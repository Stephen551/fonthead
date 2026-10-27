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

// Auto measures the letterforms; a positive value overrides its margin with
// that percent of UPM per side. Proven on real bytes: download both builds' OTFs
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

async function rebuildSpacing(page: Page, value: string) {
  await page.getByLabel('spacing', { exact: true }).fill(value);
  await page.evaluate(() => { (window as any).__b0 = (window as any).__lastBuild; });
  await page.getByRole('button', { name: 'rebuild with these settings' }).click();
  await page.waitForFunction(() => (window as any).__lastBuild !== (window as any).__b0, undefined, { timeout: 60_000 });
  await expect(page.getByRole('button', { name: 'download otf', exact: true })).toBeEnabled();
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
  await rebuildSpacing(page, '12');
  const looseAdvance = await advanceOfH(page, await downloadOtf(page, 'loose.otf'));

  // The manual 12% override must be looser than the measured auto value; both built
  // valid (buildFont validates internally or it would have errored)
  expect(looseAdvance).toBeGreaterThan(autoAdvance);
  expect(looseAdvance).toBeGreaterThan(0);
  expect(autoAdvance).toBeGreaterThan(0);

  await rebuildSpacing(page, '0');
  expect(await advanceOfH(page, await downloadOtf(page, 'auto-again.otf'))).toBe(autoAdvance);
  expect(await page.evaluate(() => (window as any).__lastSpacing.mode)).toBe('auto');
});

test('color auto spacing survives a manual override and glyph edits', async ({ page }) => {
  test.setTimeout(180_000);
  await page.goto('/make');
  await page.getByRole('button', { name: 'color · flat', exact: true }).click();
  await page.getByRole('button', { name: 'try a sample sheet', exact: true }).click();
  await expect(page.getByRole('button', { name: 'download otf', exact: true })).toBeVisible({ timeout: 60_000 });
  const automatic = await advanceOfH(page, await downloadOtf(page, 'color-auto.otf'));
  await page.getByRole('button', { name: /advanced/ }).click();
  await rebuildSpacing(page, '12');
  expect(await advanceOfH(page, await downloadOtf(page, 'color-loose.otf'))).toBeGreaterThan(automatic);
  await rebuildSpacing(page, '0');
  expect(await advanceOfH(page, await downloadOtf(page, 'color-auto-again.otf'))).toBe(automatic);
  const spacing = await page.evaluate(async () => {
    const w = window as any;
    w.__lastSpacing = null;
    await w.ColorMaker.editGlyph('exclude', 0, { excluded: true });
    return w.__lastSpacing;
  });
  expect(spacing.mode).toBe('auto');
  expect(spacing.pct).toBeGreaterThanOrEqual(2.5);
  expect(spacing.pct).toBeLessThanOrEqual(7);
});
