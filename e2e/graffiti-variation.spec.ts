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

test('every variation sheet has independent row controls', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/make');
  await page.locator('#sheet-file').setInputFiles([1, 2, 3].map(n => `e2e/fixtures/graffiti-variation-${n}.png`));
  await expect(page.getByRole('button', { name: 'download woff2', exact: true })).toBeVisible({ timeout: 180_000 });
  let before = await exportedFont(page);
  // A different contour preset makes the edited row observably different even
  // when both slicers happen to find the same whitespace cuts.
  await page.getByRole('button', { name: 'advanced' }).click();
  await page.getByRole('button', { name: 'logo', exact: true }).click();
  for (const sheet of [2, 3]) {
    const group = page.getByRole('group', { name: `Sheet ${sheet} · variation`, exact: true });
    await expect(group).toBeVisible();
    await expect(group.getByRole('combobox')).toHaveCount(7);
    const select = group.getByRole('combobox').first();
    await select.selectOption('anchored');
    await group.getByRole('button', { name: 're-slice', exact: true }).first().click();
    await expect(group.getByRole('button', { name: 'slicing…', exact: true })).toBeVisible();
    await expect(group.getByRole('button', { name: 'slicing…', exact: true })).toHaveCount(0, { timeout: 120_000 });
    expect(await page.getByRole('alert').allTextContents()).toEqual([]);
    await expect(select).toHaveValue('anchored');
    await select.focus();
    await page.keyboard.press('Tab');
    await expect(group.getByRole('button', { name: 're-slice', exact: true }).first()).toBeFocused();
    const after = await exportedFont(page);
    expectThreeDrawings(after);
    const targetSuffix = `.cv0${sheet - 1}`;
    let changed = 0;
    for (let i = 0; i < before.numGlyphs; i++) {
      const a = before.getGlyph(i);
      const b = after.getGlyph(i);
      if (/^[A-M]/.test(a.name) && a.name.endsWith(targetSuffix)) {
        if (JSON.stringify(a.path.commands) !== JSON.stringify(b.path.commands)) changed++;
      } else if (a.name.endsWith(targetSuffix)) {
        // The edited sheet's cap-height estimate can move Q's baseline. Keep
        // its outline: only a uniform Y translation plus integer rounding is
        // allowed. Other sheets below must remain exactly unchanged.
        expect(b.path.commands.map((c: any) => c.command)).toEqual(a.path.commands.map((c: any) => c.command));
        const dy: number[] = [];
        a.path.commands.forEach((c: any, j: number) => c.args.forEach((v: number, k: number) => {
          if (k % 2 === 0) expect(b.path.commands[j].args[k], `${a.name} x`).toBe(v);
          else dy.push(b.path.commands[j].args[k] - v);
        }));
        if (dy.length) expect(Math.max(...dy) - Math.min(...dy), `${a.name} outline`).toBeLessThanOrEqual(1);
      } else {
        expect(b.path.commands, `untouched ${a.name}`).toEqual(a.path.commands);
      }
    }
    expect(changed, `sheet ${sheet}'s selected row actually changed`).toBeGreaterThan(0);
    before = after;
  }
  await expect(page.getByRole('group', { name: 'Sheet 1 · base alphabet', exact: true }).getByRole('combobox').first()).toHaveValue('auto');
  for (const width of [375, 768, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    const group = page.getByRole('group', { name: 'Sheet 3 · variation', exact: true });
    await group.screenshot({ path: test.info().outputPath(`sheet-3-${width}.png`) });
    expect(await group.evaluate(el => [el, ...el.querySelectorAll('*')].every(node => {
      const box = node.getBoundingClientRect();
      return box.left >= 0 && box.right <= innerWidth;
    })), `sheet controls fit at ${width}px`).toBe(true);
  }
  expect(errors).toEqual([]);
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
