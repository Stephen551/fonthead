import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// Load the worker-style IIFE module into a sandbox.
const code = readFileSync(join(__dirname, '..', 'public', 'assets', 'vendor', 'font-engine-gpos.js'), 'utf-8');
const sandbox: {
  buildGposKern?: (pairs: unknown[], map: Map<number, number>) => Uint8Array | null;
  buildGposKernFromGidPairs?: (pairs: Array<{ l: number; r: number; value: number }>) => Uint8Array | null;
} = {};
new Function('self', code)(sandbox);
const buildGposKern = sandbox.buildGposKern!;
const buildGposKernFromGidPairs = sandbox.buildGposKernFromGidPairs!;

const cmap = new Map<number, number>([
  ['A'.codePointAt(0)!, 34],
  ['V'.codePointAt(0)!, 55],
  ['T'.codePointAt(0)!, 53],
  ['o'.codePointAt(0)!, 82],
  ['a'.codePointAt(0)!, 66],
]);

/* A strict little GPOS reader: follows every offset the way a shaper
 * would and returns the kerning map keyed "left:right" -> value. Throws
 * on anything malformed, which is the point. */
function parseGpos(bytes: Uint8Array): { pairs: Map<string, number>; scripts: string[]; feature: string; lookupType: number } {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tag = (off: number) => String.fromCharCode(dv.getUint8(off), dv.getUint8(off + 1), dv.getUint8(off + 2), dv.getUint8(off + 3));
  expect(dv.getUint16(0)).toBe(1);
  expect(dv.getUint16(2)).toBe(0);
  const scriptListOff = dv.getUint16(4);
  const featureListOff = dv.getUint16(6);
  const lookupListOff = dv.getUint16(8);

  const scripts: string[] = [];
  const scriptCount = dv.getUint16(scriptListOff);
  for (let i = 0; i < scriptCount; i++) {
    const rec = scriptListOff + 2 + i * 6;
    scripts.push(tag(rec));
    const scriptOff = scriptListOff + dv.getUint16(rec + 4);
    const langSysOff = scriptOff + dv.getUint16(scriptOff);
    expect(dv.getUint16(langSysOff + 2)).toBe(0xffff); // no required feature
    expect(dv.getUint16(langSysOff + 4)).toBe(1);
    expect(dv.getUint16(langSysOff + 6)).toBe(0); // feature index 0
  }

  expect(dv.getUint16(featureListOff)).toBe(1);
  const feature = tag(featureListOff + 2);
  const featureOff = featureListOff + dv.getUint16(featureListOff + 6);
  expect(dv.getUint16(featureOff + 2)).toBe(1);
  expect(dv.getUint16(featureOff + 4)).toBe(0); // lookup index 0

  expect(dv.getUint16(lookupListOff)).toBe(1);
  const lookupOff = lookupListOff + dv.getUint16(lookupListOff + 2);
  const lookupType = dv.getUint16(lookupOff);
  expect(dv.getUint16(lookupOff + 4)).toBe(1);
  const subOff = lookupOff + dv.getUint16(lookupOff + 6);

  expect(dv.getUint16(subOff)).toBe(1); // PairPos format 1
  const covOff = subOff + dv.getUint16(subOff + 2);
  expect(dv.getUint16(subOff + 4)).toBe(0x0004); // XAdvance only
  expect(dv.getUint16(subOff + 6)).toBe(0x0000);
  const pairSetCount = dv.getUint16(subOff + 8);

  expect(dv.getUint16(covOff)).toBe(1); // coverage format 1
  const covCount = dv.getUint16(covOff + 2);
  expect(covCount).toBe(pairSetCount);
  const firsts: number[] = [];
  for (let i = 0; i < covCount; i++) firsts.push(dv.getUint16(covOff + 4 + 2 * i));
  expect([...firsts].sort((a, b) => a - b)).toEqual(firsts); // spec: ascending

  const pairs = new Map<string, number>();
  for (let i = 0; i < pairSetCount; i++) {
    const psOff = subOff + dv.getUint16(subOff + 10 + 2 * i);
    const count = dv.getUint16(psOff);
    let prev = -1;
    for (let j = 0; j < count; j++) {
      const second = dv.getUint16(psOff + 2 + j * 4);
      const value = dv.getInt16(psOff + 4 + j * 4);
      expect(second).toBeGreaterThan(prev); // spec: ascending, no dupes
      prev = second;
      pairs.set(`${firsts[i]}:${second}`, value);
    }
  }
  return { pairs, scripts, feature, lookupType };
}

