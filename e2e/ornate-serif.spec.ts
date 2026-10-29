import { test, expect } from '@playwright/test';
import { readFileSync, writeFileSync } from 'node:fs';
import * as fontkit from 'fontkit';
import { auditAlphabet } from './alphabet-audit';
import { verifySfntChecksums } from '../src/lib/sfnt';

test('ornate serif tucks l-p while keeping flourishes clear in every export', async ({ page }) => {
  test.setTimeout(180_000);
  await page.addInitScript(() => localStorage.setItem('fh-maker-tour-seen', '1'));
  await page.goto('/make');
  await page.locator('#sheet-file').setInputFiles('e2e/fixtures/ornate-serif-sheet.png');
  await expect(page.getByRole('button', { name: 'download otf', exact: true })).toBeVisible({ timeout: 120_000 });
  expect(await page.evaluate(() => (window as any).__lastSpacing.mode)).toBe('auto');
  for (const format of ['otf', 'ttf', 'woff2']) {
    const pending = page.waitForEvent('download');
    await page.getByRole('button', { name: `download ${format}`, exact: true }).click();
    const file = test.info().outputPath(`ornate-serif.${format}`);
    await (await pending).saveAs(file);
    const bytes = readFileSync(file);
    if (format !== 'woff2') expect(verifySfntChecksums(new Uint8Array(bytes)).ok).toBe(true);
    const font: any = fontkit.create(bytes);
    expect(font.characterSet.filter((cp: number) => ![0, 32, 65535].includes(cp))).toHaveLength(92);
    const run = font.layout('lp', ['kern']);
    // The old whole-outline guard limited this pair to -57 despite the
    // bottom curl and descending tail occupying different heights.
    expect(run.positions[0].xAdvance - run.glyphs[0].advanceWidth).toBeLessThan(-150);
    expect(run.positions[1].yOffset).toBe(0);
    const audit = await auditAlphabet(page, font);
    writeFileSync(test.info().outputPath(`${format}-alphabet-audit.json`), JSON.stringify(audit, null, 2));
    for (const pair of audit.pairs) expect(pair.clearance, `${format} ${pair.pair} stays clear`).toBeGreaterThan(0);
  }
});
