import { describe, it, expect } from 'vitest';
import { bodyBoundsFromColumns, translatePathX } from '../src/lib/maker';

// Build a column-area histogram: segments of [width, areaPerColumn].
function profile(...segs: Array<[number, number]>): number[] {
  const out: number[] = [];
  for (const [w, a] of segs) for (let i = 0; i < w; i++) out.push(a);
  return out;
}

describe('bodyBoundsFromColumns', () => {
  it('returns null for empty ink', () => {
    expect(bodyBoundsFromColumns([])).toBeNull();
    expect(bodyBoundsFromColumns([0, 0, 0])).toBeNull();
  });

  it('leaves a uniform block alone (an upright letter)', () => {
    const cols = profile([100, 50]);
    expect(bodyBoundsFromColumns(cols)).toEqual({ min: 0, max: 99 });
  });

  it('leaves an H profile alone (dense stems at both edges)', () => {
    const cols = profile([12, 180], [76, 25], [12, 180]);
    expect(bodyBoundsFromColumns(cols)).toEqual({ min: 0, max: 99 });
  });

  it('trims a long thin tail on the right (a swash)', () => {
    // 60px dense body, then a 40px tail holding ~2.6% of the area
    const cols = profile([60, 150], [40, 6]);
    const b = bodyBoundsFromColumns(cols)!;
    expect(b.min).toBe(0);
    expect(b.max).toBeLessThan(99);
    expect(b.max).toBeGreaterThanOrEqual(59); // never eats into the body
  });

  it('trims thin tails on both sides', () => {
    const cols = profile([30, 5], [60, 150], [30, 5]);
    const b = bodyBoundsFromColumns(cols)!;
    expect(b.min).toBeGreaterThan(0);
    expect(b.max).toBeLessThan(119);
    expect(b.max - b.min).toBeGreaterThanOrEqual(59);
  });

  it('caps the trim at maxTrimFrac of the ink span', () => {
    // a huge near-zero tail: budget would allow more than the 30% cap
    const cols = profile([40, 200], [160, 1]);
    const b = bodyBoundsFromColumns(cols)!;
    expect(200 - 1 - b.max).toBeLessThanOrEqual(Math.floor(200 * 0.3));
  });

  it('ignores a tail too short to matter (minExtentFrac)', () => {
    const cols = profile([100, 100], [3, 2]);
    expect(bodyBoundsFromColumns(cols)).toEqual({ min: 0, max: 102 });
  });
});

describe('translatePathX', () => {
  it('shifts every x and leaves y alone across M, L, C', () => {
    const d = 'M10.500 20 L30 40 C1 2,3.25 4,5 6 Z';
    expect(translatePathX(d, 10)).toBe('M20.5 20 L40 40 C11 2,13.25 4,15 6 Z');
  });

  it('handles negative shifts into negative coordinates (the overhang)', () => {
    expect(translatePathX('M5 5 L10 10', -8)).toBe('M-3 5 L2 10');
  });

  it('is a no-op at dx 0', () => {
    const d = 'M1 2 C3 4,5 6,7 8';
    expect(translatePathX(d, 0)).toBe(d);
  });
});
