import { test, expect, type Page } from '@playwright/test';
import * as fontkitNs from 'fontkit';
import { verifySfntChecksums } from '../src/lib/sfnt';
import { isOtf } from '../src/lib/fontsig';

// Contextual seam alternates (ADR 0048), end to end on the smooth-script hand
// whose fo/on/ve/so knots motivated the milestone. A measured high exit gains
// a .jn01 alternate with the exit lowered onto the entry line; a GSUB calt
// lookahead rule swaps it in only before a low-entry follower. The headline
// proofs shape real runs with fontkit: mid-word the alternate applies, at a
// word end the drawn flick survives, and the alternate is metrically
// transparent (the base advance, so spacing and kern are untouched).

const SHEET = 'e2e/fixtures/smooth-script-sheet.jpg';

const fontkit: any = (fontkitNs as any).create ? fontkitNs : (fontkitNs as any).default;

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    try {
      localStorage.setItem('fh-maker-tour-seen', '1');
      // No fh-test-no-autoconnect: the script face SHOULD auto-connect; seam
      // alternates ride the real path.
    } catch {
      /* private mode */
    }
  });
});

const buildDone = (page: Page) => expect(page.getByRole('button', { name: 'download otf' })).toBeVisible({ timeout: 150_000 });

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

const shapeNames = (font: any, text: string): string[] => font.layout(text, ['calt', 'kern']).glyphs.map((g: any) => g.name);

test.describe('seam alternates', () => {
  test('a high-exit hand builds lowered-exit alternates that fire mid-word only', async ({ page }) => {
    test.setTimeout(220_000);
    await page.goto('/make');
    await page.locator('#sheet-file').setInputFiles(SHEET);
    await buildDone(page);

    // the measured offender class on this hand: the o/v/w/b gentle crossings
    // and the s/x high sweeps; never the crossbars (f, t), the descenders, or
    // an ascender loop (l).
    const sa = await page.evaluate(
      () => (window as unknown as { __lastSeamAlts?: { count: number; offenders: Array<{ char: string }>; rights: string[] } }).__lastSeamAlts,
    );
    expect(sa, 'seam alternates ran').toBeTruthy();
    const offenders = sa!.offenders.map((o) => o.char);
    for (const c of ['o', 's', 'v']) expect(offenders, `offender ${c}`).toContain(c);
    for (const c of ['f', 't', 'l', 'a', 'e']) expect(offenders, `${c} is never an offender`).not.toContain(c);
    expect(sa!.rights.length, 'low-entry follower set covers the lowercase').toBeGreaterThanOrEqual(20);

    const otf = await captureOtf(page);
    expect(isOtf(otf), 'real OTF signature').toBe(true);
    const check = verifySfntChecksums(otf);
    expect(check.ok, `sfnt checksums valid: ${check.errors.join('; ')}`).toBe(true);

    const font = fontkit.create(Buffer.from(otf));
    // mid-word: the alternate applies before a low-entry follower
    expect(shapeNames(font, 'on')).toEqual(['o.jn01', 'n']);
    expect(shapeNames(font, 'so')).toEqual(['s.jn01', 'o']);
    // word-final: the drawn flick survives (no lookahead, no substitution)
    expect(shapeNames(font, 'no')).toEqual(['n', 'o']);
    // metric transparency: the alternate carries its base's advance exactly,
    // so the calt swap never jolts spacing and the base kern pairs apply.
    const byName = new Map<string, any>();
    for (let i = 0; i < font.numGlyphs; i++) {
      const g = font.getGlyph(i);
      if (g?.name) byName.set(g.name, g);
    }
    for (const c of offenders) {
      const alt = byName.get(`${c}.jn01`);
      const base = byName.get(c);
      expect(alt, `${c}.jn01 exists`).toBeTruthy();
      expect(alt.advanceWidth, `${c}.jn01 advance = base`).toBe(base.advanceWidth);
      // the warp actually lowered the exit: the alternate rides no higher than
      // its base (a few units of tolerance — the y-ramp moves curve control
      // points by slightly different amounts than their on-curve neighbors, so
      // a Bezier extremum can drift 1-3 units at upm 1000, invisible in ink)
      expect(alt.bbox.maxY <= base.bbox.maxY + 4, `${c}.jn01 rides no higher than its base (alt ${Math.round(alt.bbox.maxY)} vs ${Math.round(base.bbox.maxY)})`).toBe(true);
    }
  });

  test('the seam-joins toggle is the off switch', async ({ page }) => {
    test.setTimeout(220_000);
    await page.goto('/make');
    await page.locator('#sheet-file').setInputFiles(SHEET);
    await buildDone(page);

    await page.getByRole('button', { name: 'advanced' }).click();
    await page.getByRole('button', { name: 'seam joins' }).click();
    await page.getByRole('button', { name: 'rebuild with these settings' }).click();
    await buildDone(page);

    const sa = await page.evaluate(() => (window as unknown as { __lastSeamAlts?: object | null }).__lastSeamAlts);
    expect(sa, 'seam alternates skipped when toggled off').toBeNull();
    const otf = await captureOtf(page);
    const font = fontkit.create(Buffer.from(otf));
    expect(shapeNames(font, 'on')).toEqual(['o', 'n']); // plain build, no substitution
  });
});
