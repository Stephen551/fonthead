import { test, expect, type Page } from '@playwright/test';
import { verifySfntChecksums } from '../src/lib/sfnt';
import { isOtf } from '../src/lib/fontsig';

// Connected-cursive mode end to end: a cursive sheet auto-builds a VALID,
// Windows-openable connected font, and toggling connect off falls back to the
// trim/overhang path. Mirrors maker.spec's trust gate (signature + checksums).

const SHEET = 'e2e/fixtures/corpus/connected-cursive.png';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    try {
      localStorage.setItem('fh-maker-tour-seen', '1');
    } catch {
      /* private mode */
    }
  });
});

type LastBuild = { kind: string; glyphCount: number; otf: number; woff2: number };
type LastConnect = { joined: number; broke: number };

const buildDone = (page: Page) => expect(page.getByRole('button', { name: 'download otf' })).toBeVisible({ timeout: 90_000 });
const lastBuild = (page: Page) => page.evaluate(() => (window as unknown as { __lastBuild: LastBuild }).__lastBuild);
const lastConnect = (page: Page) => page.evaluate(() => (window as unknown as { __lastConnect?: LastConnect }).__lastConnect);
const lastTrim = (page: Page) => page.evaluate(() => (window as unknown as { __lastTrim?: { script: boolean } }).__lastTrim);

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
  expect(glyphCount).toBeGreaterThanOrEqual(60);
  expect(isOtf(otf), 'real OTF signature').toBe(true);
  const check = verifySfntChecksums(otf);
  expect(check.ok, `sfnt checksums valid: ${check.errors.join('; ')}`).toBe(true);
}

test.describe('connected-cursive mode', () => {
  test('a cursive sheet auto-builds a valid connected font', async ({ page }) => {
    await page.goto('/make');
    await page.locator('#sheet-file').setInputFiles(SHEET);
    await buildDone(page);

    const lb = await lastBuild(page);
    expect(lb.kind).toBe('mono');
    expect(lb.woff2).toBeGreaterThan(0);

    // auto-detect should have built in connect mode (the sheet reads as script)
    const lc = await lastConnect(page);
    expect(lc, 'connect mode ran').toBeTruthy();
    expect(lc!.joined, 'most lowercase joined').toBeGreaterThanOrEqual(20);

    // the connect toggle reflects the auto-decision
    await page.getByRole('button', { name: 'advanced' }).click();
    expect(await page.getByRole('button', { name: /connected cursive/ }).getAttribute('aria-pressed')).toBe('true');

    assertValidFont(await captureOtf(page), lb.glyphCount);
  });

  test('toggling connect off falls back to the overhang path', async ({ page }) => {
    await page.goto('/make');
    await page.locator('#sheet-file').setInputFiles(SHEET);
    await buildDone(page);

    await page.getByRole('button', { name: 'advanced' }).click();
    await page.getByRole('button', { name: /connected cursive/ }).click(); // turn it off
    await page.getByRole('button', { name: 'rebuild with these settings' }).click();
    await buildDone(page);

    // overhang path ran (sets __lastTrim) and the font is still valid
    const trim = await lastTrim(page);
    expect(trim, 'overhang path ran').toBeTruthy();
    const lb = await lastBuild(page);
    assertValidFont(await captureOtf(page), lb.glyphCount);
  });
});
