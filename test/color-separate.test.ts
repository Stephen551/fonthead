import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const code = readFileSync(join(__dirname, '..', 'public', 'assets', 'color-core.js'), 'utf-8');
const sandbox: { ColorCore?: any } = {};
new Function('self', code)(sandbox);
const CC = sandbox.ColorCore!;

type RGB = [number, number, number];
function blank(w: number, h: number, bg: RGB = [255, 255, 255]): Uint8ClampedArray {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let p = 0; p < w * h; p++) {
    data[p * 4] = bg[0]; data[p * 4 + 1] = bg[1]; data[p * 4 + 2] = bg[2]; data[p * 4 + 3] = 255;
  }
  return data;
}
function rect(data: Uint8ClampedArray, w: number, x0: number, y0: number, x1: number, y1: number, [r, g, b]: RGB) {
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
    const i = (y * w + x) * 4; data[i] = r; data[i + 1] = g; data[i + 2] = b;
  }
}
const RED: RGB = [224, 32, 32];
const BLUE: RGB = [30, 79, 194];
const palette2 = { colors: [{ r: 224, g: 32, b: 32 }, { r: 30, g: 79, b: 194 }], bg: { r: 255, g: 255, b: 255 }, bgDist: 20 };
const inkAt = (union: Uint8ClampedArray, w: number, x: number, y: number) => union[(y * w + x) * 4] === 0;

describe('separateGlyph', () => {
  it('splits a two-color glyph into two layers', () => {
    const w = 80, h = 100;
    const data = blank(w, h);
    rect(data, w, 20, 10, 60, 50, RED);
    rect(data, w, 20, 50, 60, 90, BLUE);
    const g = CC.separateGlyph(data, w, h, palette2, 'o');
    expect(g.layers.length).toBe(2);
    expect(g.totalInk).toBe(40 * 80);
    expect(g.strayDropped).toBe(false);
  });

  it('culls a stray minor island for a single-shape glyph, keeps it for MULTI_PART', () => {
    const w = 80, h = 100;
    const mk = () => {
      const d = blank(w, h);
      rect(d, w, 20, 30, 50, 60, RED);  // 30x30 body
      rect(d, w, 60, 5, 70, 15, RED);   // 10x10 distant crumb (over despeckle absMin, under half)
      return d;
    };
    const o = CC.separateGlyph(mk(), w, h, palette2, 'o');
    expect(o.strayDropped).toBe(true);
    expect(inkAt(o.union, w, 65, 10)).toBe(false);
    const i = CC.separateGlyph(mk(), w, h, palette2, 'i');
    expect(i.strayDropped).toBe(false); // an i dot is legitimate
    expect(inkAt(i.union, w, 65, 10)).toBe(true);
  });

  it('never culls two big halves (a mis-slice to flag, not delete)', () => {
    const w = 80, h = 100;
    const data = blank(w, h);
    rect(data, w, 10, 20, 35, 80, RED);
    rect(data, w, 45, 20, 70, 80, BLUE);
    const g = CC.separateGlyph(data, w, h, palette2, 'o');
    expect(g.strayDropped).toBe(false);
    expect(inkAt(g.union, w, 20, 50)).toBe(true);
    expect(inkAt(g.union, w, 60, 50)).toBe(true);
  });

  it('trims a neighbor-row strip fused to the top edge, spares a top-heavy cap', () => {
    const w = 80, h = 100;
    // bleed: wide strip rows 0-5, thin neck rows 6-11, much wider body below
    const bleed = blank(w, h);
    rect(bleed, w, 20, 0, 60, 6, RED);    // strip width 40 at the very edge
    rect(bleed, w, 36, 6, 44, 12, RED);   // neck width 8 (fused, not an island)
    rect(bleed, w, 5, 12, 75, 90, RED);   // body width 70 (>= 1.6x the edge)
    const gb = CC.separateGlyph(bleed, w, h, palette2, 'o');
    expect(inkAt(gb.union, w, 30, 2)).toBe(false);  // strip cleared
    expect(inkAt(gb.union, w, 40, 50)).toBe(true);  // body intact
    // top-heavy cap: wide top but the body below is NARROWER, must be spared
    const cap = blank(w, h);
    rect(cap, w, 10, 0, 70, 10, RED);   // T crossbar width 60
    rect(cap, w, 33, 10, 47, 90, RED);  // stem width 14
    const gc = CC.separateGlyph(cap, w, h, palette2, 'T');
    expect(inkAt(gc.union, w, 40, 4)).toBe(true);   // crossbar untouched
  });
});

describe('bodyBoundsX', () => {
  const mask = (w: number, h: number, boxes: Array<[number, number, number, number]>) => {
    const m = new Uint8Array(w * h);
    for (const [x0, y0, x1, y1] of boxes) for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) m[y * w + x] = 1;
    return m;
  };
  it('merges an x-overlapping detached part, drops a beside-the-body fragment', () => {
    const w = 100, h = 100;
    const m = mask(w, h, [
      [10, 10, 40, 60],  // body (largest)
      [15, 70, 35, 95],  // detached descender, x-overlaps the body
      [60, 30, 75, 45],  // neighbor-bleed fragment beside the body
    ]);
    const b = CC.bodyBoundsX(m, w, h);
    expect(b.minX).toBe(10);
    expect(b.maxX).toBe(40); // descender inside, side fragment out
  });
});

describe('sampleFireGradient', () => {
  it('samples a vertical ramp: baseline stop from the bottom color, top stop from the top color', () => {
    const w = 60, h = 100;
    const data = blank(w, h);
    rect(data, w, 10, 20, 50, 50, [250, 210, 40]); // yellow upper half of the band
    rect(data, w, 10, 50, 50, 80, [200, 24, 12]);  // red lower half
    const g = CC.sampleFireGradient(data, w, h, [[20, 80]], { stops: 3 });
    expect(g.stops.length).toBe(3);
    expect(g.stops[0].r).toBeGreaterThan(150); // offset 0 = baseline = red
    expect(g.stops[0].g).toBeLessThan(100);
    expect(g.stops[2].g).toBeGreaterThan(150); // offset 1 = top = yellow
  });

  it('chroma gate: a gray outline does not drag the stops muddy', () => {
    const w = 60, h = 100;
    const data = blank(w, h);
    rect(data, w, 10, 20, 50, 50, [250, 210, 40]);
    rect(data, w, 10, 50, 50, 80, [200, 24, 12]);
    rect(data, w, 0, 20, 8, 80, [85, 85, 85]); // gray column, chroma under the 18 gate
    const g = CC.sampleFireGradient(data, w, h, [[20, 80]], { stops: 3 });
    expect(g.stops[2].g).toBeGreaterThan(150); // still yellow, not muddied
  });
});
