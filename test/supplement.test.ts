import { describe, it, expect } from 'vitest';
import * as maker from '../src/lib/maker';
import type { Glyph } from '../src/lib/maker';

const glyph = (char: string, h = 100, mark = false): Glyph => ({
  char, italic: false, cellW: h, cellH: h * 2, baselineYInCell: h * 1.5,
  paths: [`M10 ${h * .5}L50 ${h * .5}L50 ${h * 1.5}L10 ${h * 1.5}Z${mark ? ` M20 0L30 0L30 ${h * .1}L20 ${h * .1}Z` : ''}`],
});
const measure = (g: Glyph) => {
  const nums = g.paths[0].split('Z')[0].match(/[-+]?\d*\.?\d+/g)!.map(Number);
  const ys = nums.filter((_, i) => i % 2 === 1), top = Math.min(...ys), bottom = Math.max(...ys);
  return { top, bottom, bodyTop: top, baseTop: top, baseBottom: bottom };
};

describe('supplement sheets', () => {
  it('adds new characters after base variants, keeps base duplicates and strips supplement variant tags', () => {
    const merge = (maker as any).mergeSupplementSheet;
    expect(merge, 'supplement merger is available').toBeTypeOf('function');
    const base = [glyph('A'), glyph('a'), { ...glyph('a'), variantSuffix: '.cv01' }];
    const extra = [glyph('A', 200), { ...glyph('é'), variantSuffix: '.cv02' }, glyph('é'), glyph('ç')];
    const result = merge(base, extra);
    expect(result.map((g: Glyph) => [g.char, g.variantSuffix])).toEqual([['A', undefined], ['a', undefined], ['a', '.cv01'], ['é', undefined], ['ç', undefined]]);
    expect(result.slice(0, 3)).toEqual(base);
    expect(result[0]).toBe(base[0]);
    expect(extra[1].variantSuffix).toBe('.cv02');
  });

  it('matches 2x supplement bodies independently to base cap height and x-height', () => {
    const fit = (maker as any).matchSupplementSize;
    expect(fit, 'supplement size matching is available').toBeTypeOf('function');
    const base = [...'BEH'].map(c => glyph(c, 100)).concat([...'enmxz'].map(c => glyph(c, 60)));
    const extra = [...'ÉÊË'].map(c => glyph(c, 200, true)).concat([...'éñü'].map(c => glyph(c, 120, true)), [glyph('€', 200)]);
    const fitted: Glyph[] = fit(base, extra, measure);
    fitted.forEach((g, i) => {
      const h = measure(g).baseBottom - measure(g).baseTop;
      expect(Math.abs(h / (i < 3 || g.char === '€' ? 100 : 60) - 1)).toBeLessThan(.02);
      expect(g.cellW).toBe(extra[i].cellW / 2);
      expect(g.cellH).toBe(extra[i].cellH / 2);
      expect(g.baselineYInCell).toBeCloseTo(extra[i].baselineYInCell / 2);
      expect(g.paths[0].split('M').length).toBe(extra[i].paths[0].split('M').length);
    });
    expect(extra[0].cellW).toBe(200);
  });

  it('uses separate capital and lowercase ratios and ignores variant references', () => {
    const base = [...'BEH'].map(c => glyph(c, 100)).concat([...'enmxz'].map(c => glyph(c, 60)), [{...glyph('E', 900), variantSuffix: '.cv01'}]);
    const extra = [glyph('É', 200, true), glyph('é', 180, true), glyph('€', 200)];
    const fitted = maker.matchSupplementSize(base, extra, measure);
    expect(fitted.map(g => measure(g).baseBottom - measure(g).baseTop)).toEqual([100,60,100]);
    expect(() => maker.matchSupplementSize([glyph('!')], [glyph('?')], measure)).toThrow('match the accents sheet size');
  });
});
