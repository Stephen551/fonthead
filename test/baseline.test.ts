import { describe, it, expect } from 'vitest';
import { alignGlyphBaselines, type BaselineBounds } from '../src/lib/baseline';
import type { Glyph } from '../src/lib/maker';

type MeasuredGlyph = Glyph & { bounds: BaselineBounds };
function glyph(char: string, top: number, bottom: number, bodyTop = top, baseline = 200): MeasuredGlyph {
  return { char, italic: false, paths: [`M 10 ${top} L 50 ${top} L 50 ${bottom} Z`],
    cellW: 70, cellH: 300, baselineYInCell: baseline, bounds: { top, bottom, bodyTop } };
}
const refs = () => [
  ...Array.from('HBE', (c) => glyph(c, 50, 200)),
  ...Array.from('mnxz', (c) => glyph(c, 100, 200)),
  ...Array.from('bdhkl', (c) => glyph(c, 40, 200)),
];
const align = (gs: MeasuredGlyph[]) => alignGlyphBaselines(gs, (g) => (g as MeasuredGlyph).bounds);
const get = (gs: Glyph[], c: string) => gs.find((g) => g.char === c)!;

describe('automatic glyph baselines', () => {
  it('lowers a floating letter and raises a sunken letter without changing its outline or size', () => {
    const high = glyph('a', 82, 182);
    const low = glyph('t', 70, 220);
    const gs = [...refs(), high, low];
    const before = structuredClone(gs);
    const result = align(gs);
    expect(get(result.glyphs, 'a').baselineYInCell).toBe(182);
    expect(get(result.glyphs, 't').baselineYInCell).toBe(220);
    expect(result.adjustments.map((a) => a.shift)).toEqual([-18, 20]);
    expect(gs).toEqual(before);
    for (const c of ['a', 't']) {
      expect(get(result.glyphs, c).paths).toBe(get(gs, c).paths);
      expect(get(result.glyphs, c).cellH).toBe(300);
      expect(get(result.glyphs, c).cellW).toBe(70);
    }
  });

  it('puts rounded bottoms on the same baseline and is stable when rebuilt', () => {
    const gs = [...refs(), glyph('o', 98, 202), glyph('s', 98, 202), glyph('e', 98, 202)];
    for (const c of 'ose') expect(get(align(gs).glyphs, c).baselineYInCell).toBe(202);
    const shifted = [...gs, glyph('c', 118, 222)];
    const first = align(shifted);
    expect(get(first.glyphs, 'c').baselineYInCell).toBe(222);
    expect(align(first.glyphs as MeasuredGlyph[]).adjustments).toEqual([]);
  });

  it('corrects fractional-pixel drift that remains visible after scaling to font units', () => {
    const gs = [...refs().filter(g => !'dm'.includes(g.char)), glyph('d', 39.3, 199.3), glyph('m', 100.8, 200.8)];
    const result = align(gs);
    expect(get(result.glyphs, 'd').baselineYInCell).toBe(199.3);
    expect(get(result.glyphs, 'm').baselineYInCell).toBe(200.8);
    expect(get(result.glyphs, 'd').paths).toBe(get(gs, 'd').paths);
  });

  it('aligns descender bodies, including g with an ear above the bowl', () => {
    const gs = [...refs(), ...Array.from('gpqy', (c) => glyph(c, c === 'g' ? 95 : 115, 255, 115))];
    const result = align(gs);
    for (const c of 'gpqy') {
      expect(get(result.glyphs, c).baselineYInCell).toBe(215);
      expect(255 - get(result.glyphs, c).baselineYInCell).toBe(40);
    }
  });

  it('moves j with its dot, preserves f/Q descents and uses R bottom without a stem measurement', () => {
    const gs = [...refs(), glyph('i', 55, 200), glyph('j', 75, 270),
      glyph('f', 60, 250), glyph('Q', 65, 255), glyph('R', 65, 235)];
    const result = align(gs);
    expect(get(result.glyphs, 'j').baselineYInCell).toBe(220);
    expect(get(result.glyphs, 'f').baselineYInCell).toBe(220);
    expect(get(result.glyphs, 'Q').baselineYInCell).toBe(215);
    expect(get(result.glyphs, 'R').baselineYInCell).toBe(235);
  });

  it('levels an upright f that sits too low', () => {
    expect(get(align([...refs(), glyph('f', 45, 217)]).glyphs, 'f').baselineYInCell).toBe(217);
  });

  it('anchors R on its stem and preserves a descending leg without resizing', () => {
    const r = glyph('R', 65, 235);
    r.bounds.stemBottom = 215;
    const result = align([...refs(), r]);
    expect(get(result.glyphs, 'R').baselineYInCell).toBe(215);
    expect(get(result.glyphs, 'R').paths).toBe(r.paths);
    expect(align(result.glyphs as MeasuredGlyph[]).adjustments).toEqual([]);
  });

  it('keeps an ordinary R on the line and rejects unreliable stem measurements', () => {
    for (const stemBottom of [235, 234, 110, NaN]) {
      const r = glyph('R', 65, 235);
      r.bounds.stemBottom = stemBottom;
      expect(get(align([...refs(), r]).glyphs, 'R').baselineYInCell).toBe(235);
    }
  });

  it('snaps an upright J while retaining a descending J tail', () => {
    expect(get(align([...refs(), glyph('J', 50, 200.5)]).glyphs, 'J').baselineYInCell).toBe(200.5);
    expect(get(align([...refs(), glyph('J', 50, 240)]).glyphs, 'J').baselineYInCell).toBe(200);
  });

  it('preserves a capital swash and does not mistake a narrow g bowl for an ear', () => {
    const gs = [...refs(), glyph('A', 50, 230), glyph('g', 100, 270, 140)];
    expect(align(gs).adjustments).toEqual([]);
  });

  it('does not snap punctuation, unknown characters, invalid bounds or extreme outliers', () => {
    const gs = [...refs(), ...Array.from("_-'.,:;éΩ", (c) => glyph(c, 120, 140)),
      glyph('A', 0, 100), glyph('C', NaN, 210), glyph('D', 200, 200)];
    expect(align(gs).glyphs).toBe(gs);
  });

  it('does not invent reference heights for incomplete sheets', () => {
    const gs = [glyph('g', 100, 260), glyph('j', 60, 260), glyph('n', 80, 180)];
    expect(align(gs).glyphs).toBe(gs);
    const gs2 = [...refs().filter((g) => !'bdhkl'.includes(g.char)), glyph('f', 60, 250), glyph('j', 60, 260)];
    expect(align(gs2).adjustments).toEqual([]);
    expect(alignGlyphBaselines(refs(), () => null).adjustments).toEqual([]);
    expect(align([]).adjustments).toEqual([]);
  });

  it('uses a robust median when one reference letter is oversized', () => {
    const gs = [...refs().filter((g) => g.char !== 'H'), glyph('H', 0, 200), glyph('Q', 70, 260)];
    expect(get(align(gs).glyphs, 'Q').baselineYInCell).toBe(220);
  });

  it('levels each variation sheet independently and preserves variant metadata', () => {
    const gs = [...refs(), glyph('a', 120, 220)];
    const variants = gs.map((g) => ({ ...g, variantSuffix: '.cv01',
      baselineYInCell: 400, bounds: { top: g.bounds.top * 2, bottom: g.bounds.bottom * 2, bodyTop: g.bounds.bodyTop * 2 } }));
    const result = align([...gs, ...variants]);
    expect(get(result.glyphs, 'a').baselineYInCell).toBe(220);
    const va = result.glyphs.find((g) => g.char === 'a' && g.variantSuffix)!;
    expect(va.baselineYInCell).toBe(440);
    expect(va.variantSuffix).toBe('.cv01');
    expect(va.paths).toBe(variants.at(-1)!.paths);
  });
});
