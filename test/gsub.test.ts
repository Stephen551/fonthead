import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// Load the worker-style IIFE module into a sandbox (mirrors test/gpos.test.ts).
const code = readFileSync(join(__dirname, '..', 'public', 'assets', 'vendor', 'font-engine-gsub.js'), 'utf-8');
type Variant = { suffix: string; name: string; gid: number };
type Group = { base: string; baseGid: number; variants: Variant[] };
type GidPair = { l: number; r: number; value: number };
const sandbox: {
  collectVariantGroups?: (indexByName: Map<string, number>) => Group[];
  buildGsubCalt?: (groups: Group[] | null, indexByName: Map<string, number>) => Uint8Array | null;
  expandVariantKern?: (
    pairs: Array<{ leftChar: string; rightChar: string; value: number }>,
    indexByChar: Map<number, number>,
    indexByName: Map<string, number>,
  ) => GidPair[];
} = {};
new Function('self', code)(sandbox);
const collectVariantGroups = sandbox.collectVariantGroups!;
const buildGsubCalt = sandbox.buildGsubCalt!;
const expandVariantKern = sandbox.expandVariantKern!;

const grp = (base: string, baseGid: number, ...vs: Array<[string, number]>): Group => ({
  base,
  baseGid,
  variants: vs.map(([suffix, gid]) => ({ suffix, name: base + suffix, gid })),
});

/* A strict GSUB reader: walks every offset the way a shaper would, asserts each
 * Coverage is ascending and every structural invariant, and returns the layout.
 * Throws/fails on anything malformed — that is the point. */
type SingleLookup = { type: 1; map: Map<number, number> };
type ChainLookup = { type: 6; backtrackLen: number; btCovs: number[][]; inputCov: number[]; seq: Array<{ seqIndex: number; lookupIndex: number }> };
function parseGsub(bytes: Uint8Array) {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tag = (off: number) => String.fromCharCode(dv.getUint8(off), dv.getUint8(off + 1), dv.getUint8(off + 2), dv.getUint8(off + 3));
  expect(dv.getUint16(0)).toBe(1); // majorVersion
  expect(dv.getUint16(2)).toBe(0); // minorVersion
  const scriptListOff = dv.getUint16(4);
  const featureListOff = dv.getUint16(6);
  const lookupListOff = dv.getUint16(8);

  const readCoverage = (off: number): number[] => {
    expect(dv.getUint16(off)).toBe(1); // coverage format 1
    const n = dv.getUint16(off + 2);
    const gids: number[] = [];
    for (let i = 0; i < n; i++) gids.push(dv.getUint16(off + 4 + 2 * i));
    expect([...gids].sort((a, b) => a - b)).toEqual(gids); // spec: ascending
    return gids;
  };

  // ScriptList — read tags, verify each LangSys points at feature index 0.
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

  // FeatureList — one feature; read its lookup index list.
  expect(dv.getUint16(featureListOff)).toBe(1);
  const feature = tag(featureListOff + 2);
  const featureOff = featureListOff + dv.getUint16(featureListOff + 6);
  expect(dv.getUint16(featureOff)).toBe(0); // featureParams null
  const featureLookups: number[] = [];
  const lc = dv.getUint16(featureOff + 2);
  for (let i = 0; i < lc; i++) featureLookups.push(dv.getUint16(featureOff + 4 + 2 * i));

  // LookupList — decode every lookup.
  const lookupCount = dv.getUint16(lookupListOff);
  const lookups: Array<SingleLookup | ChainLookup> = [];
  for (let li = 0; li < lookupCount; li++) {
    const lookupOff = lookupListOff + dv.getUint16(lookupListOff + 2 + 2 * li);
    const type = dv.getUint16(lookupOff);
    expect(dv.getUint16(lookupOff + 2)).toBe(0); // lookupFlag
    expect(dv.getUint16(lookupOff + 4)).toBe(1); // subTableCount
    const subOff = lookupOff + dv.getUint16(lookupOff + 6);
    if (type === 1) {
      expect(dv.getUint16(subOff)).toBe(2); // SingleSubst format 2
      const covOff = subOff + dv.getUint16(subOff + 2);
      const glyphCount = dv.getUint16(subOff + 4);
      const subs: number[] = [];
      for (let i = 0; i < glyphCount; i++) subs.push(dv.getUint16(subOff + 6 + 2 * i));
      const cov = readCoverage(covOff);
      expect(cov.length).toBe(glyphCount); // spec: counts match
      const map = new Map<number, number>();
      cov.forEach((g, i) => map.set(g, subs[i]));
      lookups.push({ type: 1, map });
    } else if (type === 6) {
      expect(dv.getUint16(subOff)).toBe(3); // ChainContextSubst format 3
      let o = subOff + 2;
      const btCount = dv.getUint16(o);
      o += 2;
      const btCovs: number[][] = [];
      for (let i = 0; i < btCount; i++) {
        btCovs.push(readCoverage(subOff + dv.getUint16(o)));
        o += 2;
      }
      const inputCount = dv.getUint16(o);
      o += 2;
      expect(inputCount).toBe(1);
      const inputCov = readCoverage(subOff + dv.getUint16(o));
      o += 2;
      const laCount = dv.getUint16(o);
      o += 2;
      expect(laCount).toBe(0);
      const seqCount = dv.getUint16(o);
      o += 2;
      const seq: Array<{ seqIndex: number; lookupIndex: number }> = [];
      for (let i = 0; i < seqCount; i++) {
        const seqIndex = dv.getUint16(o);
        const lookupIndex = dv.getUint16(o + 2);
        expect(seqIndex).toBeLessThan(inputCount); // spec: indexes the input sequence
        expect(lookupIndex).toBeLessThan(lookupCount); // spec: in-range nested lookup
        seq.push({ seqIndex, lookupIndex });
        o += 4;
      }
      lookups.push({ type: 6, backtrackLen: btCount, btCovs, inputCov, seq });
    } else {
      throw new Error('unexpected lookup type ' + type);
    }
  }
  return { scripts, feature, featureLookups, lookups, lookupCount };
}

