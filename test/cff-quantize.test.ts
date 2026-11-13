import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildFont, type Glyph } from '../src/lib/maker';

const ROOT = join(__dirname, '..');

function loadEngine(): any {
  const sb: any = {};
  sb.self = sb;
  sb.window = sb;
  for (const f of [
    'opentype.min.js',
    'font-engine-tables.js',
    'font-engine-gpos.js',
    'font-engine-gsub.js',
    'font-engine-features.js',
    'font-engine-builder.js',
  ]) {
    const src = readFileSync(join(ROOT, 'public', 'assets', 'vendor', f), 'utf-8');
    if (f === 'opentype.min.js') {
      new Function('self', 'window', src).call(sb, sb, sb);
    } else {
      new Function('self', 'window', 'opentype', src).call(sb, sb, sb, sb.opentype);
    }
  }
  return sb;
}

const eng = loadEngine();

function makeWaveGlyph(char: string, cellW = 517.33, xStart = 40.37): Glyph {
  // 60 cubic segments with fractional (.37 / .43) steps so unquantized relative
  // CFF deltas accumulate several font units of drift along the contour.
  const segs: string[] = [`M ${xStart.toFixed(2)} 680.37`];
  let x = xStart;
  let y = 680.37;
  for (let i = 0; i < 60; i++) {
    const nx = x + 6.41;
    const ny = i < 30 ? y - 15.37 : y - 4.37;
    segs.push(
      `C ${(x + 2.13).toFixed(2)} ${(y - 4.13).toFixed(2)} ${(nx - 2.13).toFixed(2)} ${(ny + 2.13).toFixed(2)} ${nx.toFixed(2)} ${ny.toFixed(2)}`,
    );
    x = nx;
    y = ny;
  }
  segs.push(`L ${x.toFixed(2)} 700.37 L ${xStart.toFixed(2)} 700.37 Z`);
  return {
    char,
    italic: false,
    paths: [segs.join(' ')],
    cellW,
    cellH: 900,
    baselineYInCell: 720,
  };
}

function coordsOf(commands: Array<{ type: string; x?: number; y?: number; x1?: number; y1?: number; x2?: number; y2?: number }>) {
  const pts: Array<[number, number]> = [];
  for (const c of commands) {
    if (c.x1 !== undefined && c.y1 !== undefined) pts.push([c.x1, c.y1]);
    if (c.x2 !== undefined && c.y2 !== undefined) pts.push([c.x2, c.y2]);
    if (c.x !== undefined && c.y !== undefined) pts.push([c.x, c.y]);
  }
  return pts;
}

