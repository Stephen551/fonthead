import { describe, it, expect } from 'vitest';
import { strokeWeightFloor } from '../src/lib/maker';

// A binarized raster: 0 = ink, 255 = background, RGBA. Paint the given columns ink
// down every row, so the median horizontal ink-run equals the column count = the
// stroke width strokeWeightFloor measures.
function raster(w: number, h: number, inkCols: number[]): Uint8ClampedArray {
  const d = new Uint8ClampedArray(w * h * 4).fill(255);
  for (let y = 0; y < h; y++)
    for (const x of inkCols) {
      const i = (y * w + x) * 4;
      d[i] = 0;
      d[i + 1] = 0;
      d[i + 2] = 0;
    }
  return d;
}

describe('strokeWeightFloor', () => {
  it('returns a positive dilation weight for a wispy hand (stroke under the gate)', () => {
    // 1px stroke in a 40px row = 0.025 of the row height, under the 0.05 gate.
    expect(strokeWeightFloor(raster(20, 40, [0]), 20, 40, [[0, 39]], 0)).toBeGreaterThan(0);
  });

  it('spares a delicate-but-functional hand at the base weight (above the gate)', () => {
    // 3px stroke in a 40px row = 0.075, like an intentionally delicate engrosser; untouched.
    expect(strokeWeightFloor(raster(20, 40, [0, 1, 2]), 20, 40, [[0, 39]], 0)).toBe(0);
  });

  it('caps the dilation so a hairline hand cannot over-thicken', () => {
    // 1px stroke in a 200px row needs many iterations but is capped at the max (2).
    expect(strokeWeightFloor(raster(20, 200, [0]), 20, 200, [[0, 199]], 0)).toBeLessThanOrEqual(2);
  });

  it('never lowers an explicit base weight', () => {
    expect(strokeWeightFloor(raster(20, 40, [0, 1, 2, 3, 4, 5]), 20, 40, [[0, 39]], 1)).toBe(1);
  });

  it('is a no-op with no rows', () => {
    expect(strokeWeightFloor(raster(20, 40, [0, 1]), 20, 40, [], 0)).toBe(0);
  });
});
