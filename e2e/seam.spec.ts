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
    // (plus r). Stage E replaced the flat descent cap with the measured DIVE
    // gate: s (2.66) and x (2.08) both need a steeper synthesized descent
    // than the verified-clean class (0.88-1.49) and park with their drawn
    // sweeps; a roomier hand's s/x will fire on its own geometry. Never the
    // crossbars (f, t), an ascender loop (l), or the low-exit class (a, e).
    const sa = await page.evaluate(
      () =>
        (window as unknown as { __lastSeamAlts?: { count: number; offenders: Array<{ char: string }>; rights: string[]; skipped: string[] } })
          .__lastSeamAlts,
    );
    expect(sa, 'seam alternates ran').toBeTruthy();
    const offenders = sa!.offenders.map((o) => o.char);
    for (const c of ['o', 'v', 'w', 'b']) expect(offenders, `offender ${c}`).toContain(c);
    for (const c of ['f', 't', 'l', 'a', 'e', 's', 'x']) expect(offenders, `${c} is never an offender`).not.toContain(c);
    for (const c of ['s', 'x']) expect(sa!.skipped, `${c} parks at the dive gate, keeping its drawn sweep`).toContain(c);
    expect(sa!.rights.length, 'low-entry follower set covers the lowercase').toBeGreaterThanOrEqual(20);

    const otf = await captureOtf(page);
    expect(isOtf(otf), 'real OTF signature').toBe(true);
    const check = verifySfntChecksums(otf);
    expect(check.ok, `sfnt checksums valid: ${check.errors.join('; ')}`).toBe(true);

    // entry side (the director's w): the arch letters whose lead-in hook
    // rides high with NO low entry gain .jn02; letters with a real low entry
    // sweep (h/k/q fired falsely at the band floor once) never fire.
    const entryOffenders = (sa as unknown as { entryOffenders: Array<{ char: string }> }).entryOffenders.map((o) => o.char);
    for (const c of ['w', 'n', 'm', 'r', 'v']) expect(entryOffenders, `entry offender ${c}`).toContain(c);
    for (const c of ['h', 'k', 'q', 'f', 't', 'u']) expect(entryOffenders, `${c} never fires the entry side`).not.toContain(c);

    const font = fontkit.create(Buffer.from(otf));
    // mid-word: the exit alternate applies before a low-entry follower, and
    // the follower's own floating lead-in collapses after a joining exit
    expect(shapeNames(font, 'on')).toEqual(['o.jn01', 'n.jn02']);
    expect(shapeNames(font, 've')).toEqual(['v.jn01', 'e']);
    expect(shapeNames(font, 'ow')).toEqual(['o.jn01', 'w.jn02']);
    // entry-only context: a clean exit still collapses the follower's hook
    expect(shapeNames(font, 'aw')).toEqual(['a', 'w.jn02']);
    // both sides at once compose through .jn03
    expect(shapeNames(font, 'awa')).toEqual(['a', 'w.jn03', 'a']);
    // steep class (Stage E): s and x park at the dive gate and keep their
    // drawn sweeps everywhere — and because those sweeps land on the
    // follower's hook, they are excluded from the backtrack class too (the
    // n after s keeps its lead-in)
    expect(shapeNames(font, 'sos')).toEqual(['s', 'o.jn01', 's']);
    expect(shapeNames(font, 'so')).toEqual(['s', 'o']);
    expect(shapeNames(font, 'sn')).toEqual(['s', 'n']);
    expect(shapeNames(font, 'xa')).toEqual(['x', 'a']);
    // word boundaries: the drawn flick survives word-finally, the drawn
    // lead-in survives word-initially
    expect(shapeNames(font, 'no')).toEqual(['n', 'o']);
    expect(shapeNames(font, 'wo')).toEqual(['w.jn01', 'o']);
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
    // entry alternates carry the base advance too (all three tiers)
    for (const c of entryOffenders) {
      const base = byName.get(c);
      for (const suf of ['.jn02', '.jn03']) {
        const alt = byName.get(`${c}${suf}`);
        if (suf === '.jn02') expect(alt, `${c}.jn02 exists`).toBeTruthy();
        if (!alt) continue;
        expect(alt.advanceWidth, `${c}${suf} advance = base`).toBe(base.advanceWidth);
      }
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
