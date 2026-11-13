import { describe, expect, it } from 'vitest';
import { crowdedRows, flatBandShare, isSmallSheet, looksLikeScreenshot, rgbaToGray, uploadAdvice } from '../src/lib/upload-advice';

// A grayscale page: white paper with a little grain, optional flat gray bands
// (an app's toolbar and status bar) and optional dark "ink" rows.
function page(w: number, h: number, opts: { bands?: [number, number, number][]; grain?: number; gradient?: number } = {}): Uint8Array {
  const g = new Uint8Array(w * h);
  let seed = 7;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const base = 248 - (opts.gradient ?? 0) * (x / w);
      g[y * w + x] = Math.max(0, Math.min(255, Math.round(base + (rnd() - 0.5) * (opts.grain ?? 0))));
    }
  }
  for (const [y0, y1, shade] of opts.bands ?? []) {
    for (let y = y0; y < y1; y++) g.fill(shade, y * w, (y + 1) * w);
  }
  return g;
}

describe('screenshot signal', () => {
  it('reads full-width flat gray bars as app chrome', () => {
    // 600x1000 with a 60px title bar and a 40px status bar: 10% of rows
    const share = flatBandShare(page(600, 1000, { bands: [[0, 60, 210], [960, 1000, 60]] }), 600, 1000);
    expect(share).toBeCloseTo(0.1, 2);
    expect(looksLikeScreenshot({ width: 600, height: 1000, flatBandShare: share })).toBe(true);
  });

  it('does not flag a plain white generated sheet', () => {
    const share = flatBandShare(page(800, 500), 800, 500);
    expect(share).toBe(0);
  });

  it('does not flag a photographed page, even a dim one', () => {
    // dim paper (~180) with grain and a lighting falloff across the page
    const g = page(500, 400, { grain: 6, gradient: 30 }).map(v => v - 70);
    expect(flatBandShare(g, 500, 400)).toBe(0);
  });

  it('does not flag a generated sheet on a plain gray background', () => {
    // flat #e5e5e5 page with dark letter rows: the gray is the page itself
    const w = 600, h = 800;
    const g = new Uint8Array(w * h).fill(229);
    for (let y = 100; y < 700; y += 200) for (let yy = y; yy < y + 80; yy++) for (let x = 0; x < w; x += 7) g[yy * w + x] = 20;
    expect(flatBandShare(g, w, h)).toBe(0);
  });

  it('flags gray bars on a dark-mode screenshot too', () => {
    const w = 400, h = 1000;
    const g = new Uint8Array(w * h).fill(18);
    g.fill(70, 0, 80 * w);
    expect(flatBandShare(g, w, h)).toBeCloseTo(0.08, 2);
  });

  it('ignores a thin ruled line', () => {
    const share = flatBandShare(page(400, 1000, { bands: [[500, 504, 120]] }), 400, 1000);
    expect(share).toBe(0);
  });

  it('converts canvas RGBA to luma', () => {
    expect([...rgbaToGray([255, 255, 255, 255, 0, 0, 0, 255, 128, 128, 128, 255], 3, 1)]).toEqual([255, 0, 128]);
  });
});

describe('small sheet signal', () => {
  it('flags the 296 x 571 image from the 2026-11-13 report', () => {
    expect(isSmallSheet({ width: 296, height: 571, flatBandShare: 0 })).toBe(true);
  });

  it('leaves a phone photo or a generated sheet alone', () => {
    expect(isSmallSheet({ width: 4032, height: 3024, flatBandShare: 0 })).toBe(false);
    expect(isSmallSheet({ width: 1774, height: 887, flatBandShare: 0 })).toBe(false);
  });
});

describe('touching letters', () => {
  it('finds a row where 3 characters came out as 1 shape', () => {
    expect(crowdedRows([1], ['ABC'])).toEqual([{ row: 1, chars: 3, shapes: 1 }]);
  });

  it('leaves slicer noise alone', () => {
    expect(crowdedRows([24, 25, 10], ['ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz', '0123456789'])).toEqual([]);
  });

  it('does not compare rows when the row counts differ', () => {
    expect(crowdedRows([26, 26, 10], ['ABC', 'DEF'])).toEqual([]);
  });
});

describe('upload advice', () => {
  const clean = { width: 2000, height: 900, flatBandShare: 0 };

  it('says nothing for a sheet the maker is built for', () => {
    expect(uploadAdvice({ signals: clean, cellsPerRow: [26, 26, 10], charLines: ['ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz', '0123456789'], layoutSuggested: false })).toEqual([]);
  });

  it('explains a screenshot and a small image in plain words', () => {
    const lines = uploadAdvice({ signals: { width: 296, height: 571, flatBandShare: 0.12 }, cellsPerRow: [], charLines: [], layoutSuggested: false });
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatch(/^This looks like a screenshot\./);
    expect(lines[1]).toContain('296 × 571 pixels');
  });

  it('names the crowded row and says to leave space', () => {
    const [line] = uploadAdvice({ signals: clean, cellsPerRow: [1], charLines: ['ABC'], layoutSuggested: false });
    expect(line).toBe('Row 1 has 3 characters in the charset, but the maker only found 1 shape there. Letters that touch get read as one shape, so leave a little space between each one.');
  });

  it('groups several crowded rows into one line', () => {
    const [line] = uploadAdvice({ signals: clean, cellsPerRow: [13, 4, 3], charLines: ['ABCDEFGHIJKLM', 'NOPQRSTUVWXYZ', 'abcdefghijklm'], layoutSuggested: false });
    expect(line).toMatch(/^Rows 2 and 3 have far fewer shapes/);
  });

  it('leaves the shape count to the charset suggestion when it is showing', () => {
    expect(uploadAdvice({ signals: clean, cellsPerRow: [1], charLines: ['ABC'], layoutSuggested: true })).toEqual([]);
  });
});
