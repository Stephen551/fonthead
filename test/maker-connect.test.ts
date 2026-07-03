import { describe, it, expect } from 'vitest';
import { joinClass, anchorAdvance, connectGlyphs, isScriptFace, makeSeamAlternates } from '../src/lib/maker';

// Connected-cursive join classification. Pure, position-independent (a glyph's
// class is a property of the character alone), no canvas, no engine.
describe('joinClass', () => {
  it('lowercase baseline letter joins both sides', () => {
    const c = joinClass('n');
    expect(c.kind).toBe('join');
    expect(c.joinsLeft).toBe(true);
    expect(c.joinsRight).toBe(true);
    expect(c.highExit).toBe(false);
  });

  it('high-exit lowercase flags highExit (incl. r, whose arm rides above the band)', () => {
    expect(joinClass('o').highExit).toBe(true);
    expect(joinClass('s').highExit).toBe(true);
    expect(joinClass('r').highExit).toBe(true); // prototype correction
    expect(joinClass('f').highExit).toBe(false); // f stays out (crossbar)
    expect(joinClass('t').highExit).toBe(false);
  });

  it('descender letter joins both sides (body carries the join, loop hangs below)', () => {
    const c = joinClass('g');
    expect(c.kind).toBe('join');
    expect(c.joinsLeft).toBe(true);
    expect(c.joinsRight).toBe(true);
  });

  it('caps open a word: clean left, join right into the lowercase', () => {
    expect(joinClass('H')).toMatchObject({ kind: 'join', joinsLeft: false, joinsRight: true });
    expect(joinClass('B')).toMatchObject({ kind: 'join', joinsLeft: false, joinsRight: true });
  });

  it('digit, punctuation break both sides; space is space', () => {
    expect(joinClass('5')).toMatchObject({ kind: 'break', joinsLeft: false, joinsRight: false });
    expect(joinClass('!').kind).toBe('break');
    expect(joinClass(' ').kind).toBe('space');
  });
});

describe('anchorAdvance', () => {
  const base = { overlapPx: 0, minAdvPx: 5, leftPadPx: 1, joinLeft: true, joinRight: true };
  it('joinLeft+joinRight: anchors on left plug when entry is leftmost ink', () => {
    const r = anchorAdvance({ ...base, leftPlug: 10, rightPlug: 40, inkLeft: 10 });
    expect(r.dx).toBe(-10); // anchorOrigin = min(10,10) = 10
    expect(r.cellW).toBe(30); // 40 - 10 - 0
  });

  it('round letter bowl left of entry anchors on ink and shortens advance the same', () => {
    // bowl bulges left: inkLeft=4, entry plug=10
    const r = anchorAdvance({ ...base, leftPlug: 10, rightPlug: 40, inkLeft: 4 });
    expect(r.dx).toBe(-4); // anchorOrigin = min(10,4) = 4 → no negative-x ink
    expect(r.cellW).toBe(36); // 40 - 4 - 0 → right plug still lands at the join
  });

  it('overlap shortens the advance', () => {
    const r = anchorAdvance({ ...base, overlapPx: 3, leftPlug: 10, rightPlug: 40, inkLeft: 10 });
    expect(r.cellW).toBe(27); // 40 - 10 - 3
  });

  it('minAdvPx floors a narrow letter', () => {
    const r = anchorAdvance({ ...base, leftPlug: 10, rightPlug: 12, inkLeft: 10 });
    expect(r.cellW).toBe(5); // max(5, 12-10-0 = 2)
  });

  it('joinLeft=false (word-opener) gets a body-left bearing', () => {
    const r = anchorAdvance({ ...base, joinLeft: false, leftPlug: 10, rightPlug: 40, inkLeft: 6 });
    expect(r.dx).toBe(1 - 6); // leftPadPx - inkLeft
    expect(r.cellW).toBe(35); // max(5, (40-0) - (6-1)) = 40 - 5 = 35
  });

  it('joinRight=false (descender-exit) advances past the plug by a pad', () => {
    const r = anchorAdvance({ ...base, joinRight: false, leftPlug: 10, rightPlug: 40, inkLeft: 10 });
    expect(r.dx).toBe(-10);
    expect(r.cellW).toBe(31); // (40 + 1) - 10
  });
});

