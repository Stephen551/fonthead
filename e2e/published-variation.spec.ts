import { test, expect, type Locator, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';

// This exported three-sheet font has calt. Use it on real specimen elements so
// the check includes the site's inherited CSS and letter spacing, not just GSUB.
const fontData = readFileSync('e2e/fixtures/portrait-variation.woff2').toString('base64');

async function checkSpecimen(page: Page, specimen: Locator, label: string) {
  await page.evaluate(async data => {
    const face = new FontFace('VariationRegression', `url(data:font/woff2;base64,${data})`);
    document.fonts.add(await face.load());
  }, fontData);
  await specimen.evaluate(el => {
    el.textContent = 'aaaaaa';
    el.style.fontFamily = 'VariationRegression';
    el.style.fontSize = '32px';
  });
  for (const width of [375, 768, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    await specimen.scrollIntoViewIfNeeded();
    await page.evaluate(() => document.fonts.ready);
    await expect(specimen).toHaveCSS('font-feature-settings', '"calt"');
    const original = await specimen.screenshot({ path: test.info().outputPath(`${label}-${width}.png`) });
    await specimen.evaluate(el => el.style.fontFeatureSettings = '"calt" 0');
    const off = await specimen.screenshot();
    await specimen.evaluate(el => el.style.fontFeatureSettings = '"calt" 1');
    const on = await specimen.screenshot({ path: test.info().outputPath(`${label}-${width}-explicit-on.png`) });
    await specimen.evaluate(el => el.style.removeProperty('font-feature-settings'));
    expect(on.equals(off), `${label} font visibly varies at ${width}px`).toBe(false);
    // Default rendering must differ from disabled alternates. Comparing two
    // enabled captures byte-for-byte is fragile after the centered run changes
    // width: subpixel positioning can change antialiasing without changing glyphs.
    expect(original.equals(off), `${label} varies by default at ${width}px`).toBe(false);
    await specimen.screenshot({ path: test.info().outputPath(`${label}-${width}.png`) });
  }
}

test('published card and detail specimens keep contextual alternates enabled', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/?sort=new');
  const card = page.locator('.fh-card').first();
  const href = await card.locator('a').first().getAttribute('href');
  const specimen = card.locator('[data-font]');
  await specimen.scrollIntoViewIfNeeded();
  await expect.poll(() => specimen.evaluate(el => el.style.fontFamily)).toContain('fh-');
  await checkSpecimen(page, specimen, 'card');
  await page.goto(href!);
  await checkSpecimen(page, page.locator('#specimen'), 'detail');
  expect(errors).toEqual([]);
});
