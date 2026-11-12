import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as fontkitNs from 'fontkit';

const fontkit: any = (fontkitNs as any).create ? fontkitNs : (fontkitNs as any).default;
const ROOT = join(__dirname, '..');

// Load the worker-style IIFE module into a sandbox.
const code = readFileSync(join(ROOT, 'public', 'assets', 'vendor', 'font-engine-gpos.js'), 'utf-8');
const otCode = readFileSync(join(ROOT, 'public', 'assets', 'vendor', 'opentype.min.js'), 'utf-8');
const tblCode = readFileSync(join(ROOT, 'public', 'assets', 'vendor', 'font-engine-tables.js'), 'utf-8');
const sandbox: {
  self?: unknown;
  window?: unknown;
  opentype?: any;
  buildGposKern?: (pairs: unknown[], map: Map<number, number>) => Uint8Array | null;
  buildGposKernFromGidPairs?: (pairs: Array<{ l: number; r: number; value: number }>) => Uint8Array | null;
  injectCustomTables?: (bytes: Uint8Array, customTables: Record<string, Uint8Array>) => Uint8Array;
} = {};
sandbox.self = sandbox;
sandbox.window = sandbox;
new Function('self', 'window', otCode).call(sandbox, sandbox, sandbox);
new Function('self', code)(sandbox);
new Function('self', tblCode)(sandbox);
const buildGposKern = sandbox.buildGposKern!;
const buildGposKernFromGidPairs = sandbox.buildGposKernFromGidPairs!;
const injectCustomTables = sandbox.injectCustomTables!;
const opentype = sandbox.opentype!;

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
function parseGpos(bytes: Uint8Array): {
  pairs: Map<string, number>;
  scripts: string[];
  feature: string;
  lookupType: number;
  subTableCount: number;
} {
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
  const subTableCount = dv.getUint16(lookupOff + 4);
  expect(subTableCount).toBeGreaterThanOrEqual(1);

  const pairs = new Map<string, number>();
  const seenFirsts = new Set<number>();
  const lookupHeaderEnd = lookupOff + 6 + 2 * subTableCount;

  const subOffs: number[] = [];
  for (let s = 0; s < subTableCount; s++) {
    const subOff = lookupOff + dv.getUint16(lookupOff + 6 + 2 * s);
    expect(subOff).toBeGreaterThanOrEqual(lookupHeaderEnd);
    expect(subOff).toBeLessThan(bytes.byteLength);
    subOffs.push(subOff);
  }

  for (let s = 0; s < subTableCount; s++) {
    const subOff = subOffs[s];
    const subEnd = s + 1 < subTableCount ? subOffs[s + 1] : bytes.byteLength;
    expect(subOff).toBeLessThan(subEnd);

    expect(dv.getUint16(subOff)).toBe(1); // PairPos format 1
    const covOff = subOff + dv.getUint16(subOff + 2);
    expect(dv.getUint16(subOff + 4)).toBe(0x0004); // XAdvance only
    expect(dv.getUint16(subOff + 6)).toBe(0x0000);
    const pairSetCount = dv.getUint16(subOff + 8);
    const subHeaderEnd = subOff + 10 + 2 * pairSetCount;

    expect(covOff).toBeGreaterThanOrEqual(subHeaderEnd);
    expect(covOff + 4).toBeLessThanOrEqual(subEnd);
    expect(dv.getUint16(covOff)).toBe(1); // coverage format 1
    const covCount = dv.getUint16(covOff + 2);
    expect(covCount).toBe(pairSetCount);
    expect(covOff + 4 + 2 * covCount).toBeLessThanOrEqual(subEnd);

    const firsts: number[] = [];
    for (let i = 0; i < covCount; i++) {
      const gid = dv.getUint16(covOff + 4 + 2 * i);
      expect(seenFirsts.has(gid)).toBe(false); // first glyph's pair set never split across subtables
      seenFirsts.add(gid);
      firsts.push(gid);
    }
    expect([...firsts].sort((a, b) => a - b)).toEqual(firsts); // spec: ascending

    for (let i = 0; i < pairSetCount; i++) {
      const psOff = subOff + dv.getUint16(subOff + 10 + 2 * i);
      expect(psOff).toBeGreaterThanOrEqual(subHeaderEnd);
      expect(psOff + 2).toBeLessThanOrEqual(subEnd);
      const count = dv.getUint16(psOff);
      expect(psOff + 2 + count * 4).toBeLessThanOrEqual(subEnd);
      let prev = -1;
      for (let j = 0; j < count; j++) {
        const second = dv.getUint16(psOff + 2 + j * 4);
        const value = dv.getInt16(psOff + 4 + j * 4);
        expect(second).toBeGreaterThan(prev); // spec: ascending, no dupes
        prev = second;
        pairs.set(`${firsts[i]}:${second}`, value);
      }
    }
  }
  return { pairs, scripts, feature, lookupType, subTableCount };
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
    expect(g.subTableCount).toBe(1);
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

  it('splits ~24,000 pairs (156x156) across multiple PairPos subtables without overflowing 16-bit offsets', () => {
    const N = 156;
    const baseGid = 2;
    const bigPairs: Array<{ l: number; r: number; value: number }> = [];
    const expected = new Map<string, number>();
    for (let i = 0; i < N; i++) {
      const l = baseGid + i;
      for (let j = 0; j < N; j++) {
        const r = baseGid + j;
        const value = -(((i * 31 + j * 17) % 120) + 1);
        bigPairs.push({ l, r, value });
        expected.set(`${l}:${r}`, value);
      }
    }

    const bytes = buildGposKernFromGidPairs(bigPairs)!;
    expect(bytes).not.toBeNull();
    const g = parseGpos(bytes);
    expect(g.subTableCount).toBeGreaterThan(1);
    expect(g.pairs.size).toBe(N * N);

    // Embed into a real 158-glyph OTF and verify via fontkit shaping.
    const rectPath = () => {
      const p = new opentype.Path();
      p.moveTo(50, 0);
      p.lineTo(450, 0);
      p.lineTo(450, 700);
      p.lineTo(50, 700);
      p.close();
      return p;
    };
    const glyphs = [
      new opentype.Glyph({ name: '.notdef', unicode: 0, advanceWidth: 500, path: rectPath() }),
      new opentype.Glyph({ name: 'space', unicode: 0x20, advanceWidth: 300, path: new opentype.Path() }),
    ];
    for (let i = 0; i < N; i++) {
      const gid = baseGid + i;
      glyphs.push(
        new opentype.Glyph({
          name: `g${gid}`,
          unicode: 0x0100 + gid,
          advanceWidth: 500,
          path: rectPath(),
        }),
      );
    }
    const font = new opentype.Font({
      familyName: 'GposSplitTest',
      styleName: 'Regular',
      unitsPerEm: 1000,
      ascender: 800,
      descender: -200,
      glyphs,
    });
    const otfWithGpos = injectCustomTables(new Uint8Array(font.toArrayBuffer()), { GPOS: bytes });
    const fkFont = fontkit.create(Buffer.from(otfWithGpos));
    expect(fkFont.GPOS.lookupList.get(0).subTables.length).toBe(g.subTableCount);

    // Sample 50 pairs spanning early, middle, and late first glyphs (across subtables).
    let checked = 0;
    for (let k = 0; k < 50; k++) {
      const i = Math.floor((k * (N - 1)) / 49);
      const j = (k * 37) % N;
      const l = baseGid + i;
      const r = baseGid + j;
      const expVal = expected.get(`${l}:${r}`)!;
      expect(g.pairs.get(`${l}:${r}`)).toBe(expVal);
      const run = fkFont.layout(String.fromCodePoint(0x0100 + l, 0x0100 + r), ['kern']);
      expect(run.positions[0].xAdvance - 500, `fontkit pair ${l}:${r}`).toBe(expVal);
      checked++;
    }
    expect(checked).toBe(50);
  });

  it('throws instead of silently wrapping if a uint16 offset would exceed 65535', () => {
    // A single first glyph with 17,000 second glyphs creates a >68 KB PairSet
    // before a second subtable starts, pushing subtable[1]'s lookup-relative
    // offset past 65,535. Must throw rather than wrap silently.
    const hugePairs: Array<{ l: number; r: number; value: number }> = [];
    for (let r = 2; r < 17002; r++) {
      hugePairs.push({ l: 2, r, value: -10 });
    }
    hugePairs.push({ l: 3, r: 2, value: -10 });
    expect(() => buildGposKernFromGidPairs(hugePairs)).toThrow();
  });
});
