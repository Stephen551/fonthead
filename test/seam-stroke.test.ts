import { describe, it, expect } from 'vitest';
import { traceTerminalStroke } from '../src/lib/maker';

// Stage A of the connector-reconstruction milestone (ADR 0049, plan
// 2026-07-02): the terminal stroke model. traceTerminalStroke reads a
// glyph's EXISTING row profile and recovers the exit (or entry) tail as a
// STROKE — centerline points, a measured width, the attachment point and
// tangent at the body edge, and the tip — or null when there is no usable
// tail. Pure and jsdom-safe: profiles are injected, no canvas.
//
// The model reads PER-COLUMN y-extents (colTop/colBot, recorded by
// glyphColumnAreas in its raster pass): cross-section at column x is
// [colTop[x], colBot[x]]. Per-row extents cannot recover a sloped tail — a
// descending stroke's rowRight smears every column into the union of all
// columns to its right (proven by these tests before implementation).

const CW = 48;
const CH = 100;
const BASE = 80;

type Prof = {
  cols: number[];
  spans: number[];
  rowLeft: number[];
  rowRight: number[];
  colTop: number[];
  colBot: number[];
  inkTopRow: number;
};

// a dense body [bodyX0..bodyX1] over the full x-height, plus an exit tail
// described by per-column y-centers: tail[i] = center row of the tail at
// column bodyX1+1+i, drawn `thick` rows tall.
const profWithExit = (bodyX0: number, bodyX1: number, tailCenters: number[], thick = 5): Prof => {
  const cols = new Array(CW).fill(0);
  const colTop = new Array(CW).fill(Infinity);
  const colBot = new Array(CW).fill(-Infinity);
  for (let x = bodyX0; x <= bodyX1; x++) {
    cols[x] = 30;
    colTop[x] = BASE - 30;
    colBot[x] = BASE;
  }
  const rowLeft = new Array(CH).fill(Infinity);
  const rowRight = new Array(CH).fill(-Infinity);
  for (let y = BASE - 30; y <= BASE; y++) {
    rowLeft[y] = bodyX0;
    rowRight[y] = bodyX1;
  }
  const half = Math.floor(thick / 2);
  tailCenters.forEach((cy, i) => {
    const x = bodyX1 + 1 + i;
    cols[x] = thick;
    colTop[x] = cy - half;
    colBot[x] = cy + half;
    for (let y = cy - half; y <= cy + half; y++) {
      if (rowLeft[y] === Infinity) rowLeft[y] = bodyX0; // tail rows still start at the body
      if (rowRight[y] < x) rowRight[y] = x;
    }
  });
  const spans = cols.map((n) => (n > 0 ? (n > 10 ? 0.9 : 0.1) : 0));
  return { cols, spans, rowLeft, rowRight, colTop, colBot, inkTopRow: BASE - 30 };
};

const BODY = { min: 10, max: 26 };

