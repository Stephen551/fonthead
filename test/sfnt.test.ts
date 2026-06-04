import { describe, it, expect } from 'vitest';
import { fixSfntChecksums, verifySfntChecksums } from '../src/lib/sfnt';

// Build a tiny synthetic sfnt: header + a 'head' table (needs >=12 bytes for
// checkSumAdjustment at offset 8) + one more table. Checksums start wrong.
function writeTag(buf: Uint8Array, off: number, tag: string) {
  for (let i = 0; i < 4; i++) buf[off + i] = tag.charCodeAt(i);
}

function buildSynthSfnt(): Uint8Array {
  const headLen = 16;
  const aLen = 8;
  const dirSize = 12 + 2 * 16; // header + 2 records = 44
  const headOff = dirSize; // 44
  const aOff = headOff + headLen; // 60
  const total = aOff + aLen; // 68
  const buf = new Uint8Array(total);
  const dv = new DataView(buf.buffer);
  dv.setUint32(0, 0x00010000, false); // sfnt version (TrueType)
  dv.setUint16(4, 2, false); // numTables
  // record 0: head
  writeTag(buf, 12, 'head');
  dv.setUint32(12 + 8, headOff, false);
  dv.setUint32(12 + 12, headLen, false);
  // record 1: a filler table
  writeTag(buf, 28, 'aaaa');
  dv.setUint32(28 + 8, aOff, false);
  dv.setUint32(28 + 12, aLen, false);
  // table bodies: deterministic non-zero filler
  for (let i = headOff; i < total; i++) buf[i] = (i * 7) & 0xff;
  return buf;
}

describe('fixSfntChecksums / verifySfntChecksums', () => {
  it('repairs a font with wrong checksums so verify passes', () => {
    const raw = buildSynthSfnt();
    expect(verifySfntChecksums(raw).ok).toBe(false); // checksums start at 0
    const fixed = fixSfntChecksums(raw);
    const check = verifySfntChecksums(fixed);
    expect(check.ok).toBe(true);
    expect(check.errors).toEqual([]);
  });

  it('is idempotent', () => {
    const once = fixSfntChecksums(buildSynthSfnt());
    const twice = fixSfntChecksums(once);
    expect(Array.from(twice)).toEqual(Array.from(once));
  });

  it('catches a corrupted table body', () => {
    const fixed = fixSfntChecksums(buildSynthSfnt());
    const bad = fixed.slice();
    bad[62] ^= 0xff; // a byte inside the 'aaaa' table body
    expect(verifySfntChecksums(bad).ok).toBe(false);
  });

  it('rejects non-sfnt input', () => {
    expect(verifySfntChecksums(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8])).ok).toBe(false);
  });
});
