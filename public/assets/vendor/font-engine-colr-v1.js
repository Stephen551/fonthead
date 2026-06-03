/* ============================================================
 * font-engine-colr-v1.js  (gradient colour fonts: COLR v1 + CPAL)
 * ------------------------------------------------------------
 * Authors a COLR **version 1** table that fills each base glyph's
 * own outline with a linear gradient, plus the CPAL palette the
 * gradient stops reference. This is the path for gradient /
 * painterly source art (e.g. a flame alphabet): instead of flat
 * COLRv0 layers (which posterise a gradient into bands), every
 * letter is its real silhouette filled with a smooth vertical
 * gradient — scalable vector, tiny, true colour.
 *
 * Paint graph per glyph (the minimal COLRv1 gradient shape):
 *   BaseGlyphPaintRecord(gid)
 *     -> PaintGlyph(format 10, clip = the glyph's own outline)
 *        -> PaintLinearGradient(format 4, p0->p1 axis, p2 rotation)
 *           -> ColorLine(extend=PAD, N stops -> palette indices)
 * One ColorLine is shared by every glyph (the fire palette is the
 * same across the alphabet); only the gradient geometry (p0/p1/p2,
 * in each glyph's own design units) differs per letter.
 *
 * Same surgery contract as the rest of the engine: on ANY error,
 * return the original bytes unchanged so the font stays a valid
 * monochrome font (the base outlines still render black).
 *
 * Depends (global): injectCustomTables (font-engine-tables.js).
 *
 * Public entry:
 *   addColrV1Gradient(fontBytes, colors, gradient)
 *       -> { bytes, status, reason, stats }
 *     colors:   [{ r, g, b, a? }]                     CPAL palette
 *     gradient: { stops:  [{ offset(0..1), paletteIndex, alpha? }],
 *                 glyphs: [{ gid, p0:[x,y], p1:[x,y], p2:[x,y] }] }
 * ============================================================ */
