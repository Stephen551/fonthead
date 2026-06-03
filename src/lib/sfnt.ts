// SFNT (OTF/TTF) table-checksum repair + verification.
//
// opentype.js can write a table checksum one off when the table length is not
// 4-byte aligned (it surfaced on a 242-glyph colour font as a CFF checksum
// mismatch). Windows enforces table checksums and rejects such files, even
// though browsers/fontkit tolerate them. fixSfntChecksums recomputes every
// table checksum (zero-padded, per the OpenType spec) and head.checkSumAdjustment.
// verifySfntChecksums is the read-only check used as a server-side gate.
//
// Pure ArrayBuffer math: safe to import on both the client (maker) and the
// server (publish action).

const MAGIC = 0xb1b0afba;

/** Big-endian uint32 sum over [start, start+length), zero-padded to a
 *  multiple of 4 (the OpenType checksum rule). */
function sum32(view: DataView, start: number, length: number): number {
  let sum = 0;
  for (let i = 0; i < length; i += 4) {
    const b0 = view.getUint8(start + i);
    const b1 = i + 1 < length ? view.getUint8(start + i + 1) : 0;
    const b2 = i + 2 < length ? view.getUint8(start + i + 2) : 0;
    const b3 = i + 3 < length ? view.getUint8(start + i + 3) : 0;
    sum = (sum + (((b0 << 24) | (b1 << 16) | (b2 << 8) | b3) >>> 0)) >>> 0;
  }
  return sum >>> 0;
}

interface Rec {
  tag: string;
  recOff: number;
  off: number;
  len: number;
}

function records(view: DataView): { recs: Rec[]; headOff: number } {
  const numTables = view.getUint16(4, false);
  const recs: Rec[] = [];
  let headOff = -1;
  for (let i = 0; i < numTables; i++) {
    const recOff = 12 + i * 16;
    const tag = String.fromCharCode(
      view.getUint8(recOff),
      view.getUint8(recOff + 1),
      view.getUint8(recOff + 2),
      view.getUint8(recOff + 3),
    );
    const off = view.getUint32(recOff + 8, false);
    const len = view.getUint32(recOff + 12, false);
    recs.push({ tag, recOff, off, len });
    if (tag === 'head') headOff = off;
  }
  return { recs, headOff };
}

/** Return a copy with every table checksum + head.checkSumAdjustment corrected. */
export function fixSfntChecksums(input: Uint8Array): Uint8Array {
  const bytes = input.slice();
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const { recs, headOff } = records(view);

  // head's own checksum is computed with checkSumAdjustment = 0 (spec)
  if (headOff >= 0) view.setUint32(headOff + 8, 0, false);

  for (const r of recs) {
    view.setUint32(r.recOff + 4, sum32(view, r.off, r.len), false);
  }

  // whole-font checksum with checkSumAdjustment still 0, then the adjustment
  if (headOff >= 0) {
    const whole = sum32(view, 0, bytes.length);
    view.setUint32(headOff + 8, (MAGIC - whole) >>> 0, false);
  }
  return bytes;
}

export interface ChecksumCheck {
  ok: boolean;
  errors: string[];
}

/** Read-only: does every table checksum (and head.checkSumAdjustment) match? */
export function verifySfntChecksums(input: Uint8Array): ChecksumCheck {
  const errors: string[] = [];
  try {
    const view = new DataView(input.buffer, input.byteOffset, input.byteLength);
    const tag = view.getUint32(0, false);
    if (tag !== 0x4f54544f && tag !== 0x00010000 && tag !== 0x74727565) {
      return { ok: false, errors: ['not an sfnt (OTTO/0x00010000/true)'] };
    }
    const { recs, headOff } = records(view);
    for (const r of recs) {
      const declared = view.getUint32(r.recOff + 4, false);
      let actual: number;
      if (r.tag === 'head') {
        // recompute with checkSumAdjustment zeroed, without mutating input
        const copy = input.slice(r.off, r.off + Math.min(r.len, input.length - r.off));
        const cv = new DataView(copy.buffer, copy.byteOffset, copy.byteLength);
        if (copy.length >= 12) cv.setUint32(8, 0, false);
        actual = sum32(cv, 0, copy.length);
      } else {
        actual = sum32(view, r.off, r.len);
      }
      if (actual !== declared) {
        errors.push(`${r.tag.trim()} checksum 0x${declared.toString(16)} != 0x${actual.toString(16)}`);
      }
    }
    if (headOff < 0) errors.push('missing head table');
  } catch (e) {
    errors.push(e instanceof Error ? e.message : 'parse error');
  }
  return { ok: errors.length === 0, errors };
}
