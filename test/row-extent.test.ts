import { describe, expect, it } from 'vitest';
import { recoverRowExtent } from '../src/lib/row-extent';

function raster() {
  const width = 60, height = 180;
  const data = new Uint8ClampedArray(width * height * 4).fill(255);
  const rect = (x0: number, x1: number, y0: number, y1: number) => {
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) data[(y * width + x) * 4] = 0;
  };
  return { data, width, height, rect };
}

describe('connected ink across a row cut', () => {
  it('recovers a hooked descender without admitting disconnected ink from the next row', () => {
    const r = raster();
    r.rect(30, 34, 35, 125); r.rect(12, 34, 121, 125); r.rect(12, 16, 105, 125);
    r.rect(45, 55, 112, 165); // another glyph in the row below
    const extent = recoverRowExtent(r.data, r.width, r.height, 5, 58, 20, 110, null, 0);
    expect(extent.bottom).toBe(125);
    expect(extent.owner?.(14, 123)).toBe(0);
    expect(extent.owner?.(50, 120)).not.toBe(0);
    expect(extent.owner?.(50, 120)).not.toBe(-1);
  });
  it('recovers an ascender above the band and respects an existing cell owner', () => {
    const r = raster(); r.rect(10, 15, 12, 90); r.rect(30, 35, 10, 130);
    const owner = (x: number) => x < 20 ? 0 : 1;
    const extent = recoverRowExtent(r.data, r.width, r.height, 5, 50, 20, 110, owner, 0);
    expect(extent.top).toBe(12);
    expect(extent.bottom).toBe(110);
    expect(extent.owner?.(32, 45)).toBe(1);
    expect(extent.owner?.(12, 14)).toBe(0);
  });
  it('does not grow a shallow fragment belonging to an adjacent row', () => {
    const r = raster(); r.rect(10, 15, 50, 90); r.rect(30, 35, 0, 29);
    const extent = recoverRowExtent(r.data, r.width, r.height, 5, 50, 20, 110, null, 0);
    expect(extent).toEqual({ top: 20, bottom: 110, owner: null });
  });
  it('follows a diagonal one-pixel connection and stays within image bounds', () => {
    const r = raster(); r.rect(20, 21, 40, 110); r.rect(21, 22, 110, 120);
    const extent = recoverRowExtent(r.data, r.width, r.height, 0, 60, 20, 110, null, 0);
    expect(extent.bottom).toBe(120);
    expect(recoverRowExtent(r.data, r.width, r.height, 0, 60, 0, 180, null, 0).bottom).toBe(180);
  });
});
