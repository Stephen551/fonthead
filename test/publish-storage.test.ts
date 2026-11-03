// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { prepareSourceSheets, sourceSheetKeys, MAX_SOURCE_SHEET_BYTES } from '../src/lib/source-sheets';

// Use Astro's real form parsing and validation, replacing only its virtual import.
vi.mock('astro:actions', async () => import('../node_modules/astro/dist/actions/runtime/server.js'));
vi.mock('astro:schema', async () => import('zod'));
vi.mock('../src/lib/auth', () => ({
  createAuth: () => ({ api: { getSession: async () => session } }),
}));
import { server } from '../src/actions';
import { GET as cdn } from '../src/pages/cdn/[...key]';

const owner = { id: 'maker', name: 'Maker', email: 'maker@example.test' };
let session: { user: typeof owner } | null;
let sqlite: DatabaseSync;
let env: Env;
let objects: Map<string, { bytes: Uint8Array; contentType: string }>;
let failInsert = false;
let failPut = '';

beforeEach(() => {
  session = { user: owner };
  failInsert = false;
  failPut = '';
  sqlite = new DatabaseSync(':memory:');
  for (const migration of ['0001_auth.sql', '0002_app.sql', '0003_reports.sql', '0004_profile.sql', '0005_moderation.sql', '0006_downloads.sql', '0007_bug_reports.sql', '0008_maker_reviews.sql', '0009_member_activity.sql']) {
    sqlite.exec(readFileSync(new URL(`../migrations/${migration}`, import.meta.url), 'utf8'));
  }
  sqlite.exec(`INSERT INTO "user" (id, name, email, handle, createdAt, updatedAt)
    VALUES ('maker', 'Maker', 'maker@example.test', 'maker', '2026-11-01', '2026-11-01')`);
  const db = {
    prepare(sql: string) {
      let args: Array<string | number | null> = [];
      return {
        bind(...values: typeof args) { args = values; return this; },
        async first() { return sqlite.prepare(sql).get(...args) ?? null; },
        async all() { return { results: sqlite.prepare(sql).all(...args) }; },
        async run() {
          if (failInsert && sql.includes('INSERT INTO fonts')) throw new Error('D1 unavailable');
          sqlite.prepare(sql).run(...args);
          return { success: true };
        },
      };
    },
  };
  objects = new Map();
  env = {
    DB: db,
    SESSION: { async get() { return null; }, async put() {} },
    FONTS: {
      async put(key: string, bytes: Uint8Array, options: { httpMetadata: { contentType: string } }) {
        objects.set(key, { bytes: bytes.slice(), contentType: options.httpMetadata.contentType });
        if (key.includes(failPut || '\0')) throw new Error('R2 unavailable');
      },
      async delete(key: string) { objects.delete(key); },
    },
  } as unknown as Env;
});
afterEach(() => sqlite.close());

const png = readFileSync(new URL('../e2e/fixtures/corpus/natural-variation-1.png', import.meta.url));

function context() {
  return { locals: { runtime: { env } }, request: new Request('https://fonthead.dev/_actions/publishFont') };
}

function form(files: File[] = []) {
  // A real font built by the production engine passes the action's checksum gate.
  const engine: any = {};
  const load = (name: string) => readFileSync(new URL(`../public/assets/vendor/${name}`, import.meta.url), 'utf8');
  new Function('self', load('opentype.min.js')).call(engine, engine);
  new Function('self', 'opentype', load('font-engine-builder.js')).call(engine, engine, engine.opentype);
  const otf = engine.buildFontForStyle([
    { char: 'A', paths: ['M0 0 L100 0 L100 100 L0 100 Z'], cellW: 120, cellH: 120, baselineYInCell: 100 },
  ], { familyName: 'Stored Test', styleName: 'Regular', unitsPerEm: 1000 }).toArrayBuffer();
  const fd = new FormData();
  fd.set('name', 'Stored Test');
  fd.set('visibility', 'public');
  fd.set('glyphCount', '1');
  fd.set('charset', 'A');
  fd.set('mappingConfirmed', 'true');
  fd.set('spacingChecked', 'true');
  fd.set('otf', new File([otf], 'font.otf'));
  const woff2 = new Uint8Array(256);
  woff2.set([0x77, 0x4f, 0x46, 0x32]);
  fd.set('woff2', new File([woff2], 'font.woff2'));
  for (const file of files) fd.append('sourceSheets', file);
  return fd;
}

async function publish(files: File[] = []) {
  return server.publishFont.orThrow.call(context() as never, form(files));
}

