import { test, expect } from '@playwright/test';
import { readdirSync, readFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { verifySfntChecksums } from '../src/lib/sfnt';
import { isOtf } from '../src/lib/fontsig';

// The color lint. Every color fixture builds through the real engine (flat
// COLRv0/CPAL or gradient COLRv1 by name prefix) and the result is gated:
// valid sfnt, COLR authored (never the silent mono fallback), rows aligned,
// charset coverage, palette size, and the confidence-flag counts.
//
// The former defect baselines are now strict expectations: paper-edge blends
// cannot create extra palette entries, punctuation keeps its detached marks,
// and a shadowed gradient must preserve the same charset as a clean sheet.
//
// Field-failure PNGs dropped into e2e/fixtures/corpus-color/ build too; an
// unknown name gets the strict defaults (palette ungated, zero flags, full
// coverage) so a broken field sheet lands red. A
// per-fixture strip + a contact sheet land in test-results for the thirty-
// second eyeball pass (Chromium renders COLR in color).

const ROOT = process.cwd();
const CORPUS_DIR = join(ROOT, 'e2e', 'fixtures', 'corpus-color');
const OUT_DIR = join(ROOT, 'test-results');
const STRIPS = join(OUT_DIR, 'corpus-color-strips');

// Intended palette sizes and live-kerning requirements for the fixed fixtures.
type FixtureExpect = {
  palette?: number;
  gpos?: boolean;
};
const EXPECT: Record<string, FixtureExpect> = {
  'flat-2color': { palette: 2, gpos: true },
  'flat-3color': { palette: 3 },
  'flat-shadow': { palette: 2 },
  'flat-light': { palette: 2 },
  'flat-outline': { palette: 2 },
  'flat-lowres': { palette: 2 },
  'gradient-basic': { gpos: true },
  'gradient-shadow': { gpos: true },
};

// 13+13+13+13+10+11 cells; the charset guess pins letters and digits exactly.
const FULL_CHARSET = 73;
const GLYPHS_MIN = 70;

const sheets = readdirSync(CORPUS_DIR)
  .filter((f) => f.endsWith('.png'))
  .map((f) => ({ name: f.replace('.png', ''), path: join(CORPUS_DIR, f) }));

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    try {
      localStorage.setItem('fh-maker-tour-seen', '1');
    } catch {
      /* private mode */
    }
  });
});

// --- sfnt table reads (offsets per the OpenType spec) ----------------------
function tableSlice(b: Uint8Array, tag: string): Uint8Array | null {
  const u16 = (o: number) => (b[o] << 8) | b[o + 1];
  const u32 = (o: number) => b[o] * 0x1000000 + (b[o + 1] << 16) + (b[o + 2] << 8) + b[o + 3];
  const n = u16(4);
  for (let i = 0; i < n; i++) {
    const rec = 12 + i * 16;
    const t = String.fromCharCode(b[rec], b[rec + 1], b[rec + 2], b[rec + 3]);
    if (t === tag) return b.subarray(u32(rec + 8), u32(rec + 8) + u32(rec + 12));
  }
  return null;
}
const u16At = (t: Uint8Array, o: number) => (t[o] << 8) | t[o + 1];

