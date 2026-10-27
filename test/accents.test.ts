import { describe, it, expect } from 'vitest';
import { parseCharset } from '../src/lib/maker';
import { alignGlyphBaselines } from '../src/lib/baseline';
import { charsetCharacters, latinAccent, mergeAccentBands, validateCharset } from '../src/lib/accents';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('accented Latin input and placement', () => {
  it('uses unique Unicode glyph names, including outside the BMP', () => {
    const engine: any = {};
    new Function('self', 'opentype', readFileSync(join(__dirname, '../public/assets/vendor/font-engine-builder.js'), 'utf8'))(engine, {});
    expect(['é', 'ñ', 'ü', 'ç', 'Œ', '™', '𝔄'].map(engine.glyphName)).toEqual(['uni00E9', 'uni00F1', 'uni00FC', 'uni00E7', 'uni0152', 'uni2122', 'u1D504']);
    expect(engine.glyphName('e\u0301')).toBe('uni00E9');
    expect(engine.glyphName('A')).toBe('A');
    expect(engine.glyphName('0')).toBe('zero');
  });

  it('distinguishes upper and lower marks without compatibility decomposition', () => {
    expect(latinAccent('ç')).toEqual({ base: 'c', above: false, below: true });
    expect(latinAccent('ǘ')).toEqual({ base: 'u', above: true, below: false });
    expect(latinAccent('ộ')).toEqual({ base: 'o', above: true, below: true });
    expect(latinAccent('æ')).toBeNull();
    expect(charsetCharacters('e\u0301𝔄')).toEqual(['é', '𝔄']);
    expect(() => validateCharset(['x\u0301'])).toThrow('combining accent');
  });

  it('merges detached accent bands according to the declared row and preserves punctuation', () => {
    const bands = [[0, 100], [150, 165], [185, 285], [350, 450], [465, 480], [550, 565]];
    expect(mergeAccentBands(bands, ['ABC', 'éñü', 'çąę', '.:'])).toEqual([[0, 100], [150, 285], [350, 480], [550, 565]]);
    expect(mergeAccentBands(bands, ['ABC', 'abc', 'xyz', '.:'])).toBe(bands);
    expect(mergeAccentBands([[0, 100], [150, 250]], ['é'])).toEqual([[0, 100], [150, 250]]);
    expect(mergeAccentBands([[0, 10], [100, 200]], ['é'])).toEqual([[0, 10], [100, 200]]);
  });
  it('normalizes pasted decomposed characters before counting cells', () => {
    expect(parseCharset('e\u0301n\u0303u\u0308c\u0327\nA\u0308')).toEqual(['éñüç', 'Ä']);
  });

  it('anchors accents to the base letter body without moving their contours', () => {
    const glyph = (char: string, top: number, bottom: number, baseTop = top) => ({
      char, paths: ['M0 0L10 0L10 10Z'], cellW: 100, cellH: 300, italic: false,
      baselineYInCell: 200, bounds: { top, bottom, bodyTop: baseTop, baseTop },
    });
    const gs = [...'HBE'].map(c => glyph(c, 50, 200)).concat(
      [...'mnxzencu'].map(c => glyph(c, 100, 200)),
      [glyph('é', 60, 220, 120), glyph('ñ', 40, 180, 80), glyph('ü', 65, 220, 120), glyph('ç', 120, 250)]);
    const result = alignGlyphBaselines(gs, g => gs.find(x => x === g)!.bounds);
    for (const [char, baseline] of [['é', 220], ['ñ', 180], ['ü', 220], ['ç', 220]] as const) {
      const g = result.glyphs.find(g => g.char === char)!;
      expect(g.baselineYInCell, char).toBe(baseline);
      expect(g.paths).toBe(gs.find(x => x.char === char)!.paths);
    }
  });

  it('aligns an accent-only supplement and does not confuse the cedilla with a foot', () => {
    const gs = ['é', 'ñ', 'ü', 'ç'].map((char, i) => ({
      char, paths: ['M0 0L10 0L10 10Z'], cellW: 100, cellH: 300, italic: false, baselineYInCell: 200,
      bounds: { top: i === 3 ? 120 : 60, bottom: i === 3 ? 250 : 220, bodyTop: 120, baseTop: 120, baseBottom: i === 3 ? 250 : 220 },
    }));
    const result = alignGlyphBaselines(gs, g => gs.find(x => x === g)!.bounds);
    expect(result.glyphs.map(g => g.baselineYInCell)).toEqual([220, 220, 220, 220]);
  });
});
