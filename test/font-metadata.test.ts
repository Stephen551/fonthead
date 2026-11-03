// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const vendor = join(__dirname, '..', 'public', 'assets', 'vendor');
const engine: any = {};
new Function('self', readFileSync(join(vendor, 'opentype.min.js'), 'utf8')).call(engine, engine);
new Function('self', 'opentype', readFileSync(join(vendor, 'font-engine-builder.js'), 'utf8'))
  .call(engine, engine, engine.opentype);
const colorCode = readFileSync(join(vendor, 'font-engine-color-build.js'), 'utf8');
const globals = ['opentype', 'estimateBBox', 'measureGlyphBounds', 'svgPathToOpentypePath', 'glyphName', 'sanitizePostScriptName'];
new Function('self', ...globals, colorCode).call(engine, engine, ...globals.map((key) => engine[key]));

const path = 'M100 100 L800 100 L800 900 L100 900 Z';
const opts = { familyName: 'Attribution Test', styleName: 'Regular', unitsPerEm: 1000, kern: false };
const chars = [{ char: 'A', baseD: path, cellW: 1000, baselineYInCell: 900, layers: [] }];

describe('embedded font attribution', () => {
  for (const mode of ['mono', 'flat', 'gradient']) {
    it(`serializes Fonthead attribution and URLs in ${mode} fonts`, () => {
      let bytes: ArrayBuffer | Uint8Array;
      if (mode === 'mono') {
        bytes = engine.buildFontForStyle([
          { char: 'A', paths: [path], cellW: 1000, cellH: 1000, baselineYInCell: 900 },
        ], opts).toArrayBuffer();
      } else if (mode === 'flat') {
        bytes = engine.buildColorFont(chars, { colors: [{ r: 255, g: 0, b: 0 }] }, opts).bytes;
      } else {
        bytes = engine.buildGradientFont(chars, [
          { offset: 0, r: 255, g: 0, b: 0 }, { offset: 1, r: 255, g: 255, b: 0 },
        ], opts).bytes;
      }
      const buffer = bytes instanceof Uint8Array
        ? bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) : bytes;
      const names = engine.opentype.parse(buffer).names;
      expect(names.manufacturer.en).toBe('Fonthead');
      expect(names.designer.en).toBe('Fonthead');
      expect(names.manufacturerURL.en).toBe('https://fonthead.dev');
      expect(names.designerURL.en).toBe('https://fonthead.dev');
      expect(JSON.stringify(names)).not.toMatch(/A&C Meridian|acmeridian\.co/);
    });
  }
});
