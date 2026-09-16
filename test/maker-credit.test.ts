// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { getFont, getFontsByIds, listFontsByOwner, listPublicFonts, makerProfileUrl } from '../src/lib/fonts';
import { GET as sitemap } from '../src/pages/sitemap.xml';

let sqlite: DatabaseSync;
let db: D1Database;

beforeEach(() => {
  sqlite = new DatabaseSync(':memory:');
  for (const migration of ['0001_auth.sql', '0002_app.sql', '0006_downloads.sql']) {
    sqlite.exec(readFileSync(new URL(`../migrations/${migration}`, import.meta.url), 'utf8'));
  }
  // Run the production queries against SQLite, adapting only D1's async shape.
  db = {
    prepare(sql: string) {
      const statement = sqlite.prepare(sql);
      let args: Array<string | number | null> = [];
      return {
        bind(...values: typeof args) { args = values; return this; },
        async first() { return statement.get(...args) ?? null; },
        async all() { return { results: statement.all(...args) }; },
      };
    },
  } as unknown as D1Database;
  sqlite.exec(`
    INSERT INTO "user" (id, name, email, handle, createdAt, updatedAt)
    VALUES ('live', 'Live Maker', 'live@example.test', 'live-maker', '2026-09-16', '2026-09-16'),
           ('deleted', 'Deleted Maker', 'deleted@example.test', 'deleted-maker', '2026-09-16', '2026-09-16');
    INSERT INTO fonts (id, owner_id, name, maker_handle, specimen_word, visibility, meta)
    VALUES ('active-font', 'live', 'Active Font', 'live-maker', 'Active', 'public', '{}'),
           ('private-font', 'live', 'Private Font', 'live-maker', 'Private', 'private', '{}'),
           ('deleted-font', 'deleted', 'Deleted Font', 'deleted-maker', 'Kept', 'public', '{}'),
           ('imported-font', NULL, 'Imported Font', 'a-c-meridian', 'Imported', 'public', '{}'),
           ('stand-in', NULL, 'Stand In', 'Original Designer', 'Stand In', 'public', '{"standIn":true}');
    DELETE FROM "user" WHERE id = 'deleted';
  `);
});

afterEach(() => sqlite.close());

describe('maker profile availability', () => {
  it('links a live owner and retains deleted/imported fonts without profile links', async () => {
    expect(makerProfileUrl((await getFont(db, 'active-font'))!)).toBe('/u/live-maker');
    for (const id of ['deleted-font', 'imported-font', 'stand-in']) {
      const font = await getFont(db, id);
      expect(font).not.toBeNull();
      expect(font!.makerExists).toBe(false);
      expect(makerProfileUrl(font!)).toBeNull();
    }
  });

  it('does not give an orphaned font to a new account that reclaims its handle', async () => {
    sqlite.exec(`INSERT INTO "user" (id, name, email, handle, createdAt, updatedAt)
      VALUES ('replacement', 'Replacement', 'replacement@example.test', 'deleted-maker', '2026-09-16', '2026-09-16')`);
    const font = (await getFont(db, 'deleted-font'))!;
    expect(font.maker_handle).toBe('deleted-maker');
    expect(makerProfileUrl(font)).toBeNull();
  });

  it('does not link stale credits to a different handle', async () => {
    sqlite.exec(`UPDATE "user" SET handle = 'changed-maker' WHERE id = 'live'`);
    expect(makerProfileUrl((await getFont(db, 'active-font'))!)).toBeNull();
  });

  it('keeps public counts, search and pagination while resolving card authors', async () => {
    const all = await listPublicFonts(db, 'popular');
    expect(all.total).toBe(4);
    expect(all.items.find((f) => f.id === 'active-font')?.makerExists).toBe(true);
    expect(all.items.find((f) => f.id === 'deleted-font')?.makerExists).toBe(false);
    const page = await listPublicFonts(db, 'new', { limit: 2, offset: 1 });
    expect(page.items).toHaveLength(2);
    expect(page.total).toBe(4);
    const search = await listPublicFonts(db, 'popular', { q: 'a-c-meridian' });
    expect(search.items.map((f) => f.id)).toEqual(['imported-font']);
    expect(search.items[0].makerExists).toBe(false);
  });

  it('resolves featured and related fonts without exposing private fonts', async () => {
    const fonts = await getFontsByIds(db, ['deleted-font', 'active-font', 'private-font', 'missing']);
    expect(fonts.map((f) => [f.id, f.makerExists])).toEqual([['deleted-font', false], ['active-font', true]]);
    expect(await getFontsByIds(db, [])).toEqual([]);
    expect((await listFontsByOwner(db, 'live', false)).map((f) => f.id)).toEqual(['active-font']);
    expect((await listFontsByOwner(db, 'live', true)).every((f) => f.makerExists)).toBe(true);
    expect(await getFont(db, 'missing')).toBeNull();
  });

  it('keeps orphaned font URLs in the sitemap but excludes missing maker profiles', async () => {
    const response = await sitemap({
      locals: { runtime: { env: { DB: db } } },
      url: new URL('https://fonthead.dev/sitemap.xml'),
    } as unknown as Parameters<typeof sitemap>[0]);
    const xml = await response.text();
    expect(xml).toContain('/f/deleted-font');
    expect(xml).toContain('/f/imported-font');
    expect(xml).toContain('/u/live-maker');
    expect(xml).not.toContain('/u/deleted-maker');
    expect(xml).not.toContain('/u/a-c-meridian');
    expect(xml).not.toContain('/f/private-font');
  });
});
