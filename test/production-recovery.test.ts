import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import vm from 'node:vm';
import { fixSfntChecksums, verifySfntChecksums } from '../src/lib/sfnt';
import {
  cullForeignTopTails,
  filterFilledGlyphPaths,
  looksLikeRowFragmentation,
  matchesExtendedLatinLayout,
  matchVariantSheetScale,
  reconcileRowBands,
  splitBandsAtValleys,
  type Glyph,
} from '../src/lib/maker';

const ROOT = join(__dirname, '..');

function loadWorkerEngine(): any {
  const ctx: any = {
    console,
    Math,
    Uint8Array,
    Uint16Array,
    Uint32Array,
    Int8Array,
    Int16Array,
    Int32Array,
    Float32Array,
    Float64Array,
    ArrayBuffer,
    DataView,
    module: { exports: {} },
  };
  ctx.self = ctx;
  ctx.window = ctx;
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  for (const f of [
    'opentype.min.js',
    'cubic2quad.js',
    'font-engine-builder.js',
    'font-engine-features.js',
    'font-engine-autokern.js',
    'font-engine-gpos.js',
    'font-engine-gsub.js',
    'font-engine-tables.js',
    'font-engine-glyf-encoder.js',
    'font-engine-glyf-parser.js',
    'font-engine-cff-to-tt.js',
    'font-engine-validate.js',
  ]) {
    vm.runInContext(readFileSync(join(ROOT, 'public', 'assets', 'vendor', f), 'utf-8'), ctx, { filename: f });
  }
  return ctx;
}

function loadTracerCore(): any {
  const ctx: any = {
    console,
    Math,
    Uint8Array,
    Uint8ClampedArray,
    Uint32Array,
    Int32Array,
    Float32Array,
    Float64Array,
  };
  ctx.window = ctx;
  ctx.self = ctx;
  vm.createContext(ctx);
  vm.runInContext(readFileSync(join(ROOT, 'public', 'assets', 'tracer-core.js'), 'utf-8'), ctx, {
    filename: 'tracer-core.js',
  });
  return ctx.TracerCore;
}

const eng = loadWorkerEngine();
const TracerCore = loadTracerCore();

beforeAll(() => {
  (window as unknown as Record<string, unknown>).estimateBBox = eng.estimateBBox;
});

const STANDARD_ASCII_ROWS = [
  'ABCDEFGHIJKLM',
  'NOPQRSTUVWXYZ',
  'abcdefghijklm',
  'nopqrstuvwxyz',
  '0123456789',
  '!?@#$%^&*()-_+=[];',
  '{}\':",.<>/\\|',
];

describe('Cluster A: stack-safe OpenType serialization on extreme contour counts', () => {
  it('compiles OTF and TTF for a 15,000-cubic-segment noisy glyph (>90k charstring bytes) without stack overflow', () => {
    const segs: string[] = ['M 40 40'];
    for (let i = 0; i < 15_000; i++) {
      const x = 40 + ((i * 7) % 820);
      const y = 40 + ((i * 11) % 820);
      segs.push(`C ${x + 1} ${y + 2} ${x + 3} ${y - 1} ${x + 4} ${y + 1}`);
    }
    segs.push('Z');
    const noisyA: Glyph = {
      char: 'A',
      italic: false,
      paths: [segs.join(' ')],
      cellW: 900,
      cellH: 1884,
      baselineYInCell: 1500,
    };
    const cleanB: Glyph = {
      char: 'B',
      italic: false,
      paths: ['M 120 120 L 720 120 L 720 1500 L 120 1500 Z'],
      cellW: 900,
      cellH: 1884,
      baselineYInCell: 1500,
    };

    const font = eng.buildFontForStyle([noisyA, cleanB], {
      unitsPerEm: 1000,
      familyName: 'CameraStress',
      styleName: 'Regular',
      useCellWidth: true,
      outlinesFormat: 'cff',
      features: { autoKern: true },
    });
    const otfRaw = new Uint8Array(font.toArrayBuffer());
    const otf = fixSfntChecksums(eng.injectCustomTables(otfRaw, font._customTables || {}));
    expect(verifySfntChecksums(otf).ok).toBe(true);
    expect(eng.validateFont(otf).ok).toBe(true);

    const parsedOtf = eng.opentype.parse(otf.buffer.slice(otf.byteOffset, otf.byteOffset + otf.byteLength));
    expect(parsedOtf.charToGlyph('A').path.commands.length).toBeGreaterThan(15_000);

    const conv = eng.convertCFFToTTF(otf, {});
    expect(conv.status).toBe('converted');
    const ttf = fixSfntChecksums(eng.injectCustomTables(conv.bytes, font._customTables || {}));
    expect(verifySfntChecksums(ttf).ok).toBe(true);
    expect(eng.validateFont(ttf).ok).toBe(true);
    const parsedTtf = eng.opentype.parse(ttf.buffer.slice(ttf.byteOffset, ttf.byteOffset + ttf.byteLength));
    expect(parsedTtf.charToGlyph('A').path.commands.length).toBeGreaterThan(12_000);
  }, 30_000);
});