describe('connectGlyphs (structural)', () => {
  // Glyphs with no usable paths raster to null, so every glyph falls to the
  // break-class fallback. This exercises the orchestration without needing a
  // real canvas (the full raster path is gated by the corpus/e2e suites).
  it('tolerates empty glyphs and never produces a non-positive advance', () => {
    const glyphs = [
      { char: 'a', italic: false, paths: [], cellW: 40, cellH: 100, baselineYInCell: 80 },
      { char: ' ', italic: false, paths: [], cellW: 30, cellH: 100, baselineYInCell: 80 },
      { char: 'n', italic: false, paths: [], cellW: 50, cellH: 100, baselineYInCell: 80 },
    ];
    const out = connectGlyphs(glyphs as never, {});
    expect(out.glyphs).toHaveLength(3);
    for (const g of out.glyphs) expect(g.cellW).toBeGreaterThan(0);
    expect(out.joined + out.broke).toBeGreaterThanOrEqual(0);
  });

  it('isScriptFace returns false with no measurable ink (jsdom: no canvas)', () => {
    const glyphs = [{ char: 'a', italic: false, paths: [], cellW: 40, cellH: 100, baselineYInCell: 80 }];
    expect(isScriptFace(glyphs as never)).toBe(false);
  });
});

describe('connectGlyphs (geometry, injected profiles)', () => {
  // jsdom has no canvas, so feed connectGlyphs synthetic column rasters to
  // exercise the band/plug/anchor/advance path the production build runs.
  const CELL_W = 40;
  const CELL_H = 100;
  const BASE = 80; // baseline y in cell
  // a rectangular glyph inked from x0..x1, from (baseline-h) up to baseline
  const rect = (x0: number, x1: number, h: number) => {
    const cols = new Array(CELL_W).fill(0);
    for (let x = x0; x <= x1; x++) cols[x] = h;
    const spans = cols.map((n) => (n > 0 ? 0.9 : 0));
    const rowLeft = new Array(CELL_H).fill(Infinity);
    const rowRight = new Array(CELL_H).fill(-Infinity);
    for (let y = BASE - h; y <= BASE; y++) {
      rowLeft[y] = x0;
      rowRight[y] = x1;
    }
    return { cols, spans, rowLeft, rowRight, inkTopRow: BASE - h };
  };
  const g = (char: string, x0: number, x1: number, h = 30) => ({ char, italic: false, paths: [`M${x0} 0`], cellW: CELL_W, cellH: CELL_H, baselineYInCell: BASE, _p: rect(x0, x1, h) });

  it('joins lowercase on the body edge with a connector gap', () => {
    const gs = [g('x', 2, 20), g('n', 3, 22)];
    const out = connectGlyphs(gs as never, {}, gs.map((x) => x._p) as never);
    expect(out.joined).toBe(2);
    expect(out.broke).toBe(0);
    // advance = body width + a connector gap (~0.16 x-height = 5px here); the bodies
    // sit a gap apart and the real strokes bridge it. A uniform rect doesn't trim,
    // so the dense body edge is the full ink.
    expect(out.glyphs[0].cellW).toBe(23); // x: (20 - 2) + gap(5)
    expect(out.glyphs[1].cellW).toBe(24); // n: (22 - 3) + gap(5)
  });

  it('descender joins right like a normal letter (body carries the join)', () => {
    const gs = [g('x', 2, 20), g('g', 2, 20)]; // identical ink; g now joins both sides
    const out = connectGlyphs(gs as never, {}, gs.map((x) => x._p) as never);
    expect(out.glyphs[0].cellW).toBe(23); // x: ink(18) + connector gap(5)
    expect(out.glyphs[1].cellW).toBe(23); // g joins right too -> same advance as x
  });

  it('caps open a word: join right with a clean left bearing', () => {
    const gs = [g('H', 4, 24)];
    const out = connectGlyphs(gs as never, {}, gs.map((x) => x._p) as never);
    expect(out.joined).toBe(1); // caps now join right into the following lowercase
    expect(out.broke).toBe(0);
    expect(out.glyphs[0].cellW).toBeGreaterThanOrEqual(24 - 4); // at least the body span
  });

  // The body-edge model's distinguishing behaviour: the advance runs to the dense
  // BODY edge and TRIMS the thin exit connector, which then rides over the seam into
  // the next letter. Build a body [4..20] plus a thin, short exit connector [21..28]
  // (short enough to fully trim), and an x glyph to set the x-height.
  const bodyWithExit = () => {
    const cols = new Array(CELL_W).fill(0);
    for (let x = 4; x <= 20; x++) cols[x] = 30; // body, full height
    for (let x = 21; x <= 28; x++) cols[x] = 3; // thin exit connector (short, fully trimmable)
    const spans = cols.map((n) => (n > 0 ? (n > 10 ? 0.9 : 0.1) : 0));
    const rowLeft = new Array(CELL_H).fill(Infinity);
    const rowRight = new Array(CELL_H).fill(-Infinity);
    for (let y = BASE - 30; y <= BASE; y++) { rowLeft[y] = 4; rowRight[y] = 20; } // body
    for (let y = BASE - 8; y <= BASE - 2; y++) rowRight[y] = 28; // connector rides in the band
    return { cols, spans, rowLeft, rowRight, inkTopRow: BASE - 30 };
  };

  it('advance runs to the dense body edge, trimming the thin exit connector', () => {
    const gs = [
      { char: 'x', italic: false, paths: ['M2 0'], cellW: CELL_W, cellH: CELL_H, baselineYInCell: BASE, _p: rect(2, 20, 30) },
      { char: 'n', italic: false, paths: ['M4 0'], cellW: CELL_W, cellH: CELL_H, baselineYInCell: BASE, _p: bodyWithExit() },
    ];
    const out = connectGlyphs(gs as never, {}, gs.map((x) => x._p) as never);
    // body edge = 20, entry = 4 -> advance (20-4) + gap(5) = 21, NOT to the connector tip (28)
    expect(out.glyphs[1].cellW).toBe(21);
  });
});

