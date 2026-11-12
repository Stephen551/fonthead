import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as fontkitNs from 'fontkit';
import { DEFAULT_CHAR_LINES } from '../src/lib/maker';
import { EXTENDED_LATIN_ROWS } from '../src/lib/charsets';
import { charsetCharacters } from '../src/lib/accents';

const fontkit: any = (fontkitNs as any).create ? fontkitNs : (fontkitNs as any).default;
const ROOT = join(__dirname, '..');

function loadEngine(): any {
  const sb: any = {};
  sb.self = sb;
  sb.window = sb;
  const ot = readFileSync(join(ROOT, 'public', 'assets', 'vendor', 'opentype.min.js'), 'utf-8');
  const c2q = readFileSync(join(ROOT, 'public', 'assets', 'vendor', 'cubic2quad.js'), 'utf-8');
  const enc = readFileSync(join(ROOT, 'public', 'assets', 'vendor', 'font-engine-glyf-encoder.js'), 'utf-8');
  const conv = readFileSync(join(ROOT, 'public', 'assets', 'vendor', 'font-engine-cff-to-tt.js'), 'utf-8');
  const builder = readFileSync(join(ROOT, 'public', 'assets', 'vendor', 'font-engine-builder.js'), 'utf-8');

  new Function('self', 'window', ot).call(sb, sb, sb);
  new Function('self', 'module', c2q).call(sb, sb, { exports: {} });
  new Function('self', 'window', 'opentype', enc).call(sb, sb, sb, sb.opentype);
  new Function('self', 'window', 'opentype', conv).call(sb, sb, sb, sb.opentype);
  new Function('self', 'window', 'opentype', builder).call(sb, sb, sb, sb.opentype);
  return sb;
}

const eng = loadEngine();

function makeTracedGlyphs(lines: string[]) {
  const seen = new Set<string>();
  const chars: string[] = [];
  for (const line of lines) {
    for (const ch of charsetCharacters(line)) {
      if (ch === ' ' || seen.has(ch)) continue;
      seen.add(ch);
      chars.push(ch);
    }
  }
  return chars.map((ch, idx) => {
    const right = 60 + (idx % 30);
    return {
      char: ch,
      italic: false,
      paths: [`M 20 10 L ${right} 10 L ${right} 80 L 20 80 Z`],
      cellW: 100,
      cellH: 120,
      baselineYInCell: 85,
    };
  });
}

function buildOtfAndTtf(lines: string[]) {
  const glyphs = makeTracedGlyphs(lines);
  const otfFont = eng.buildFontForStyle(glyphs, {
    unitsPerEm: 1000,
    familyName: 'AliasTest',
    styleName: 'Regular',
    useCellWidth: true,
    outlinesFormat: 'opentype',
  });
  const otfBytes = new Uint8Array(otfFont.toArrayBuffer());
  const conv = eng.convertCFFToTTF(otfBytes, {});
  expect(conv.status).toBe('converted');
  const fkOtf = fontkit.create(Buffer.from(otfBytes));
  const fkTtf = fontkit.create(Buffer.from(conv.bytes));
  return { fkOtf, fkTtf, glyphCount: glyphs.length };
}

