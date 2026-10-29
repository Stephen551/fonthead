import { describe, expect, it } from 'vitest';
import { repairSupplementDescenders, type OutlineBounds } from '../src/lib/supplement-repair';
import type { Glyph } from '../src/lib/maker';

const rect = (x: number, y: number, w: number, h: number) => `M${x} ${y} L${x + w} ${y} L${x + w} ${y + h} L${x} ${y + h} Z`;
const glyph = (char: string, paths: string[]): Glyph => ({ char, paths, italic: false, cellW: 100, cellH: 130, baselineYInCell: 70 });
const donor = glyph('y', [rect(20, 20, 40, 100)]);
const mark = rect(35, 2, 5, 8);
const clipped = glyph('ý', [rect(20, 20, 40, 80), rect(15, 90, 9, 10), mark]);
const measure = (paths: string[]): OutlineBounds => {
  const values = paths.join(' ').match(/-?\d+(?:\.\d+)?/g)!.map(Number);
  const xs = values.filter((_, i) => i % 2 === 0), ys = values.filter((_, i) => i % 2 === 1);
  return { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) };
};
const matching = () => ({ coverage: 0.99, donorComponents: 1, targetComponents: 2 });

describe('clipped supplement descenders', () => {
  it('restores a matching body while keeping the accent, baseline and cell width', () => {
    const before = structuredClone(clipped);
    const result = repairSupplementDescenders([donor], [clipped], measure, matching);
    expect(result.repairs.map(r => r.char)).toEqual(['ý']);
    expect(result.glyphs[0].paths).toEqual([rect(17.5, 20, 40, 100), mark]);
    expect(result.glyphs[0].baselineYInCell).toBe(70);
    expect(result.glyphs[0].cellW).toBe(100);
    expect(clipped).toEqual(before);
  });

  it('leaves a complete or single-piece descender intact', () => {
    const complete = glyph('ý', [...donor.paths, mark]);
    const single = glyph('ý', [clipped.paths[0], mark]);
    for (const g of [complete, single]) {
      expect(repairSupplementDescenders([donor], [g], measure, matching).glyphs[0]).toBe(g);
    }
  });

  it('requires an intact matching body rather than guessing a connection', () => {
    for (const evidence of [
      { coverage: 0.8, donorComponents: 1, targetComponents: 2 },
      { coverage: 0.99, donorComponents: 2, targetComponents: 2 },
      { coverage: 0.99, donorComponents: 1, targetComponents: 3 },
    ]) expect(repairSupplementDescenders([donor], [clipped], measure, () => evidence).glyphs[0]).toBe(clipped);
    expect(repairSupplementDescenders([{ ...donor, variantSuffix: '.cv01' }], [clipped], measure, matching).glyphs[0]).toBe(clipped);
  });

  it('does not replace an intentionally shorter tail, a different scale, or an unaligned body', () => {
    const differentCut = glyph('ý', [clipped.paths[0], rect(15, 90, 9, 6), mark]);
    const wide = glyph('ý', [rect(20, 20, 65, 80), rect(15, 90, 9, 10), mark]);
    const unaligned = { ...clipped, baselineYInCell: 80 };
    for (const g of [differentCut, wide, unaligned]) {
      expect(repairSupplementDescenders([donor], [g], measure, matching).glyphs[0]).toBe(g);
    }
  });

  it('excludes below accents and never borrows a different base character', () => {
    for (const char of ['y', 'ç', 'é']) {
      const g = { ...clipped, char };
      expect(repairSupplementDescenders([donor], [g], measure, matching).glyphs[0]).toBe(g);
    }
  });
});
