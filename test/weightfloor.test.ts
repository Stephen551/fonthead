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

describe('strokeWeightFloor (fidelity doctrine: rescue disintegrating ink, never restyle a hand)', () => {
  it('rescues genuinely disintegrating ink (stroke under the 0.025 gate)', () => {
    // 1px stroke in a 60px row = 0.017 of the row height — ink too broken to trace.
    expect(strokeWeightFloor(raster(20, 60, [0]), 20, 60, [[0, 59]], 0)).toBeGreaterThan(0);
  });

  it('spares an intentionally thin hand (the field regression: 3px in a 79px row, 0.038)', () => {
    // The 2026-07-01 field failure: the old 0.05 gate thickened every thin GPT
    // script into a bold. A drawn-thin hand is the design; untouched.
    expect(strokeWeightFloor(raster(20, 79, [0, 1, 2]), 20, 79, [[0, 78]], 0)).toBe(0);
  });

  it('spares a delicate engrosser well above the gate', () => {
    // 3px stroke in a 40px row = 0.075; untouched.
    expect(strokeWeightFloor(raster(20, 40, [0, 1, 2]), 20, 40, [[0, 39]], 0)).toBe(0);
  });

  it('takes at most ONE dilation step, the minimal rescue', () => {
    // 1px stroke in a 200px row would need many iterations; capped at 1 (+2px),
    // because two steps restyled low-res hands into bolds.
    expect(strokeWeightFloor(raster(20, 200, [0]), 20, 200, [[0, 199]], 0)).toBeLessThanOrEqual(1);
  });

  it('never lowers an explicit base weight', () => {
    expect(strokeWeightFloor(raster(20, 40, [0, 1, 2, 3, 4, 5]), 20, 40, [[0, 39]], 1)).toBe(1);
  });

  it('is a no-op with no rows', () => {
    expect(strokeWeightFloor(raster(20, 40, [0, 1]), 20, 40, [], 0)).toBe(0);
  });
});
