import { describe, it, expect } from 'vitest';
import { isPng, isJpeg, isWebp, imageExt } from '../src/lib/imagesig';

const pad = (...b: number[]) => new Uint8Array([...b, ...new Array(16).fill(0)]);
const PNG = pad(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a);
const JPEG = pad(0xff, 0xd8, 0xff, 0xe0);
const WEBP = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 0, 0, 0, 0]);
const SVG = pad(0x3c, 0x73, 0x76, 0x67); // "<svg"

describe('image signature detection', () => {
  it('accepts real PNG / JPEG / WebP magic bytes', () => {
    expect(isPng(PNG)).toBe(true);
    expect(isJpeg(JPEG)).toBe(true);
    expect(isWebp(WEBP)).toBe(true);
  });
  it('rejects mislabeled or junk bytes', () => {
    expect(isPng(JPEG)).toBe(false);
    expect(isWebp(PNG)).toBe(false);
    expect(isJpeg(PNG)).toBe(false);
  });
  it('maps recognized images to an extension and rejects SVG', () => {
    expect(imageExt(PNG)).toBe('png');
    expect(imageExt(JPEG)).toBe('jpg');
    expect(imageExt(WEBP)).toBe('webp');
    expect(imageExt(SVG)).toBe(null);
  });
});
