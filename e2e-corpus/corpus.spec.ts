import { test, expect, type Page } from '@playwright/test';
import { readdirSync, readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

// The typographic lint. Every fixture sheet builds through the real maker,
// and the resulting font is measured for the failure classes found in the
// field (each metric maps to a shipped-and-fixed bug):
//   fusion    : adjacent glyph ink interpenetrating so deep the pair redraws
//               (r+i read as n, Chelsea read as a C-h ligature)
//   rhythm    : wildly uneven pair gaps ("H and mad e S pacin g")
//   wordSpace : swash overhangs swallowing the word break ("pipperhuddle")
// Thresholds were calibrated against the broken historical builds: the
// pre-fix chancery measured fusion 89 / rhythm SD 156; the fixed corpus
// stays under half of each gate.
//
// One contact-sheet PNG lands in test-results/corpus-contact.png for the
// thirty-second human pass: metrics catch the known classes, eyes the new.

const ROOT = process.cwd();
const CORPUS_DIR = join(ROOT, 'e2e', 'fixtures', 'corpus');
const OUT_DIR = join(ROOT, 'test-results');

// Two fusion classes, calibrated on the broken-vs-fixed chancery builds.
// STRUCTURAL pairs may never interpenetrate deeply in any face: the left
// glyph has no legitimate swash crosser. Every real fusion measured 117-281
// (broken r+i, welded marker t-bars, doubled cursive n-strokes); natural
// calligraphic nesting on untrimmed sides reaches 60 (Gabriola C+d). The
// gate sits between with margin both ways. CROSSER pairs swash across by
// design (V+A tails measure -166 in a healthy chancery), so their gate is
// the over-kern crash signature, not the natural crossing.
const STRUCTURAL_MAX = 70;
const CROSSER_MAX = 260;
const RHYTHM_SD_MAX = 130; // pair-gap standard deviation across a pangram
const WORD_SPACE_MIN = 40; // median visible gap across a word break
// capOverhang: a cap with a right-reaching arm or bowl (F/P/R/E/B, and the
// T/Y/V/W reaches) over-kerned onto the following lowercase so the arm welds
// into the next letter's body. The metric the corpus already had could not
// see it only because cap+lowercase pairs weren't in any pair list, not
// because of where it measures: the weld interpenetrates the x-height body
// (the F mid-arm sits inside the strip), so the existing strip measure
// catches it once the pairs are listed. The pre-fix LaunchSans build welded
// F+a / r+a ~150 deep; the fixed build reads ~0. Upright faces only: a
// script cap legitimately swashes into the following letter.
const CAP_OVERHANG_MAX = 60;

const STRUCTURAL_PAIRS = [
  'ri', 'rn', 'rm', 'ru', 'rh', 'rl', 'rb', 'rk',
  'Ch', 'Cl', 'Ck', 'Cb', 'Cd', 'Gh', 'Gl', 'Gn',
  'oi', 'ol', 'nn', 'll', 'tt', 'hi', 'mi', 'ui',
];
const CROSSER_PAIRS = ['AV', 'VA', 'To', 'Ta', 'Yo', 'Wa', 'LT', 'fl', 'fi', 'ft'];
// Cap -> lowercase pairs where an over-kern welds a top/right protrusion
// into the next glyph. Top-heavy and open-right caps before short/round
// lowercase. Measured full-height (see CAP_OVERHANG_MAX).
const CAP_PAIRS = [
  'Fi', 'Fa', 'Fe', 'Fo', 'Fr', 'Fu', 'Fs',
  'Pa', 'Pe', 'Po', 'Pr', 'Pu',
  'Ti', 'Ta', 'Te', 'To', 'Tu', 'Tr',
  'Ya', 'Ye', 'Yo', 'Yu', 'Va', 'Vo', 'Wa', 'Wo',
  'Ra', 'Re', 'Ro', 'Ka', 'Ke', 'Ko',
];
const PANGRAM = 'thequickbrownfoxjumpsoverthelazydog';
const SPACE_PAIRS = [
  ['y', 'd'],
  ['r', 'h'],
  ['x', 'l'],
  ['g', 'j'],
  ['t', 'T'],
];

const sheets = [
  ...readdirSync(CORPUS_DIR)
    .filter((f) => f.endsWith('.png'))
    .map((f) => ({ name: f.replace('.png', ''), path: join(CORPUS_DIR, f) })),
  { name: 'field-chancery', path: join(ROOT, 'e2e', 'fixtures', 'chancery-sheet.png') },
];

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    try {
      localStorage.setItem('fh-maker-tour-seen', '1');
    } catch {
      /* private mode */
    }
  });
});

