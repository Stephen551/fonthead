import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// Sandbox opentype.js + the builder IIFE. opentype's UMD attaches to `this`
// (e = this || self), so .call(sandbox, sandbox) exposes sandbox.opentype; the
// builder reads `opentype` as an injected param and exports onto `self`.
const ROOT = join(__dirname, '..');
function loadEngine(): any {
  const sb: any = {};
  const ot = readFileSync(join(ROOT, 'public', 'assets', 'vendor', 'opentype.min.js'), 'utf-8');
  const builder = readFileSync(join(ROOT, 'public', 'assets', 'vendor', 'font-engine-builder.js'), 'utf-8');
  new Function('self', ot).call(sb, sb);
  new Function('self', 'opentype', builder).call(sb, sb, sb.opentype);
  return sb;
}
const eng = loadEngine();

// Deterministic projection of the built glyphs — name, unicode, advance, and a
// rounded path-command string. No head/name timestamps, so it's stable across
// runs and is exactly the surface the makeOtGlyph extraction governs.
function glyphSnapshot(font: any) {
  const out: Array<Record<string, unknown>> = [];
  for (let i = 0; i < font.glyphs.length; i++) {
    const g = font.glyphs.get(i);
    const cmds = (g.path && g.path.commands ? g.path.commands : [])
      .map((c: any) =>
        c.type +
        ':' +
        [c.x, c.y, c.x1, c.y1, c.x2, c.y2]
          .filter((v: any) => v !== undefined)
          .map((v: number) => Math.round(v))
          .join(','),
      )
      .join(' ');
    out.push({ index: i, name: g.name, unicode: g.unicode, advanceWidth: g.advanceWidth, cmds });
  }
  return out;
}

const OPTS = { unitsPerEm: 1000, familyName: 'Test', styleName: 'Regular', useCellWidth: true, outlinesFormat: 'opentype' };
const A = { char: 'a', italic: false, paths: ['M100 100 L900 100 L900 900 L100 900 Z'], cellW: 1000, cellH: 1000, baselineYInCell: 900 };
const B = { char: 'b', italic: false, paths: ['M200 150 L800 150 L800 850 L200 850 Z'], cellW: 1000, cellH: 1000, baselineYInCell: 900 };

describe('builder variant glyphs', () => {
  it('appends each variant glyph after the bases, unicode-less, bases keep theirs', () => {
    const glyphs = [
      A,
      B,
      { ...A, variantSuffix: '.cv01' },
      { ...B, variantSuffix: '.cv01' },
      { ...A, variantSuffix: '.cv02' },
    ];
    const snap = glyphSnapshot(eng.buildFontForStyle(glyphs, OPTS));
    const byName = new Map(snap.map((s) => [s.name, s]));

    // Bases keep their codepoint.
    expect(byName.get('a')!.unicode).toBe('a'.codePointAt(0));
    expect(byName.get('b')!.unicode).toBe('b'.codePointAt(0));

    // Variants exist, carry NO unicode, and sit after every base glyph.
    const variantNames = ['a.cv01', 'b.cv01', 'a.cv02'];
    const maxBaseIndex = Math.max(byName.get('a')!.index as number, byName.get('b')!.index as number);
    for (const n of variantNames) {
      expect(byName.has(n), `missing variant ${n}`).toBe(true);
      expect(byName.get(n)!.unicode, `${n} must have no unicode`).toBeUndefined();
      expect(byName.get(n)!.index as number).toBeGreaterThan(maxBaseIndex);
    }
  });

  it('a build with no variants is byte-identical to today (snapshot guard)', () => {
    expect(glyphSnapshot(eng.buildFontForStyle([A, B], OPTS))).toMatchSnapshot();
  });

  it('keeps an aligned baseline through CFF serialization of fractional curves', () => {
    const curves = Array.from({ length: 20 }, (_, i) => {
      const x = i * 3, y = i * 0.12;
      return `C${x + 1} ${y + 0.04} ${x + 2} ${y + 0.08} ${x + 3} ${y + 0.12}`;
    }).join(' ');
    const g = { ...A, paths: [`M0 0 ${curves} L80 100 L0 100 Z`], cellW: 100, cellH: 110, baselineYInCell: 100 };
    const exportBottom = (quantizeY: boolean) => {
      const font = eng.buildFontForStyle([g], { ...OPTS, quantizeY });
      expect(font.charToGlyph('a').getBoundingBox().y1).toBeCloseTo(0, 6);
      return eng.opentype.parse(font.toArrayBuffer()).charToGlyph('a').getBoundingBox().y1;
    };
    expect(Math.abs(exportBottom(false)), 'fixture exposes accumulated rounding drift').toBeGreaterThan(3);
    expect(exportBottom(true)).toBe(0);
  });

  it('preserves fitted horizontal bounds through CFF serialization', () => {
    const curves = Array.from({ length: 20 }, (_, i) => {
      const x = 10 + i * 0.12, y = i * 3;
      return `C${x + 0.04} ${y + 1} ${x + 0.08} ${y + 2} ${x + 0.12} ${y + 3}`;
    }).join(' ');
    const g = { ...A, paths: [`M10 0 ${curves} L90 100 L10 100 Z`], cellW: 100, cellH: 110, baselineYInCell: 100 };
    const drift = (quantizeX: boolean) => {
      const font = eng.buildFontForStyle([g], { ...OPTS, quantizeX });
      const before = font.charToGlyph('a').getBoundingBox();
      const after = eng.opentype.parse(font.toArrayBuffer()).charToGlyph('a').getBoundingBox();
      return Math.max(Math.abs(before.x1 - after.x1), Math.abs(before.x2 - after.x2));
    };
    expect(drift(false), 'fixture exposes accumulated horizontal rounding drift').toBeGreaterThan(3);
    expect(drift(true)).toBe(0);
  });
});
