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
// Connect mode joins on the dense BODY edge and lets each letter's real thin
// connecting strokes ride across the seam into the neighbour. That intended
// stroke crossing reads as x-height-strip "fusion" to the body-strip metric
// (the healthy connect fixtures measure up to 93 while rendering as clean joins,
// verified on the contact sheet), so connect gets a higher structural ceiling.
// A true body-on-body collision is far deeper; the contact sheet is the eyeball.
// Height-mismatched pairs (h+i, G+h: tall ascender beside a short/dotted letter)
// read high here because the per-glyph band normalization compares mismatched
// slices — verified not visually fused — so connect allows headroom for that noise.
const STRUCTURAL_MAX_CONNECT = 145;
const CROSSER_MAX = 260;
const RHYTHM_SD_MAX = 130; // pair-gap standard deviation across a pangram
const WORD_SPACE_MIN = 40; // median visible gap across a word break
// Connect mode only: the letters must stay JOINED (the line continuous), not drift
// back to word-spaced. Under the connection-point model the two healthy connect
// fixtures read body-strip joinGap median -5 and 40, while a non-connect build of
// the same letters reads 78-110, so the gate sits between with margin and catches a
// face that has stopped connecting. (connJoin — the gap in the low connector band —
// is logged as a diagnostic but not gated: it is too per-pair noisy, the known-good
// original spikes to 133 on one pair while reading clean.)
const JOIN_GAP_MEDIAN_MAX = 60;
// The right "do they connect" gate for the body-edge model: every join pair must
// come within this over its FULL height (a join counts wherever the connecting
// ink rides — baseline, x-height, or an f-crossbar up high). The healthy fixtures
// read 34, 71, and 111 (cc-3's ll, a clean join with a visible connector verified
// on render); a pair that connects nowhere (the old flourished-f drop hit 210)
// fails. This replaces the body-strip joinGap MAX gate, which measured dense-body
// spacing the body-edge model intentionally keeps a connector apart.
const FULL_JOIN_MAX = 130;
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
      // Build each fixture in a deterministic, intended mode: this harness drives
      // the connect toggle explicitly (off for the trim/overhang fixtures, on for
      // the connected-cursive fixture), so it must not auto-connect script faces.
      localStorage.setItem('fh-test-no-autoconnect', '1');
    } catch {
      /* private mode */
    }
  });
});

// Lowercase->lowercase pairs that should JOIN in connect mode (no break-class
// glyph, no descender-exit left member). The realized gap should be a touch,
// never visible daylight, or the "connected" face reads disconnected.
const JOIN_PAIRS = ['an', 'ne', 'en', 'nn', 'mi', 'in', 're', 'er', 'ou', 'un', 'th', 'he', 'ic', 'ck', 'ow', 'wn', 'el', 'll', 'or', 'ab', 'cd', 'de', 'ef', 'ro', 'br', 'fr', 'lo', 'oo', 'ee'];

type Metrics = {
  glyphs: number;
  structural: { depth: number; worst: string };
  crosser: { depth: number; worst: string };
  capOverhang: { depth: number; worst: string };
  rhythmSd: number;
  wordSpaceMedian: number;
  joinGapMedian: number;
  joinGapMax: number;
  joinGapWorst: string;
  connJoinMedian: number;
  connJoinMax: number;
  connJoinWorst: string;
  fullJoinMax: number;
  fullJoinWorst: string;
  probe?: unknown;
};

