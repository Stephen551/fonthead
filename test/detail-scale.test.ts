import { describe, it, expect } from 'vitest';
import { detailScale } from '../src/lib/maker';

// detailScale drives the supersample factor (and therefore the upscaled cell
// dimensions, cellDim * scale). The pixel resampling itself needs a real canvas
// and is checked live against the engine.
describe('detailScale', () => {
  it('returns 1 for cells already at or above the target height', () => {
    expect(detailScale(320)).toBe(1);
    expect(detailScale(400)).toBe(1);
  });

  it('scales smaller cells up toward the target height', () => {
    expect(detailScale(160)).toBe(2); // ceil(320 / 160)
    expect(detailScale(110)).toBe(3); // ceil(320 / 110)
  });

  it('caps the factor at 3x for tiny cells', () => {
    expect(detailScale(40)).toBe(3);
    expect(detailScale(1)).toBe(3);
  });
});
