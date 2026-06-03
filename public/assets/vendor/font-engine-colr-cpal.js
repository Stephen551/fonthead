/* ============================================================
 * font-engine-colr-cpal.js  (color font tables: CPAL + COLRv0)
 * ------------------------------------------------------------
 * Authors the two tables that make an OpenType font render in
 * colour: CPAL (the palette) and COLRv0 (per-base-glyph layer
 * records pointing at layer glyphs + palette indices). The font
 * passed in must already contain the base glyphs (cmap-mapped,
 * fallback outline) and the layer glyphs (solid shapes); this
 * module is pure post-build table authoring that references them
 * by glyph id, then splices the tables into the SFNT.
 *
 * Same surgery contract as the rest of the engine: on ANY parse
 * or build error, return the original bytes unchanged so the font
 * stays a valid monochrome font (the base outlines still render).
 *
 * Public entry:
 *   addColrCpal(fontBytes, colors, baseLayers) -> { bytes, status, reason, stats }
 *     colors:     [{ r, g, b, a? }]            palette index 0
 *     baseLayers: [{ baseGid, layers: [{ glyphId, paletteIndex }, ...] }, ...]
 * ============================================================ */
(function (global) {
  'use strict';

  // CPAL v0: one palette of N colours (BGRA records), or two when darkColors is
  // supplied — the second is a dark-background variant (CSS font-palette: dark).
  function buildCPAL(colors, darkColors) {
    const pals = (darkColors && darkColors.length === colors.length) ? [colors, darkColors] : [colors];
    const n = colors.length, P = pals.length;
    const recordsOffset = 12 + 2 * P; // 12-byte header + colorRecordIndices[P]
    const buf = new Uint8Array(recordsOffset + n * P * 4);
    const dv = new DataView(buf.buffer);
    dv.setUint16(0, 0, false);        // version 0
    dv.setUint16(2, n, false);        // numPaletteEntries
    dv.setUint16(4, P, false);        // numPalettes
    dv.setUint16(6, n * P, false);    // numColorRecords
    dv.setUint32(8, recordsOffset, false); // offsetFirstColorRecord
    for (let p = 0; p < P; p++) dv.setUint16(12 + p * 2, p * n, false); // colorRecordIndices[p]
    let o = recordsOffset;
    for (let p = 0; p < P; p++) for (const c of pals[p]) {
      buf[o++] = c.b & 255;           // BGRA order
      buf[o++] = c.g & 255;
      buf[o++] = c.r & 255;
      buf[o++] = (c.a == null ? 255 : c.a) & 255;
    }
    return buf;
  }

  // COLRv0: base glyph records (sorted by gid) -> runs of layer records.
  function buildCOLR(baseLayers) {
    const bases = baseLayers.slice().sort((a, b) => a.baseGid - b.baseGid);
    const layerRecords = [];
    const baseRecords = [];
    for (const b of bases) {
      baseRecords.push({ gid: b.baseGid, first: layerRecords.length, num: b.layers.length });
      for (const l of b.layers) layerRecords.push({ gid: l.glyphId, pal: l.paletteIndex });
    }
    const headerSize = 14;            // version, numBase, baseOff(4), layerOff(4), numLayer
    const baseOff = headerSize;
    const layerOff = baseOff + baseRecords.length * 6;
    const buf = new Uint8Array(layerOff + layerRecords.length * 4);
    const dv = new DataView(buf.buffer);
    dv.setUint16(0, 0, false);                       // version 0
    dv.setUint16(2, baseRecords.length, false);      // numBaseGlyphRecords
    dv.setUint32(4, baseOff, false);                 // baseGlyphRecordsOffset
    dv.setUint32(8, layerOff, false);                // layerRecordsOffset
    dv.setUint16(12, layerRecords.length, false);    // numLayerRecords
    let o = baseOff;
    for (const r of baseRecords) { dv.setUint16(o, r.gid, false); dv.setUint16(o + 2, r.first, false); dv.setUint16(o + 4, r.num, false); o += 6; }
    o = layerOff;
    for (const r of layerRecords) { dv.setUint16(o, r.gid, false); dv.setUint16(o + 2, r.pal, false); o += 4; }
    return buf;
  }

  function addColrCpal(fontBytes, colors, baseLayers, darkColors) {
    try {
      if (!colors || colors.length === 0) return { bytes: fontBytes, status: 'skipped', reason: 'no colors' };
      if (!baseLayers || baseLayers.length === 0) return { bytes: fontBytes, status: 'skipped', reason: 'no base layers' };
      const cpal = buildCPAL(colors, darkColors);
      const colr = buildCOLR(baseLayers);
      const inject = global.injectCustomTables;
      if (typeof inject !== 'function') {
        console.warn('addColrCpal: injectCustomTables unavailable — shipping mono fallback (outlines only)');
        return { bytes: fontBytes, status: 'error', reason: 'injectCustomTables unavailable' };
      }
      const out = inject(fontBytes, { CPAL: cpal, COLR: colr });
      return {
        bytes: out, status: 'ok',
        stats: { palette: colors.length, baseGlyphs: baseLayers.length,
                 layers: baseLayers.reduce((s, b) => s + b.layers.length, 0),
                 cpalBytes: cpal.length, colrBytes: colr.length }
      };
    } catch (e) {
      const reason = (e && e.message) || 'colr/cpal write failed';
      console.warn('addColrCpal: ' + reason + ' — shipping mono fallback (outlines only)');
      return { bytes: fontBytes, status: 'error', reason: reason };
    }
  }

  global.buildCPAL = buildCPAL;
  global.buildCOLR = buildCOLR;
  global.addColrCpal = addColrCpal;
})(typeof self !== 'undefined' ? self : this);