for (const sheet of sheets) {
  const mode = sheet.name.startsWith('gradient') ? 'gradient' : 'flat';
  const exp = EXPECT[sheet.name] ?? {};

  test(`color corpus: ${sheet.name}`, async ({ page }) => {
    await page.goto('/make');
    await page.getByRole('button', { name: `color · ${mode}`, exact: true }).click();
    await page.locator('#sheet-file').setInputFiles(sheet.path);
    await expect(page.getByRole('button', { name: 'download otf' })).toBeVisible({ timeout: 150_000 });

    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: 'download otf' }).click(),
    ]);
    const otfPath = test.info().outputPath(`${sheet.name}.otf`);
    await download.saveAs(otfPath);
    const otf = new Uint8Array(readFileSync(otfPath));

    const lb = await page.evaluate(() => (window as any).__lastBuild);
    const lc = await page.evaluate(() => (window as any).__lastColor);
    const charset = await page.getByLabel('Charset, one row of characters per line').inputValue();

    console.log(
      `COLOR-CORPUS | ${sheet.name.padEnd(18)} | ${mode} glyphs=${lb.glyphCount} colr=${lc.colrStatus} ` +
        `rowWarn=${lc.rowWarning ? 'YES' : 'no'} glow=${lc.glowWarning} flags=${JSON.stringify(lc.flags)}`,
    );

    // strip for the contact sheet, rendered before the gates below so a
    // fixture that fails an assertion still lands a strip on the contact sheet
    const b64 = readFileSync(otfPath).toString('base64');
    await page.setContent(`
      <style>@font-face { font-family: f; src: url(data:font/otf;base64,${b64}); }</style>
      <div id="strip" style="background:#fff;padding:10px 16px;width:1100px;">
        <div style="font-family:monospace;font-size:12px;color:#888;">${sheet.name}</div>
        <div style="font-family:f;font-size:42px;white-space:nowrap;">The quick brown fox jumps over</div>
        <div style="font-family:f;font-size:42px;white-space:nowrap;">AVATAR To 0123456789 .,!?</div>
      </div>`);
    await page.waitForTimeout(400);
    mkdirSync(STRIPS, { recursive: true });
    await page.locator('#strip').screenshot({ path: join(STRIPS, `${sheet.name}.png`) });

    if (EXPECT[sheet.name]) {
      expect(charset, 'template character order').toBe(
        "ABCDEFGHIJKLM\nNOPQRSTUVWXYZ\nabcdefghijklm\nnopqrstuvwxyz\n0123456789\n.,!?:;'-&@#",
      );
      expect(lb.glyphCount, 'all fixture characters survive').toBe(FULL_CHARSET);
    }

    // validity
    expect(isOtf(otf), 'real OTF signature').toBe(true);
    const check = verifySfntChecksums(otf);
    expect(check.ok, `sfnt checksums valid: ${check.errors.join('; ')}`).toBe(true);

    // COLR authored, hard gate: a silent mono fallback is a failure
    expect(lc.colrStatus, 'COLR authoring').toBe('ok');

    // rows aligned + coverage
    expect(lc.rowWarning, 'row alignment').toBe('');
    expect(lb.glyphCount, 'charset coverage').toBeGreaterThanOrEqual(GLYPHS_MIN);
    expect(lb.glyphCount, 'charset coverage (over-slice)').toBeLessThanOrEqual(FULL_CHARSET + 2);

    // table structure
    const colr = tableSlice(otf, 'COLR');
    const cpal = tableSlice(otf, 'CPAL');
    expect(colr, 'COLR present').not.toBeNull();
    expect(cpal, 'CPAL present').not.toBeNull();
    if (mode === 'flat') {
      expect(u16At(colr!, 0), 'COLR version').toBe(0);
      // every colored base glyph keeps at least one layer
      expect(u16At(colr!, 2), 'base glyph records').toBeGreaterThanOrEqual(lb.glyphCount - 2);
      if (exp.palette != null) expect(u16At(cpal!, 2), 'CPAL palette entries').toBe(exp.palette);
    } else {
      expect(u16At(colr!, 0), 'COLR version').toBe(1);
    }

    // live kerning: Chrome and Firefox position from GPOS only; the legacy
    // kern table this path used to describe was never written on the main
    // thread (no GPOS writer loaded) so color fonts shipped un-kerned
    if (exp.gpos) {
      expect(tableSlice(otf, 'GPOS'), 'GPOS PairPos present').not.toBeNull();
    }

    // Clean fixtures cannot silently lose punctuation or counters.
    for (const f of ['stray', 'filled', 'empty'] as const) {
      expect(lc.flags[f] ?? 0, `${f} flags`).toBe(0);
    }
  });
}

test('color contact sheet', async ({ page }) => {
  // Mirrors the mono contact sheet: skip when no fixture rendered a strip
  // (every fixture failing its gates leaves nothing to eyeball).
  if (!existsSync(STRIPS)) test.skip();
  const strips = readdirSync(STRIPS).filter((f) => f.endsWith('.png'));
  expect(strips.length, 'strips rendered by the fixture tests').toBeGreaterThan(0);
  const imgs = strips
    .map((f) => `<img style="display:block;" src="data:image/png;base64,${readFileSync(join(STRIPS, f)).toString('base64')}">`)
    .join('');
  await page.setContent(`<div id="contact" style="background:#fff;">${imgs}</div>`);
  await page.locator('#contact').screenshot({ path: join(OUT_DIR, 'corpus-color-contact.png') });
});
