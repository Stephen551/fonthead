import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import * as fontkit from 'fontkit';
import { EXTENDED_LATIN_ROWS } from '../src/lib/charsets';
import { verifySfntChecksums } from '../src/lib/sfnt';

// Ë's fine-detail trace has a detached serif in its body, plus the two dots.
const contours: Record<string, number> = { Ê: 2, Ë: 4, Ē: 2, Ė: 2, Ì: 2, Í: 2, Î: 2, Ï: 3, Ī: 2,
  Ñ: 2, Ò: 3, Ó: 3, Ô: 3, Õ: 3, Ö: 4, ď: 3, ť: 2, Ą: 2 };
function verifyMarks(font: any, format: string) {
  for (const [char, count] of Object.entries(contours)) {
    const g = font.glyphForCodePoint(char.codePointAt(0));
    expect(g.path.commands.filter((p: any) => p.command === 'moveTo'), `${format} ${char} keeps its own marks only`).toHaveLength(count);
  }
  for (const char of EXTENDED_LATIN_ROWS.join('')) {
    expect(font.glyphForCodePoint(char.codePointAt(0)).id, char).toBeGreaterThan(0);
  }
  for (const char of 'ÊËĒĖÌÍÎÏĪÑÒÓÔÕÖťď') {
    expect(Math.abs(font.glyphForCodePoint(char.codePointAt(0)).bbox.minY), char + ' baseline').toBeLessThan(2);
  }
}

test('tight supplement keeps row-two marks and overlapping side carons through exports and row edits', async ({ page }) => {
  test.setTimeout(240_000);
  await page.addInitScript(() => {
    localStorage.setItem('fh-maker-tour-seen', '1');
    localStorage.setItem('fh-test-no-autoconnect', '1');
  });
  await page.goto('/make');
  await page.locator('#supplement-file').setInputFiles('e2e/fixtures/tight-extended-latin-sheet.png');
  await page.locator('#sheet-file').setInputFiles('e2e/fixtures/luxury-serif-sheet.png');
  const download = page.getByRole('button', { name: 'download woff2', exact: true });
  await expect(download).toBeVisible({ timeout: 150_000 });
  expect(await page.getByRole('alert').allTextContents()).toEqual([]);
  const exported = async (format: string) => {
    const pending = page.waitForEvent('download');
    await page.getByRole('button', { name: `download ${format}`, exact: true }).click();
    const file = test.info().outputPath(`tight-accents.${format}`);
    await (await pending).saveAs(file);
    const bytes = readFileSync(file);
    if (format !== 'woff2') expect(verifySfntChecksums(bytes).ok).toBe(true);
    const font: any = fontkit.create(bytes);
    verifyMarks(font, format);
    expect(font.characterSet.filter((cp: number) => ![0, 32, 65535].includes(cp))).toHaveLength(214);
  };
  for (const format of ['otf', 'ttf', 'woff2']) await exported(format);
  const sheet = page.getByRole('group', { name: 'Sheet 2 · accents', exact: true });
  await expect(sheet.getByRole('listitem')).toHaveCount(122);
  for (const row of [1, 5]) {
    await sheet.getByRole('combobox').nth(row).selectOption('whitespace');
    await sheet.getByRole('button', { name: 're-slice', exact: true }).nth(row).click();
    await expect(sheet.getByRole('button', { name: 'slicing…', exact: true })).toHaveCount(0, { timeout: 120_000 });
    await exported('woff2');
  }
});
