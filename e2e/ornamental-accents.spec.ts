import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import * as fontkit from 'fontkit';
import { verifySfntChecksums } from '../src/lib/sfnt';

test('ornamental supplement preserves detached y descender curls through exports and re-slicing', async ({ page }) => {
  test.setTimeout(240_000);
  await page.addInitScript(() => localStorage.setItem('fh-maker-tour-seen', '1'));
  await page.goto('/make');
  await page.locator('#supplement-file').setInputFiles('e2e/fixtures/ornamental-extended-latin-sheet.png');
  await page.locator('#sheet-file').setInputFiles('e2e/fixtures/ornate-serif-sheet.png');
  await expect(page.getByRole('button', { name: 'download otf', exact: true })).toBeVisible({ timeout: 150_000 });
  const exported = async (format: string) => {
    const pending = page.waitForEvent('download');
    await page.getByRole('button', { name: `download ${format}`, exact: true }).click();
    const file = test.info().outputPath(`ornamental-extended.${format}`);
    await (await pending).saveAs(file);
    const bytes = readFileSync(file);
    if (format !== 'woff2') expect(verifySfntChecksums(bytes).ok).toBe(true);
    const font: any = fontkit.create(bytes);
    expect(font.characterSet.filter((cp: number) => ![0, 32, 65535].includes(cp))).toHaveLength(214);
    for (const [char, count] of [['ý', 5], ['ÿ', 6]] as const) {
      const glyph = font.glyphForCodePoint(char.codePointAt(0)!);
      // Body, two tiny internal contours, above mark(s), and the separate
      // bottom curl. Before the fix only that last contour was discarded.
      expect(glyph.path.commands.filter((c: any) => c.command === 'moveTo'), `${format} ${char} curl`).toHaveLength(count);
      expect(glyph.bbox.minY, `${format} ${char} descends below its baseline`).toBeLessThan(-200);
    }
  };
  for (const format of ['otf', 'ttf', 'woff2']) await exported(format);
  const sheet = page.getByRole('group', { name: 'Sheet 2 · accents', exact: true });
  await expect(sheet.getByRole('listitem')).toHaveCount(122);
  await sheet.getByRole('combobox').nth(5).selectOption('whitespace');
  await sheet.getByRole('button', { name: 're-slice', exact: true }).nth(5).click();
  await expect(sheet.getByRole('button', { name: 'slicing…', exact: true })).toHaveCount(0, { timeout: 120_000 });
  await exported('woff2');
});
