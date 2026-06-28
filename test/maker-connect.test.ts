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
