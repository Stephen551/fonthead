import { test, expect, type Page } from '@playwright/test';
import { writeFileSync } from 'node:fs';
import { verifySfntChecksums } from '../src/lib/sfnt';
import { isOtf } from '../src/lib/fontsig';

// The trust gate: prove the maker still produces a VALID, Windows-openable font
// end to end, so a refactor cannot silently ship a broken one. We drive the real
// /make page, build, then capture the actual OTF bytes and check the SFNT
// signature + every table checksum (the same gate publish enforces and Windows
// applies). CI additionally runs a built font through fontTools for an
// independent, authoritative second opinion.

type LastBuild = { kind: string; glyphCount: number; colrStatus: string; otf: number; ttf: number; woff2: number };

async function buildDone(page: Page) {
  // the "download otf" button only renders once the build reaches the done phase
  await expect(page.getByRole('button', { name: 'download otf' })).toBeVisible({ timeout: 60_000 });
}

async function lastBuild(page: Page): Promise<LastBuild> {
  return page.evaluate(() => (window as unknown as { __lastBuild: LastBuild }).__lastBuild);
}

// Capture the built OTF bytes by intercepting the blob URL the download creates.
async function captureOtf(page: Page): Promise<Uint8Array> {
  const b64 = await page.evaluate(async () => {
    let blob: Blob | null = null;
    const orig = URL.createObjectURL;
    URL.createObjectURL = function (o: Blob | MediaSource) {
      if (o instanceof Blob) blob = o;
      return orig.call(URL, o);
    };
    const btn = Array.from(document.querySelectorAll('button')).find((b) => b.textContent?.trim() === 'download otf');
    btn?.click();
    await new Promise((r) => setTimeout(r, 150));
    URL.createObjectURL = orig;
    if (!blob) return '';
    const buf = new Uint8Array(await (blob as Blob).arrayBuffer());
    let bin = '';
    const chunk = 8192;
    for (let i = 0; i < buf.length; i += chunk) bin += String.fromCharCode.apply(null, Array.from(buf.subarray(i, i + chunk)));
    return btoa(bin);
  });
  expect(b64.length, 'captured OTF bytes').toBeGreaterThan(0);
  return new Uint8Array(Buffer.from(b64, 'base64'));
}

function assertValidFont(otf: Uint8Array, glyphCount: number) {
  expect(glyphCount).toBeGreaterThan(0);
  expect(isOtf(otf), 'real OTF signature').toBe(true);
  const check = verifySfntChecksums(otf);
  expect(check.ok, `sfnt checksums valid: ${check.errors.join('; ')}`).toBe(true);
}

const clickButton = (page: Page, label: string) =>
  page.getByRole('button', { name: label, exact: true }).click();

test.describe('maker builds valid fonts', () => {
  test('monochrome sample', async ({ page }) => {
    await page.goto('/make');
    await clickButton(page, 'try a sample sheet');
    await buildDone(page);
    const lb = await lastBuild(page);
    expect(lb.kind).toBe('mono');
    expect(lb.woff2).toBeGreaterThan(0);
    const otf = await captureOtf(page);
    assertValidFont(otf, lb.glyphCount);
    // hand one built font to CI for an independent fontTools checksum pass
    writeFileSync('e2e/built-sample.otf', otf);
  });

  test('colour gradient sample renders COLR', async ({ page }) => {
    await page.goto('/make');
    await clickButton(page, 'colour · gradient');
    await clickButton(page, 'try a sample sheet');
    await buildDone(page);
    const lb = await lastBuild(page);
    expect(lb.kind).toBe('gradient');
    expect(lb.colrStatus).toBe('ok');
    assertValidFont(await captureOtf(page), lb.glyphCount);
  });

  test('colour flat sample renders COLR', async ({ page }) => {
    await page.goto('/make');
    await clickButton(page, 'colour · flat');
    await clickButton(page, 'try a sample sheet');
    await buildDone(page);
    const lb = await lastBuild(page);
    expect(lb.kind).toBe('flat');
    expect(lb.colrStatus).toBe('ok');
    assertValidFont(await captureOtf(page), lb.glyphCount);
  });

  test('fine detail produces a valid font with more outline data', async ({ page }) => {
    await page.goto('/make');
    await clickButton(page, 'try a sample sheet');
    await buildDone(page);
    const off = await lastBuild(page);

    // turn on fine detail in the advanced panel, then rebuild
    await page.getByRole('button', { name: /advanced/ }).click();
    await page.getByRole('button', { name: /^fine detail/ }).click();
    await clickButton(page, 'rebuild with these settings');
    await buildDone(page);
    const on = await lastBuild(page);

    expect(on.glyphCount).toBe(off.glyphCount); // no glyphs lost
    expect(on.otf).toBeGreaterThan(off.otf); // more captured detail
    assertValidFont(await captureOtf(page), on.glyphCount);
  });

  test('a mono per-row re-slice rebuilds a valid font', async ({ page }) => {
    await page.goto('/make');
    await clickButton(page, 'try a sample sheet');
    await buildDone(page);
    const before = await lastBuild(page);

    // re-slice row 1 with the anchored slicer via the ROWS panel
    const changed = await page.evaluate(async () => {
      const sel = document.querySelector('select') as HTMLSelectElement | null;
      if (!sel) return false;
      const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!;
      setter.call(sel, 'anchored');
      sel.dispatchEvent(new Event('change', { bubbles: true }));
      await new Promise((r) => setTimeout(r, 120));
      const btn = Array.from(sel.parentElement!.querySelectorAll('button')).find((b) => /re-slice|slicing/.test(b.textContent || ''));
      btn?.click();
      return true;
    });
    expect(changed, 'mono ROWS panel present').toBe(true);
    await buildDone(page);
    const after = await lastBuild(page);
    assertValidFont(await captureOtf(page), after.glyphCount);
    expect(after.glyphCount).toBeGreaterThan(0);
    expect(before.glyphCount).toBeGreaterThan(0);
  });
});
