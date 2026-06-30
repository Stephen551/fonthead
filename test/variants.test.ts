import { describe, it, expect } from 'vitest';
import { mergeVariantSheets, type Glyph } from '../src/lib/maker';

// Minimal toy glyph — mergeVariantSheets only reads `char` and writes
// `variantSuffix`, so the geometry fields are placeholders.
function g(char: string): Glyph {
  return { char, italic: false, paths: [`d-${char}`], cellW: 10, cellH: 10, baselineYInCell: 8 };
}

const name = (m: Glyph) => m.char + (m.variantSuffix ?? '');

describe('mergeVariantSheets', () => {
  it('single sheet returns unchanged, no variant suffixes', () => {
    const base = [g('a'), g('b'), g('c')];
    const merged = mergeVariantSheets([base]);
    expect(merged).toEqual(base);
    expect(merged.every((m) => m.variantSuffix === undefined)).toBe(true);
  });

  it('three sheets: bases first with no suffix, then .cv01, then .cv02', () => {
    const merged = mergeVariantSheets([[g('a'), g('b')], [g('a'), g('b')], [g('a'), g('b')]]);
    expect(merged.slice(0, 2).map((m) => [m.char, m.variantSuffix])).toEqual([
      ['a', undefined],
      ['b', undefined],
    ]);
    expect(merged.slice(2).map(name)).toEqual(['a.cv01', 'b.cv01', 'a.cv02', 'b.cv02']);
    expect(merged).toHaveLength(6);
  });

  it('a letter missing from a variant sheet just yields fewer variants for it', () => {
    const merged = mergeVariantSheets([[g('a'), g('b')], [g('a')], [g('a'), g('b')]]);
    expect(merged.map(name)).toEqual(['a', 'b', 'a.cv01', 'a.cv02', 'b.cv02']);
  });

  it('drops an orphan variant glyph with no matching base letter', () => {
    const merged = mergeVariantSheets([[g('a')], [g('a'), g('z')]]);
    expect(merged.map(name)).toEqual(['a', 'a.cv01']);
  });

  it('does not mutate the input sheets', () => {
    const base = [g('a')];
    const v1 = [g('a')];
    mergeVariantSheets([base, v1]);
    expect(base[0].variantSuffix).toBeUndefined();
    expect(v1[0].variantSuffix).toBeUndefined();
  });

  it('empty input returns empty', () => {
    expect(mergeVariantSheets([])).toEqual([]);
  });
});