describe('collectVariantGroups', () => {
  it('groups .cvNN variants under their base, ordered by cv number', () => {
    const idx = new Map<string, number>([
      ['a', 5],
      ['b', 6],
      ['a.cv01', 40],
      ['a.cv02', 41],
      ['b.cv01', 42],
    ]);
    expect(collectVariantGroups(idx)).toEqual([
      {
        base: 'a',
        baseGid: 5,
        variants: [
          { suffix: '.cv01', name: 'a.cv01', gid: 40 },
          { suffix: '.cv02', name: 'a.cv02', gid: 41 },
        ],
      },
      { base: 'b', baseGid: 6, variants: [{ suffix: '.cv01', name: 'b.cv01', gid: 42 }] },
    ]);
  });

  it('ignores an orphan variant whose base is absent from the index', () => {
    const idx = new Map<string, number>([['a', 5], ['a.cv01', 40], ['z.cv01', 99]]);
    const groups = collectVariantGroups(idx);
    expect(groups.map((g) => g.base)).toEqual(['a']);
    expect(groups[0].variants.map((v) => v.gid)).toEqual([40]);
  });

  it('returns groups sorted by base gid ascending', () => {
    const idx = new Map<string, number>([
      ['m', 20],
      ['a', 5],
      ['m.cv01', 70],
      ['a.cv01', 40],
    ]);
    expect(collectVariantGroups(idx).map((g) => g.baseGid)).toEqual([5, 20]);
  });

  it('orders variants by cv number even when the index is out of order', () => {
    const idx = new Map<string, number>([['a', 5], ['a.cv02', 41], ['a.cv01', 40]]);
    expect(collectVariantGroups(idx)[0].variants.map((v) => v.suffix)).toEqual(['.cv01', '.cv02']);
  });

  it('returns empty when no base carries a variant', () => {
    expect(collectVariantGroups(new Map([['a', 5], ['b', 6]]))).toEqual([]);
  });
});