describe('connectGlyphs (entry-reach normalization, ADR 0043)', () => {
  // Synthetic profiles: a dense 24px-wide body (full x-height, so it passes the
  // eye-body column criterion) behind a thin low entry tail of varying reach.
  // xh = 30 (from the x glyph), so gap = round(0.16*30) = 5, armLap = 4.
  const CW = 80;
  const CH = 100;
  const BASE = 80;
  const BODY_W = 24;
  const profWithEntry = (tail: number) => {
    const bodyX0 = 4 + tail;
    const bodyX1 = bodyX0 + BODY_W - 1;
    const cols = new Array(CW).fill(0);
    for (let x = 4; x < bodyX0; x++) cols[x] = 3; // thin entry tail
    for (let x = bodyX0; x <= bodyX1; x++) cols[x] = 30; // dense body
    const spans = cols.map((n) => (n > 0 ? (n > 10 ? 0.9 : 0.1) : 0));
    const rowLeft = new Array(CH).fill(Infinity);
    const rowRight = new Array(CH).fill(-Infinity);
    for (let y = BASE - 30; y <= BASE; y++) {
      rowLeft[y] = bodyX0;
      rowRight[y] = bodyX1;
    }
    if (tail > 0) for (let y = BASE - 6; y <= BASE - 2; y++) rowLeft[y] = 4; // tail rides low
    return { cols, spans, rowLeft, rowRight, inkTopRow: BASE - 30 };
  };
  const mk = (char: string, tail: number) => ({
    char,
    italic: false,
    paths: [`M4 0`],
    cellW: CW,
    cellH: CH,
    baselineYInCell: BASE,
    _p: profWithEntry(tail),
  });

  it('fires on scattered reaches and anchors every joiner on its eye-body', () => {
    // entry fracs [0, 0, .2, .4, .6]: sd 0.233 > 0.19 gate, median 0.2 <= 0.6
    const gs = [mk('x', 0), mk('n', 0), mk('m', 6), mk('u', 12), mk('h', 18)];
    const out = connectGlyphs(gs as never, {}, gs.map((x) => x._p) as never);
    expect(out.entryNorm).toBe(true);
    // each glyph anchors at its BODY left edge plus its span deficit (what the
    // pair's connectors cannot cover: bridgedGap 11 - exitMed 0 - tail + 2,
    // capped at half the body). u, tail 12: deficit 1 -> dx = -(16 + 1)
    expect(out.glyphs[3].paths[0]).toBe(`M${4 - (4 + 12 + 1)} 0`);
    expect(out.glyphs[4].cellW).toBe(BODY_W - 1 + 11); // h: tail 18, deficit 0 -> eye span + natural gap(11)
  });

  it('skips a consistent hand (reaches do not scatter)', () => {
    const gs = [mk('x', 0), mk('n', 6), mk('m', 6), mk('u', 7), mk('h', 7)];
    const out = connectGlyphs(gs as never, {}, gs.map((x) => x._p) as never);
    expect(out.entryNorm).toBe(false);
    // ink anchor: leftmost ink at x=4 lands on the origin
    expect(out.glyphs[1].paths[0]).toBe('M0 0');
  });

  it('exempts a long-sweep hand by median reach (the flashy park, ADR 0040)', () => {
    // entry fracs [0, .5, .7, .9, 1.1]: sd 0.377 but median 0.7 > 0.6
    const gs = [mk('x', 0), mk('n', 15), mk('m', 21), mk('u', 27), mk('h', 33)];
    const out = connectGlyphs(gs as never, {}, gs.map((x) => x._p) as never);
    expect(out.entryNorm).toBe(false);
  });

  it('caps a deep exit over-ride past the advance (the arm guard)', () => {
    // n carries an arm: thin ink riding 0.66-0.93 xh reaching x=60, far past
    // its eye-body advance. maxOver = 60 + dx(-4) - cellW(34) = 22 > lap(4).
    const armed = profWithEntry(0);
    for (let y = BASE - 28; y <= BASE - 20; y++) armed.rowRight[y] = 60;
    const gs = [mk('x', 0), { ...mk('n', 0), _p: armed }, mk('m', 6), mk('u', 12), mk('h', 18)];
    const out = connectGlyphs(gs as never, {}, gs.map((x) => x._p) as never);
    expect(out.entryNorm).toBe(true);
    // n has no drawn tail: span deficit min(11+2, gap-floor cap 11-5=6) = 6 as
    // a left bearing: anchor 10, cellW = 27 + 11 - 10 = 28, then grown so the
    // arm (maxOver 60 - 10 - 28 = 22) laps only 4: 28 + (22 - 4) = 46
    expect(out.glyphs[1].cellW).toBe(46);
  });

  it('does not cap an f crossbar riding above the strip (overhang by design)', () => {
    const barred = profWithEntry(0);
    for (let y = BASE - 40; y <= BASE - 36; y++) barred.rowRight[y] = 60; // 1.2-1.33 xh
    const gs = [mk('x', 0), { ...mk('f', 0), _p: barred }, mk('m', 6), mk('u', 12), mk('h', 18)];
    const out = connectGlyphs(gs as never, {}, gs.map((x) => x._p) as never);
    expect(out.entryNorm).toBe(true);
    // f: zero tail -> span deficit capped at 6 (gap floor), anchor 10, cellW
    // 27+11-10; the crossbar above the scan stays uncapped
    expect(out.glyphs[1].cellW).toBe(28);
  });

  // Natural variation: the placement MODE belongs to the bases alone. A merged
  // palette's variant glyphs (.cvNN) inherit their base's advance and shift, so
  // their drawn tails must not enter the entry-reach gate — three sheets of one
  // hand would otherwise vote three times and could flip the whole palette into
  // a mode none of its solo builds takes (the nano palette, ADR 0047).
  it('variant glyphs stay out of the entry-reach gate and inherit the base metric', () => {
    const bases = [mk('x', 0), mk('n', 6), mk('m', 6), mk('u', 7), mk('h', 7)]; // consistent: skips
    const variants = [
      { ...mk('n', 0), variantSuffix: '.cv01' },
      { ...mk('m', 21), variantSuffix: '.cv01' }, // scattered tails: would fire the sd gate if counted
      { ...mk('u', 0), variantSuffix: '.cv01' },
      { ...mk('h', 18), variantSuffix: '.cv01' },
    ];
    const gs = [...bases, ...variants];
    const out = connectGlyphs(gs as never, {}, gs.map((x) => x._p) as never);
    expect(out.entryNorm).toBe(false);
    // metric transparency: each variant carries its base's advance
    expect(out.glyphs[5].cellW).toBe(out.glyphs[1].cellW); // n.cv01 = n
    expect(out.glyphs[6].cellW).toBe(out.glyphs[2].cellW); // m.cv01 = m
    expect(out.glyphs[8].cellW).toBe(out.glyphs[4].cellW); // h.cv01 = h
  });
});