type Metrics = {
  glyphs: number;
  structural: { depth: number; worst: string };
  crosser: { depth: number; worst: string };
  capOverhang: { depth: number; worst: string };
  rhythmSd: number;
  wordSpaceMedian: number;
};

async function measure(page: Page, otfPath: string): Promise<Metrics> {
  const b64 = readFileSync(otfPath).toString('base64');
  return page.evaluate(
    ({ b, structuralPairs, crosserPairs, capPairs, pangram, spacePairs }) => {
      const bin = atob(b);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      const font = (window as unknown as { opentype: { parse: (x: ArrayBuffer) => any } }).opentype.parse(bytes.buffer);
      const upm = font.unitsPerEm || 1000;
      const BANDS = 72;

      // per-glyph horizontal profiles by y-band, sampled from path commands
      const profileCache = new Map<string, { left: number[]; right: number[]; adv: number; yMin: number; yMax: number } | null>();
      const profile = (ch: string) => {
        if (profileCache.has(ch)) return profileCache.get(ch)!;
        const g = font.charToGlyph(ch);
        if (!g || !g.path || !g.path.commands || g.path.commands.length === 0) {
          profileCache.set(ch, null);
          return null;
        }
        const pts: Array<[number, number]> = [];
        let cx = 0,
          cy = 0,
          sx = 0,
          sy = 0;
        const emit = (x: number, y: number) => pts.push([x, y]);
        const sample = (x0: number, y0: number, pts2: number[][]) => {
          // flatten curve control polylines at 8 steps
          for (let t = 1; t <= 8; t++) {
            const u = t / 8;
            if (pts2.length === 3) {
              const [p1, p2, p3] = pts2;
              const a = (1 - u) * (1 - u),
                b2 = 2 * (1 - u) * u,
                c = u * u;
              emit(a * x0 + b2 * p1[0] + c * p2[0], a * y0 + b2 * p1[1] + c * p2[1]);
              void p3;
            } else {
              const [p1, p2, p3] = pts2;
              const a = (1 - u) ** 3,
                b2 = 3 * (1 - u) ** 2 * u,
                c = 3 * (1 - u) * u * u,
                d = u ** 3;
              emit(a * x0 + b2 * p1[0] + c * p2[0] + d * p3[0], a * y0 + b2 * p1[1] + c * p2[1] + d * p3[1]);
            }
          }
        };
        for (const cmd of g.path.commands) {
          if (cmd.type === 'M') {
            cx = cmd.x;
            cy = cmd.y;
            sx = cx;
            sy = cy;
            emit(cx, cy);
          } else if (cmd.type === 'L') {
            emit(cmd.x, cmd.y);
            cx = cmd.x;
            cy = cmd.y;
          } else if (cmd.type === 'C') {
            sample(cx, cy, [
              [cmd.x1, cmd.y1],
              [cmd.x2, cmd.y2],
              [cmd.x, cmd.y],
            ]);
            cx = cmd.x;
            cy = cmd.y;
          } else if (cmd.type === 'Q') {
            sample(cx, cy, [
              [cmd.x1, cmd.y1],
              [cmd.x, cmd.y],
              [cmd.x, cmd.y],
            ]);
            cx = cmd.x;
            cy = cmd.y;
          } else if (cmd.type === 'Z') {
            emit(sx, sy);
            cx = sx;
            cy = sy;
          }
        }
        if (!pts.length) {
          profileCache.set(ch, null);
          return null;
        }
        let yMin = Infinity,
          yMax = -Infinity;
        for (const [, y] of pts) {
          if (y < yMin) yMin = y;
          if (y > yMax) yMax = y;
        }
        const left = new Array(BANDS).fill(Infinity);
        const right = new Array(BANDS).fill(-Infinity);
        const span = Math.max(1, yMax - yMin);
        for (const [x, y] of pts) {
          const band = Math.min(BANDS - 1, Math.max(0, Math.floor(((y - yMin) / span) * BANDS)));
          if (x < left[band]) left[band] = x;
          if (x > right[band]) right[band] = x;
        }
        const out = { left, right, adv: g.advanceWidth, yMin, yMax };
        profileCache.set(ch, out);
        return out;
      };
      const kern = (l: string, r: string) => {
        try {
          return font.getKerningValue(font.charToGlyph(l), font.charToGlyph(r)) || 0;
        } catch {
          return 0;
        }
      };

      // The body strip: where letter identity is read. Calibration on the
      // chancery showed benign script crossings are DEEPER than real fusions
      // (V+A baseline tails at -170 vs the r+i arm fusion at -117), so depth
      // alone cannot discriminate; zone does. Tails cross at the baseline
      // and in the ascender/descender zones; fusions that redraw a pair (the
      // r arm into a stem) happen inside the x-height strip.
      const xProf = profile('x');
      const xh = xProf ? xProf.yMax : upm * 0.5;
      const stripY0 = xh * 0.15;
      const stripY1 = xh * 1.1;

      // closest approach of a pair inside the body strip; negative =
      // interpenetration depth where it actually changes what a reader sees
      const pairGap = (l: string, r: string, extraAdv = 0) => {
        const L = profile(l);
        const R = profile(r);
        if (!L || !R) return null;
        const y0 = Math.max(L.yMin, R.yMin, stripY0);
        const y1 = Math.min(L.yMax, R.yMax, stripY1);
        if (y1 <= y0) return null;
        const offset = L.adv + extraAdv + kern(l, r);
        let gap = Infinity;
        const spanL = Math.max(1, L.yMax - L.yMin);
        const spanR = Math.max(1, R.yMax - R.yMin);
        for (let s = 0; s <= 48; s++) {
          const y = y0 + ((y1 - y0) * s) / 48;
          const bL = Math.min(BANDS - 1, Math.max(0, Math.floor(((y - L.yMin) / spanL) * BANDS)));
          const bR = Math.min(BANDS - 1, Math.max(0, Math.floor(((y - R.yMin) / spanR) * BANDS)));
          if (!isFinite(L.right[bL]) || !isFinite(R.left[bR])) continue;
          const g = offset + R.left[bR] - L.right[bL];
          if (g < gap) gap = g;
        }
        return isFinite(gap) ? gap : null;
      };

      // fusion: deepest interpenetration per pair class
      const worstOf = (pairs: string[]) => {
        let depth = 0;
        let worst = '';
        for (const p of pairs) {
          const g = pairGap(p[0], p[1]);
          if (g === null) continue;
          const d = Math.max(0, -g);
          if (d > depth) {
            depth = d;
            worst = p;
          }
        }
        return { depth: Math.round(depth), worst };
      };
      const structural = worstOf(structuralPairs);
      const crosser = worstOf(crosserPairs);
      // Cap over-kern is measured in the SAME x-height body strip as the
      // other fusion classes, not full-height: the weld (an F/P arm or bowl
      // dragged into the next letter) interpenetrates the body, while the
      // benign tuck it must NOT flag (an i-dot riding under a T/Y crossbar)
      // sits in the cap zone the strip already excludes.
      const capOverhang = worstOf(capPairs);

      // rhythm: spread of closest-approach gaps across a pangram
      const gaps: number[] = [];
      for (let i = 0; i + 1 < pangram.length; i++) {
        const g = pairGap(pangram[i], pangram[i + 1]);
        if (g !== null) gaps.push(g);
      }
      const mean = gaps.reduce((a, x) => a + x, 0) / Math.max(1, gaps.length);
      const sd = Math.sqrt(gaps.reduce((a, x) => a + (x - mean) * (x - mean), 0) / Math.max(1, gaps.length));

      // word space: visible gap across a break, median over sample pairs
      const spaceAdv = font.charToGlyph(' ').advanceWidth || Math.round(upm * 0.28);
      const spaceGaps: number[] = [];
      for (const [l, r] of spacePairs) {
        const g = pairGap(l, r, spaceAdv);
        if (g !== null) spaceGaps.push(g);
      }
      spaceGaps.sort((a, b) => a - b);
      const wordSpaceMedian = spaceGaps.length ? spaceGaps[Math.floor(spaceGaps.length / 2)] : 0;

      let glyphs = 0;
      for (let i = 0; i < font.glyphs.length; i++) {
        const g = font.glyphs.get(i);
        if (g && g.path && g.path.commands && g.path.commands.length) glyphs++;
      }
      return {
        glyphs,
        structural,
        crosser,
        capOverhang,
        rhythmSd: Math.round(sd),
        wordSpaceMedian: Math.round(wordSpaceMedian),
      };
    },
    { b: b64, structuralPairs: STRUCTURAL_PAIRS, crosserPairs: CROSSER_PAIRS, capPairs: CAP_PAIRS, pangram: PANGRAM, spacePairs: SPACE_PAIRS },
  );
}