(function (global) {
  'use strict';

  // CPAL v0: one palette of N colours, BGRA records. (Self-contained
  // copy so this module fails safe independently of the v0 module.)
  // CPAL v0 with one or (when darkColors is supplied) two palettes — the second
  // is a dark-background variant selectable in CSS via font-palette: dark.
  function buildCPAL(colors, darkColors) {
    const pals = (darkColors && darkColors.length === colors.length) ? [colors, darkColors] : [colors];
    const n = colors.length, P = pals.length;
    const recordsOffset = 12 + 2 * P;         // header + colorRecordIndices[P]
    const buf = new Uint8Array(recordsOffset + n * P * 4);
    const dv = new DataView(buf.buffer);
    dv.setUint16(0, 0, false);                // version 0
    dv.setUint16(2, n, false);                // numPaletteEntries
    dv.setUint16(4, P, false);                // numPalettes
    dv.setUint16(6, n * P, false);            // numColorRecords
    dv.setUint32(8, recordsOffset, false);    // offsetFirstColorRecord
    for (let p = 0; p < P; p++) dv.setUint16(12 + p * 2, p * n, false); // colorRecordIndices[p]
    let o = recordsOffset;
    for (let p = 0; p < P; p++) for (const c of pals[p]) {
      buf[o++] = c.b & 255; buf[o++] = c.g & 255; buf[o++] = c.r & 255;
      buf[o++] = (c.a == null ? 255 : c.a) & 255;
    }
    return buf;
  }

  // COLR v1 with a per-glyph PaintGlyph -> PaintLinearGradient -> shared ColorLine.
  function buildCOLRv1(gradient) {
    const glyphs = gradient.glyphs.slice().sort((a, b) => a.gid - b.gid);
    const stops = gradient.stops;
    const N = glyphs.length, S = stops.length;

    const HEADER = 34;
    const bglOff = HEADER;                     // baseGlyphListOffset
    const bglSize = 4 + N * 6;                 // numRecords(4) + N * BaseGlyphPaintRecord(6)
    const paintsOff = bglOff + bglSize;
    const PER = 6 + 16;                        // PaintGlyph(6) + PaintLinearGradient(16)
    const colorLineOff = paintsOff + N * PER;
    const total = colorLineOff + 3 + S * 6;    // ColorLine header(3) + S * ColorStop(6)

    const buf = new Uint8Array(total);
    const dv = new DataView(buf.buffer);
    const u24 = (o, v) => { buf[o] = (v >>> 16) & 255; buf[o + 1] = (v >>> 8) & 255; buf[o + 2] = v & 255; };
    const f2dot14 = (v) => Math.round(Math.max(-2, Math.min(1.99994, v)) * 16384);

    // --- COLR header (version 1) ---
    dv.setUint16(0, 1, false);                 // version
    dv.setUint16(2, 0, false);                 // numBaseGlyphRecords (v0, unused)
    dv.setUint32(4, 0, false);                 // baseGlyphRecordsOffset
    dv.setUint32(8, 0, false);                 // layerRecordsOffset
    dv.setUint16(12, 0, false);                // numLayerRecords
    dv.setUint32(14, bglOff, false);           // baseGlyphListOffset (v1)
    dv.setUint32(18, 0, false);                // layerListOffset
    dv.setUint32(22, 0, false);                // clipListOffset
    dv.setUint32(26, 0, false);                // varIndexMapOffset
    dv.setUint32(30, 0, false);                // itemVariationStoreOffset

    // --- BaseGlyphList ---
    dv.setUint32(bglOff, N, false);
    glyphs.forEach((g, i) => {
      const recOff = bglOff + 4 + i * 6;
      const paintGlyphOff = paintsOff + i * PER;
      dv.setUint16(recOff, g.gid, false);
      dv.setUint32(recOff + 2, paintGlyphOff - bglOff, false); // Offset32 from BaseGlyphList start
    });

    // --- per-glyph paints ---
    glyphs.forEach((g, i) => {
      const pgOff = paintsOff + i * PER;       // PaintGlyph
      const lgOff = pgOff + 6;                  // PaintLinearGradient
      // PaintGlyph (format 10): format, Offset24 paint, uint16 glyphID
      buf[pgOff] = 10;
      u24(pgOff + 1, 6);                        // sub-paint sits immediately after (6 bytes in)
      dv.setUint16(pgOff + 4, g.gid, false);
      // PaintLinearGradient (format 4): format, Offset24 colorLine, FWORD x0,y0,x1,y1,x2,y2
      buf[lgOff] = 4;
      u24(lgOff + 1, colorLineOff - lgOff);    // Offset24 to the shared ColorLine
      dv.setInt16(lgOff + 4, Math.round(g.p0[0]), false);
      dv.setInt16(lgOff + 6, Math.round(g.p0[1]), false);
      dv.setInt16(lgOff + 8, Math.round(g.p1[0]), false);
      dv.setInt16(lgOff + 10, Math.round(g.p1[1]), false);
      dv.setInt16(lgOff + 12, Math.round(g.p2[0]), false);
      dv.setInt16(lgOff + 14, Math.round(g.p2[1]), false);
    });

    // --- shared ColorLine ---
    buf[colorLineOff] = 0;                     // extend = PAD
    dv.setUint16(colorLineOff + 1, S, false);  // numStops
    stops.forEach((s, i) => {
      const so = colorLineOff + 3 + i * 6;
      dv.setInt16(so, f2dot14(s.offset), false);          // stopOffset (F2DOT14)
      dv.setUint16(so + 2, s.paletteIndex, false);        // paletteIndex
      dv.setInt16(so + 4, f2dot14(s.alpha == null ? 1 : s.alpha), false); // alpha (F2DOT14)
    });

    return buf;
  }

  // COLR v1 with a black OUTLINE behind the gradient. Each base glyph becomes a
  // PaintColrLayers of two layers (via a LayerList):
  //   layer 0 = PaintGlyph(baseGid)  -> PaintSolid(outlineIndex)   the outline
  //   layer 1 = PaintGlyph(insetGid) -> PaintLinearGradient        the fill
  // The base glyph is the full silhouette filled solid (outlineIndex colour);
  // the inset glyph is the eroded silhouette filled with the gradient, so the
  // solid colour peeks out around the edge as an outline ring. One shared
  // PaintSolid + one shared ColorLine; per-glyph gradient geometry.
  function buildCOLRv1Outline(gradient) {
    const glyphs = gradient.glyphs.slice().sort((a, b) => a.gid - b.gid);
    const stops = gradient.stops;
    const N = glyphs.length, S = stops.length;
    const outlineIndex = gradient.outlineIndex || 0;

    const HEADER = 34;
    const bglOff = HEADER;
    const bglSize = 4 + N * 6;
    const pclOff = bglOff + bglSize;              // N PaintColrLayers (6 each)
    const layerListOff = pclOff + N * 6;
    const layerListSize = 4 + (2 * N) * 4;        // numLayers(4) + 2N Offset32
    const pgOff = layerListOff + layerListSize;   // 2N PaintGlyph (6 each)
    const solidOff = pgOff + (2 * N) * 6;         // one shared PaintSolid (5)
    const gradOff = solidOff + 5;                 // N PaintLinearGradient (16 each)
    const colorLineOff = gradOff + N * 16;
    const total = colorLineOff + 3 + S * 6;

    const buf = new Uint8Array(total);
    const dv = new DataView(buf.buffer);
    const u24 = (o, v) => { buf[o] = (v >>> 16) & 255; buf[o + 1] = (v >>> 8) & 255; buf[o + 2] = v & 255; };
    const f2dot14 = (v) => Math.round(Math.max(-2, Math.min(1.99994, v)) * 16384);

    dv.setUint16(0, 1, false);
    dv.setUint16(2, 0, false); dv.setUint32(4, 0, false); dv.setUint32(8, 0, false); dv.setUint16(12, 0, false);
    dv.setUint32(14, bglOff, false);              // baseGlyphListOffset
    dv.setUint32(18, layerListOff, false);        // layerListOffset
    dv.setUint32(22, 0, false); dv.setUint32(26, 0, false); dv.setUint32(30, 0, false);

    // BaseGlyphList -> each base glyph points at its PaintColrLayers
    dv.setUint32(bglOff, N, false);
    glyphs.forEach((g, i) => {
      const recOff = bglOff + 4 + i * 6;
      dv.setUint16(recOff, g.gid, false);
      dv.setUint32(recOff + 2, (pclOff + i * 6) - bglOff, false);
    });

    // PaintColrLayers (format 1): 2 layers each, firstLayerIndex = 2*i
    glyphs.forEach((g, i) => {
      const o = pclOff + i * 6;
      buf[o] = 1; buf[o + 1] = 2; dv.setUint32(o + 2, 2 * i, false);
    });

    // LayerList: 2N paint offsets (from layerListOff)
    dv.setUint32(layerListOff, 2 * N, false);
    glyphs.forEach((g, i) => {
      dv.setUint32(layerListOff + 4 + (2 * i) * 4, (pgOff + (2 * i) * 6) - layerListOff, false);
      dv.setUint32(layerListOff + 4 + (2 * i + 1) * 4, (pgOff + (2 * i + 1) * 6) - layerListOff, false);
    });

    // PaintGlyphs + sub-paints
    glyphs.forEach((g, i) => {
      const blackPg = pgOff + (2 * i) * 6;
      const gradPg = pgOff + (2 * i + 1) * 6;
      const lg = gradOff + i * 16;
      buf[blackPg] = 10; u24(blackPg + 1, solidOff - blackPg); dv.setUint16(blackPg + 4, g.gid, false);
      buf[gradPg] = 10; u24(gradPg + 1, lg - gradPg); dv.setUint16(gradPg + 4, (g.insetGid != null ? g.insetGid : g.gid), false);
      buf[lg] = 4; u24(lg + 1, colorLineOff - lg);
      dv.setInt16(lg + 4, Math.round(g.p0[0]), false); dv.setInt16(lg + 6, Math.round(g.p0[1]), false);
      dv.setInt16(lg + 8, Math.round(g.p1[0]), false); dv.setInt16(lg + 10, Math.round(g.p1[1]), false);
      dv.setInt16(lg + 12, Math.round(g.p2[0]), false); dv.setInt16(lg + 14, Math.round(g.p2[1]), false);
    });

    // shared PaintSolid (format 2) — the outline colour
    buf[solidOff] = 2; dv.setUint16(solidOff + 1, outlineIndex, false); dv.setInt16(solidOff + 3, f2dot14(1), false);

    // shared ColorLine
    buf[colorLineOff] = 0; dv.setUint16(colorLineOff + 1, S, false);
    stops.forEach((s, i) => {
      const so = colorLineOff + 3 + i * 6;
      dv.setInt16(so, f2dot14(s.offset), false); dv.setUint16(so + 2, s.paletteIndex, false); dv.setInt16(so + 4, f2dot14(s.alpha == null ? 1 : s.alpha), false);
    });
    return buf;
  }

  // COLR v1 with an optional black OUTLINE and/or a glossy white HIGHLIGHT, as a
  // PaintColrLayers stack per glyph. Layers, bottom -> top:
  //   [outline]  PaintGlyph(baseGid)  -> PaintSolid(outlineIndex)     the ring
  //   fill       PaintGlyph(fillGid)  -> PaintLinearGradient(main)    the colour
  //   gloss      PaintGlyph(fillGid)  -> PaintLinearGradient(gloss)   white sheen
  // The gloss is a second linear gradient over the SAME fill outline, running
  // top -> bottom with a white-opaque -> transparent ColorLine, so a soft shine
  // sits on the upper part of each letter. Shared PaintSolid + two shared
  // ColorLines (main + gloss); per-glyph gradient geometry.
  function buildCOLRv1Layered(gradient) {
    const glyphs = gradient.glyphs.slice().sort((a, b) => a.gid - b.gid);
    const stops = gradient.stops, gstops = gradient.glossStops;
    const N = glyphs.length, S = stops.length, GS = gstops.length;
    const outline = !!gradient.outline;
    const outlineIndex = gradient.outlineIndex || 0;
    const L = (outline ? 1 : 0) + 2;             // [outline] + fill + gloss

    const HEADER = 34;
    const bglOff = HEADER, bglSize = 4 + N * 6;
    const pclOff = bglOff + bglSize;             // N PaintColrLayers (6 each)
    const layerListOff = pclOff + N * 6;
    const layerListSize = 4 + (N * L) * 4;
    const pgOff = layerListOff + layerListSize;  // N*L PaintGlyph (6 each)
    const solidOff = pgOff + (N * L) * 6;        // shared PaintSolid (5) [outline]
    const mainGradOff = solidOff + (outline ? 5 : 0); // N PaintLinearGradient (16)
    const glossGradOff = mainGradOff + N * 16;   // N PaintLinearGradient (16)
    const mainCLOff = glossGradOff + N * 16;     // main ColorLine (3 + S*6)
    const glossCLOff = mainCLOff + 3 + S * 6;    // gloss ColorLine (3 + GS*6)
    const total = glossCLOff + 3 + GS * 6;

    const buf = new Uint8Array(total);
    const dv = new DataView(buf.buffer);
    const u24 = (o, v) => { buf[o] = (v >>> 16) & 255; buf[o + 1] = (v >>> 8) & 255; buf[o + 2] = v & 255; };
    const f2dot14 = (v) => Math.round(Math.max(-2, Math.min(1.99994, v)) * 16384);
    const grad = (o, g, p0, p1, p2, clOff) => {
      buf[o] = 4; u24(o + 1, clOff - o);
      dv.setInt16(o + 4, Math.round(p0[0]), false); dv.setInt16(o + 6, Math.round(p0[1]), false);
      dv.setInt16(o + 8, Math.round(p1[0]), false); dv.setInt16(o + 10, Math.round(p1[1]), false);
      dv.setInt16(o + 12, Math.round(p2[0]), false); dv.setInt16(o + 14, Math.round(p2[1]), false);
    };
    const colorLine = (o, ss) => { buf[o] = 0; dv.setUint16(o + 1, ss.length, false); ss.forEach((s, i) => { const so = o + 3 + i * 6; dv.setInt16(so, f2dot14(s.offset), false); dv.setUint16(so + 2, s.paletteIndex, false); dv.setInt16(so + 4, f2dot14(s.alpha == null ? 1 : s.alpha), false); }); };

    dv.setUint16(0, 1, false);
    dv.setUint16(2, 0, false); dv.setUint32(4, 0, false); dv.setUint32(8, 0, false); dv.setUint16(12, 0, false);
    dv.setUint32(14, bglOff, false);
    dv.setUint32(18, layerListOff, false);
    dv.setUint32(22, 0, false); dv.setUint32(26, 0, false); dv.setUint32(30, 0, false);

    dv.setUint32(bglOff, N, false);
    glyphs.forEach((g, i) => { const r = bglOff + 4 + i * 6; dv.setUint16(r, g.gid, false); dv.setUint32(r + 2, (pclOff + i * 6) - bglOff, false); });

    glyphs.forEach((g, i) => { const o = pclOff + i * 6; buf[o] = 1; buf[o + 1] = L; dv.setUint32(o + 2, i * L, false); });

    dv.setUint32(layerListOff, N * L, false);
    for (let k = 0; k < N * L; k++) dv.setUint32(layerListOff + 4 + k * 4, (pgOff + k * 6) - layerListOff, false);

    glyphs.forEach((g, i) => {
      const fillGid = outline ? (g.insetGid != null ? g.insetGid : g.gid) : g.gid;
      let j = 0;
      if (outline) { const pg = pgOff + (i * L + j) * 6; buf[pg] = 10; u24(pg + 1, solidOff - pg); dv.setUint16(pg + 4, g.gid, false); j++; }
      const fpg = pgOff + (i * L + j) * 6; const flg = mainGradOff + i * 16;
      buf[fpg] = 10; u24(fpg + 1, flg - fpg); dv.setUint16(fpg + 4, fillGid, false);
      grad(flg, g, g.p0, g.p1, g.p2, mainCLOff); j++;
      const gpg = pgOff + (i * L + j) * 6; const glg = glossGradOff + i * 16;
      buf[gpg] = 10; u24(gpg + 1, glg - gpg); dv.setUint16(gpg + 4, fillGid, false);
      grad(glg, g, g.gp0, g.gp1, g.gp2, glossCLOff);
    });

    if (outline) { buf[solidOff] = 2; dv.setUint16(solidOff + 1, outlineIndex, false); dv.setInt16(solidOff + 3, f2dot14(1), false); }
    colorLine(mainCLOff, stops);
    colorLine(glossCLOff, gstops);
    return buf;
  }

  function addColrV1Gradient(fontBytes, colors, gradient, darkColors) {
    try {
      if (!colors || colors.length === 0) return { bytes: fontBytes, status: 'skipped', reason: 'no colors' };
      if (!gradient || !gradient.glyphs || gradient.glyphs.length === 0) return { bytes: fontBytes, status: 'skipped', reason: 'no glyphs' };
      if (!gradient.stops || gradient.stops.length < 2) return { bytes: fontBytes, status: 'skipped', reason: 'need >= 2 stops' };
      const cpal = buildCPAL(colors, darkColors);
      const colr = (gradient.gloss && gradient.glossStops && gradient.glossStops.length >= 2)
        ? buildCOLRv1Layered(gradient)
        : (gradient.outline ? buildCOLRv1Outline(gradient) : buildCOLRv1(gradient));
      const inject = global.injectCustomTables;
      if (typeof inject !== 'function') {
        console.warn('addColrV1Gradient: injectCustomTables unavailable — shipping mono fallback (outlines only)');
        return { bytes: fontBytes, status: 'error', reason: 'injectCustomTables unavailable' };
      }
      const out = inject(fontBytes, { CPAL: cpal, COLR: colr });
      return {
        bytes: out, status: 'ok',
        stats: { palette: colors.length, glyphs: gradient.glyphs.length, stops: gradient.stops.length,
                 cpalBytes: cpal.length, colrBytes: colr.length }
      };
    } catch (e) {
      const reason = (e && e.message) || 'colr v1 write failed';
      console.warn('addColrV1Gradient: ' + reason + ' — shipping mono fallback (outlines only)');
      return { bytes: fontBytes, status: 'error', reason: reason };
    }
  }

  global.buildCOLRv1 = buildCOLRv1;
  global.buildCOLRv1Outline = buildCOLRv1Outline;
  global.buildCOLRv1Layered = buildCOLRv1Layered;
  global.addColrV1Gradient = addColrV1Gradient;
})(typeof self !== 'undefined' ? self : this);
