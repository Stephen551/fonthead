import { describe, it, expect } from 'vitest';
import { warpTailX, warpTailY, compressConnectorTails, snapConnectorHeights, type Glyph } from '../src/lib/maker';

// warpTailX compresses a connecting tail horizontally toward the body edge: for x
// on the tail side of `edge`, x -> edge + (x - edge) * scale. y is never moved, the
// body side is untouched. It is the primitive compressConnectorTails uses to shorten
// a flashy hand's over-long entry sweeps so the letter places tight.
describe('warpTailX', () => {
  it('is a no-op at scale 1', () => {
    expect(warpTailX('M 0 0 L 20 0', 20, 1, 'left')).toBe('M 0 0 L 20 0');
  });

  it('left side: compresses x < edge toward edge, edge itself untouched', () => {
    // edge 20, scale 0.5: (0,0) -> 20+(0-20)*0.5 = 10; (10,0) -> 15; (20,0) untouched.
    expect(warpTailX('M 0 0 L 10 0 L 20 0', 20, 0.5, 'left')).toBe('M 10 0 L 15 0 L 20 0');
  });

  it('right side: compresses x > edge toward edge, edge and body side untouched', () => {
    // edge 10, scale 0.5: (0,0) and (10,0) untouched; (20,0) -> 10+(20-10)*0.5 = 15.
    expect(warpTailX('M 0 0 L 10 0 L 20 0', 10, 0.5, 'right')).toBe('M 0 0 L 10 0 L 15 0');
  });

  it('never moves y', () => {
    // y values (7, 9) must survive unchanged while x compresses.
    expect(warpTailX('M 0 7 L 10 9 L 20 7', 20, 0.5, 'left')).toBe('M 10 7 L 15 9 L 20 7');
  });

  it('walks cubic control points, compressing each x by its own position', () => {
    // edge 8, scale 0.5: (0,0)->4, cp(2,0)->5, cp(4,0)->6, end(8,0) untouched.
    expect(warpTailX('M 0 0 C 2 0 4 0 8 0', 8, 0.5, 'left')).toBe('M 4 0 C 5 0 6 0 8 0');
  });
});

// warpTailY lowers a connecting tail vertically by a RAMPED delta: 0 at the body
// `edge`, full `dy` at the `tip`, for y on the tail side of edge. x is never moved,
// the body side is untouched. It is the primitive snapConnectorHeights uses to pull a
// hand's abnormally-high exit flicks down onto the entries' join line so seams meet.
describe('warpTailY', () => {
  it('is a no-op at dy 0', () => {
    expect(warpTailY('M 0 0 L 20 0', 10, 20, 0, 'right')).toBe('M 0 0 L 20 0');
  });

  it('right side: ramps y for x > edge, full dy at the tip, edge and body untouched', () => {
    // edge 10, tip 20, dy 4: x=0 (body side) and x=10 (edge) untouched; x=15 -> ramp 0.5 -> y 2; x=20 -> ramp 1 -> y 4.
    expect(warpTailY('M 0 0 L 10 0 L 15 0 L 20 0', 10, 20, 4, 'right')).toBe('M 0 0 L 10 0 L 15 2 L 20 4');
  });

  it('left side: ramps y for x < edge, full dy at the tip', () => {
    // edge 10, tip 0, dy 4: x=10 untouched; x=5 -> ramp 0.5 -> y 2; x=0 -> ramp 1 -> y 4.
    expect(warpTailY('M 0 0 L 5 0 L 10 0', 10, 0, 4, 'left')).toBe('M 0 4 L 5 2 L 10 0');
  });

  it('never moves x', () => {
    // x values (0, 15, 20) survive unchanged while y shifts on the tail.
    expect(warpTailY('M 0 7 L 15 7 L 20 7', 10, 20, 4, 'right')).toBe('M 0 7 L 15 9 L 20 11');
  });

  it('walks cubic control points, ramping each y by its own x position', () => {
    // edge 10, tip 20, dy 4: cp(12)->0.8, cp(16)->2.4, end(20)->4; the M at the edge stays.
    expect(warpTailY('M 10 0 C 12 0 16 0 20 0', 10, 20, 4, 'right')).toBe('M 10 0 C 12 0.8 16 2.4 20 4');
  });
});

// compressConnectorTails needs a rasterized column profile per glyph (from a canvas).
// jsdom has no canvas, so the profiles are null and the pass is a safe no-op there;
// production injects real profiles. This locks the no-op so a connect build never
// throws when the raster is unavailable.
describe('compressConnectorTails without a raster', () => {
  const g = (char: string): Glyph => ({ char, italic: false, paths: ['M 0 0 L 10 0'], cellW: 12, cellH: 12, baselineYInCell: 9 });
  it('returns the glyphs unchanged and compresses nothing', () => {
    const glyphs = [g('a'), g('o'), g('n'), g('r'), g('e'), g('m')];
    const out = compressConnectorTails(glyphs);
    expect(out.compressed).toBe(0);
    expect(out.glyphs).toEqual(glyphs);
  });
});

// snapConnectorHeights also needs per-glyph rasters; without a canvas its profiles are
// null, so the pass must be a safe no-op (gate measures nothing, snaps nothing). This
// locks that a connect build never throws when the raster is unavailable.
describe('snapConnectorHeights without a raster', () => {
  const g = (char: string): Glyph => ({ char, italic: false, paths: ['M 0 0 L 10 0'], cellW: 12, cellH: 12, baselineYInCell: 9 });
  it('returns the glyphs unchanged and snaps nothing', () => {
    const glyphs = [g('a'), g('o'), g('n'), g('r'), g('e'), g('m')];
    const out = snapConnectorHeights(glyphs);
    expect(out.snapped).toBe(0);
    expect(out.glyphs).toEqual(glyphs);
  });
});
