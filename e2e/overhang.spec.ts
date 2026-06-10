import { test, expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';

// Skip the maker onboarding modal so it does not block the flow.
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    try {
      localStorage.setItem('fh-maker-tour-seen', '1');
    } catch {
      /* private mode */
    }
  });
});

// The flourish-overhang toggle, on the real sheet that exposed the bug: a
// chancery italic whose swash tails ride inside bbox-derived advances as dead
// air ("H and mad e S pacin g"). With the toggle on, advances come from the
// dense letter body and the tails overhang the neighbor (negative bearings).

type Probe = { advance: number; lsb: number };

async function probeOtf(page: Page, otfPath: string, chars: string[]): Promise<Record<string, Probe>> {
  const b64 = readFileSync(otfPath).toString('base64');
  return page.evaluate(
    ({ b, cs }) => {
      const bin = atob(b);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      const font = (window as unknown as { opentype: { parse: (x: ArrayBuffer) => { charToGlyph: (c: string) => { advanceWidth: number; getBoundingBox: () => { x1: number } } } } }).opentype.parse(bytes.buffer);
      const out: Record<string, { advance: number; lsb: number }> = {};
      for (const c of cs) {
        const g = font.charToGlyph(c);
        out[c] = { advance: Math.round(g.advanceWidth), lsb: Math.round(g.getBoundingBox().x1) };
      }
      return out;
    },
    { b: b64, cs: chars },
  );
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

test('flourish overhang fits a chancery sheet on body advances by default', async ({ page }) => {
  test.setTimeout(180_000);
  await page.goto('/make');

  // the default build carries the overhang fit
  await page.locator('input[type="file"]').setInputFiles('e2e/fixtures/chancery-sheet.png');
  await expect(page.getByRole('button', { name: 'download otf' })).toBeVisible({ timeout: 120_000 });
  await expect(page.getByText('7 rows · 13 cells in row 1')).toBeVisible();
  const probes = ['H', 'm', 'i', 'o'];
  const on = await probeOtf(page, await downloadOtf(page, 'on.otf'), probes);

  // switch it off, rebuild: the historical bbox advances
  await page.getByRole('button', { name: /advanced/ }).click();
  await page.getByRole('button', { name: /flourish overhang/ }).click();
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
    { timeout: 120_000 },
  );
  await expect(page.getByRole('button', { name: 'download otf' })).toBeEnabled({ timeout: 15_000 });
  const off = await probeOtf(page, await downloadOtf(page, 'off.otf'), probes);

  // swash-heavy letters tighten hard: the dead air leaves the advance
  expect(on.H.advance).toBeLessThan(off.H.advance * 0.8);
  expect(on.m.advance).toBeLessThan(off.m.advance * 0.85);
  expect(on.i.advance).toBeLessThan(off.i.advance * 0.85);
  // the trimmed tails really overhang (negative left bearing somewhere)
  expect(Math.min(on.H.lsb, on.m.lsb, on.i.lsb)).toBeLessThan(0);
  // a round letter with no tail is untouched
  expect(Math.abs(on.o.advance - off.o.advance)).toBeLessThanOrEqual(Math.round(off.o.advance * 0.01));
});
