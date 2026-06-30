import { describe, it, expect } from 'vitest';
import { warpTailX, compressConnectorTails, type Glyph } from '../src/lib/maker';

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
