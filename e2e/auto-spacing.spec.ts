import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import * as fontkit from 'fontkit';
import { auditAlphabet } from './alphabet-audit';

test.beforeEach(async ({ page }) => {
  test.setTimeout(180_000);
  await page.addInitScript(() => localStorage.setItem('fh-maker-tour-seen', '1'));
});

test('auto responds to real condensed and open letterforms without changing the slider', async ({ page }) => {
  await page.goto('/make');
  await page.getByRole('button', { name: /advanced/ }).click();
  const results: number[] = [];
  for (const name of ['condensed-impact', 'light-segoe']) {
    await page.locator('#sheet-file').setInputFiles(`e2e/fixtures/corpus/${name}.png`);
    const download = page.getByRole('button', { name: 'download woff2', exact: true });
    await expect(download).toBeVisible({ timeout: 120_000 });
    await expect(page.getByLabel('spacing', { exact: true })).toHaveValue('0');
    const spacing = await page.evaluate(() => (window as any).__lastSpacing);
    expect(spacing.mode).toBe('auto');
    results.push(spacing.pct);
    const pending = page.waitForEvent('download');
    await download.click();
    const file = test.info().outputPath(`${name}.woff2`);
    await (await pending).saveAs(file);
    const font: any = fontkit.create(readFileSync(file));
    const h = font.glyphForCodePoint(72);
    expect(h.bbox.minX).toBeGreaterThan(15);
    expect(h.advanceWidth - h.bbox.maxX).toBeGreaterThan(15);
  }
  expect(results[0]).toBeLessThan(4);
  expect(results[1]).toBeGreaterThan(results[0] + 1);
  for (const width of [375, 768, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    const help = page.getByText('auto chooses spacing from the letter shapes.', { exact: false });
    await help.screenshot({ path: test.info().outputPath(`auto-help-${width}.png`) });
    expect(await help.evaluate(el => el.getBoundingClientRect().right <= innerWidth)).toBe(true);
  }
});

test('auto keeps doodle decorations inside their margins', async ({ page }) => {
  await page.goto('/make');
  await page.locator('#sheet-file').setInputFiles('e2e/fixtures/graffiti-variation-1.png');
  await page.getByRole('button', { name: 'download woff2', exact: true }).waitFor({ timeout: 120_000 });
  expect(await page.evaluate(() => (window as any).__lastTrim)).toMatchObject({ upright: true, trimmed: 0 });
  const pending = page.waitForEvent('download');
  await page.getByRole('button', { name: 'download woff2', exact: true }).click();
  const file = test.info().outputPath('doodles.woff2');
  await (await pending).saveAs(file);
  const font: any = fontkit.create(readFileSync(file));
  const audit = await auditAlphabet(page, font);
  for (const pair of audit.pairs) expect(pair.clearance, pair.pair).toBeGreaterThan(0);
});
