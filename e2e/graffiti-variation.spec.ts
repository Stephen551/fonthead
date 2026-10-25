import { test, expect } from '@playwright/test';
import * as fontkit from 'fontkit';
import { readFileSync, mkdirSync } from 'node:fs';
import { verifySfntChecksums } from '../src/lib/sfnt';

const rows = [
  'ABCDEFGHIJKLM', 'NOPQRSTUVWXYZ', 'abcdefghijklm', 'nopqrstuvwxyz',
  '0123456789', '!?@#$%^&*()-_+=[]', '{};:\'",.<>/\\|',
];

test('decorated seven-row sheets build a complete three-drawing variation font', async ({ page }) => {
  test.setTimeout(240_000);
  await page.addInitScript(() => {
    localStorage.setItem('fh-maker-tour-seen', '1');
    localStorage.removeItem('fh-gen-charset');
  });
  await page.goto('/make');
  await page.locator('#font-name').fill('Graffiti Variations');
  await page.locator('#sheet-file').setInputFiles([1, 2, 3].map(n => `e2e/fixtures/graffiti-variation-${n}.png`));
  await expect(page.getByRole('button', { name: 'download otf', exact: true })).toBeVisible({ timeout: 180_000 });
  await expect(page.getByRole('textbox', { name: 'Charset, one row of characters per line' })).toHaveValue(rows.join('\n'));
  expect(await page.evaluate(() => (window as any).__lastBuild)).toMatchObject({ glyphCount: 92, variants: 2, kind: 'mono' });
  expect(await page.getByRole('alert').allTextContents()).toEqual([]);
  mkdirSync('test-results/graffiti-export', { recursive: true });
  let named: any;
  for (const format of ['otf', 'ttf', 'woff2']) {
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: `download ${format}`, exact: true }).click(),
    ]);
    const path = `test-results/graffiti-export/Graffiti-Variations.${format}`;
    await download.saveAs(path);
    const bytes = readFileSync(path);
    if (format !== 'woff2') expect(verifySfntChecksums(bytes).errors).toEqual([]);
    const font: any = (fontkit as any).create(bytes);
    if (format === 'otf') named = font;
    // The first sheet's zero must be the oval drawing, not the narrow tip of
    // the next row's exclamation mark. Coverage alone cannot catch shifted cuts.
    const zero = font.glyphForCodePoint(48).bbox;
    expect((zero.maxX - zero.minX) / (zero.maxY - zero.minY), `${format}: zero retains its oval shape`).toBeGreaterThan(0.6);
    for (const char of rows.join('')) {
      expect(font.hasGlyphForCodePoint(char.codePointAt(0)), `${format}: ${char}`).toBe(true);
      const run = font.layout(char.repeat(6));
      // TTF preserves glyph IDs but omits the PostScript names.
      const names = run.glyphs.map((g: any) => named.getGlyph(g.id).name);
      const base = names[0];
      expect(names, `${format}: all three drawings of ${char}`).toEqual([
        base, base + '.cv01', base + '.cv02', base + '.cv01', base + '.cv02', base + '.cv01',
      ]);
      for (const g of run.glyphs) expect(g.path.commands.length, `${format}: nonempty ${char}`).toBeGreaterThan(0);
    }
  }
  await page.getByRole('textbox', { name: 'Type to preview your font' }).fill('BALLOON graffiti 0123456789');
  await page.screenshot({ path: 'test-results/graffiti-export/maker.png', fullPage: true });
});