describe('buildGposKern', () => {
  it('builds a spec-shaped GPOS a shaper can walk, values exact', () => {
    const bytes = buildGposKern(
      [
        { leftChar: 'A', rightChar: 'V', value: -85 },
        { leftChar: 'T', rightChar: 'o', value: -60 },
        { leftChar: 'A', rightChar: 'T', value: -42.4 },
      ],
      cmap,
    )!;
    const g = parseGpos(bytes);
    expect(g.scripts).toEqual(['DFLT', 'latn']);
    expect(g.feature).toBe('kern');
    expect(g.lookupType).toBe(2);
    expect(g.pairs.get('34:55')).toBe(-85); // A:V
    expect(g.pairs.get('53:82')).toBe(-60); // T:o
    expect(g.pairs.get('34:53')).toBe(-42); // A:T rounded
    expect(g.pairs.size).toBe(3);
  });

  it('sorts coverage and records regardless of input order', () => {
    const bytes = buildGposKern(
      [
        { leftChar: 'T', rightChar: 'o', value: -60 },
        { leftChar: 'A', rightChar: 'V', value: -85 },
        { leftChar: 'A', rightChar: 'T', value: -40 },
      ],
      cmap,
    )!;
    // parseGpos asserts ascending coverage + ascending records internally
    expect(parseGpos(bytes).pairs.size).toBe(3);
  });

  it('last write wins on duplicate pairs', () => {
    const bytes = buildGposKern(
      [
        { leftChar: 'A', rightChar: 'V', value: -85 },
        { leftChar: 'A', rightChar: 'V', value: -30 },
      ],
      cmap,
    )!;
    expect(parseGpos(bytes).pairs.get('34:55')).toBe(-30);
  });

  it('skips unresolvable chars and zero values; null when nothing survives', () => {
    expect(buildGposKern([{ leftChar: 'Ø', rightChar: 'V', value: -50 }], cmap)).toBeNull();
    expect(buildGposKern([{ leftChar: 'A', rightChar: 'V', value: 0 }], cmap)).toBeNull();
    expect(buildGposKern([], cmap)).toBeNull();
    const mixed = buildGposKern(
      [
        { leftChar: 'Ø', rightChar: 'V', value: -50 },
        { leftChar: 'A', rightChar: 'V', value: -50 },
      ],
      cmap,
    )!;
    expect(parseGpos(mixed).pairs.size).toBe(1);
  });

  it('clamps extreme values into int16', () => {
    const bytes = buildGposKern([{ leftChar: 'A', rightChar: 'V', value: -99999 }], cmap)!;
    expect(parseGpos(bytes).pairs.get('34:55')).toBe(-32768);
  });
});

describe('buildGposKernFromGidPairs', () => {
  it('writes a GPOS from raw gid pairs (the variant-kern core)', () => {
    const bytes = buildGposKernFromGidPairs([
      { l: 34, r: 55, value: -85 },
      { l: 40, r: 55, value: -30 },
    ])!;
    const g = parseGpos(bytes);
    expect(g.feature).toBe('kern');
    expect(g.lookupType).toBe(2);
    expect(g.pairs.get('34:55')).toBe(-85);
    expect(g.pairs.get('40:55')).toBe(-30);
    expect(g.pairs.size).toBe(2);
  });

  it('null when no usable pair survives', () => {
    expect(buildGposKernFromGidPairs([])).toBeNull();
    expect(buildGposKernFromGidPairs([{ l: 1, r: 2, value: 0 }])).toBeNull();
  });
});
