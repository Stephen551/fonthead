import { describe, expect, it } from 'vitest';
import { guardRowPadding } from '../src/lib/row-extent';

describe('row crop padding', () => {
  it('rejects disconnected neighboring ink but retains an antialias fringe at the row edge', () => {
    const width = 30, height = 30;
    const data = new Uint8ClampedArray(width * height * 4).fill(255);
    data[(10 * width + 15) * 4] = 0;
    data[(8 * width + 3) * 4] = 0; // prior row, inside the two-pixel crop pad
    const owner = guardRowPadding(data, width, height, 10, 20, null, 0);
    expect(owner(3, 8)).toBe(1);
    expect(owner(15, 9)).toBe(0);
    expect(owner(15, 10)).toBe(-1);
    expect(owner(15, 8)).toBe(1);
  });

  it('does not borrow another cell\'s fringe and respects existing ownership inside the row', () => {
    const width = 30, height = 30;
    const data = new Uint8ClampedArray(width * height * 4).fill(255);
    data[(10 * width + 15) * 4] = 0;
    const owner = guardRowPadding(data, width, height, 10, 20, () => 2, 0);
    expect(owner(15, 9)).toBe(1);
    expect(owner(15, 10)).toBe(2);
    expect(owner(-1, -1)).toBe(1);
  });
});
