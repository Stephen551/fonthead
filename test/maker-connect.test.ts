import { describe, it, expect } from 'vitest';
import { joinClass, anchorAdvance, connectGlyphs, isScriptFace } from '../src/lib/maker';

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

  it('descender-exit letter joins left, breaks right', () => {
    const c = joinClass('g');
    expect(c.kind).toBe('join');
    expect(c.joinsLeft).toBe(true);
    expect(c.joinsRight).toBe(false);
  });

  it('caps stand alone in v1 (break both sides)', () => {
    expect(joinClass('H')).toMatchObject({ kind: 'break', joinsLeft: false, joinsRight: false });
    expect(joinClass('B')).toMatchObject({ kind: 'break', joinsRight: false });
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

  it('descender-exit breaks right (a trailing pad, not a connector gap)', () => {
    const gs = [g('x', 2, 20), g('g', 2, 20)]; // identical ink; only the class differs
    const out = connectGlyphs(gs as never, {}, gs.map((x) => x._p) as never);
    expect(out.glyphs[0].cellW).toBe(23); // x joins right: ink(18) + connector gap(5)
    // g breaks right (its only exit is the descender): no connector gap, just a small
    // side pad, so it advances tighter than the joined x.
    expect(out.glyphs[1].cellW).toBeGreaterThanOrEqual(18);
    expect(out.glyphs[1].cellW).toBeLessThan(out.glyphs[0].cellW);
  });

  it('caps stand alone (break-class, full ink width + pad both sides)', () => {
    const gs = [g('H', 4, 24)];
    const out = connectGlyphs(gs as never, {}, gs.map((x) => x._p) as never);
    expect(out.joined).toBe(0);
    expect(out.broke).toBe(1);
    expect(out.glyphs[0].cellW).toBe(24 - 4 + 1 + 2); // ink span + 2*leftPad(1)
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
