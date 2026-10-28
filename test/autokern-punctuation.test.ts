import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const engine: any = {};
const source = readFileSync(join(__dirname, '..', 'public/assets/vendor/font-engine-autokern.js'), 'utf8');
new Function('self', source).call(engine, engine);

function glyph(char: string, width: number, top: number, bottom: number, edge: (y: number) => number) {
  return { char, cellW: width, cellH: 111, baselineYInCell: 100,
    _silhouette: { inkY0: top, inkY1: bottom,
      left: Array.from({ length: 111 }, (_, y) => y >= top && y <= bottom ? 6 : Infinity),
      right: Array.from({ length: 111 }, (_, y) => y >= top && y <= bottom ? edge(y) : -Infinity) } };
}

const refs = () => [...'HEnox'].map(c => glyph(c, 100, 0, 100, () => 98));
const punct = (char: string) => glyph(char, 20, 90, 108, () => 14);
const analyze = (glyphs: any[], allLetters = true) => engine.analyzeAutoKern(glyphs, 10, 1, { allLetters });

describe('upright punctuation kerning', () => {
  it('tucks low punctuation toward a diagonal at its own height, including accented letters', () => {
    const pairs = analyze([...refs(), ...[...'VÝ'].map(c => glyph(c, 100, 0, 100, y => 90 - y * .45)),
      ...[...',.;:…'].map(punct)]);
    for (const l of 'VÝ') for (const r of ',.;:…') {
      expect(pairs.find((p: any) => p.leftChar === l && p.rightChar === r)?.value, l + r).toBe(-250);
    }
  });

  it('keeps the tightest shared ink row clear, even when the rest of the diagonal is open', () => {
    const pairs = analyze([...refs(), glyph('V', 100, 0, 100, y => y === 95 ? 98 : 90 - y * .45), punct(',')]);
    const pull = pairs.find((p: any) => p.leftChar === 'V' && p.rightChar === ',')?.value;
    expect(pull).toBe(-40); // 8px at the protruding row, retaining the 4px target gap.
  });

  it('does not change script candidates or invent a pull without overlapping ink heights', () => {
    const gs = [...refs(), glyph('V', 100, 0, 100, y => 90 - y * .45), punct(',')];
    expect(analyze(gs, false).some((p: any) => p.rightChar === ',')).toBe(false);
    gs[gs.length - 1] = glyph(',', 20, 105, 110, () => 14);
    expect(analyze(gs).some((p: any) => p.rightChar === ',')).toBe(false);
  });
});