describe('Cluster A: camera illumination normalization and tabletop border stripping', () => {
  it('recovers all 6 rows on an unevenly-lit camera photo with dark tabletop edges', () => {
    const w = 900;
    const h = 720;
    const raw = new Uint8ClampedArray(w * h * 4);

    const paperAt = (x: number, y: number) => {
      // Top-left bright (236) -> bottom-right deep shadow (106, below global 128 threshold!)
      const tx = x / (w - 1);
      const ty = y / (h - 1);
      return Math.round(236 - 65 * tx - 65 * ty);
    };

    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        let lum: number;
        // Dark desk edges on left & right spanning 100% of height (previously bridged all rows into 1!)
        if (x < 28 || x >= w - 28) {
          lum = 32;
        } else {
          const p = paperAt(x, y);
          // Faint #c9c9c9-equivalent template grid lines at ~79% of local paper luminance
          const isGrid = x % 70 === 0 || y % 110 === 45;
          lum = isGrid ? Math.round(p * 0.79) : p;
        }
        const idx = (y * w + x) * 4;
        raw[idx] = lum;
        raw[idx + 1] = lum;
        raw[idx + 2] = lum;
        raw[idx + 3] = 255;
      }
    }

    // Draw 6 clean rows of dark ink strokes inside the paper area
    for (let row = 0; row < 6; row++) {
      const yTop = 52 + row * 108;
      const yBot = yTop + 56;
      for (let cell = 0; cell < 10; cell++) {
        const xLeft = 68 + cell * 76;
        for (let y = yTop; y < yBot; y++) {
          for (let x = xLeft; x < xLeft + 26; x++) {
            const idx = (y * w + x) * 4;
            raw[idx] = 20;
            raw[idx + 1] = 20;
            raw[idx + 2] = 20;
          }
        }
      }
    }

    // Prove naïve global threshold collapses this exact image to 1 single mega-row
    const naive = new Uint8ClampedArray(raw);
    for (let i = 0; i < naive.length; i += 4) {
      const v = naive[i] < 128 ? 0 : 255;
      naive[i] = naive[i + 1] = naive[i + 2] = v;
    }
    expect(TracerCore.detectRowsInBinary(naive, w, h)).toHaveLength(1);

    // Now run TracerCore.binarizeRgbaInPlace and verify all 6 rows separate cleanly
    const fixed = new Uint8ClampedArray(raw);
    const meta = TracerCore.binarizeRgbaInPlace(fixed, w, h, 128, false, 0);
    expect(meta.illuminated).toBe(true);
    expect(meta.autoInverted).toBe(false);
    const bands = TracerCore.detectRowsInBinary(fixed, w, h);
    expect(bands).toHaveLength(6);
    for (let r = 0; r < 6; r++) {
      expect(bands[r][0]).toBeGreaterThanOrEqual(48 + r * 108);
      expect(bands[r][1]).toBeLessThanOrEqual(114 + r * 108);
    }
  });

  it('auto-inverts an unmistakable white-on-black sheet when invert is left off', () => {
    const w = 600;
    const h = 480;
    const data = new Uint8ClampedArray(w * h * 4);
    for (let i = 0; i < data.length; i += 4) {
      data[i] = data[i + 1] = data[i + 2] = 20;
      data[i + 3] = 255;
    }
    for (let row = 0; row < 6; row++) {
      const y0 = 30 + row * 72;
      for (let col = 0; col < 8; col++) {
        const x0 = 45 + col * 64;
        for (let y = y0; y < y0 + 40; y++) {
          for (let x = x0; x < x0 + 22; x++) {
            const idx = (y * w + x) * 4;
            data[idx] = data[idx + 1] = data[idx + 2] = 238;
          }
        }
      }
    }
    const meta = TracerCore.binarizeRgbaInPlace(data, w, h, 128, false, 0);
    expect(meta.autoInverted).toBe(true);
    expect(TracerCore.detectRowsInBinary(data, w, h)).toHaveLength(6);
  });

  it('bypasses illumination normalization on clean digital white sheets', () => {
    const w = 400;
    const h = 300;
    const data = new Uint8ClampedArray(w * h * 4).fill(255);
    // #c9c9c9 template border (201) + crisp black glyph (0)
    for (let x = 20; x < 380; x++) {
      const idx = (40 * w + x) * 4;
      data[idx] = data[idx + 1] = data[idx + 2] = 201;
    }
    for (let y = 80; y < 160; y++) {
      for (let x = 100; x < 140; x++) {
        const idx = (y * w + x) * 4;
        data[idx] = data[idx + 1] = data[idx + 2] = 0;
      }
    }
    const meta = TracerCore.binarizeRgbaInPlace(data, w, h, 128, false, 0);
    expect(meta.illuminated).toBe(false);
    expect(meta.autoInverted).toBe(false);
    expect(data[(40 * w + 100) * 4]).toBe(255); // #c9c9c9 dropped cleanly
    expect(data[(100 * w + 120) * 4]).toBe(0); // glyph preserved
  });
});

