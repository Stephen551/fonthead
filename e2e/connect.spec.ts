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

// Realized adjacency: measure the closest approach of a few lowercase JOIN pairs
// in the built font's body strip. joined>=20 is only a DECISION counter; this
// proves the advances actually land letters adjacent (a connect build that
// computes wrong advances would float them and fail here). The full per-face
// join-gap distribution lives in the corpus harness; this is the CI guardrail.
async function medianJoinGap(page: Page, otf: Uint8Array): Promise<number> {
  const b64 = Buffer.from(otf).toString('base64');
  return page.evaluate((b) => {
    const bin = atob(b);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const font = (window as unknown as { opentype: { parse: (x: ArrayBuffer) => any } }).opentype.parse(bytes.buffer);
    const upm = font.unitsPerEm || 1000;
    const BANDS = 64;
    const profile = (ch: string) => {
      const g = font.charToGlyph(ch);
      if (!g?.path?.commands?.length) return null;
      const pts: Array<[number, number]> = [];
      let cx = 0, cy = 0, sx = 0, sy = 0;
      for (const c of g.path.commands) {
        if (c.type === 'M') { cx = sx = c.x; cy = sy = c.y; pts.push([cx, cy]); }
        else if (c.type === 'L') { cx = c.x; cy = c.y; pts.push([cx, cy]); }
        else if (c.type === 'C' || c.type === 'Q') { for (let t = 1; t <= 8; t++) { const u = t / 8; pts.push([cx + (c.x - cx) * u, cy + (c.y - cy) * u]); } cx = c.x; cy = c.y; }
        else if (c.type === 'Z') { cx = sx; cy = sy; }
      }
      if (!pts.length) return null;
      let yMin = Infinity, yMax = -Infinity;
      for (const [, y] of pts) { if (y < yMin) yMin = y; if (y > yMax) yMax = y; }
      const left = new Array(BANDS).fill(Infinity), right = new Array(BANDS).fill(-Infinity);
      const span = Math.max(1, yMax - yMin);
      for (const [x, y] of pts) { const bd = Math.min(BANDS - 1, Math.max(0, Math.floor(((y - yMin) / span) * BANDS))); if (x < left[bd]) left[bd] = x; if (x > right[bd]) right[bd] = x; }
      return { left, right, adv: g.advanceWidth, yMin, yMax };
    };
    const xh = profile('x')?.yMax || upm * 0.5;
    const gap = (l: string, r: string) => {
      const L = profile(l), R = profile(r);
      if (!L || !R) return null;
      const y0 = Math.max(L.yMin, R.yMin, xh * 0.15), y1 = Math.min(L.yMax, R.yMax, xh * 1.1);
      if (y1 <= y0) return null;
      let g = Infinity;
      const sL = Math.max(1, L.yMax - L.yMin), sR = Math.max(1, R.yMax - R.yMin);
      for (let s = 0; s <= 48; s++) {
        const y = y0 + ((y1 - y0) * s) / 48;
        const bL = Math.min(BANDS - 1, Math.max(0, Math.floor(((y - L.yMin) / sL) * BANDS)));
        const bR = Math.min(BANDS - 1, Math.max(0, Math.floor(((y - R.yMin) / sR) * BANDS)));
        if (!isFinite(L.right[bL]) || !isFinite(R.left[bR])) continue;
        const d = L.adv + R.left[bR] - L.right[bL];
        if (d < g) g = d;
      }
      return isFinite(g) ? g : null;
    };
    const pairs = ['in', 'nn', 'mi', 'ic', 'ck', 'el', 'an', 'ne'];
    const gaps = pairs.map((p) => gap(p[0], p[1])).filter((x): x is number => x !== null).sort((a, b) => a - b);
    return gaps.length ? gaps[Math.floor(gaps.length / 2)] : 999;
  }, b64);
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

    const otf = await captureOtf(page);
    assertValidFont(otf, lb.glyphCount);
    // the letters actually land joined, not just "decided" to join: a connected
    // build measures a tight body-strip gap; a non-connect build of the same
    // letters reads ~78+ units. Gate well between the two.
    const join = await medianJoinGap(page, otf);
    expect(join, 'realized lowercase join gap (median)').toBeLessThanOrEqual(50);
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