describe('cmap punctuation/space aliases and .notdef contour', () => {
  it('maps curly apostrophes, NBSP and dashes to existing glyphs in default charset without duplicating outlines', () => {
    const { fkOtf, fkTtf, glyphCount } = buildOtfAndTtf(DEFAULT_CHAR_LINES);
    const aliases: Array<[number, number, string]> = [
      [0x2019, 0x0027, 'right single quote -> straight apostrophe'],
      [0x2018, 0x0027, 'left single quote -> straight apostrophe'],
      [0x00a0, 0x0020, 'NBSP -> space'],
      [0x2010, 0x002d, 'hyphen -> hyphen-minus'],
      [0x2011, 0x002d, 'non-breaking hyphen -> hyphen-minus'],
      [0x2013, 0x002d, 'en dash -> hyphen-minus'],
    ];

    for (const [label, fk] of [['OTF', fkOtf], ['TTF', fkTtf]] as const) {
      expect(fk.numGlyphs, `${label} numGlyphs (.notdef + space + traced glyphs)`).toBe(2 + glyphCount);
      for (const [aliasCp, srcCp, desc] of aliases) {
        expect(fk.hasGlyphForCodePoint(aliasCp), `${label} missing ${desc}`).toBe(true);
        const srcGid = fk.glyphForCodePoint(srcCp).id;
        const aliasGid = fk.glyphForCodePoint(aliasCp).id;
        expect(srcGid, `${label} ${desc} source gid`).toBeGreaterThan(0);
        expect(aliasGid, `${label} ${desc}`).toBe(srcGid);
      }
      // Curly double quotes stay unmapped unless explicitly drawn.
      expect(fk.hasGlyphForCodePoint(0x201c), `${label} should not alias U+201C`).toBe(false);
      expect(fk.hasGlyphForCodePoint(0x201d), `${label} should not alias U+201D`).toBe(false);
    }
  });

  it('preserves dedicated Extended Latin glyphs for U+2018, U+2019 and U+2013 without aliasing over them', () => {
    const { fkOtf, fkTtf } = buildOtfAndTtf([...DEFAULT_CHAR_LINES, ...EXTENDED_LATIN_ROWS]);
    for (const [label, fk] of [['OTF', fkOtf], ['TTF', fkTtf]] as const) {
      const straightQuote = fk.glyphForCodePoint(0x0027).id;
      const leftSingle = fk.glyphForCodePoint(0x2018).id;
      const rightSingle = fk.glyphForCodePoint(0x2019).id;
      const hyphenMinus = fk.glyphForCodePoint(0x002d).id;
      const enDash = fk.glyphForCodePoint(0x2013).id;

      expect(leftSingle, `${label} U+2018 distinct`).toBeGreaterThan(0);
      expect(leftSingle, `${label} U+2018 not aliased to '`).not.toBe(straightQuote);
      expect(rightSingle, `${label} U+2019 distinct`).toBeGreaterThan(0);
      expect(rightSingle, `${label} U+2019 not aliased to '`).not.toBe(straightQuote);
      expect(leftSingle).not.toBe(rightSingle);
      expect(enDash, `${label} U+2013 distinct`).toBeGreaterThan(0);
      expect(enDash, `${label} U+2013 not aliased to -`).not.toBe(hyphenMinus);

      // Code points absent from Extended Latin still alias to space and -.
      expect(fk.glyphForCodePoint(0x00a0).id, `${label} NBSP -> space`).toBe(fk.glyphForCodePoint(0x0020).id);
      expect(fk.glyphForCodePoint(0x2010).id, `${label} U+2010 -> -`).toBe(hyphenMinus);
      expect(fk.glyphForCodePoint(0x2011).id, `${label} U+2011 -> -`).toBe(hyphenMinus);
    }
  });

  it('gives .notdef a visible box contour in both OTF and TTF', () => {
    const { fkOtf, fkTtf } = buildOtfAndTtf(DEFAULT_CHAR_LINES);

    const otfNotdef = fkOtf.getGlyph(0);
    const otfCloses = otfNotdef.path.commands.filter((c: any) => c.command === 'closePath');
    expect(otfCloses.length).toBeGreaterThanOrEqual(1);
    expect(otfNotdef.bbox.width).toBeGreaterThan(0);
    expect(otfNotdef.bbox.height).toBeGreaterThan(0);

    const ttfNotdef = fkTtf.getGlyph(0);
    const decoded = ttfNotdef._decode();
    expect(decoded.numberOfContours).toBeGreaterThanOrEqual(1);
    expect(ttfNotdef.bbox.minX).toBeGreaterThanOrEqual(0);
    expect(ttfNotdef.bbox.maxX).toBeLessThanOrEqual(ttfNotdef.advanceWidth);
  });
});