describe('Cluster A: compound subpath speckle storm culling', () => {
  it('filters tiny upper-zone camera specks in filterFilledGlyphPaths while keeping real i/j tittles', () => {
    const rowH = 1478;
    const baseline = 1150;
    const bodyD = 'M 100 400 L 240 400 L 240 1150 L 100 1150 Z';
    const realTittleD = 'M 140 240 L 195 240 L 195 295 L 140 295 Z';
    const tinySpeckD = 'M 20 120 L 23 120 L 23 123 L 20 123 Z';
    const out = filterFilledGlyphPaths([bodyD, realTittleD, tinySpeckD], rowH, baseline).map((p) => p.d);
    expect(out).toContain(bodyD);
    expect(out).toContain(realTittleD);
    expect(out).not.toContain(tinySpeckD);
  });

  it('caps a 500-subpath Potrace compound speckle storm while preserving body + counter hole', () => {
    const cellH = 1200;
    const subs: string[] = [
      // Outer letter body + inner counter hole
      'M 200 200 L 700 200 L 700 1000 L 200 1000 Z',
      'M 320 360 L 580 360 L 580 840 L 320 840 Z',
    ];
    // 500 paper-grain specks scattered across the middle of the cell
    for (let i = 0; i < 500; i++) {
      const x = 20 + ((i * 19) % 850);
      const y = 250 + ((i * 13) % 700);
      subs.push(`M ${x} ${y} L ${x + 2} ${y} L ${x + 2} ${y + 2} L ${x} ${y + 2} Z`);
    }
    const compound = [{ d: subs.join(' '), bb: { minX: 20, minY: 200, maxX: 872, maxY: 1000 }, area: 500_000 }];
    const culled = cullForeignTopTails(compound, cellH, 'O');
    const keptSubs = culled[0].d
      .split(/(?=M)/)
      .map((s) => s.trim())
      .filter(Boolean);
    expect(keptSubs.length).toBeLessThanOrEqual(128);
    expect(keptSubs).toContain('M 200 200 L 700 200 L 700 1000 L 200 1000 Z');
    expect(keptSubs).toContain('M 320 360 L 580 360 L 580 840 L 320 840 Z');
  });
});

