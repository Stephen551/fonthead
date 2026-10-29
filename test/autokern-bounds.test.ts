import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const engine: any = {};
const vendor = (name: string) => readFileSync(join(__dirname, '..', 'public', 'assets', 'vendor', name), 'utf8');
new Function('self', 'opentype', vendor('font-engine-builder.js')).call(engine, engine, {});
new Function('self', 'estimateBBox', 'tokenizePath', vendor('font-engine-autokern.js'))
  .call(engine, engine, engine.estimateBBox, engine.tokenizePath);

function glyph(char: string, edge = 90, silhouetteRight = 98, variantSuffix?: string) {
  return { char, variantSuffix, paths: [`M10 0 L${edge} 0 L${edge} 100 L10 100 Z`],
    cellW: 100, cellH: 101, baselineYInCell: 100,
    _silhouette: { left: new Array(101).fill(10), right: new Array(101).fill(silhouetteRight), inkY0: 0, inkY1: 100 } };
}

describe('decorative kerning clearance', () => {
  it('lets flourishes at different heights interleave without changing outlines', () => {
    const l = glyph('l', 90, 70), p = glyph('p', 90, 70);
    l.paths = ['M10 0 H60 V80 H90 V100 H10 Z'];
    p.paths = ['M40 0 H90 V120 H10 V110 H40 Z'];
    const pairs = engine.analyzeAutoKern([l, p, ...[...'OHnu'].map(c => glyph(c))], 10, 1,
      { protectBounds: true, allLetters: true });
    expect(pairs.find((p: any) => p.leftChar === 'l' && p.rightChar === 'p').value).toBe(-250);
  });

  it('aligns protection to fractional baselines before comparing heights', () => {
    const l = glyph('l', 90, 70), p = glyph('p', 90, 70);
    l.paths = ['M10 0 H60 V80 H90 V100 H10 Z'];
    p.paths = ['M40 0 H90 V120 H10 V110 H40 Z'];
    l.baselineYInCell = 100.25; p.baselineYInCell = 120.25;
    const pairs = engine.analyzeAutoKern([l, p, ...[...'OHnu'].map(c => glyph(c))], 10, 1,
      { protectBounds: true, allLetters: true });
    expect(pairs.find((p: any) => p.leftChar === 'l' && p.rightChar === 'p').value).toBe(-180);
  });

  it('keeps a subpixel curved flourish that the cached raster misses', () => {
    const l = glyph('l', 90, 70), p = glyph('p', 90, 70);
    l.paths = ['M10 0 H60 V80.2 C60 80.2 90 80.2 90 80.3 Q90 80.4 60 80.4 V100 H10 Z'];
    const pairs = engine.analyzeAutoKern([l, p, ...[...'OHnu'].map(c => glyph(c))], 10, 1,
      { protectBounds: true, allLetters: true });
    expect(pairs.find((p: any) => p.leftChar === 'l' && p.rightChar === 'p').value).toBe(-180);
  });

  it('caps an over-optimistic raster pull at the complete outline envelope', () => {
    const glyphs = [glyph('W', 90, 70), ...[...'OHnu'].map(c => glyph(c))];
    const pull = (protectBounds: boolean) => engine.analyzeAutoKern(glyphs, 10, 1, { protectBounds })
      .find((p: any) => p.leftChar === 'W' && p.rightChar === 'O').value;
    expect(pull(false)).toBe(-250);
    expect(pull(true)).toBe(-180); // 20 source px daylight minus a 20-unit floor
  });

  it('protects the widest alternate when a character shares a kerning pair', () => {
    const glyphs = [glyph('W', 98, 70, '.cv01'), glyph('W', 90, 70), ...[...'OHnu'].map(c => glyph(c))];
    const pairs = engine.analyzeAutoKern(glyphs, 10, 1, { protectBounds: true });
    expect(pairs.find((p: any) => p.leftChar === 'W' && p.rightChar === 'O').value).toBe(-100);
  });
});
