import { test, expect, type Page } from '@playwright/test';
import * as fontkitNs from 'fontkit';
import { verifySfntChecksums } from '../src/lib/sfnt';
import { isOtf } from '../src/lib/fontsig';

// Contextual seam alternates (ADR 0048, PARKED), end to end on the
// smooth-script hand whose fo/on/ve/so knots motivated the milestone. The
// warp-based alternates failed the judge panel twice, so production builds
// never fire them: the machinery is BANKED behind the fh-test-seam-alts hook
// and this suite keeps it gated (measurement class, calt lookahead shaping,
// metric transparency) until the stroke-model rework (ADR 0049) replaces the
// warp. The second test proves the production default builds PLAIN.

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

test.describe('seam alternates (banked behind the test hook)', () => {
  test('a high-exit hand builds lowered-exit alternates that fire mid-word only', async ({ page }) => {
    test.setTimeout(220_000);
    await page.addInitScript(() => {
      try {
        localStorage.setItem('fh-test-seam-alts', '1');
      } catch {
        /* private mode */
      }
    });
    await page.goto('/make');
    await page.locator('#sheet-file').setInputFiles(SHEET);
    await buildDone(page);

    // the measured offender class on this hand: the o/v/w/b gentle crossings
    // (plus r). Never the crossbars (f, t), the descenders, an ascender loop
    // (l), or the STEEP s/x sweeps — a drop past the descent cap reads as a
    // wire cliff (the panel verdict), so those keep the drawn flick.
    const sa = await page.evaluate(
      () => (window as unknown as { __lastSeamAlts?: { count: number; offenders: Array<{ char: string }>; rights: string[] } }).__lastSeamAlts,
    );
    expect(sa, 'seam alternates ran').toBeTruthy();
    const offenders = sa!.offenders.map((o) => o.char);
    for (const c of ['o', 'v', 'w', 'b']) expect(offenders, `offender ${c}`).toContain(c);
    for (const c of ['f', 't', 'l', 'a', 'e', 's', 'x']) expect(offenders, `${c} is never an offender`).not.toContain(c);
    expect(sa!.rights.length, 'low-entry follower set covers the lowercase').toBeGreaterThanOrEqual(20);

    const otf = await captureOtf(page);
    expect(isOtf(otf), 'real OTF signature').toBe(true);
    const check = verifySfntChecksums(otf);
    expect(check.ok, `sfnt checksums valid: ${check.errors.join('; ')}`).toBe(true);

    const font = fontkit.create(Buffer.from(otf));
    // mid-word: the alternate applies before a low-entry follower
    expect(shapeNames(font, 'on')).toEqual(['o.jn01', 'n']);
    expect(shapeNames(font, 've')).toEqual(['v.jn01', 'e']);
    // steep class: s keeps its drawn exit even mid-word (and the final o is
    // word-final, so it keeps the flick too)
    expect(shapeNames(font, 'sos')).toEqual(['s', 'o.jn01', 's']);
    expect(shapeNames(font, 'so')).toEqual(['s', 'o']);
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
      // the warp actually changed the exit and nothing structurally rose: the
      // truncation re-parametrizes stub curves (control points compress in x),
      // so a Bezier extremum can drift up to ~10 units at upm 1000 — an order
      // below visibility. A REAL regression (a sheared ascender, a raised
      // terminal) moves tens of units.
      expect(alt.bbox.maxY <= base.bbox.maxY + 12, `${c}.jn01 rides no higher than its base (alt ${Math.round(alt.bbox.maxY)} vs ${Math.round(base.bbox.maxY)})`).toBe(true);
    }
  });

  test('the production default builds plain (parked: no user surface, no alternates)', async ({ page }) => {
    test.setTimeout(220_000);
    await page.goto('/make');
    await page.locator('#sheet-file').setInputFiles(SHEET);
    await buildDone(page);

    const sa = await page.evaluate(() => (window as unknown as { __lastSeamAlts?: object | null }).__lastSeamAlts);
    expect(sa, 'seam alternates never fire without the test hook').toBeNull();
    const otf = await captureOtf(page);
    const font = fontkit.create(Buffer.from(otf));
    expect(shapeNames(font, 'on')).toEqual(['o', 'n']); // plain build, no substitution
    let jn = 0;
    for (let i = 0; i < font.numGlyphs; i++) if (/\.jn\d\d$/.test(font.getGlyph(i)?.name ?? '')) jn++;
    expect(jn, 'no .jn glyphs in a production build').toBe(0);
  });
});