describe('connectGlyphs (variation gap is .cv-scoped)', () => {
  // The tightened variation gap (0.05·xh, ADR 0036) belongs to the .cvNN
  // palette only. A seam alternate (.jnNN, ADR 0048) is a same-sheet copy and
  // must NOT flip the face onto the variation gap.
  const CELL_W = 40;
  const CELL_H = 100;
  const BASE = 80;
  const rect = (x0: number, x1: number, h: number) => {
    const cols = new Array(CELL_W).fill(0);
    for (let x = x0; x <= x1; x++) cols[x] = h;
    const spans = cols.map((n) => (n > 0 ? 0.9 : 0));
    const rowLeft = new Array(CELL_H).fill(Infinity);
    const rowRight = new Array(CELL_H).fill(-Infinity);
    for (let y = BASE - h; y <= BASE; y++) {
      rowLeft[y] = x0;
      rowRight[y] = x1;
    }
    return { cols, spans, rowLeft, rowRight, inkTopRow: BASE - h };
  };
  const g = (char: string, x0: number, x1: number, h = 30) => ({ char, italic: false, paths: [`M${x0} 0`], cellW: CELL_W, cellH: CELL_H, baselineYInCell: BASE, _p: rect(x0, x1, h) });

  it('a .jn seam alternate keeps the classic connector gap', () => {
    const gs = [g('x', 2, 20), g('n', 3, 22), { ...g('n', 3, 22), variantSuffix: '.jn01' }];
    const out = connectGlyphs(gs as never, {}, gs.map((x) => x._p) as never);
    expect(out.glyphs[0].cellW).toBe(23); // x: (20 - 2) + classic gap(5), NOT the variation gap(2)
  });

  it('a .cv variant tightens the gap (the variation build)', () => {
    const gs = [g('x', 2, 20), g('n', 3, 22), { ...g('n', 3, 22), variantSuffix: '.cv01' }];
    const out = connectGlyphs(gs as never, {}, gs.map((x) => x._p) as never);
    expect(out.glyphs[0].cellW).toBe(20); // x: (20 - 2) + variation gap(2)
  });
});