describe('Cluster B: row fragmentation guard, valley cap, and 14->7 band reconciliation', () => {
  it('rejects strict dark-core pass when it shatters 7 clean rows into 14 fragments, but keeps genuine un-bridging', () => {
    const clean7 = Array.from({ length: 7 }, (_, i) => [40 + i * 130, 120 + i * 130]);
    const shattered14 = clean7.flatMap(([y0, y1]) => [
      [y0, y0 + 36],
      [y0 + 44, y1],
    ]);
    expect(looksLikeRowFragmentation(clean7, shattered14, 7)).toBe(true);
    expect(looksLikeRowFragmentation(clean7, shattered14, 0)).toBe(true);

    // Genuine shadow un-bridging: 4 fused bands -> 7 real rows
    const bridged4 = [
      [40, 250],
      [290, 500],
      [540, 750],
      [790, 870],
    ];
    expect(looksLikeRowFragmentation(bridged4, clean7, 7)).toBe(false);
    expect(looksLikeRowFragmentation(bridged4, clean7, 0)).toBe(false);
  });

  it('never splits 7 clean uniform rows into 14 half-rows at thin mid-stem valleys', () => {
    const h = 980;
    const profile = new Array(h).fill(0);
    const bands: number[][] = [];
    for (let r = 0; r < 7; r++) {
      const y0 = 30 + r * 135;
      const y1 = y0 + 90;
      bands.push([y0, y1]);
      for (let y = y0; y < y1; y++) {
        const midDist = Math.abs(y - (y0 + 45));
        // Heavy top/bottom serifs (120px ink) with very thin mid-stems (18px ink -> 15% of peak!)
        profile[y] = midDist < 8 ? 18 : 120;
      }
    }
    expect(splitBandsAtValleys(profile, bands)).toEqual(bands);
    expect(splitBandsAtValleys(profile, bands, 7)).toEqual(bands);
  });

  it('drops 7 alternating AI reference caption strips to recover the exact 7 hand-drawn rows', () => {
    const w = 720;
    const h = 1120;
    const data = new Uint8ClampedArray(w * h * 4).fill(255);
    const bands: number[][] = [];
    const letterBands: number[][] = [];

    for (let r = 0; r < 7; r++) {
      // Main hand-drawn row (height 78px, 13 separate glyph cells)
      const ly0 = 24 + r * 150;
      const ly1 = ly0 + 78;
      bands.push([ly0, ly1]);
      letterBands.push([ly0, ly1]);
      for (let c = 0; c < 13; c++) {
        const x0 = 24 + c * 52;
        for (let y = ly0; y < ly1; y++) {
          for (let x = x0; x < x0 + 30; x++) data[(y * w + x) * 4] = 0;
        }
      }
      // Small printed reference caption strip directly underneath (height 14px, 13 tiny labels)
      const cy0 = ly1 + 10;
      const cy1 = cy0 + 14;
      bands.push([cy0, cy1]);
      for (let c = 0; c < 13; c++) {
        const x0 = 32 + c * 52;
        for (let y = cy0; y < cy1; y++) {
          for (let x = x0; x < x0 + 10; x++) data[(y * w + x) * 4] = 0;
        }
      }
    }

    expect(bands).toHaveLength(14);
    const reconciled = reconcileRowBands(bands, data, w, STANDARD_ASCII_ROWS);
    expect(reconciled).toEqual(letterBands);
  });

  it('folds 14 split upper/lower row halves back into 7 full rows without merging genuine extra rows', () => {
    const w = 600;
    const h = 1050;
    const data = new Uint8ClampedArray(w * h * 4).fill(255);
    const split14: number[][] = [];
    const expected7: number[][] = [];
    for (let r = 0; r < 7; r++) {
      const y0 = 30 + r * 140;
      const upper = [y0, y0 + 24];
      const lower = [y0 + 36, y0 + 88];
      split14.push(upper, lower);
      expected7.push([y0, y0 + 88]);
    }
    expect(reconcileRowBands(split14, data, w, STANDARD_ASCII_ROWS)).toEqual(expected7);

    // Genuine 8 full-height uniform rows with wide gaps must NOT be merged into 7
    const genuine8 = Array.from({ length: 8 }, (_, r) => [20 + r * 125, 100 + r * 125]);
    expect(reconcileRowBands(genuine8, data, w, STANDARD_ASCII_ROWS)).toHaveLength(8);
  });

  it('detects Extended Latin supplement sheets accidentally loaded as variations and normalizes mismatched variant resolution', () => {
    const w = 960;
    const h = 1160;
    const extData = new Uint8ClampedArray(w * h * 4).fill(255);
    const extBands: number[][] = [];
    const rowCellCounts = [18, 18, 18, 18, 17, 17, 16];
    for (let r = 0; r < 7; r++) {
      const y = 30 + r * 155;
      // Floating accent band (16px tall) + letter body band (72px tall, 16-18 cells)
      const ay0 = y;
      const ay1 = y + 16;
      const ly0 = y + 22;
      const ly1 = y + 94;
      extBands.push([ay0, ay1], [ly0, ly1]);
      for (let c = 0; c < rowCellCounts[r]; c++) {
        const x0 = 24 + c * 50;
        for (let py = ly0; py < ly1; py++) {
          for (let px = x0; px < x0 + 28; px++) extData[(py * w + px) * 4] = 0;
        }
        if (c < 14) {
          for (let py = ay0; py < ay1; py++) {
            for (let px = x0 + 8; px < x0 + 20; px++) extData[(py * w + px) * 4] = 0;
          }
        }
      }
    }
    expect(matchesExtendedLatinLayout(extBands, extData, w, STANDARD_ASCII_ROWS)).toBe(true);

    // A 13-cell ASCII variation sheet (even if 14 bands) is NOT an Extended Latin sheet
    const asciiData = new Uint8ClampedArray(w * h * 4).fill(255);
    for (let r = 0; r < 7; r++) {
      const ly0 = 52 + r * 155;
      const ly1 = 124 + r * 155;
      for (let c = 0; c < 13; c++) {
        const x0 = 24 + c * 68;
        for (let py = ly0; py < ly1; py++) {
          for (let px = x0; px < x0 + 34; px++) asciiData[(py * w + px) * 4] = 0;
        }
      }
    }
    expect(matchesExtendedLatinLayout(extBands, asciiData, w, STANDARD_ASCII_ROWS)).toBe(false);

    // Variant resolution matching: leaves same-scale palettes untouched, scales 0.5x sheet by 2.0x
    const mkGlyphs = (chars: string, h: number): Glyph[] =>
      Array.from(chars).map((char) => ({
        char,
        italic: false,
        cellW: h,
        cellH: h,
        baselineYInCell: h * 0.8,
        paths: [`M 10 10 L ${h - 10} 10 L ${h - 10} ${h - 10} L 10 ${h - 10} Z`],
      }));
    const base = mkGlyphs('acemnorsuvwxz', 200);
    const sameScaleVar = mkGlyphs('acemnorsuvwxz', 190);
    expect(matchVariantSheetScale(base, sameScaleVar)).toBe(sameScaleVar);

    const halfScaleVar = mkGlyphs('acemnorsuvwxz', 100);
    const normalized = matchVariantSheetScale(base, halfScaleVar);
    expect(normalized).not.toBe(halfScaleVar);
    const bb = eng.estimateBBox(normalized[0].paths[0]);
    expect(bb.maxY - bb.minY).toBeCloseTo(180, 1);
  });
});
