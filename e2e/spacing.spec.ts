import { test, expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';

// Skip the maker onboarding modal so it does not block the flow. This spec tests
// the spacing knob, which connect mode disables, so pin connect auto-detect off
// (the sample sheet can read as script under CI's font fallback and would
// otherwise auto-connect and grey out the spacing control).
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    try {
      localStorage.setItem('fh-maker-tour-seen', '1');
      localStorage.setItem('fh-test-no-autoconnect', '1');
    } catch {
      /* private mode */
    }
  });
});

// The spacing knob. Auto keeps the sheet's own pitch (cell-width advance, the
// historical default); a positive value rebuilds on tight advance with that
// percent of UPM per side. Proven on real bytes: download both builds' OTFs
// and compare a glyph's advance width via the page's own opentype.js.

async function advanceOfH(page: Page, otfPath: string): Promise<number> {
  const b64 = readFileSync(otfPath).toString('base64');
  return page.evaluate((b) => {
    const bin = atob(b);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const font = (window as unknown as { opentype: { parse: (b: ArrayBuffer) => { charToGlyph: (c: string) => { advanceWidth: number } } } }).opentype.parse(bytes.buffer);
    return font.charToGlyph('H').advanceWidth;
  }, b64);
}

async function downloadOtf(page: Page, to: string): Promise<string> {
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'download otf' }).click(),
  ]);
  const p = test.info().outputPath(to);
  await download.saveAs(p);
  return p;
}

test('the spacing knob changes the built advance widths', async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto('/make');

  // build the sample at auto spacing and capture H's advance
  await page.getByRole('button', { name: 'try a sample sheet', exact: true }).click();
  await expect(page.getByRole('button', { name: 'download otf' })).toBeVisible({ timeout: 60_000 });
  const autoAdvance = await advanceOfH(page, await downloadOtf(page, 'auto.otf'));

  // open advanced, push spacing to 12 (loose), rebuild
  await page.getByRole('button', { name: /advanced/ }).click();
  await page.getByLabel('spacing', { exact: true }).fill('12');
  await page.evaluate(() => {
    (window as unknown as { __b0?: unknown; __lastBuild?: unknown }).__b0 = (window as unknown as { __lastBuild?: unknown }).__lastBuild;
  });
  await page.getByRole('button', { name: 'rebuild with these settings' }).click();
  await page.waitForFunction(
    () => {
      const w = window as unknown as { __b0?: unknown; __lastBuild?: unknown };
      return w.__lastBuild !== w.__b0;
    },
    undefined,
    { timeout: 60_000 },
  );
  await expect(page.getByRole('button', { name: 'download otf' })).toBeEnabled({ timeout: 15_000 });
  const looseAdvance = await advanceOfH(page, await downloadOtf(page, 'loose.otf'));

  // tight advance at 12% must differ from the sheet's cell pitch; both built
  // valid (buildFont validates internally or it would have errored)
  expect(looseAdvance).not.toBe(autoAdvance);
  expect(looseAdvance).toBeGreaterThan(0);
  expect(autoAdvance).toBeGreaterThan(0);
});
