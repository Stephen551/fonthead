import { describe, expect, it } from 'vitest';
import { assignAccentMarks } from '../src/lib/accent-marks';

function raster() {
  const width = 100, height = 200, data = new Uint8ClampedArray(width * height * 4).fill(255);
  const rect = (x0: number, y0: number, x1: number, y1: number) => {
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) data[(y * width + x) * 4] = 0;
  };
  return { width, height, data, rect };
}
const extent = (top: number, bottom: number) => ({ x0: 0, x1: 100, top, bottom, owner: null });

describe('charset-owned accent components', () => {
  it('takes a mark from the preceding band without taking its letter body or keeping the mark twice', () => {
    const r = raster();
    r.rect(30, 10, 60, 60); // row one's letter body
    r.rect(40, 70, 55, 76); // belongs to row two, but before the blank-line cut
    r.rect(30, 85, 60, 140);
    const owned = assignAccentMarks(r.data, r.width, r.height, [
      { band: [0, 80], chars: 'E', ranges: [[0, 100]] },
      { band: [82, 145], chars: 'Ē', ranges: [[0, 100]] },
    ])!;
    const upper = owned.extend(0, 0, extent(0, 80)), lower = owned.extend(1, 0, extent(82, 145));
    expect(lower.top).toBe(68);
    expect(lower.owner?.(45, 73)).toBe(0);
    expect(upper.owner?.(45, 73)).toBe(1);
    expect(upper.owner?.(45, 30)).toBe(-1);
    expect(lower.owner?.(45, 30)).toBe(1);
    expect(lower.owner?.(70, 73)).toBe(1); // no neighboring ink in the borrowed strip
  });

  it('uses each cell charset and keeps both diaeresis dots without giving them to a connected ogonek', () => {
    const r = raster();
    r.rect(30, 10, 60, 60);r.rect(55, 55, 60, 73); // connected ogonek
    r.rect(75, 10, 90, 60); // reference baseline
    r.rect(37, 77, 41, 81);r.rect(50, 77, 54, 81);
    r.rect(30, 90, 60, 145);r.rect(75, 90, 90, 145);
    const owned = assignAccentMarks(r.data, r.width, r.height, [
      { band: [0, 85], chars: 'ĄE', ranges: [[0, 70], [70, 100]] },
      { band: [88, 150], chars: 'ÏE', ranges: [[0, 70], [70, 100]] },
    ])!;
    const lower = owned.extend(1, 0, extent(88, 150)), upper = owned.extend(0, 0, extent(0, 85));
    for (const x of [39, 52]) { expect(lower.owner?.(x, 79)).toBe(0); expect(upper.owner?.(x, 79)).toBe(1); }
    expect(upper.owner?.(57, 70)).toBe(-1); // the original attached ogonek stays
  });

  it('does not borrow marks for unaccented characters or guess against a mismatched cell count', () => {
    const r = raster();r.rect(30, 85, 60, 140);r.rect(40, 70, 55, 76);
    expect(assignAccentMarks(r.data, r.width, r.height, [{ band: [82, 145], chars: 'E', ranges: [[0, 100]] }])).toBeNull();
    expect(assignAccentMarks(r.data, r.width, r.height, [{ band: [82, 145], chars: 'ĒE', ranges: [[0, 100]] }])).toBeNull();
  });

  it('does not steal a detached serif from the preceding letter body', () => {
    const r = raster();
    r.rect(30, 10, 60, 60);r.rect(63, 53, 67, 60); // disconnected arm of the first E
    r.rect(40, 70, 55, 76); // actual mark of the second letter
    r.rect(30, 85, 65, 140);
    const owned = assignAccentMarks(r.data, r.width, r.height, [
      { band: [0, 80], chars: 'E', ranges: [[0, 100]] },
      { band: [82, 145], chars: 'Ē', ranges: [[0, 100]] },
    ])!;
    const lower = owned.extend(1, 0, extent(82, 145));
    expect(lower.top).toBe(68);
    expect(lower.owner?.(65, 56)).toBe(1);
    expect(owned.extend(0, 0, extent(0, 80)).owner?.(65, 56)).toBe(-1);
  });
});
