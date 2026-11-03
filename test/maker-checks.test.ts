import { describe, expect, it } from 'vitest';
import { mappingProblems, spacingProblems } from '../src/lib/maker-checks';
import { inspectBuiltFont } from '../src/lib/maker';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const engine: any = {};
const load = (name: string) => readFileSync(join(__dirname, '..', 'public', 'assets', 'vendor', name), 'utf8');
new Function('self', load('opentype.min.js')).call(engine, engine);
new Function('self', 'opentype', load('font-engine-builder.js')).call(engine, engine, engine.opentype);
(window as any).opentype = engine.opentype;

describe('mapping checks', () => {
  it('blocks unassigned cells, repeated keys, spaces, and mismatched rows', () => {
    expect(mappingProblems(['ABCD', 'EF□'])).toContain('Replace each □ with the character shown in that cell.');
    expect(mappingProblems(['ABC', 'CDE']).join()).toMatch(/Repeated: C/);
    expect(mappingProblems(['A B']).join()).toMatch(/spaces/);
    expect(mappingProblems(['ABC'], 2).join()).toMatch(/2 detected rows/);
  });
  it('accepts a correctly mapped compact alphabet and punctuation', () => {
    expect(mappingProblems(['ABCD', 'EFGH', 'IJKL', 'MNOP', 'QRST', 'UVWX', 'YZ!'], 7)).toEqual([]);
    expect(mappingProblems(['ABC', 'abc', '012'])).toEqual([]);
  });
});

describe('compiled spacing checks', () => {
  it('checks the actual serialized widths and missing mapped characters', () => {
    const bytes = new Uint8Array(engine.buildFontForStyle([
      { char: 'T', paths: ['M0 0 L600 0 L600 700 L0 700 Z'], cellW: 238, cellH: 800, baselineYInCell: 700 },
    ], { familyName: 'Too Narrow', styleName: 'Regular', unitsPerEm: 1000, useCellWidth: true }).toArrayBuffer());
    expect(inspectBuiltFont(bytes, ['TE'])).toEqual({ missing: ['E'], spacing: ['T'] });
    expect(inspectBuiltFont(bytes, ['TE'], true, ['E'])).toEqual({ missing: [], spacing: [] });
  });
  it('catches Handmade’s original T metrics', () => {
    expect(spacingProblems([{ char: 'T', advance: 238, left: -159, right: 444 }], 1000)).toEqual(['T']);
  });
  it('catches outlines displaced far outside an otherwise reasonable advance', () => {
    expect(spacingProblems([{ char: 'A', advance: 500, left: 900, right: 1300 }], 1000)).toEqual(['A']);
  });
  it('accepts repaired bearings and ordinary optical overhang', () => {
    expect(spacingProblems([
      { char: 'T', advance: 639, left: 18, right: 621 },
      { char: 'A', advance: 500, left: -12, right: 512 },
    ], 1000)).toEqual([]);
  });
  it('preserves intentional script overlap without permitting invalid advances', () => {
    expect(spacingProblems([{ char: 'f', advance: 238, left: -159, right: 444 }], 1000, true)).toEqual([]);
    expect(spacingProblems([{ char: 'f', advance: 0, left: 0, right: 444 }], 1000, true)).toEqual(['f']);
  });
});