describe('publish source sheets', () => {
  it('keeps an accents sheet alongside the base and variations and deletes all four with the account', async () => {
    const file = new File([png], 'sheet.png');
    const fd = form([file, file, file]);
    fd.set('supplementSheet', file);
    const { id } = await server.publishFont.orThrow.call(context() as never, fd);
    const meta = JSON.parse((sqlite.prepare('SELECT meta FROM fonts WHERE id = ?').get(id) as { meta: string }).meta);
    expect(meta.sourceSheets.map((sheet: { role: string }) => sheet.role)).toEqual(['base', 'variation-1', 'variation-2', 'supplement']);
    expect(Buffer.compare(Buffer.from(objects.get(`sources/${id}/supplement.png`)!.bytes), png)).toBe(0);
    expect((await cdn({ ...context(), params: { key: `sources/${id}/supplement.png` } } as never)).status).toBe(404);
    await server.deleteAccount.orThrow.call(context() as never, { confirm: 'DELETE' });
    expect([...objects.keys()].filter(key => key.startsWith(`sources/${id}/`))).toEqual([]);
  });
  it('rejects missing review and malformed mapping before writing any font', async () => {
    for (const field of ['mappingConfirmed', 'spacingChecked', 'charset']) {
      const fd = form();
      fd.delete(field);
      await expect(server.publishFont.orThrow.call(context() as never, fd)).rejects.toThrow(/check the character mapping and spacing/);
    }
    const fd = form();
    fd.set('charset', 'AA□');
    await expect(server.publishFont.orThrow.call(context() as never, fd)).rejects.toThrow(/check the character mapping and spacing/);
    expect(objects.size).toBe(0);
  });
  it('stores exact original bytes, records the font ID, and keeps them off the CDN', async () => {
    const file = new File([png], 'wrong-extension.jpg', { type: 'text/plain' });
    const { id } = await publish([file, file, file]);
    const row = sqlite.prepare('SELECT meta FROM fonts WHERE id = ?').get(id) as { meta: string };
    const sheets = JSON.parse(row.meta).sourceSheets;
    expect(sheets.map((sheet: { key: string }) => sheet.key)).toEqual([
      `sources/${id}/base.png`, `sources/${id}/variation-1.png`, `sources/${id}/variation-2.png`,
    ]);
    for (const sheet of sheets) {
      expect(Buffer.compare(Buffer.from(objects.get(sheet.key)!.bytes), png)).toBe(0);
      expect(sheet.contentType).toBe('image/png');
      expect(sheet.size).toBe(png.length);
      const response = await cdn({ ...context(), params: { key: sheet.key } } as unknown as Parameters<typeof cdn>[0]);
      expect(response.status).toBe(404);
    }
    expect(objects.size).toBe(5);
  });

  it('accepts older clients without an original sheet', async () => {
    const { id } = await publish();
    expect(JSON.parse((sqlite.prepare('SELECT meta FROM fonts WHERE id = ?').get(id) as { meta: string }).meta).sourceSheets).toEqual([]);
    expect(objects.size).toBe(2);
  });

  it('rejects invalid images and excess files before writing objects', async () => {
    await expect(publish([new File(['<svg/>'], 'sheet.png', { type: 'image/png' })])).rejects.toThrow(/PNG, JPEG, or WebP/);
    const file = new File([png], 'sheet.png');
    await expect(publish([file, file, file, file])).rejects.toThrow();
    expect(objects.size).toBe(0);
    expect(sqlite.prepare('SELECT count(*) AS n FROM fonts').get()).toMatchObject({ n: 0 });
  });

  it('checks source sizes before reading bytes', async () => {
    const arrayBuffer = vi.fn();
    await expect(prepareSourceSheets('test', [{ size: MAX_SOURCE_SHEET_BYTES + 1, arrayBuffer } as unknown as File])).rejects.toThrow(/10 MB/);
    expect(arrayBuffer).not.toHaveBeenCalled();
  });

  for (const failure of ['D1', 'R2']) {
    it(`rolls back fonts and sheets when ${failure} fails`, async () => {
      failInsert = failure === 'D1';
      failPut = failure === 'R2' ? '/base.png' : '';
      await expect(publish([new File([png], 'sheet.png')])).rejects.toThrow(/Publish failed/);
      expect(objects.size).toBe(0);
      expect(sqlite.prepare('SELECT count(*) AS n FROM fonts').get()).toMatchObject({ n: 0 });
    });
  }

  for (const action of ['deleteOwnFont', 'removeFont', 'deleteAccount'] as const) {
    it(`${action} purges the original sheets with the font`, async () => {
      const { id } = await publish([new File([png], 'sheet.png')]);
      expect(objects.has(`sources/${id}/base.png`)).toBe(true);
      env.ADMIN_EMAILS = owner.email;
      if (action === 'deleteAccount') {
        await server.deleteAccount.orThrow.call(context() as never, { confirm: 'delete' });
      } else {
        await server[action].orThrow.call(context() as never, { fontId: id });
      }
      expect(objects.size).toBe(0);
      expect(sqlite.prepare('SELECT count(*) AS n FROM fonts').get()).toMatchObject({ n: 0 });
    });
  }

  it('preserves source references when the font is renamed', async () => {
    const { id } = await publish([new File([png], 'sheet.png')]);
    await server.updateOwnFont.orThrow.call(context() as never, { fontId: id, name: 'Renamed', license: 'cc0' });
    const meta = JSON.parse((sqlite.prepare('SELECT meta FROM fonts WHERE id = ?').get(id) as { meta: string }).meta);
    expect(meta.sourceSheets[0].key).toBe(`sources/${id}/base.png`);
    expect(objects.has(meta.sourceSheets[0].key)).toBe(true);
  });

  it('never deletes another font or an unrelated object through source metadata', () => {
    const meta = JSON.stringify({ sourceSheets: [
      { key: 'sources/mine/base.png' }, { key: 'sources/other/base.png' },
      { key: 'sources/mine/../../fonts/other.otf' }, { key: 'avatars/maker.png' }, null,
    ] });
    expect(sourceSheetKeys('mine', meta)).toEqual(['sources/mine/base.png']);
    for (const raw of ['{}', 'null', 'broken', '{"sourceSheets":"wrong"}']) {
      expect(sourceSheetKeys('mine', raw)).toEqual([]);
    }
  });
});