describe('CFF coordinate quantization across build modes', () => {
  const origWorker = globalThis.Worker;
  const w = window as any;
  const origOt = w.opentype;
  const origSvg = w.svgPathToOpentypePath;
  const origEst = w.estimateBBox;
  const origMgb = w.measureGlyphBounds;
  const captured: Array<{ payload: any; preFont: any }> = [];

  class StubWorker {
    private listeners = new Map<string, Array<(e: any) => void>>();
    addEventListener(type: string, fn: (e: any) => void) {
      if (!this.listeners.has(type)) this.listeners.set(type, []);
      this.listeners.get(type)!.push(fn);
    }
    postMessage(msg: { id: number; type: string; payload: any }) {
      const p = msg.payload;
      const preFont = eng.buildFontForStyle(p.glyphs, {
        familyName: p.family,
        styleName: p.style,
        unitsPerEm: p.upm,
        useCellWidth: p.useCellWidth,
        tightAdvance: p.tightAdvance,
        sideBearingPct: p.sideBearingPct,
        outlinesFormat: 'cff',
        features: p.features,
        isItalic: /italic/i.test(p.style || ''),
        spaceAdvance: p.spaceAdvance,
        quantizeY: p.quantizeY,
        quantizeX: p.quantizeX,
      });
      captured.push({ payload: p, preFont });
      const raw = new Uint8Array(preFont.toArrayBuffer());
      const otf = eng.injectCustomTables(raw, preFont._customTables);
      queueMicrotask(() => {
        for (const fn of this.listeners.get('message') ?? []) {
          fn({ data: { id: msg.id, type: 'result', payload: { otf } } });
        }
      });
    }
  }

  beforeEach(() => {
    captured.length = 0;
    w.opentype = eng.opentype;
    w.svgPathToOpentypePath = eng.svgPathToOpentypePath;
    w.estimateBBox = eng.estimateBBox;
    w.measureGlyphBounds = eng.measureGlyphBounds;
    (globalThis as any).Worker = StubWorker;
  });

  afterAll(() => {
    globalThis.Worker = origWorker;
    w.opentype = origOt;
    w.svgPathToOpentypePath = origSvg;
    w.estimateBBox = origEst;
    w.measureGlyphBounds = origMgb;
  });

  function verifyQuantized(otf: Uint8Array, preFont: any, chars: string[]) {
    const parsed = eng.opentype.parse(
      otf.buffer.slice(otf.byteOffset, otf.byteOffset + otf.byteLength),
    );
    for (const ch of chars) {
      const sentGlyph = preFont.charToGlyph(ch);
      const parsedGlyph = parsed.charToGlyph(ch);
      const sentPts = coordsOf(sentGlyph.path.commands);
      const parsedPts = coordsOf(parsedGlyph.path.commands);
      expect(parsedPts.length).toBeGreaterThan(100);
      expect(parsedPts.length).toBe(sentPts.length);
      for (let i = 0; i < sentPts.length; i++) {
        expect(Number.isInteger(sentPts[i][0])).toBe(true);
        expect(Number.isInteger(sentPts[i][1])).toBe(true);
        expect(Number.isInteger(parsedPts[i][0])).toBe(true);
        expect(Number.isInteger(parsedPts[i][1])).toBe(true);
        expect(parsedPts[i][0]).toBe(sentPts[i][0]);
        expect(parsedPts[i][1]).toBe(sentPts[i][1]);
      }
    }
  }

  it('keeps X and Y unrounded before CFF export for connected cursive builds', async () => {
    const glyphs: Glyph[] = [
      makeWaveGlyph('a'),
      makeWaveGlyph('n'),
      makeWaveGlyph('o'),
      makeWaveGlyph('x'),
    ];

    const res = await buildFont(glyphs, {
      family: 'ConnectedUnquant',
      connect: true,
      formats: ['otf'],
    });

    expect(res.otf).toBeDefined();
    expect(captured.length).toBeGreaterThanOrEqual(1);
    for (const entry of captured) {
      expect(entry.payload.quantizeX).toBe(false);
      expect(entry.payload.quantizeY).toBe(false);
    }
    const { preFont } = captured[captured.length - 1];
    for (const ch of ['a', 'n', 'o', 'x']) {
      const sentPts = coordsOf(preFont.charToGlyph(ch).path.commands);
      expect(sentPts.length).toBeGreaterThan(100);
      expect(sentPts.some(([x]) => !Number.isInteger(x))).toBe(true);
      expect(sentPts.some(([, y]) => !Number.isInteger(y))).toBe(true);
    }
  });

  it('rounds both X and Y before CFF export for flourish-trimmed upright builds', async () => {
    const glyphs: Glyph[] = [
      makeWaveGlyph('a'),
      makeWaveGlyph('H'),
      makeWaveGlyph('x'),
    ];

    const res = await buildFont(glyphs, {
      family: 'TrimQuant',
      trimFlourishes: true,
      formats: ['otf'],
    });

    expect(res.otf).toBeDefined();
    expect(captured.length).toBeGreaterThanOrEqual(1);
    const { payload, preFont } = captured[captured.length - 1];
    verifyQuantized(res.otf!, preFont, ['a', 'H', 'x']);
    expect(payload.quantizeX).toBe(true);
    expect(payload.quantizeY).toBe(true);
  });
});