describe('makeSeamAlternates (ADR 0048 selection, ADR 0049 synthesis)', () => {
  // Synthetic profiles, jsdom-safe: a dense body plus optional thin entry/exit
  // tails whose tip heights are exact, so the offender gate and the assembly
  // are asserted in closed form. Tails carry per-column extents (colTop/colBot)
  // for the Stage A stroke model. xh = 30 (the x glyph), baseline y = 80.
  const CW = 48;
  const CH = 100;
  const BASE = 80;
  type Tail = { tipFrac: number; reach: number };
  const prof = (bodyX0: number, bodyX1: number, entry?: Tail, exit?: Tail) => {
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
    if (entry) {
      const tipY = Math.round(BASE - entry.tipFrac * 30);
      for (let y = tipY; y <= Math.min(BASE, tipY + 4); y++) rowLeft[y] = bodyX0 - entry.reach;
      for (let x = bodyX0 - entry.reach; x < bodyX0; x++) {
        cols[x] = 5;
        colTop[x] = tipY;
        colBot[x] = Math.min(BASE, tipY + 4);
      }
    }
    if (exit) {
      const tipY = Math.round(BASE - exit.tipFrac * 30);
      for (let y = tipY; y <= Math.min(BASE, tipY + 4); y++) rowRight[y] = bodyX1 + exit.reach;
      for (let x = bodyX1 + 1; x <= bodyX1 + exit.reach; x++) {
        cols[x] = 5;
        colTop[x] = tipY;
        colBot[x] = Math.min(BASE, tipY + 4);
      }
    }
    // thin tails read as tails (low span fraction), the body as body
    const spans = cols.map((n) => (n > 0 ? (n > 10 ? 0.9 : 0.1) : 0));
    return { cols, spans, rowLeft, rowRight, colTop, colBot, inkTopRow: BASE - 30 };
  };
  // parse an absolute M/L path into vertices; shoelace sign for orientation
  const pts = (d: string) => {
    const nums = d.match(/[-+]?\d*\.?\d+(?:e[-+]?\d+)?/g)!.map(Number);
    const out: Array<{ x: number; y: number }> = [];
    for (let i = 0; i < nums.length; i += 2) out.push({ x: nums[i], y: nums[i + 1] });
    return out;
  };
  const areaSign = (d: string) => {
    const p = pts(d);
    let a = 0;
    for (let i = 0; i < p.length; i++) {
      const q = p[(i + 1) % p.length];
      a += p[i].x * q.y - q.x * p[i].y;
    }
    return Math.sign(a);
  };
  const mk = (char: string, entry?: Tail, exit?: Tail, tipPath = 'M4 0') => ({
    char,
    italic: false,
    paths: [tipPath],
    cellW: CW,
    cellH: CH,
    baselineYInCell: BASE,
    _p: prof(10, 26, entry, exit),
  });
  const lowHands = () => [
    mk('n', { tipFrac: 0.2, reach: 6 }, { tipFrac: 0.2, reach: 4 }),
    mk('m', { tipFrac: 0.2, reach: 6 }, { tipFrac: 0.2, reach: 4 }),
    mk('u', { tipFrac: 0.2, reach: 6 }, { tipFrac: 0.2, reach: 4 }),
    mk('h', { tipFrac: 0.2, reach: 6 }, { tipFrac: 0.2, reach: 4 }),
  ];

  it('a high-exit glyph gains a .jn01 alternate: drawn tail collapsed, a synthesized connector appended', () => {
    // o: exit stub tip at 0.5·xh, tail centerline flat at y 67 (colTop 65..69),
    // reach 8 past the body. Join line = median entry 0.2·xh -> joinY 74. The
    // drawn tail COLLAPSES onto the body-edge clip line (x' = min(x, 26)) and
    // ONE synthesized stroke is appended: attach at the tail root (27, 67),
    // terminating past the standard join point (bodyMax 26 + gap 5 + median
    // entry tip offset 0 = 31) by the overlap (2·width 5 = 10) along the flat
    // median entry tangent — tip at (41, 74). Meeting is by construction
    // (ADR 0049); the warp that lowered/truncated the drawn ink is gone.
    const gs = [mk('x'), ...lowHands(), mk('o', { tipFrac: 0.2, reach: 6 }, { tipFrac: 0.5, reach: 8 }, 'M34 65')];
    const out = makeSeamAlternates(gs as never, gs.map((x) => x._p) as never);
    expect(out.joinFrac).toBeCloseTo(0.2, 5);
    expect(out.offenders.map((o) => o.char)).toEqual(['o']);
    expect(out.alternates).toHaveLength(1);
    const alt = out.alternates[0];
    expect(alt.char).toBe('o');
    expect(alt.variantSuffix).toBe('.jn01');
    expect(alt.cellW).toBe(CW); // a copy: metrics untouched
    expect(alt.paths).toHaveLength(2); // collapsed original + the synthesized connector
    expect(alt.paths[0]).toBe('M26 65'); // collapsed onto the clip line, y untouched
    const ring = pts(alt.paths[1]);
    expect(alt.paths[1].trim().endsWith('Z')).toBe(true); // one closed contour
    const maxX = Math.max(...ring.map((p) => p.x));
    // tip capped at m.last + width/2 (34 + 2.5): into the follower's entry
    // ink, never through its far edge (the round-3 oc spur)
    expect(maxX).toBeGreaterThan(35);
    expect(maxX).toBeLessThan(38.5);
    // tip ON the join line: within half-width plus the outer-rail curvature
    // swell (the width-preserving clamp shifts ink outward on the rise)
    for (const p of ring.filter((p) => p.x >= 35.5)) expect(Math.abs(p.y - 74)).toBeLessThan(3.2);
    expect(Math.min(...ring.map((p) => p.x))).toBeLessThan(27); // start cap buried toward the body
    // low-entry followers (hooks at 0.2) and the hook-less x (body-edge entry)
    expect([...out.rights].sort()).toEqual(['h', 'm', 'n', 'o', 'u', 'x']);
  });

  it('the synthesized stroke carries the tail\'s measured width into the diagnostics', () => {
    const gs = [mk('x'), ...lowHands(), mk('o', { tipFrac: 0.2, reach: 6 }, { tipFrac: 0.5, reach: 8 })];
    const out = makeSeamAlternates(gs as never, gs.map((x) => x._p) as never);
    expect(out.offenders).toHaveLength(1);
    expect(out.offenders[0].width).toBeCloseTo(5, 0); // the flat tail's 5-row cross-section
    expect(out.join).toBeTruthy();
    expect(out.join!.tipOffsetX).toBe(0); // entry tails ARE the leftmost ink
    expect(out.join!.tangent.dx).toBeGreaterThan(0.9); // flat entries: level approach
  });

  it('the synthesized stroke reaches the drawn flick\'s own span when it exceeds the bare join model', () => {
    // the pair kern is fitted to the BASE outline's long flick, so the
    // follower sits near where the drawn flick ended — a connector stopping
    // at the bare join point leaves its taper naked in the kern gap (the
    // Stage D waist-before-the-stem). Tail reach 20 (m.last = 46) beats the
    // joinX + 1.5·width floor (38.5): the tip lands at m.last − width/2,
    // inside the follower's entry ink but short of its far edge.
    const gs = [mk('x'), ...lowHands(), mk('o', { tipFrac: 0.2, reach: 6 }, { tipFrac: 0.5, reach: 20 })];
    const out = makeSeamAlternates(gs as never, gs.map((x) => x._p) as never);
    expect(out.offenders.map((o) => o.char)).toEqual(['o']);
    const ring = pts(out.alternates[0].paths[1]);
    const maxX = Math.max(...ring.map((p) => p.x));
    expect(maxX).toBeGreaterThan(42);
    expect(maxX).toBeLessThan(45.5);
  });

  it('an offender whose exit stroke cannot be traced is skipped whole', () => {
    // a 2-column stub clears the rowRight offender gate but is too short for
    // the stroke model (under 3 columns): no reconstruction, no alternate —
    // never an amputated letter without its bridge.
    const gs = [mk('x'), ...lowHands(), mk('o', { tipFrac: 0.2, reach: 6 }, { tipFrac: 0.5, reach: 2 })];
    const out = makeSeamAlternates(gs as never, gs.map((x) => x._p) as never);
    expect(out.offenders).toEqual([]);
    expect(out.alternates).toEqual([]);
    expect(out.skipped).toEqual(['o']);
  });

  it('the synthesized contour matches the base outline orientation (nonzero fill unions, never cancels)', () => {
    // the base outer contour's winding decides: same sign, or an overlap with
    // the body ink would punch a hole under nonzero fill.
    const cw = 'M10 50 L26 50 L26 78 Z'; // shoelace positive in cell coords
    const ccw = 'M26 78 L26 50 L10 50 Z'; // reversed
    for (const outer of [cw, ccw]) {
      const gs = [mk('x'), ...lowHands(), mk('o', { tipFrac: 0.2, reach: 6 }, { tipFrac: 0.5, reach: 8 }, outer)];
      const out = makeSeamAlternates(gs as never, gs.map((x) => x._p) as never);
      expect(out.alternates).toHaveLength(1);
      expect(areaSign(out.alternates[0].paths[1])).toBe(areaSign(outer));
    }
  });

  it('a steep exit stays drawn (a cliff descent reads mechanical, the panel verdict)', () => {
    // exit tip at 0.8·xh needs a 0.6·xh drop to the 0.2 line — over the
    // descent cap. The base flick is better texture than a wire cliff; the
    // s/x class waits for the assembled pass.
    const gs = [mk('x'), ...lowHands(), mk('o', { tipFrac: 0.2, reach: 6 }, { tipFrac: 0.8, reach: 8 })];
    const out = makeSeamAlternates(gs as never, gs.map((x) => x._p) as never);
    expect(out.offenders).toEqual([]);
    expect(out.alternates).toEqual([]);
  });

  it('the collapse is y-banded to the join zone: ascender ink right of the body never moves', () => {
    // a b-class glyph: gentle exit stub AND an ascender loop whose right side
    // leans past the body edge high above the zone. The alternate collapses the
    // stub; the loop point is byte-identical (the un-banded warp first cut
    // sheared it — the seam e2e caught an 8-unit maxY drift on b.jn01).
    const looped = mk('b', { tipFrac: 0.2, reach: 6 }, { tipFrac: 0.5, reach: 8 }, 'M34 65');
    looped.paths.push('M30 26'); // loop point: x past body edge, y at 1.8·xh (row 80-54)
    const gs = [mk('x'), ...lowHands(), looped];
    const out = makeSeamAlternates(gs as never, gs.map((x) => x._p) as never);
    expect(out.offenders.map((o) => o.char)).toEqual(['b']);
    expect(out.alternates[0].paths).toHaveLength(3); // two collapsed originals + the connector
    expect(out.alternates[0].paths[0]).toBe('M26 65'); // stub: collapsed to the clip line
    expect(out.alternates[0].paths[1]).toBe('M30 26'); // loop: untouched
  });

  it('a short tail collapses the same as a long one (the clip line is absolute)', () => {
    // reach 3, inside the old seam gap: still collapsed to the body edge — the
    // synthesized stroke owns the span now, whatever the drawn tail reached.
    const gs = [mk('x'), ...lowHands(), mk('o', { tipFrac: 0.2, reach: 6 }, { tipFrac: 0.5, reach: 3 }, 'M29 65')];
    const out = makeSeamAlternates(gs as never, gs.map((x) => x._p) as never);
    expect(out.offenders.map((o) => o.char)).toEqual(['o']);
    expect(out.alternates[0].paths[0]).toBe('M26 65');
    expect(out.alternates[0].paths).toHaveLength(2);
  });

  it('a face whose exit tips already sit on the entry line generates nothing', () => {
    const gs = [mk('x'), ...lowHands(), mk('o', { tipFrac: 0.2, reach: 6 }, { tipFrac: 0.25, reach: 8 })];
    const out = makeSeamAlternates(gs as never, gs.map((x) => x._p) as never);
    expect(out.offenders).toEqual([]);
    expect(out.alternates).toEqual([]);
  });

  it('crossbar letters f and t are never offenders (the crossbar rides high by design)', () => {
    const gs = [mk('x'), ...lowHands(), mk('f', { tipFrac: 0.2, reach: 6 }, { tipFrac: 1.0, reach: 10 }), mk('t', { tipFrac: 0.2, reach: 6 }, { tipFrac: 0.95, reach: 9 })];
    const out = makeSeamAlternates(gs as never, gs.map((x) => x._p) as never);
    expect(out.offenders).toEqual([]);
  });

  it('descender-exit letters keep their drawn exit', () => {
    const gs = [mk('x'), ...lowHands(), mk('z', { tipFrac: 0.2, reach: 6 }, { tipFrac: 0.8, reach: 8 })];
    const out = makeSeamAlternates(gs as never, gs.map((x) => x._p) as never);
    expect(out.offenders).toEqual([]);
  });

  it('bails whole when too few joiners carry an entry tail to fix the join line', () => {
    const gs = [mk('x'), mk('n', { tipFrac: 0.2, reach: 6 }), mk('o', undefined, { tipFrac: 0.8, reach: 8 })];
    const out = makeSeamAlternates(gs as never, gs.map((x) => x._p) as never);
    expect(out.alternates).toEqual([]);
    expect(out.offenders).toEqual([]);
  });

  it('a glyph with no ink past its body is not an offender even when its body tops the zone', () => {
    // a bare stem/bowl reaching x-height has no exit tail; nothing to warp.
    const gs = [mk('x'), ...lowHands(), mk('i', { tipFrac: 0.2, reach: 6 })];
    const out = makeSeamAlternates(gs as never, gs.map((x) => x._p) as never);
    expect(out.offenders).toEqual([]);
  });

  it('an ascender loop leaning past the body is structure, not an exit tail (the l false positive)', () => {
    // right-of-body ink continues ABOVE the exit-scan ceiling: a loop, never a
    // connector. Live calibration flagged l at the ceiling; warping it would
    // bend the ascender.
    const looped = mk('l', { tipFrac: 0.2, reach: 6 }, { tipFrac: 0.9, reach: 8 });
    const lp = looped._p;
    for (let y = BASE - Math.round(1.25 * 30); y <= BASE - Math.round(1.1 * 30); y++) lp.rowRight[y] = 26 + 8; // the loop keeps leaning right above the zone
    const gs = [mk('x'), ...lowHands(), looped];
    const out = makeSeamAlternates(gs as never, gs.map((x) => x._p) as never);
    expect(out.offenders).toEqual([]);
  });

  it('a gentle high exit crossing the line still corrects (the o/v class)', () => {
    // exit tip at 0.45·xh over a 0.2 join line: under the old 0.28 gate, but a
    // visible crossing knot in the field renders. Fires with a small warp.
    const gs = [mk('x'), ...lowHands(), mk('o', { tipFrac: 0.2, reach: 6 }, { tipFrac: 0.45, reach: 8 })];
    const out = makeSeamAlternates(gs as never, gs.map((x) => x._p) as never);
    expect(out.offenders.map((o) => o.char)).toEqual(['o']);
  });

  it('optical overshoot just past the zone ceiling is not a loop (the v/w class)', () => {
    // a pointed letter's stroke top overshoots the x-height by a few percent;
    // that poke must not read as ascender structure or the v/w knots go
    // uncorrected (live calibration: v topped ~1.08 and fell out).
    const over = mk('v', undefined, { tipFrac: 0.5, reach: 8 });
    const vp = over._p;
    const pokeY = BASE - Math.round(1.08 * 30);
    vp.rowRight[pokeY] = 26 + 4; // stroke top pokes right of the body, just over the ceiling
    const gs = [mk('x'), ...lowHands(), over];
    const out = makeSeamAlternates(gs as never, gs.map((x) => x._p) as never);
    expect(out.offenders.map((o) => o.char)).toEqual(['v']);
  });

  it('a hand that joins at mid-height is measured against its own entry line', () => {
    // copperplate class: entries AND exits both ride ~0.45-0.5·xh and already
    // meet. Clamping the line to the snap's 0.3 ceiling made every exit read
    // high and over-fired 18 alternates on cc-3 (corpus catch). The line is
    // the hand's own median entry height, unclamped.
    const mid = (c: string, exitTip: number) => mk(c, { tipFrac: 0.45, reach: 6 }, { tipFrac: exitTip, reach: 4 });
    const gs = [mk('x'), mid('n', 0.5), mid('m', 0.5), mid('u', 0.45), mid('h', 0.5), mid('o', 0.5)];
    const out = makeSeamAlternates(gs as never, gs.map((x) => x._p) as never);
    expect(out.joinFrac).toBeCloseTo(0.45, 1); // row rounding in the synthetic puts the tip at 0.433
    expect(out.offenders).toEqual([]);
  });

  it('an entry hook is read in the low connect band, under an occluding arch shoulder', () => {
    // an arch shoulder bulges left of the stem ABOVE the band; the low tick is
    // the entry. Measured at the shoulder, m and n fell out of the followers
    // set on the live sheet and the o>n knot went unfixed.
    const arched = mk('w', { tipFrac: 0.2, reach: 6 });
    const ap = arched._p;
    for (let y = BASE - Math.round(0.9 * 30); y <= BASE - Math.round(0.75 * 30); y++) ap.rowLeft[y] = 10 - 8; // shoulder leans further left than the tick
    const gs = [mk('x'), ...lowHands(), arched, mk('o', { tipFrac: 0.2, reach: 6 }, { tipFrac: 0.8, reach: 8 })];
    const out = makeSeamAlternates(gs as never, gs.map((x) => x._p) as never);
    expect(out.rights).toContain('w');
  });
});