async function measure(page: Page, otfPath: string, wantProbe = false): Promise<Metrics> {
  const b64 = readFileSync(otfPath).toString('base64');
  return page.evaluate(
    ({ b, structuralPairs, crosserPairs, capPairs, pangram, spacePairs, joinPairs, wantProbe }) => {
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

      // Rendered DENSE-BODY edges: rasterize the glyph and keep only the TALL
      // columns (ink spanning most of the x-height) — the dense body the eye reads
      // for rhythm, with the thin connecting strokes excluded. This is the measure
      // that matched the field read where the band-profile pairGap (connector-
      // inclusive) did not: on a thin hand a connector rides into the strip so the
      // profile calls a gapped pair tight. Cached per glyph.
      const bodyCache = new Map<string, { bl: number; br: number; adv: number } | null>();
      const bodyEdges = (ch: string) => {
        if (bodyCache.has(ch)) return bodyCache.get(ch)!;
        const g = font.charToGlyph(ch);
        if (!g || !g.path || !g.path.commands || !g.path.commands.length) {
          bodyCache.set(ch, null);
          return null;
        }
        const bb = g.getBoundingBox();
        const S = 60 / Math.max(1, xh); // ~60px x-height raster
        const pad = 6;
        const w = Math.ceil((bb.x2 - bb.x1) * S) + pad * 2;
        const h = Math.ceil((bb.y2 - bb.y1) * S) + pad * 2;
        const cv = new OffscreenCanvas(w, h);
        const ctx = cv.getContext('2d')!;
        ctx.fillStyle = '#000';
        const tx = (x: number) => (x - bb.x1) * S + pad;
        const ty = (y: number) => h - ((y - bb.y1) * S + pad);
        ctx.beginPath();
        for (const c of g.path.commands) {
          if (c.type === 'M') ctx.moveTo(tx(c.x), ty(c.y));
          else if (c.type === 'L') ctx.lineTo(tx(c.x), ty(c.y));
          else if (c.type === 'C') ctx.bezierCurveTo(tx(c.x1), ty(c.y1), tx(c.x2), ty(c.y2), tx(c.x), ty(c.y));
          else if (c.type === 'Q') ctx.quadraticCurveTo(tx(c.x1), ty(c.y1), tx(c.x), ty(c.y));
          else if (c.type === 'Z') ctx.closePath();
        }
        ctx.fill('nonzero');
        const img = ctx.getImageData(0, 0, w, h).data;
        const th = 0.45 * xh * S; // a body column spans most of the x-height
        let bl = -1;
        let br = -1;
        for (let x = 0; x < w; x++) {
          let cnt = 0;
          for (let y = 0; y < h; y++) if (img[(y * w + x) * 4 + 3] > 128) cnt++;
          if (cnt > th) {
            if (bl < 0) bl = x;
            br = x;
          }
        }
        if (bl < 0) {
          bodyCache.set(ch, null);
          return null;
        }
        const toFU = (px: number) => (px - pad) / S + bb.x1;
        const out = { bl: toFU(bl), br: toFU(br), adv: g.advanceWidth };
        bodyCache.set(ch, out);
        return out;
      };
      // Dense-body gap: white space between L's body right edge and R's body left
      // edge across the advance (optionally with the GPOS kern). Positive = daylight
      // between bodies, negative = bodies overlapping — what the eye judges as rhythm.
      const denseBodyGap = (l: string, r: string, wantKern: boolean) => {
        const L = bodyEdges(l);
        const R = bodyEdges(r);
        if (!L || !R) return null;
        return L.adv + (wantKern ? kern(l, r) : 0) + R.bl - L.br;
      };

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

      // Connection-band gap: the closest approach in the LOW connector zone
      // (baseline up to ~0.6 x-height), where a connected cursive's join strokes
      // actually meet. The connection-point model places exit-on-entry here, so
      // this should be ~0; it is the right gate for connect (the body-strip
      // pairGap above measures body spacing, which is naturally a connector-width
      // apart and not what "do the letters join" means).
      const connGap = (l: string, r: string) => {
        const L = profile(l);
        const R = profile(r);
        if (!L || !R) return null;
        const y0 = Math.max(L.yMin, R.yMin, xh * 0.02);
        const y1 = Math.min(L.yMax, R.yMax, xh * 0.6);
        if (y1 <= y0) return null;
        const offset = L.adv + kern(l, r);
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

      // Full-height connection: the closest approach over the ENTIRE shared
      // height (no strip clamp), so a join counts no matter where the connecting
      // ink rides — a baseline connector, an x-height stroke, or f's crossbar up
      // in the ascender zone. This is the right "do they connect" gate for the
      // body-edge model, where the dense bodies sit a gap apart and the real
      // strokes bridge them at whatever height they happen to live.
      const fullGap = (l: string, r: string) => {
        const L = profile(l);
        const R = profile(r);
        if (!L || !R) return null;
        const y0 = Math.max(L.yMin, R.yMin);
        const y1 = Math.min(L.yMax, R.yMax);
        if (y1 <= y0) return null;
        const offset = L.adv + kern(l, r);
        let gap = Infinity;
        const spanL = Math.max(1, L.yMax - L.yMin);
        const spanR = Math.max(1, R.yMax - R.yMin);
        for (let s = 0; s <= 64; s++) {
          const y = y0 + ((y1 - y0) * s) / 64;
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

      // join gaps: how far apart adjacent lowercase letters land in the body
      // strip. Positive = daylight (disconnected); ~0 or slightly negative =
      // joined. Median across the join pairs + the worst (largest) gap.
      const jg: Array<{ p: string; g: number }> = [];
      for (const p of joinPairs) {
        const g = pairGap(p[0], p[1]);
        if (g !== null) jg.push({ p, g });
      }
      const jgVals = jg.map((x) => x.g).sort((a, b) => a - b);
      const joinGapMedian = jgVals.length ? jgVals[Math.floor(jgVals.length / 2)] : 0;
      let joinGapMax = -Infinity;
      let joinGapWorst = '';
      for (const x of jg)
        if (x.g > joinGapMax) {
          joinGapMax = x.g;
          joinGapWorst = x.p;
        }
      if (!isFinite(joinGapMax)) joinGapMax = 0;

      // connection-band join: do the connectors actually meet (low zone, ~0)? The
      // right gate for connect mode (the connection-point model meets exit-on-entry
      // here by construction); also flags a kink (a seam that meets high or gaps).
      const cg: Array<{ p: string; g: number }> = [];
      for (const p of joinPairs) {
        const g = connGap(p[0], p[1]);
        if (g !== null) cg.push({ p, g });
      }
      const cgVals = cg.map((x) => Math.abs(x.g)).sort((a, b) => a - b);
      const connJoinMedian = cgVals.length ? cgVals[Math.floor(cgVals.length / 2)] : 0;
      let connJoinMax = 0;
      let connJoinWorst = '';
      for (const x of cg)
        if (Math.abs(x.g) > connJoinMax) {
          connJoinMax = Math.abs(x.g);
          connJoinWorst = x.p;
        }

      // full-height connection: the WORST join pair's closest approach over its
      // full height. <=0 means it touches somewhere; a large positive value is a
      // pair that connects nowhere (a real disconnect). The body-edge connect gate.
      let fullJoinMax = -Infinity;
      let fullJoinWorst = '';
      for (const p of joinPairs) {
        const g = fullGap(p[0], p[1]);
        if (g === null) continue;
        if (g > fullJoinMax) {
          fullJoinMax = g;
          fullJoinWorst = p;
        }
      }
      if (!isFinite(fullJoinMax)) fullJoinMax = 0;

      let glyphs = 0;
      for (let i = 0; i < font.glyphs.length; i++) {
        const g = font.glyphs.get(i);
        if (g && g.path && g.path.commands && g.path.commands.length) glyphs++;
      }

      // --- Step 1 probe: per-pair residual map (only when requested) -----------
      // rawGap = the body-strip gap BEFORE the GPOS value (the placement gap);
      // kernValue = the applied connect-kern correction; realizedGap = what the reader
      // sees. The kern is a constant x-offset on every band, so rawGap = realizedGap -
      // kernValue. saturated flags a pair pinned at the connect-kern's +/-650 clamp (a
      // correction GPOS could not fully apply, which points at placement, not spacing).
      let probe: unknown = null;
      if (wantProbe) {
        const CLAMP = 650; // MAX_UNITS in analyzeConnectKern
        const rows = joinPairs.map((p) => {
          const realized = pairGap(p[0], p[1]);
          const kv = kern(p[0], p[1]);
          const cn = connGap(p[0], p[1]);
          const fl = fullGap(p[0], p[1]);
          const dbK = denseBodyGap(p[0], p[1], true);
          const dbN = denseBodyGap(p[0], p[1], false);
          return {
            pair: p,
            rawGap: realized === null ? null : Math.round(realized - kv),
            kernValue: Math.round(kv),
            realizedGap: realized === null ? null : Math.round(realized),
            connGap: cn === null ? null : Math.round(cn),
            fullGap: fl === null ? null : Math.round(fl),
            // dense-body gap = the eye's rhythm read: WITH the current kern (rendered)
            // and WITHOUT it (the placement baseline). If the kern hurts, noKern is
            // the tighter-spread of the two.
            denseBodyKern: dbK === null ? null : Math.round(dbK),
            denseBodyNoKern: dbN === null ? null : Math.round(dbN),
            saturated: Math.abs(kv) >= CLAMP - 8,
          };
        });
        const spreadOf = (arr: number[]) => {
          if (!arr.length) return 0;
          const m = arr.reduce((a, x) => a + x, 0) / arr.length;
          return Math.round(Math.sqrt(arr.reduce((a, x) => a + (x - m) * (x - m), 0) / arr.length));
        };
        const medOf = (arr: number[]) => {
          if (!arr.length) return 0;
          const s = [...arr].sort((a, b) => a - b);
          return Math.round(s[Math.floor(s.length / 2)]);
        };
        const dbK = rows.map((r) => r.denseBodyKern).filter((x): x is number => x !== null);
        const dbN = rows.map((r) => r.denseBodyNoKern).filter((x): x is number => x !== null);
        const rv = rows.map((r) => r.realizedGap).filter((x): x is number => x !== null).sort((a, b) => a - b);
        const rMed = rv.length ? rv[Math.floor(rv.length / 2)] : 0;
        const rMean = rv.reduce((a, x) => a + x, 0) / Math.max(1, rv.length);
        const rSd = Math.sqrt(rv.reduce((a, x) => a + (x - rMean) * (x - rMean), 0) / Math.max(1, rv.length));
        const outliers = rows
          .filter((r) => r.realizedGap !== null && r.realizedGap > rMed + rSd)
          .sort((a, b) => (b.realizedGap as number) - (a.realizedGap as number));
        // Context fork: for the loosest pairs, vary the LEFT glyph and re-measure the
        // right glyph's raw gap. A spread explained by which left glyph it is means the
        // spacing is PAIR-determined (PairPos covers it); a static glyph model has no
        // third-glyph variable that only ChainContextPos could reach.
        const ctxLefts = 'iwhbor'.split('');
        const contextFork = outliers.slice(0, 3).map((o) => {
          const right = o.pair[1];
          const byLeft = ctxLefts.map((L) => {
            const realized = pairGap(L, right);
            const kv = kern(L, right);
            return { left: L, rawGap: realized === null ? null : Math.round(realized - kv), realizedGap: realized === null ? null : Math.round(realized) };
          });
          const raws = byLeft.map((x) => x.rawGap).filter((x): x is number => x !== null);
          const m2 = raws.reduce((a, x) => a + x, 0) / Math.max(1, raws.length);
          const sd2 = Math.sqrt(raws.reduce((a, x) => a + (x - m2) * (x - m2), 0) / Math.max(1, raws.length));
          return { rightGlyph: right, fromPair: o.pair, rawSpreadSd: Math.round(sd2), byLeft };
        });
        probe = {
          upm,
          realizedMedian: Math.round(rMed),
          realizedSd: Math.round(rSd),
          // Rendered dense-body rhythm: the eye's measure. medianKern/sdKern are what
          // ships now; sdNoKern is the placement baseline. sdKern > sdNoKern means the
          // connect-kern is SCATTERING this hand (evening bodyAvg, not the render).
          denseBodyMedianKern: medOf(dbK),
          denseBodySdKern: spreadOf(dbK),
          denseBodySdNoKern: spreadOf(dbN),
          outlierPairs: outliers.map((o) => o.pair),
          anySaturated: rows.some((r) => r.saturated),
          rows,
          contextFork,
        };
      }

      return {
        glyphs,
        probe,
        structural,
        crosser,
        capOverhang,
        rhythmSd: Math.round(sd),
        wordSpaceMedian: Math.round(wordSpaceMedian),
        joinGapMedian: Math.round(joinGapMedian),
        joinGapMax: Math.round(joinGapMax),
        joinGapWorst,
        connJoinMedian: Math.round(connJoinMedian),
        connJoinMax: Math.round(connJoinMax),
        connJoinWorst,
        fullJoinMax: Math.round(fullJoinMax),
        fullJoinWorst,
      };
    },
    { b: b64, structuralPairs: STRUCTURAL_PAIRS, crosserPairs: CROSSER_PAIRS, capPairs: CAP_PAIRS, pangram: PANGRAM, spacePairs: SPACE_PAIRS, joinPairs: JOIN_PAIRS, wantProbe },
  );
}

for (const sheet of sheets) {
  test(`corpus: ${sheet.name}`, async ({ page }) => {
    const isConnect = sheet.name.startsWith('connected-cursive');
    await page.goto('/make');
    await page.locator('#sheet-file').setInputFiles(sheet.path);
    await expect(page.getByRole('button', { name: 'download otf' })).toBeVisible({ timeout: 150_000 });

    // The connected-cursive fixture is built in connect mode (auto-detect is off
    // in this harness); every other fixture stays on the trim/overhang path.
    if (isConnect) {
      await page.getByRole('button', { name: 'advanced' }).click();
      await page.getByRole('button', { name: /connected cursive/ }).click();
      await page.getByRole('button', { name: 'rebuild with these settings' }).click();
      await expect(page.getByRole('button', { name: 'download otf' })).toBeVisible({ timeout: 150_000 });
    }

    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: 'download otf' }).click(),
    ]);
    const otfPath = test.info().outputPath(`${sheet.name}.otf`);
    await download.saveAs(otfPath);

    const m = await measure(page, otfPath, isConnect && !!process.env.CORPUS_KERN_PROBE);
    const trim = await page.evaluate(() => (window as unknown as { __lastTrim?: { script: boolean; trimmed: number } }).__lastTrim);
    const conn = await page.evaluate(() => (window as unknown as { __lastConnect?: { joined: number; broke: number } }).__lastConnect);
    const mode = isConnect ? `connect/${conn?.joined ?? '?'}j` : `${trim?.script ? 'script' : 'upright'}/${trim?.trimmed ?? '?'}`;
    console.log(
      `CORPUS | ${sheet.name.padEnd(24)} | ${mode} glyphs=${m.glyphs} structural=${m.structural.depth}(${m.structural.worst || '-'}) crosser=${m.crosser.depth}(${m.crosser.worst || '-'}) capOverhang=${m.capOverhang.depth}(${m.capOverhang.worst || '-'}) rhythmSd=${m.rhythmSd} wordSpace=${m.wordSpaceMedian} joinGap=med${m.joinGapMedian}/max${m.joinGapMax}(${m.joinGapWorst || '-'}) connJoin=med${m.connJoinMedian}/max${m.connJoinMax}(${m.connJoinWorst || '-'}) fullJoin=${m.fullJoinMax}(${m.fullJoinWorst || '-'})`,
    );

    // Step 1 kern probe: dump the per-pair residual map for the connect fixtures so
    // the spacing-vs-placement and pair-vs-context forks are decided from data.
    if (m.probe) {
      mkdirSync(OUT_DIR, { recursive: true });
      const probePath = join(OUT_DIR, `kern-residual-${sheet.name}.json`);
      writeFileSync(probePath, JSON.stringify(m.probe, null, 2));
      const pr = m.probe as {
        realizedMedian: number;
        realizedSd: number;
        outlierPairs: string[];
        anySaturated: boolean;
        denseBodyMedianKern: number;
        denseBodySdKern: number;
        denseBodySdNoKern: number;
      };
      console.log(
        `KERN-PROBE | ${sheet.name.padEnd(24)} | realizedMed=${pr.realizedMedian} sd=${pr.realizedSd} | denseBody med=${pr.denseBodyMedianKern} sdKern=${pr.denseBodySdKern} sdNoKern=${pr.denseBodySdNoKern} | outliers=${pr.outlierPairs.join(',') || '-'} saturated=${pr.anySaturated} -> ${probePath}`,
      );
    }

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
    expect(m.structural.depth, `structural fusion (worst pair ${m.structural.worst})`).toBeLessThanOrEqual(isConnect ? STRUCTURAL_MAX_CONNECT : STRUCTURAL_MAX);
    expect(m.crosser.depth, `crosser over-kern (worst pair ${m.crosser.worst})`).toBeLessThanOrEqual(CROSSER_MAX);
    // Cap-zone over-kern only makes sense for upright faces; a script cap
    // legitimately swashes into the cap/ascender zone this metric watches.
    if (!trim?.script && !isConnect) {
      expect(m.capOverhang.depth, `cap over-kern weld (worst pair ${m.capOverhang.worst})`).toBeLessThanOrEqual(CAP_OVERHANG_MAX);
    }
    expect(m.rhythmSd, 'pair-gap rhythm spread').toBeLessThanOrEqual(RHYTHM_SD_MAX);
    expect(m.wordSpaceMedian, 'word-break visibility').toBeGreaterThanOrEqual(WORD_SPACE_MIN);
    if (isConnect) {
      // stays connected (median body-strip gap negative/tight, not drifted back to
      // word spacing) AND every join pair meets somewhere over its full height.
      expect(m.joinGapMedian, `connect join gap median (worst ${m.joinGapWorst})`).toBeLessThanOrEqual(JOIN_GAP_MEDIAN_MAX);
      expect(m.fullJoinMax, `connect full-height join gap (worst ${m.fullJoinWorst})`).toBeLessThanOrEqual(FULL_JOIN_MAX);
    }
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
