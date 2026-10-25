import { test, expect, type Page } from '@playwright/test';
import * as fontkit from 'fontkit';
import { readFileSync, mkdirSync } from 'node:fs';
import { verifySfntChecksums } from '../src/lib/sfnt';

const rows = [
  'ABCDEFGHIJKLM', 'NOPQRSTUVWXYZ', 'abcdefghijklm', 'nopqrstuvwxyz',
  '0123456789', '!?@#$%^&*()-_+=[]', '{};:\'",.<>/\\|',
];

test.beforeEach(async ({ page }) => {
  test.setTimeout(240_000);
  await page.addInitScript(() => {
    localStorage.setItem('fh-maker-tour-seen', '1');
    localStorage.removeItem('fh-gen-charset');
  });
});

async function exportedFont(page: Page) {
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'download woff2', exact: true }).click(),
  ]);
  const path = test.info().outputPath('Handmade.woff2');
  await download.saveAs(path);
  return (fontkit as any).create(readFileSync(path));
}

function expectThreeDrawings(font: any) {
  expect(font.availableFeatures).toContain('calt');
  for (const char of rows.join('')) {
    expect(new Set(font.layout(char.repeat(6)).glyphs.map((g: any) => g.id)).size, char).toBe(3);
  }
}

test('adding variation slots updates preview and export automatically', async ({ page }) => {
  await page.goto('/make');
  await page.locator('#sheet-file').setInputFiles('e2e/fixtures/graffiti-variation-1.png');
  const download = page.getByRole('button', { name: 'download woff2', exact: true });
  await expect(download).toBeVisible({ timeout: 120_000 });
  await page.getByRole('button', { name: 'advanced' }).click();
  await page.getByRole('button', { name: /natural variation/ }).click();
  for (const slot of [0, 1]) {
    await page.locator(`#variation-file-${slot}`).setInputFiles(`e2e/fixtures/graffiti-variation-${slot + 2}.png`);
    // No stale single-sheet font may remain downloadable while new sheets build.
    await expect(download).not.toBeVisible();
    await expect(download).toBeVisible({ timeout: 120_000 });
    expect(await page.evaluate(() => (window as any).__lastBuild.variants)).toBe(slot + 1);
  }
  expectThreeDrawings(await exportedFont(page));
  const input = page.getByRole('textbox', { name: 'Type to preview your font' });
  await input.fill('AAAAAA aaaaaa');
  const preview = input.locator('xpath=preceding-sibling::div[1]');
  const varied = await preview.screenshot({ path: test.info().outputPath('variation-preview.png') });
  await preview.evaluate(el => (el as HTMLElement).style.fontFeatureSettings = '"calt" 0');
  expect(varied.equals(await preview.screenshot()), 'live preview uses the alternate drawings').toBe(false);
  await preview.evaluate(el => (el as HTMLElement).style.fontFeatureSettings = '');
  await expect(page.getByText('natural variation: 3 sheets', { exact: false })).toBeVisible();
});

test('re-slicing a varied font preserves all three drawings and the base sheet', async ({ page }) => {
  await page.goto('/make');
  await page.locator('#sheet-file').setInputFiles([1, 2, 3].map(n => `e2e/fixtures/graffiti-variation-${n}.png`));
  await expect(page.getByRole('button', { name: 'download woff2', exact: true })).toBeVisible({ timeout: 180_000 });
  const before = await exportedFont(page);
  const slice = page.getByRole('button', { name: 're-slice', exact: true }).first();
  await slice.click();
  await expect(page.getByRole('button', { name: 'slicing…', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'slicing…', exact: true })).toHaveCount(0, { timeout: 120_000 });
  expect(await page.getByRole('alert').allTextContents()).toEqual([]);
  const after = await exportedFont(page);
  expectThreeDrawings(after);
  for (const char of rows.join('')) {
    expect(after.glyphForCodePoint(char.codePointAt(0)).path.commands, `base ${char}`).toEqual(before.glyphForCodePoint(char.codePointAt(0)).path.commands);
  }
  expect(await page.evaluate(() => (window as any).__lastBuild.variants)).toBe(2);
});

test('decorated seven-row sheets build a complete three-drawing variation font', async ({ page }) => {
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