describe('traceTerminalStroke (Stage A, ADR 0049)', () => {
  it('recovers a flat tail: level centerline, vertical thickness as width, tip at the last column', () => {
    // 8 columns at a constant center height 0.5·xh above baseline (row 65)
    const prof = profWithExit(10, 26, new Array(8).fill(65));
    const s = traceTerminalStroke(prof as never, BODY, BASE, 30, 'right')!;
    expect(s).toBeTruthy();
    expect(s.attach.x).toBe(27);
    expect(s.attach.y).toBeCloseTo(65, 0);
    expect(s.tip.x).toBe(34);
    expect(s.tip.y).toBeCloseTo(65, 0);
    expect(s.width).toBeCloseTo(5, 0); // flat stroke: width = the 5-row cross-section
    expect(Math.abs(s.tangent.dy)).toBeLessThan(0.2); // level tangent
    expect(s.tangent.dx).toBeGreaterThan(0.9);
  });

  it('recovers a descending tail: falling centerline, slope-corrected width, downward tangent', () => {
    // centers descend 2 rows per column (y grows down = stroke falls toward the baseline)
    const centers = [56, 58, 60, 62, 64, 66, 68, 70];
    const prof = profWithExit(10, 26, centers);
    const s = traceTerminalStroke(prof as never, BODY, BASE, 30, 'right')!;
    expect(s.attach.y).toBeCloseTo(56, 0);
    expect(s.tip.y).toBeCloseTo(70, 0);
    expect(s.tangent.dy).toBeGreaterThan(0.5); // descending (cell y grows down)
    // vertical cross-section 5 on a slope dy/dx=2: true width = 5·cos(atan(2)) ≈ 2.24
    expect(s.width).toBeGreaterThan(1.5);
    expect(s.width).toBeLessThan(3.5);
  });

  it('reports the root width of a tapering tail separately from the median', () => {
    // a drawn tail thins toward its tip (brush lift): per-column thickness
    // 9,9,8,7,6,5,4,3. The whole-tail median (~6) understates the stroke the
    // connector must carry — the Stage D forensic panel measured synthesized
    // strokes at half the face norm because of exactly this. rootWidth reads
    // the attachment end only.
    const thicks = [9, 9, 8, 7, 6, 5, 4, 3];
    const cols = new Array(CW).fill(0);
    const colTop = new Array(CW).fill(Infinity);
    const colBot = new Array(CW).fill(-Infinity);
    for (let x = 10; x <= 26; x++) {
      cols[x] = 30;
      colTop[x] = BASE - 30;
      colBot[x] = BASE;
    }
    thicks.forEach((th, i) => {
      const x = 27 + i;
      const half = th / 2;
      cols[x] = th;
      colTop[x] = 65 - half;
      colBot[x] = 65 + half;
    });
    const rowLeft = new Array(CH).fill(Infinity);
    const rowRight = new Array(CH).fill(-Infinity);
    const spans = cols.map((n) => (n > 0 ? (n > 10 ? 0.9 : 0.1) : 0));
    const prof = { cols, spans, rowLeft, rowRight, colTop, colBot, inkTopRow: BASE - 30 };
    const s = traceTerminalStroke(prof as never, BODY, BASE, 30, 'right')!;
    expect(s.width).toBeLessThanOrEqual(8.5); // whole-tail median, mid-taper
    expect(s.rootWidth).toBeGreaterThan(9); // the attachment-end stroke weight
    expect(s.rootWidth).toBeLessThanOrEqual(10.5);
  });

  it('starts the stroke at the connector-weight point, sparing a structural taper', () => {
    // the wo regression (director's catch): for w/v/b the columns right of
    // the dense body are the letter's own tapered terminal stroke, then a
    // separation pinch, then the true connector flick. Attaching at the body
    // edge amputated the drawn structure. The model must attach where the
    // tail first runs at connector weight.
    const thicks = [40, 38, 36, 3, 10, 10, 10, 10, 10, 10];
    const cols = new Array(CW).fill(0);
    const colTop = new Array(CW).fill(Infinity);
    const colBot = new Array(CW).fill(-Infinity);
    for (let x = 10; x <= 26; x++) {
      cols[x] = 30;
      colTop[x] = BASE - 30;
      colBot[x] = BASE;
    }
    thicks.forEach((th, i) => {
      const x = 27 + i;
      cols[x] = Math.min(th, 8); // sparse tall unions: a diagonal limb
      colTop[x] = 65 - th / 2;
      colBot[x] = 65 + th / 2;
    });
    const rowLeft = new Array(CH).fill(Infinity);
    const rowRight = new Array(CH).fill(-Infinity);
    const spans = cols.map((n) => (n > 0 ? (n > 20 ? 0.9 : 0.1) : 0));
    const prof = { cols, spans, rowLeft, rowRight, colTop, colBot, inkTopRow: BASE - 30 };
    const s = traceTerminalStroke(prof as never, BODY, BASE, 30, 'right')!;
    expect(s.attach.x).toBeGreaterThanOrEqual(30); // past the structural taper (cols 27-29)
    expect(s.attach.x).toBeLessThanOrEqual(32); // at the pinch/flick root, not deep into the flick
    expect(s.width).toBeGreaterThan(8); // the flick's weight, not the limb's
    expect(s.width).toBeLessThan(12);
  });

  it('root width rejects union-contaminated columns at the body edge', () => {
    // the columns just past the dense body still carry bowl/crossover ink, and
    // the per-column extent is a UNION — the raw root columns read ~4x the
    // stroke (the Stage D slab regression). The root read must skip columns
    // whose width is an outlier against the whole-tail median and take the
    // first trustworthy stroke columns instead.
    const thicks = [44, 40, 12, 11, 10, 9, 8, 7];
    const cols = new Array(CW).fill(0);
    const colTop = new Array(CW).fill(Infinity);
    const colBot = new Array(CW).fill(-Infinity);
    for (let x = 10; x <= 26; x++) {
      cols[x] = 30;
      colTop[x] = BASE - 30;
      colBot[x] = BASE;
    }
    thicks.forEach((th, i) => {
      const x = 27 + i;
      cols[x] = th;
      colTop[x] = 60 - th / 2;
      colBot[x] = 60 + th / 2;
    });
    const rowLeft = new Array(CH).fill(Infinity);
    const rowRight = new Array(CH).fill(-Infinity);
    const spans = cols.map((n) => (n > 0 ? (n > 20 ? 0.9 : 0.1) : 0));
    const prof = { cols, spans, rowLeft, rowRight, colTop, colBot, inkTopRow: BASE - 30 };
    const s = traceTerminalStroke(prof as never, BODY, BASE, 30, 'right')!;
    expect(s.rootWidth).toBeLessThan(16); // the stroke, not the bowl union
    expect(s.rootWidth).toBeGreaterThan(9);
  });

  it('returns null when there is no tail past the body', () => {
    const prof = profWithExit(10, 26, []);
    expect(traceTerminalStroke(prof as never, BODY, BASE, 30, 'right')).toBeNull();
  });

  it('returns null for a stub too short to carry a tangent', () => {
    const prof = profWithExit(10, 26, [65, 65]);
    expect(traceTerminalStroke(prof as never, BODY, BASE, 30, 'right')).toBeNull();
  });

  it('reads the entry side mirrored', () => {
    // mirror: an entry tail LEFT of the body, flat at row 74 (0.2·xh)
    const cols = new Array(CW).fill(0);
    const colTop = new Array(CW).fill(Infinity);
    const colBot = new Array(CW).fill(-Infinity);
    for (let x = 10; x <= 26; x++) {
      cols[x] = 30;
      colTop[x] = BASE - 30;
      colBot[x] = BASE;
    }
    const rowLeft = new Array(CH).fill(Infinity);
    const rowRight = new Array(CH).fill(-Infinity);
    for (let y = BASE - 30; y <= BASE; y++) {
      rowLeft[y] = 10;
      rowRight[y] = 26;
    }
    for (let i = 0; i < 6; i++) {
      const x = 9 - i;
      cols[x] = 5;
      colTop[x] = 72;
      colBot[x] = 76;
      for (let y = 72; y <= 76; y++) if (rowLeft[y] > x) rowLeft[y] = x;
    }
    const spans = cols.map((n) => (n > 0 ? (n > 10 ? 0.9 : 0.1) : 0));
    const prof = { cols, spans, rowLeft, rowRight, colTop, colBot, inkTopRow: BASE - 30 };
    const s = traceTerminalStroke(prof as never, BODY, BASE, 30, 'left')!;
    expect(s.attach.x).toBe(9);
    expect(s.tip.x).toBe(4);
    expect(s.tip.y).toBeCloseTo(74, 0);
    expect(s.tangent.dx).toBeLessThan(-0.9); // pointing left, away from the body
  });
});
