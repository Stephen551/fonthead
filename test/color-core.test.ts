import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// Load the browser IIFE into a sandbox (the gpos.test.ts pattern).
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

// A thin-stroked H: two 6px vertical bars + a crossbar. Thin strokes matter
// for the shadow tests: an offset copy of a thin shape stays mostly visible,
// so the dark centroid sits close to the true offset vector.
function drawH(data: Uint8ClampedArray, w: number, x: number, y: number, color: RGB) {
  rect(data, w, x, y, x + 6, y + 40, color);
  rect(data, w, x + 22, y, x + 28, y + 40, color);
  rect(data, w, x + 6, y + 17, x + 22, y + 23, color);
}

const RED: RGB = [224, 32, 32];
const BLUE: RGB = [30, 79, 194];
const DARK: RGB = [60, 60, 60];

describe('detectPalette', () => {
  it('finds two colors on a two-color sheet, largest area first', () => {
    const w = 400, h = 200;
    const data = blank(w, h);
    rect(data, w, 20, 40, 120, 140, RED);   // 100x100 red
    rect(data, w, 200, 40, 260, 100, BLUE); // 60x60 blue
    const pal = CC.detectPalette(data, w, h, 3, {});
    expect(pal.mono).toBe(false);
    expect(pal.colors.length).toBe(2);
    expect(pal.colors[0].count).toBeGreaterThan(pal.colors[1].count);
    expect(pal.colors[0].r).toBeGreaterThan(150); // red is the bigger area
  });

  it('collapses a monochrome sheet to one color (mono)', () => {
    const w = 300, h = 150;
    const data = blank(w, h);
    rect(data, w, 20, 20, 200, 120, RED);
    const pal = CC.detectPalette(data, w, h, 3, {});
    expect(pal.mono).toBe(true);
    expect(pal.colors.length).toBe(1);
  });

  it('returns no colors on an empty sheet', () => {
    const pal = CC.detectPalette(blank(200, 100), 200, 100, 3, {});
    expect(pal.colors.length).toBe(0);
    expect(pal.mono).toBe(true);
  });

  it('halo gate: near-background low-chroma haze is not a color', () => {
    const w = 300, h = 150;
    const data = blank(w, h);
    rect(data, w, 20, 20, 200, 120, [242, 242, 242]); // faint gray wash
    const pal = CC.detectPalette(data, w, h, 3, {});
    expect(pal.colors.length).toBe(0);
  });
});

describe('detectShadowMask', () => {
  it('fires on an offset dark duplicate of the letters', () => {
    const w = 500, h = 120;
    const data = blank(w, h);
    // four H letters, each with a dark copy shifted +5/+5 drawn FIRST
    for (let i = 0; i < 4; i++) {
      const x = 30 + i * 110;
      drawH(data, w, x + 5, 35, DARK);
      drawH(data, w, x, 30, RED);
    }
    const pal = CC.detectPalette(data, w, h, 3, {});
    expect(pal.colors.length).toBe(2);
    const mask = CC.detectShadowMask(data, w, h, pal);
    expect(mask).not.toBeNull();
    let n = 0; for (let p = 0; p < w * h; p++) if (mask![p]) n++;
    expect(n).toBeGreaterThan(200); // the visible dark rim is real ink area
  });

  it('does not fire on a concentric dark outline', () => {
    const w = 500, h = 120;
    const data = blank(w, h);
    for (let i = 0; i < 4; i++) {
      const x = 30 + i * 110;
      rect(data, w, x - 3, 27, x + 33, 73, DARK); // outline ring drawn first
      rect(data, w, x, 30, x + 30, 70, RED);      // fill covers the center
    }
    const pal = CC.detectPalette(data, w, h, 3, {});
    const mask = CC.detectShadowMask(data, w, h, pal);
    expect(mask).toBeNull();
  });

  it('does not fire with fewer than two palette colors', () => {
    const w = 300, h = 100;
    const data = blank(w, h);
    rect(data, w, 20, 20, 200, 80, RED);
    const pal = CC.detectPalette(data, w, h, 3, {});
    const mask = CC.detectShadowMask(data, w, h, pal);
    expect(mask).toBeNull();
  });
});
