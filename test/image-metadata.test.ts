import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { stripImageMetadata, ImageMetadataError } from '../src/lib/image-metadata';
import * as fx from './fixtures/image-metadata';

const b64 = (s: string) => new Uint8Array(Buffer.from(s, 'base64'));
const bytes = (...parts: (Uint8Array | number[] | string)[]) =>
  new Uint8Array(
    parts.flatMap((p) => (typeof p === 'string' ? [...Buffer.from(p, 'latin1')] : [...p])),
  );
const has = (u: Uint8Array, s: string) => Buffer.from(u).includes(Buffer.from(s, 'latin1'));
/** A JPEG marker segment: FF marker, big-endian length (incl. itself), payload. */
const seg = (marker: number, payload: Uint8Array) =>
  bytes([0xff, marker, (payload.length + 2) >> 8, (payload.length + 2) & 0xff], payload);

const EXIF = b64(fx.exif); // "Exif\0\0" + TIFF with a GPS IFD
const XMP = bytes('http://ns.adobe.com/xap/1.0/\0', '<x:xmpmeta>GPSLatitude 39</x:xmpmeta>');

describe('stripImageMetadata: JPEG', () => {
  // A real baseline JPEG with APP0 JFIF + APP2 ICC and no metadata.
  const clean = new Uint8Array(readFileSync('e2e/fixtures/smooth-script-sheet.jpg'));
  const app0Len = (clean[4] << 8) | clean[5];
  const afterApp0 = 4 + app0Len;

  it('drops EXIF, XMP, IPTC, comments, the MPF index and trailing images, byte for byte', () => {
    const secondary = bytes([0xff, 0xd8], seg(0xe1, EXIF), [0xff, 0xd9]); // MPF depth/preview image
    const dirty = bytes(
      clean.subarray(0, afterApp0),
      seg(0xe1, EXIF),
      seg(0xe1, XMP),
      seg(0xed, bytes('Photoshop 3.0\0', '8BIM city')),
      seg(0xe2, bytes('MPF\0', [0, 0, 0, 0])),
      seg(0xfe, bytes('taken at home')),
      clean.subarray(afterApp0),
      secondary,
    );
    expect(has(dirty, 'Exif')).toBe(true);
    const { bytes: out, removed } = stripImageMetadata(dirty, 'jpg');
    expect(out).toEqual(clean); // the untouched original, so it still decodes
    expect(removed).toBe(dirty.length - clean.length);
    expect(has(out, 'ICC_PROFILE')).toBe(true);
  });

  it('is a no-op on an already clean JPEG', () => {
    const r = stripImageMetadata(clean, 'jpg');
    expect(r.removed).toBe(0);
    expect(r.bytes).toEqual(clean);
  });

  it('walks every scan of a progressive JPEG with restart markers', () => {
    // Same pixels saved by Pillow with and without EXIF (10 scans, RSTn inside).
    const r = stripImageMetadata(b64(fx.jpgProgDirty), 'jpg');
    expect(r.bytes).toEqual(b64(fx.jpgProgClean));
    expect(has(r.bytes, 'Exif')).toBe(false);
  });

  it('rejects a JPEG it cannot walk instead of storing it', () => {
    expect(() => stripImageMetadata(clean.subarray(0, 300), 'jpg')).toThrow(ImageMetadataError);
    const badLen = clean.slice();
    badLen[afterApp0 + 2] = 0x00; // a segment length shorter than its own length field
    badLen[afterApp0 + 3] = 0x01;
    expect(() => stripImageMetadata(badLen, 'jpg')).toThrow(ImageMetadataError);
  });
});

describe('stripImageMetadata: PNG', () => {
  it('drops eXIf and text chunks and leaves the same image Pillow writes without them', () => {
    const dirty = b64(fx.pngDirty);
    expect(has(dirty, 'eXIf')).toBe(true);
    expect(has(dirty, 'tEXt')).toBe(true);
    const r = stripImageMetadata(dirty, 'png');
    expect(r.bytes).toEqual(b64(fx.pngClean));
  });

  it('drops anything after IEND', () => {
    const clean = b64(fx.pngClean);
    const r = stripImageMetadata(bytes(clean, 'trailing GPS 39.15N'), 'png');
    expect(r.bytes).toEqual(clean);
  });

  it('rejects a cut-off PNG', () => {
    const clean = b64(fx.pngClean);
    expect(() => stripImageMetadata(clean.subarray(0, clean.length - 6), 'png')).toThrow(ImageMetadataError);
  });
});

describe('stripImageMetadata: WebP', () => {
  it('drops EXIF and XMP chunks, clears their VP8X flags, and fixes the RIFF size', () => {
    const dirty = b64(fx.webpDirty);
    expect(has(dirty, 'EXIF')).toBe(true);
    const { bytes: out } = stripImageMetadata(dirty, 'webp');
    expect(has(out, 'EXIF')).toBe(false);
    expect(has(out, 'XMP ')).toBe(false);
    expect(has(out, 'GPS')).toBe(false);
    const view = new DataView(out.buffer, out.byteOffset, out.byteLength);
    expect(view.getUint32(4, true)).toBe(out.length - 8);
    expect(Buffer.from(out.subarray(12, 16)).toString('latin1')).toBe('VP8X');
    expect(out[20] & 0x0c).toBe(0); // EXIF (0x08) and XMP (0x04) flags cleared
    // The image data itself is the same VP8L bitstream Pillow writes without metadata.
    const clean = b64(fx.webpClean);
    const vp8l = (u: Uint8Array) => Buffer.from(u).subarray(Buffer.from(u).indexOf('VP8L'));
    expect(vp8l(out)).toEqual(vp8l(clean));
  });

  it('rejects a WebP whose size runs past the file', () => {
    const dirty = b64(fx.webpDirty).slice();
    new DataView(dirty.buffer).setUint32(4, dirty.length * 2, true);
    expect(() => stripImageMetadata(dirty, 'webp')).toThrow(ImageMetadataError);
  });
});
