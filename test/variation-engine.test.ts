import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import vm from 'node:vm';
import { fixSfntChecksums, verifySfntChecksums } from '../src/lib/sfnt';

// Emulate the worker: all engine modules share ONE global (a vm context) so the
// builder's bare `compileFeatures` / `opentype` references resolve, exactly as
// importScripts wires them in font-engine-worker.js.
const ROOT = join(__dirname, '..');
function loadWorkerEngine(): any {
  const ctx: any = {};
  ctx.self = ctx;
  ctx.window = ctx;
  vm.createContext(ctx);
  for (const f of [
    'opentype.min.js',
    'font-engine-builder.js',
    'font-engine-features.js',
    'font-engine-gsub.js',
    'font-engine-tables.js',
  ]) {
    vm.runInContext(readFileSync(join(ROOT, 'public', 'assets', 'vendor', f), 'utf-8'), ctx, { filename: f });
  }
  return ctx;
}
const eng = loadWorkerEngine();

const OPTS = { unitsPerEm: 1000, familyName: 'Var', styleName: 'Regular', useCellWidth: true, outlinesFormat: 'opentype' };
const A = { char: 'a', italic: false, paths: ['M100 100 L900 100 L900 900 L100 900 Z'], cellW: 1000, cellH: 1000, baselineYInCell: 900 };
const B = { char: 'b', italic: false, paths: ['M200 150 L800 150 L800 850 L200 850 Z'], cellW: 1000, cellH: 1000, baselineYInCell: 900 };
const v = (g: any, suffix: string) => ({ ...g, variantSuffix: suffix });

// A 3-sheet palette merged into one glyph list (what mergeVariantSheets emits).
const PALETTE = [A, B, v(A, '.cv01'), v(B, '.cv01'), v(A, '.cv02'), v(B, '.cv02')];

function finalize(font: any): Uint8Array {
  const base = new Uint8Array(font.toArrayBuffer());
  const injected = eng.injectCustomTables(base, font._customTables || {});
  return fixSfntChecksums(injected);
}
function glyphNames(font: any): Set<string> {
  const names = new Set<string>();
  for (let i = 0; i < font.glyphs.length; i++) names.add(font.glyphs.get(i).name);
  return names;
}

describe('natural variation engine integration', () => {
  it('compiles a calt GSUB into the font, valid and re-parseable, with variant glyphs', () => {
    const font = eng.buildFontForStyle(PALETTE, { ...OPTS, features: { naturalVariation: true } });
    expect(font._customTables && font._customTables.GSUB).toBeTruthy();

    const bytes = finalize(font);
    expect(verifySfntChecksums(bytes).ok).toBe(true);

    // Independent oracle: re-parse with opentype.js (a different parser than our
    // strict reader). It must see a GSUB table carrying a 'calt' feature.
    const parsed = eng.opentype.parse(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
    expect(parsed.tables.gsub).toBeTruthy();
    const featureTags = (parsed.tables.gsub.features || []).map((f: any) => f.tag);
    expect(featureTags).toContain('calt');

    // notdef + space + 2 bases + 4 variants.
    expect(parsed.glyphs.length).toBe(8);
  });

  it('does NOT add GSUB to a single-sheet build (no variants -> default unchanged)', () => {
    const font = eng.buildFontForStyle([A, B], { ...OPTS, features: { naturalVariation: true } });
    expect(font._customTables && font._customTables.GSUB).toBeFalsy();
    expect(glyphNames(font).has('a.cv01')).toBe(false);
  });

  it('skips calt when ligatures are on (opentype.js owns GSUB)', () => {
    const font = eng.buildFontForStyle(PALETTE, { ...OPTS, features: { naturalVariation: true, ligatures: true } });
    expect(font._customTables && font._customTables.GSUB).toBeFalsy();
  });
});