for (const sheet of sheets) {
  test(`corpus: ${sheet.name}`, async ({ page }) => {
    await page.goto('/make');
    await page.locator('#sheet-file').setInputFiles(sheet.path);
    await expect(page.getByRole('button', { name: 'download otf' })).toBeVisible({ timeout: 150_000 });

    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: 'download otf' }).click(),
    ]);
    const otfPath = test.info().outputPath(`${sheet.name}.otf`);
    await download.saveAs(otfPath);

    const m = await measure(page, otfPath);
    const trim = await page.evaluate(() => (window as unknown as { __lastTrim?: { script: boolean; trimmed: number } }).__lastTrim);
    console.log(
      `CORPUS | ${sheet.name.padEnd(24)} | ${trim?.script ? 'script' : 'upright'}/${trim?.trimmed ?? '?'} glyphs=${m.glyphs} structural=${m.structural.depth}(${m.structural.worst || '-'}) crosser=${m.crosser.depth}(${m.crosser.worst || '-'}) capOverhang=${m.capOverhang.depth}(${m.capOverhang.worst || '-'}) rhythmSd=${m.rhythmSd} wordSpace=${m.wordSpaceMedian}`,
    );

    // render the contact-sheet strip for this face (real shaping, kern on)
    const b64 = readFileSync(otfPath).toString('base64');
    await page.setContent(`
      <style>@font-face { font-family: f; src: url(data:font/otf;base64,${b64}); }</style>
      <div id="strip" style="background:#fff;padding:10px 16px;width:1100px;">
        <div style="font-family:monospace;font-size:12px;color:#888;">${sheet.name}</div>
        <div style="font-family:f;font-size:42px;white-space:nowrap;">Chelsea Script ripper quick brown fox</div>
        <div style="font-family:f;font-size:42px;white-space:nowrap;">pepper huddle ripple lazy dog AVATAR To</div>
      </div>`);
    await page.waitForTimeout(400);
    mkdirSync(join(OUT_DIR, 'corpus-strips'), { recursive: true });
    await page.locator('#strip').screenshot({ path: join(OUT_DIR, 'corpus-strips', `${sheet.name}.png`) });

    expect(m.glyphs, 'built glyph count').toBeGreaterThanOrEqual(60);
    expect(m.structural.depth, `structural fusion (worst pair ${m.structural.worst})`).toBeLessThanOrEqual(STRUCTURAL_MAX);
    expect(m.crosser.depth, `crosser over-kern (worst pair ${m.crosser.worst})`).toBeLessThanOrEqual(CROSSER_MAX);
    // Cap-zone over-kern only makes sense for upright faces; a script cap
    // legitimately swashes into the cap/ascender zone this metric watches.
    if (!trim?.script) {
      expect(m.capOverhang.depth, `cap over-kern weld (worst pair ${m.capOverhang.worst})`).toBeLessThanOrEqual(CAP_OVERHANG_MAX);
    }
    expect(m.rhythmSd, 'pair-gap rhythm spread').toBeLessThanOrEqual(RHYTHM_SD_MAX);
    expect(m.wordSpaceMedian, 'word-break visibility').toBeGreaterThanOrEqual(WORD_SPACE_MIN);
  });
}

test('contact sheet', async ({ page }) => {
  const dir = join(OUT_DIR, 'corpus-strips');
  if (!existsSync(dir)) test.skip();
  const strips = readdirSync(dir).filter((f) => f.endsWith('.png'));
  const imgs = strips
    .map((f) => `<img src="data:image/png;base64,${readFileSync(join(dir, f)).toString('base64')}" style="display:block;">`)
    .join('');
  await page.setContent(`<body style="margin:0;background:#fff;">${imgs}</body>`);
  await page.waitForTimeout(400);
  const buf = await page.locator('body').screenshot();
  writeFileSync(join(OUT_DIR, 'corpus-contact.png'), buf);
  console.log(`CONTACT SHEET: test-results/corpus-contact.png (${strips.length} faces)`);
});
