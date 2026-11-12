import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as fontkitNs from 'fontkit';
import { verifySfntChecksums } from '../src/lib/sfnt';

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

function splitContours(points: Array<{ x: number; y: number; endContour?: boolean }>) {
  const contours: Array<Array<{ x: number; y: number }>> = [];
  let cur: Array<{ x: number; y: number }> = [];
  for (const p of points) {
    cur.push({ x: p.x, y: p.y });
    if (p.endContour) {
      contours.push(cur);
      cur = [];
    }
  }
  if (cur.length) contours.push(cur);
  return contours;
}

function signedArea(pts: Array<{ x: number; y: number }>) {
  let sum = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    sum += a.x * b.y - b.x * a.y;
  }
  return sum / 2;
}

describe('TTF export side bearings, bboxes and winding', () => {
  it('writes correct hmtx lsb, glyf/head/hhea bboxes, matching advances, and TrueType contour winding', () => {
    const glyphs = [
      // (a) Ink starting at x = 100; CCW in Y-up: (100,800)->(100,0)->(400,0)->(400,800)
      {
        char: 'A',
        italic: false,
        paths: ['M 100 0 L 100 800 L 400 800 L 400 0 Z'],
        cellW: 500,
        cellH: 900,
        baselineYInCell: 800,
      },
      // (b) Ink starting at x = -80 (entry tail) with a cubic curve whose CFF control points
      //     extend slightly past the on-curve extrema to test glyf bbox vs cubic getBoundingBox.
      {
        char: 'a',
        italic: false,
        paths: ['M -80 500 L -80 800 L 260 800 C 340 700 340 400 260 300 L -80 300 Z'],
        cellW: 320,
        cellH: 900,
        baselineYInCell: 800,
      },
      // (c) Ring with hole: outer CCW in Y-up, inner CW in Y-up
      {
        char: 'O',
        italic: false,
        paths: [
          'M 60 100 L 60 700 L 540 700 L 540 100 Z',
          'M 160 200 L 440 200 L 440 600 L 160 600 Z',
        ],
        cellW: 600,
        cellH: 900,
        baselineYInCell: 800,
      },
    ];

    const otfFont = eng.buildFontForStyle(glyphs, {
      familyName: 'MetricsTest',
      styleName: 'Regular',
      unitsPerEm: 1000,
      useCellWidth: true,
      tightAdvance: false,
      outlinesFormat: 'cff',
      quantizeX: true,
      quantizeY: true,
    });

    const otfBytes = new Uint8Array(otfFont.toArrayBuffer());
    const conv = eng.convertCFFToTTF(otfBytes);
    expect(conv.status).toBe('converted');
    expect(verifySfntChecksums(conv.bytes).ok).toBe(true);

    const fkOtf = fontkit.create(Buffer.from(otfBytes));
    const fkTtf = fontkit.create(Buffer.from(conv.bytes));

    expect(fkTtf.numGlyphs).toBe(fkOtf.numGlyphs);

    // Advance widths match OTF for every glyph
    for (let i = 0; i < fkTtf.numGlyphs; i++) {
      expect(fkTtf.getGlyph(i).advanceWidth).toBe(fkOtf.getGlyph(i).advanceWidth);
    }

    const gA = fkTtf.glyphForCodePoint('A'.codePointAt(0));
    const ga = fkTtf.glyphForCodePoint('a'.codePointAt(0));
    const gO = fkTtf.glyphForCodePoint('O'.codePointAt(0));

    // Each glyph's hmtx lsb equals its glyf xMin (100 and -80, not 0)
    expect(gA._getMetrics().leftBearing).toBe(100);
    expect(gA._decode().xMin).toBe(100);

    expect(ga._getMetrics().leftBearing).toBe(-80);
    expect(ga._decode().xMin).toBe(-80);

    expect(gO._getMetrics().leftBearing).toBe(60);
    expect(gO._decode().xMin).toBe(60);

    // Every non-empty glyph has hmtx lsb == glyf.xMin and glyf bbox == decoded points bbox
    let uXMin = Infinity;
    let uYMin = Infinity;
    let uXMax = -Infinity;
    let uYMax = -Infinity;
    for (let i = 0; i < fkTtf.numGlyphs; i++) {
      const g = fkTtf.getGlyph(i);
      const dec = g._decode();
      const lsb = g._getMetrics().leftBearing;
      if (!dec || !dec.points || dec.points.length === 0) {
        expect(lsb).toBe(0);
        continue;
      }
      expect(lsb).toBe(dec.xMin);
      let pxMin = Infinity;
      let pyMin = Infinity;
      let pxMax = -Infinity;
      let pyMax = -Infinity;
      for (const p of dec.points) {
        if (p.x < pxMin) pxMin = p.x;
        if (p.y < pyMin) pyMin = p.y;
        if (p.x > pxMax) pxMax = p.x;
        if (p.y > pyMax) pyMax = p.y;
      }
      expect({ xMin: dec.xMin, yMin: dec.yMin, xMax: dec.xMax, yMax: dec.yMax }).toEqual({
        xMin: pxMin,
        yMin: pyMin,
        xMax: pxMax,
        yMax: pyMax,
      });
      if (dec.xMin < uXMin) uXMin = dec.xMin;
      if (dec.yMin < uYMin) uYMin = dec.yMin;
      if (dec.xMax > uXMax) uXMax = dec.xMax;
      if (dec.yMax > uYMax) uYMax = dec.yMax;
    }

    // Ring winding: outer contour CW (negative signed area in Y-up), hole CCW (positive signed area)
    const oDec = gO._decode();
    const oContours = splitContours(oDec.points);
    expect(oContours).toHaveLength(2);
    expect(signedArea(oContours[0])).toBeLessThan(0);
    expect(signedArea(oContours[1])).toBeGreaterThan(0);

    // head bbox covers every glyph and matches union; hhea minLeftSideBearing is -80
    expect(fkTtf.head.xMin).toBeLessThanOrEqual(uXMin);
    expect(fkTtf.head.yMin).toBeLessThanOrEqual(uYMin);
    expect(fkTtf.head.xMax).toBeGreaterThanOrEqual(uXMax);
    expect(fkTtf.head.yMax).toBeGreaterThanOrEqual(uYMax);
    expect({ xMin: fkTtf.head.xMin, yMin: fkTtf.head.yMin, xMax: fkTtf.head.xMax, yMax: fkTtf.head.yMax }).toEqual({
      xMin: uXMin,
      yMin: uYMin,
      xMax: uXMax,
      yMax: uYMax,
    });
    expect(fkTtf.hhea.minLeftSideBearing).toBe(-80);
  });
});