describe('buildGsubCalt', () => {
  it('builds a two-level calt a shaper can walk, wired base->cv01->cv02', () => {
    const groups = [grp('a', 5, ['.cv01', 40], ['.cv02', 41]), grp('b', 6, ['.cv01', 42], ['.cv02', 43])];
    const g = parseGsub(buildGsubCalt(groups, new Map())!);

    expect(g.scripts).toEqual(['DFLT', 'latn']);
    expect(g.feature).toBe('calt');
    expect(g.featureLookups).toEqual([2, 3]); // calt lists ONLY the chains
    expect(g.lookups.map((l) => l.type)).toEqual([1, 1, 6, 6]);

    // Lookup 0: base -> cv01. Lookup 1: cv01 -> cv02 (NOT base -> cv02).
    const ss0 = g.lookups[0] as SingleLookup;
    const ss1 = g.lookups[1] as SingleLookup;
    expect(ss0.map.get(5)).toBe(40);
    expect(ss0.map.get(6)).toBe(42);
    expect(ss1.map.get(40)).toBe(41);
    expect(ss1.map.get(42)).toBe(43);

    // Chain 0: 1 backtrack, fires on base glyphs, nests lookup 0.
    const c0 = g.lookups[2] as ChainLookup;
    expect(c0.backtrackLen).toBe(1);
    expect(c0.inputCov).toEqual([5, 6]);
    expect(c0.seq).toEqual([{ seqIndex: 0, lookupIndex: 0 }]);

    // Chain 1 (rotation): 1 backtrack on the cv01 glyphs (a cv01 predecessor ->
    // cv02), nests lookup 1. This makes a repeated run alternate cv01/cv02 rather
    // than settle into cv02, so no two adjacent repeats are the same glyph.
    const c1 = g.lookups[3] as ChainLookup;
    expect(c1.backtrackLen).toBe(1);
    expect(c1.inputCov).toEqual([40, 42]);
    expect(c1.seq).toEqual([{ seqIndex: 0, lookupIndex: 1 }]);
    expect(c1.btCovs[0]).toEqual([40, 42]); // backtrack = the cv01 source glyphs

    // Chain 0 backtracks over the whole letter set (any preceding letter -> cv01).
    const letterSet = [5, 6, 40, 41, 42, 43];
    expect(c0.btCovs[0]).toEqual(letterSet);
  });

  it('handles a 2-sheet palette (cv02 absent) with a single level', () => {
    const groups = [grp('a', 5, ['.cv01', 40]), grp('b', 6, ['.cv01', 42])];
    const g = parseGsub(buildGsubCalt(groups, new Map())!);
    expect(g.featureLookups).toEqual([1]); // one chain at index 1
    expect(g.lookups.map((l) => l.type)).toEqual([1, 6]);
    const c0 = g.lookups[1] as ChainLookup;
    expect(c0.backtrackLen).toBe(1);
    expect(c0.seq).toEqual([{ seqIndex: 0, lookupIndex: 0 }]);
    expect((g.lookups[0] as SingleLookup).map.get(5)).toBe(40);
    expect(c0.btCovs[0]).toEqual([5, 6, 40, 42]);
  });

  it('returns null when there is nothing to cycle', () => {
    expect(buildGsubCalt([], new Map())).toBeNull();
    expect(buildGsubCalt(null, new Map())).toBeNull();
    expect(buildGsubCalt([grp('a', 5)], new Map())).toBeNull(); // base, no variants
  });

  it('sorts coverage and substitutes regardless of input group order', () => {
    const groups = [grp('m', 20, ['.cv01', 70], ['.cv02', 71]), grp('a', 5, ['.cv01', 40], ['.cv02', 41])];
    const g = parseGsub(buildGsubCalt(groups, new Map())!); // parseGsub asserts ascending coverage
    const ss0 = g.lookups[0] as SingleLookup;
    expect(ss0.map.get(5)).toBe(40);
    expect(ss0.map.get(20)).toBe(70);
    expect((g.lookups[2] as ChainLookup).inputCov).toEqual([5, 20]); // sorted by source gid
  });
});

describe('expandVariantKern', () => {
  const cp = (c: string) => c.codePointAt(0)!;

  it('expands a base char pair to every variant glyph-id combination, same value', () => {
    const indexByChar = new Map<number, number>([[cp('a'), 5], [cp('n'), 6]]);
    const indexByName = new Map<string, number>([
      ['a', 5],
      ['n', 6],
      ['a.cv01', 40],
      ['a.cv02', 41],
      ['n.cv01', 42],
    ]);
    const out = expandVariantKern([{ leftChar: 'a', rightChar: 'n', value: -30 }], indexByChar, indexByName);
    // a in {5,40,41} x n in {6,42} = 6 pairs, all -30
    const keys = out.map((p) => `${p.l}:${p.r}`).sort();
    expect(keys).toEqual(['40:42', '40:6', '41:42', '41:6', '5:42', '5:6'].sort());
    expect(out.every((p) => p.value === -30)).toBe(true);
  });

  it('a char with no variants stays a single pair', () => {
    const out = expandVariantKern(
      [{ leftChar: 'x', rightChar: 'y', value: -12 }],
      new Map([[cp('x'), 9], [cp('y'), 10]]),
      new Map([['x', 9], ['y', 10]]),
    );
    expect(out).toEqual([{ l: 9, r: 10, value: -12 }]);
  });

  it('keeps space pairs and expands only the lettered side', () => {
    const indexByChar = new Map<number, number>([[cp('a'), 5], [cp(' '), 1]]);
    const indexByName = new Map<string, number>([['a', 5], ['space', 1], ['a.cv01', 40]]);
    const out = expandVariantKern([{ leftChar: 'a', rightChar: ' ', value: 20 }], indexByChar, indexByName);
    expect(out.map((p) => `${p.l}:${p.r}`).sort()).toEqual(['40:1', '5:1'].sort());
  });

  it('drops a pair whose base char is absent from the cmap', () => {
    expect(expandVariantKern([{ leftChar: 'a', rightChar: 'n', value: -30 }], new Map(), new Map())).toEqual([]);
  });
});
