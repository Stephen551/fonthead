// Strip embedded metadata (EXIF, XMP, IPTC, text chunks) from an avatar before
// it is stored. Phone photos carry EXIF, often with GPS coordinates, and
// avatars are served publicly from /cdn/avatars/, so storing the bytes as
// uploaded would publish where the photo was taken (ADR 0085).
//
// This walks the container structure and drops metadata blocks; the image data
// itself is copied untouched, so nothing is re-encoded. Anything the parser
// does not understand throws ImageMetadataError: the caller rejects the upload
// rather than store bytes it could not clean.

export class ImageMetadataError extends Error {}

export interface StripResult {
  bytes: Uint8Array;
  /** Bytes dropped (metadata blocks plus any trailing data). 0 = already clean. */
  removed: number;
}

const fail = (why: string): never => {
  throw new ImageMetadataError(why);
};

function concat(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

const ascii = (u: Uint8Array, off: number, len: number) =>
  String.fromCharCode(...u.subarray(off, Math.min(u.length, off + len)));

/* ---------------- JPEG ----------------
   SOI, then marker segments (FF xx + big-endian length that includes itself).
   SOS is followed by entropy-coded data in which FF is always followed by 00
   (stuffing) or an RSTn marker; any other FF xx ends the scan and starts the
   next segment (progressive files have several scans). Dropped: APP1 (Exif,
   XMP), APP13 (Photoshop/IPTC), COM, APP2 "MPF" (multi-picture index), and
   everything after EOI (MPF secondary images, which carry their own EXIF).
   Kept: APP0 JFIF, APP2 ICC profile, APP14 Adobe, tables, frames, scans. */
function stripJpeg(u: Uint8Array): StripResult {
  if (u.length < 4 || u[0] !== 0xff || u[1] !== 0xd8) fail('not a JPEG');
  const keep: Uint8Array[] = [u.subarray(0, 2)];
  let i = 2;
  for (;;) {
    if (i >= u.length) fail('JPEG ends before its end marker');
    if (u[i] !== 0xff) fail('JPEG segment is not where it should be');
    while (i < u.length && u[i] === 0xff) i++; // fill bytes
    if (i >= u.length) fail('JPEG ends inside a marker');
    const marker = u[i];
    const start = i - 1;
    i++;
    if (marker === 0xd9) {
      keep.push(u.subarray(start, i)); // EOI; anything after it is dropped
      break;
    }
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      keep.push(u.subarray(start, i));
      continue;
    }
    if (marker === 0xd8 || marker === 0x00) fail('JPEG has an unexpected marker');
    if (i + 2 > u.length) fail('JPEG segment length is cut off');
    const len = (u[i] << 8) | u[i + 1];
    if (len < 2 || i + len > u.length) fail('JPEG segment length is out of range');
    const end = i + len;
    const isMpf = marker === 0xe2 && ascii(u, i + 2, 4) === 'MPF\0';
    const drop = marker === 0xe1 || marker === 0xed || marker === 0xfe || isMpf;
    if (marker === 0xda) {
      // SOS: header, then entropy-coded data up to the next real marker.
      let j = end;
      for (;;) {
        if (j + 1 >= u.length) fail('JPEG scan data is cut off');
        if (u[j] === 0xff) {
          const n = u[j + 1];
          if (n === 0x00 || (n >= 0xd0 && n <= 0xd7)) {
            j += 2;
            continue;
          }
          if (n === 0xff) {
            j++;
            continue;
          }
          break;
        }
        j++;
      }
      keep.push(u.subarray(start, j));
      i = j;
      continue;
    }
    if (!drop) keep.push(u.subarray(start, end));
    i = end;
  }
  const bytes = concat(keep);
  return { bytes, removed: u.length - bytes.length };
}

/* ---------------- PNG ----------------
   Signature, then chunks: u32 length, 4-byte type, data, u32 CRC. Dropped:
   eXIf, tEXt, iTXt, zTXt, tIME, and anything after IEND. */
const PNG_DROP = new Set(['eXIf', 'tEXt', 'iTXt', 'zTXt', 'tIME']);
function stripPng(u: Uint8Array): StripResult {
  if (u.length < 8) fail('not a PNG');
  const view = new DataView(u.buffer, u.byteOffset, u.byteLength);
  const keep: Uint8Array[] = [u.subarray(0, 8)];
  let i = 8;
  let sawEnd = false;
  while (i < u.length) {
    if (i + 12 > u.length) fail('PNG chunk is cut off');
    const len = view.getUint32(i);
    const type = ascii(u, i + 4, 4);
    if (!/^[A-Za-z]{4}$/.test(type)) fail('PNG chunk type is not valid');
    const end = i + 12 + len;
    if (end > u.length) fail('PNG chunk length is out of range');
    if (!PNG_DROP.has(type)) keep.push(u.subarray(i, end));
    i = end;
    if (type === 'IEND') {
      sawEnd = true;
      break;
    }
  }
  if (!sawEnd) fail('PNG has no end chunk');
  const bytes = concat(keep);
  return { bytes, removed: u.length - bytes.length };
}

/* ---------------- WebP ----------------
   RIFF container: "RIFF", u32le size, "WEBP", then chunks (fourcc, u32le size,
   data, pad byte when size is odd). Dropped: EXIF and "XMP " chunks; their
   flags are cleared in VP8X, the RIFF size is rewritten, and anything past the
   declared RIFF size is dropped. */
function stripWebp(u: Uint8Array): StripResult {
  if (u.length < 12 || ascii(u, 0, 4) !== 'RIFF' || ascii(u, 8, 4) !== 'WEBP') fail('not a WebP');
  const view = new DataView(u.buffer, u.byteOffset, u.byteLength);
  const riffEnd = 8 + view.getUint32(4, true);
  if (riffEnd > u.length || riffEnd < 12) fail('WebP size is out of range');
  const keep: Uint8Array[] = [];
  let vp8x: Uint8Array | null = null;
  let i = 12;
  while (i < riffEnd) {
    if (i + 8 > riffEnd) fail('WebP chunk is cut off');
    const fourcc = ascii(u, i, 4);
    const size = view.getUint32(i + 4, true);
    const end = i + 8 + size + (size & 1);
    if (end > riffEnd) fail('WebP chunk size is out of range');
    if (fourcc !== 'EXIF' && fourcc !== 'XMP ') {
      if (fourcc === 'VP8X') {
        if (size < 10) fail('WebP extended header is too short');
        vp8x = u.slice(i, end); // copy: its flags are rewritten below
        keep.push(vp8x);
      } else {
        keep.push(u.subarray(i, end));
      }
    }
    i = end;
  }
  if (vp8x) vp8x[8] &= ~(0x08 | 0x04); // clear the EXIF and XMP flags
  const body = concat(keep);
  const head = new Uint8Array(12);
  head.set(u.subarray(0, 12));
  new DataView(head.buffer).setUint32(4, 4 + body.length, true);
  const bytes = concat([head, body]);
  return { bytes, removed: u.length - bytes.length };
}

/** Strip metadata from a PNG, JPEG, or WebP. Throws ImageMetadataError on
 *  anything it cannot parse; never returns the input unchecked. */
export function stripImageMetadata(u: Uint8Array, ext: 'png' | 'jpg' | 'webp'): StripResult {
  if (ext === 'jpg') return stripJpeg(u);
  if (ext === 'png') return stripPng(u);
  return stripWebp(u);
}
