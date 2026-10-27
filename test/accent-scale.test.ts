import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// ADR 0072: accented glyphs never set the font scale. Adding É must not shrink
// the plain alphabet; the ascender grows to cover the accent instead.
const vendor = (f: string) => readFileSync(join(__dirname, '../public/assets/vendor', f), 'utf8');
const engine: any = {};
new Function('self', vendor('opentype.min.js')).call(engine, engine);
new Function('self', 'opentype', vendor('font-engine-builder.js')).call(engine, engine, engine.opentype);
const g = engine;
new Function('self', 'opentype', 'estimateBBox', 'measureGlyphBounds', 'svgPathToOpentypePath', 'glyphName', 'sanitizePostScriptName', vendor('font-engine-color-build.js'))
  .call(engine, engine, engine.opentype, g.estimateBBox, g.measureGlyphBounds, g.svgPathToOpentypePath, g.glyphName, g.sanitizePostScriptName);

const rect = (x0: number, y0: number, x1: number, y1: number) => `M${x0} ${y0}L${x1} ${y0}L${x1} ${y1}L${x0} ${y1}Z`;
// Cell coordinates, y down, baseline at 300. Caps 200px tall; the acute rises 70px higher.
const glyph = (char: string, paths: string[]) => ({ char, italic: false, paths, cellW: 200, cellH: 400, baselineYInCell: 300 });
const ASCII = [glyph('H', [rect(20, 100, 180, 300)]), glyph('x', [rect(20, 170, 180, 300)])];
const ACCENTED = [glyph('Á', [rect(20, 100, 180, 300), rect(80, 30, 120, 80)]), glyph('É', [rect(20, 100, 180, 300), rect(80, 30, 120, 80)])];
const OPTS = { unitsPerEm: 1000, familyName: 'T', styleName: 'Regular', tightAdvance: true, outlinesFormat: 'opentype' };
const yMax = (font: any, ch: string) => font.charToGlyph(ch).getBoundingBox().y2;

describe('accented glyphs and the font scale', () => {
  it('keeps H the same height with and without accented capitals', () => {
    const plain = engine.buildFontForStyle(ASCII, OPTS);
    const mixed = engine.buildFontForStyle([...ASCII, ...ACCENTED], OPTS);
    expect(yMax(plain, 'H')).toBe(800);
    expect(yMax(mixed, 'H')).toBe(yMax(plain, 'H'));
    expect(yMax(mixed, 'x')).toBe(yMax(plain, 'x'));
  });

  it('grows the ascender to cover the accent so nothing clips', () => {
    const mixed = engine.buildFontForStyle([...ASCII, ...ACCENTED], OPTS);
    expect(yMax(mixed, 'Á')).toBe(1080);
    expect(mixed.ascender).toBeGreaterThanOrEqual(yMax(mixed, 'Á'));
    expect(engine.buildFontForStyle(ASCII, OPTS).ascender).toBe(800);
  });

  it('falls back to the tallest ink for an accent-only font', () => {
    const only = engine.buildFontForStyle(ACCENTED, OPTS);
    expect(yMax(only, 'Á')).toBe(800);
    expect(only.ascender).toBe(800);
  });

  it('applies the same reference in flat and gradient color builds', () => {
    const color = (char: string, paths: string[]) => ({ char, baseD: paths.join(' '), layers: [], cellW: 200, cellH: 400, baselineYInCell: 300 });
    const plain = [color('H', [rect(20, 100, 180, 300)])];
    const mixed = [...plain, color('Á', [rect(20, 100, 180, 300), rect(80, 30, 120, 80)])];
    const palette = { colors: [{ r: 0, g: 0, b: 0 }] };
    const stops = [{ offset: 0, r: 0, g: 0, b: 255 }, { offset: 1, r: 255, g: 0, b: 0 }];
    const builds = [
      (c: any[]) => engine.buildColorFont(c, palette, { unitsPerEm: 1000, familyName: 'C' }),
      (c: any[]) => engine.buildGradientFont(c, stops, { unitsPerEm: 1000, familyName: 'C' }),
    ];
    for (const build of builds) {
      const a = build(plain), b = build(mixed);
      const fa = a.font ?? a, fb = b.font ?? b;
      expect(yMax(fb, 'H')).toBe(yMax(fa, 'H'));
      expect(fb.ascender).toBeGreaterThanOrEqual(yMax(fb, 'Á'));
    }
  });
});
