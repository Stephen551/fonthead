/* ============================================================
 * font-engine-color-build.js  (color font assembly)
 * ------------------------------------------------------------
 * Builds a COLR/CPAL colour font from per-character traced paths.
 * Mirrors buildFontForStyle's scale + per-glyph transform, but for
 * each character emits a BASE glyph (cmap-mapped, the fallback union
 * outline) plus one solid LAYER glyph per palette colour present,
 * all sharing the SAME transform so base and layers register exactly.
 * Then authors CPAL + COLRv0 over those glyph ids.
 *
 * Depends (all globals): opentype, estimateBBox, measureGlyphBounds,
 * svgPathToOpentypePath, glyphName, sanitizePostScriptName,
 * addColrCpal (font-engine-colr-cpal.js), and optionally validateFont.
 *
 * Public entry:
 *   buildColorFont(chars, palette, opts) -> { bytes, font, baseLayers, stats }
 *     chars:   [{ char, baseD, cellW, baselineYInCell,
 *                 layers: [{ paletteIndex, d }] }]
 *     palette: { colors: [{ r, g, b }] }   (index 0 = back layer)
 *     opts:    { familyName, unitsPerEm }
 * ============================================================ */
(function (global) {
  'use strict';

  // Optional auto-kern. Builds silhouettes from each glyph's cell-space path and
  // asks analyzeAutoKern for pulls (mostly diagonal pairs: A V W Y T), then
  // compileFeatures writes a real `kern` table into font._customTables. Needs
  // chars to carry cellW/cellH (cell pixel dims) + baseD. Fails silent.
  function applyAutoKern(font, chars, scale, upm, strength) {
    if (!strength || strength <= 0) return;
    if (typeof global.analyzeAutoKern !== 'function' || typeof global.compileFeatures !== 'function') return;
    try {
      const kg = chars.filter(c => c.baseD && c.cellW > 0 && c.cellH > 0)
        .map(c => ({ char: c.char, cellW: c.cellW, cellH: c.cellH, paths: [c.baseD] }));
      if (kg.length < 2) return;
      const pairs = global.analyzeAutoKern(kg, scale, strength);
      if (pairs && pairs.length) global.compileFeatures(font, { kerning: true, kerningStrength: strength }, upm, scale, pairs);
    } catch (e) { console.warn('autokern skipped: ' + (e && e.message)); }
  }
  // Inject the kern table (written into font._customTables by compileFeatures)
  // into the sfnt bytes — same surgery pipe as COLR/CPAL.
  function injectKernIfAny(bytes, font) {
    if (font._customTables && font._customTables.kern && typeof global.injectCustomTables === 'function') {
      try { return global.injectCustomTables(bytes, { kern: font._customTables.kern }); }
      catch (e) { console.warn('kern inject skipped: ' + (e && e.message)); }
    }
    return bytes;
  }

  // OpenType name-table fields from user metadata (style/version/designer/
  // license), with A&C defaults. Used by both build paths.
  function nameFields(family, opts) {
    const style = (opts.styleName || 'Regular');
    const f = {
      familyName: family, styleName: style,
      fullName: family + ' ' + style,
      postScriptName: sanitizePostScriptName(family.replace(/\s+/g, '') + '-' + style.replace(/\s+/g, '')),
      version: (opts.version || '1.0'),
      designer: opts.designer || 'A&C Meridian',
      designerURL: 'https://acmeridian.co',
      manufacturer: 'A&C Meridian Color Font Builder',
    };
    if (opts.license) f.license = opts.license;
    if (opts.copyright) f.copyright = opts.copyright;
    return f;
  }

  // Dark-background palette variant: flip each colour's HSL lightness (keeping
  // hue + saturation) so a font designed on a light sheet reads on a dark one.
  // Returned as a parallel colour array for CPAL's second palette.
  function darkVariant(colors) {
    const conv = (c) => {
      const r = c.r / 255, g = c.g / 255, b = c.b / 255;
      const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2;
      let h = 0, s = 0;
      if (mx !== mn) {
        const d = mx - mn;
        s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
        if (mx === r) h = (g - b) / d + (g < b ? 6 : 0);
        else if (mx === g) h = (b - r) / d + 2;
        else h = (r - g) / d + 4;
        h /= 6;
      }
      const nl = Math.min(1, Math.max(0, 0.96 - 0.92 * l)); // flip lightness, keep off the extremes
      const hue = (p, q, t) => { if (t < 0) t += 1; if (t > 1) t -= 1; if (t < 1 / 6) return p + (q - p) * 6 * t; if (t < 1 / 2) return q; if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6; return p; };
      let R, G, B;
      if (s === 0) { R = G = B = nl; }
      else { const q = nl < 0.5 ? nl * (1 + s) : nl + s - nl * s, p = 2 * nl - q; R = hue(p, q, h + 1 / 3); G = hue(p, q, h); B = hue(p, q, h - 1 / 3); }
      return { r: Math.round(R * 255), g: Math.round(G * 255), b: Math.round(B * 255), a: c.a };
    };
    return colors.map(conv);
  }

  function buildColorFont(chars, palette, opts) {
    opts = opts || {};
    const upm = opts.unitsPerEm || 1000;
    const family = opts.familyName || 'Untitled Color';
    const sideBearingPct = 0.05;

    // Scale from the BASE (union) outlines so base + layers scale together.
    // Mono fallback (spec section 9): a 1-colour sheet builds a NORMAL font —
    // base outlines only, no layer glyphs, no COLR/CPAL — so it renders in the
    // app's text colour instead of being forced to the single palette colour.
    const colorMode = palette && palette.colors && palette.colors.length >= 2;
    const boundsGlyphs = chars.map(c => ({ paths: [c.baseD], baselineYInCell: c.baselineYInCell }));
    const { maxAsc, maxDesc } = measureGlyphBounds(boundsGlyphs);
    const scale = (upm * 0.80) / maxAsc;
    const ascender = Math.ceil(upm * 0.80);
    const descender = -Math.max(50, Math.ceil(maxDesc * scale * 1.05));

    const otGlyphs = [
      new opentype.Glyph({ name: '.notdef', unicode: 0, advanceWidth: Math.round(upm * 0.5), path: new opentype.Path() }),
      new opentype.Glyph({ name: 'space', unicode: 0x20, advanceWidth: Math.round(upm * 0.28), path: new opentype.Path() }),
    ];

    // codepoint order for determinism, skip space
    const byCp = new Map();
    for (const c of chars) { const cp = c.char.codePointAt(0); if (cp !== 0x20) byCp.set(cp, c); }
    const orderedCps = Array.from(byCp.keys()).sort((a, b) => a - b);

    const baseLayers = [];
    for (const cp of orderedCps) {
      const c = byCp.get(cp);
      const bb = estimateBBox(c.baseD);
      if (!bb) continue;
      // Space by the solid body (ColorCore.bodyBoundsX, trims wisps + specks)
      // when available, else the full ink bbox. Flames overhang the margins.
      const inkMinX = (c.bodyMinX != null) ? c.bodyMinX : bb.minX;
      const inkMaxX = (c.bodyMaxX != null) ? c.bodyMaxX : bb.maxX;
      const inkWidthUnits = (inkMaxX - inkMinX) * scale;
      const sideBearing = (opts.sideBearing != null) ? Math.max(0, Math.round(opts.sideBearing)) : Math.round(upm * sideBearingPct);
      // Advance = ink width + equal side bearings. (Previously this used the
      // sliced cell width `c.cellW * scale`, but the slicer crops cells tight
      // to the ink — so after the ink was shifted right by `sideBearing`, it
      // overflowed the advance on the right: negative right side bearings,
      // letters overlapping. Tying the advance to the ink gives even lsb==rsb
      // spacing and proportional widths.)
      const advanceUnits = Math.max(1, Math.round(inkWidthUnits + sideBearing * 2));
      const shiftX = sideBearing - inkMinX * scale;
      const baseY = c.baselineYInCell;
      const transform = (x, y) => [
        Math.round((x * scale + shiftX) * 100) / 100,
        Math.round((-(y - baseY) * scale) * 100) / 100,
      ];

      const baseName = (glyphName(c.char).replace(/[^a-zA-Z0-9_.]/g, '_') || 'glyph');
      const basePath = svgPathToOpentypePath(c.baseD, transform, false);
      const baseGid = otGlyphs.length;
      otGlyphs.push(new opentype.Glyph({ name: baseName, unicode: cp, advanceWidth: advanceUnits, path: basePath }));

      // Layer glyphs (colour mode only): ordered by paletteIndex ascending
      // (index 0 = largest area = drawn first = back).
      if (colorMode) {
        const layers = c.layers.slice().sort((a, b) => a.paletteIndex - b.paletteIndex);
        const layerRecs = [];
        layers.forEach((l, li) => {
          const lp = svgPathToOpentypePath(l.d, transform, false);
          const gid = otGlyphs.length;
          otGlyphs.push(new opentype.Glyph({ name: baseName + '.layer' + li, advanceWidth: advanceUnits, path: lp }));
          layerRecs.push({ glyphId: gid, paletteIndex: l.paletteIndex });
        });
        if (layerRecs.length) baseLayers.push({ baseGid, layers: layerRecs });
      }
    }

    const font = new opentype.Font(Object.assign({
      unitsPerEm: upm, ascender, descender, glyphs: otGlyphs, outlinesFormat: 'cff',
    }, nameFields(family, opts)));

    applyAutoKern(font, chars, scale, upm, opts.kern === false ? 0 : (opts.kernStrength || 1));
    let bytes = injectKernIfAny(new Uint8Array(font.toArrayBuffer()), font);
    const colors = palette.colors.map(c => ({ r: c.r, g: c.g, b: c.b }));
    let colrStatus = 'skipped', colrReason = '';
    if (typeof addColrCpal === 'function' && baseLayers.length) {
      const dark = opts.darkPalette ? darkVariant(colors) : null;
      const res = addColrCpal(bytes, colors, baseLayers, dark);
      bytes = res.bytes; colrStatus = res.status; colrReason = res.reason || '';
    }

    return {
      bytes, font, baseLayers,
      stats: {
        glyphs: otGlyphs.length, baseGlyphs: baseLayers.length,
        layers: baseLayers.reduce((s, b) => s + b.layers.length, 0),
        palette: colors.length, scale, colrStatus, colrReason,
      },
    };
  }

  /* buildGradientFont(chars, gradientStops, opts) -> { bytes, font, stats }
   * The COLRv1 path: builds ONE base (cmap-mapped) glyph per character —
   * its real silhouette outline, no layer glyphs — then fills each with a
   * vertical linear gradient (the shared `gradientStops`, sampled from the
   * source by ColorCore.sampleFireGradient). p0->p1 runs bottom->top in each
   * glyph's own design units, so red sits at the baseline and yellow at the
   * tips. Scalable vector, tiny, true colour. Fails safe to mono outlines.
   *   chars:         [{ char, baseD, cellW, baselineYInCell }]
   *   gradientStops: [{ offset(0..1), r, g, b }]   (offset 0 = bottom) */
  function buildGradientFont(chars, gradientStops, opts) {
    opts = opts || {};
    const upm = opts.unitsPerEm || 1000;
    const family = opts.familyName || 'Untitled Color';
    const sideBearingPct = 0.05;

    const boundsGlyphs = chars.map(c => ({ paths: [c.baseD], baselineYInCell: c.baselineYInCell }));
    const { maxAsc, maxDesc } = measureGlyphBounds(boundsGlyphs);
    const scale = (upm * 0.80) / maxAsc;
    const ascender = Math.ceil(upm * 0.80);
    const descender = -Math.max(50, Math.ceil(maxDesc * scale * 1.05));

    const otGlyphs = [
      new opentype.Glyph({ name: '.notdef', unicode: 0, advanceWidth: Math.round(upm * 0.5), path: new opentype.Path() }),
      new opentype.Glyph({ name: 'space', unicode: 0x20, advanceWidth: Math.round(upm * 0.28), path: new opentype.Path() }),
    ];

    const byCp = new Map();
    for (const c of chars) { const cp = c.char.codePointAt(0); if (cp !== 0x20) byCp.set(cp, c); }
    const orderedCps = Array.from(byCp.keys()).sort((a, b) => a - b);

    const gradientGlyphs = [];
    for (const cp of orderedCps) {
      const c = byCp.get(cp);
      const bb = estimateBBox(c.baseD);
      if (!bb) continue;
      // Space by the solid body (trims flame wisps + specks) when available.
      const inkMinX = (c.bodyMinX != null) ? c.bodyMinX : bb.minX;
      const inkMaxX = (c.bodyMaxX != null) ? c.bodyMaxX : bb.maxX;
      const sideBearing = (opts.sideBearing != null) ? Math.max(0, Math.round(opts.sideBearing)) : Math.round(upm * sideBearingPct);
      const inkWidthUnits = (inkMaxX - inkMinX) * scale;
      // Advance = ink width + equal side bearings. (Previously this used the
      // sliced cell width `c.cellW * scale`, but the slicer crops cells tight
      // to the ink — so after the ink was shifted right by `sideBearing`, it
      // overflowed the advance on the right: negative right side bearings,
      // letters overlapping. Tying the advance to the ink gives even lsb==rsb
      // spacing and proportional widths.)
      const advanceUnits = Math.max(1, Math.round(inkWidthUnits + sideBearing * 2));
      const shiftX = sideBearing - inkMinX * scale;
      const baseY = c.baselineYInCell;
      const transform = (x, y) => [
        Math.round((x * scale + shiftX) * 100) / 100,
        Math.round((-(y - baseY) * scale) * 100) / 100,
      ];
      const baseName = (glyphName(c.char).replace(/[^a-zA-Z0-9_.]/g, '_') || 'glyph');
      const basePath = svgPathToOpentypePath(c.baseD, transform, false);
      const gid = otGlyphs.length;
      const glyph = new opentype.Glyph({ name: baseName, unicode: cp, advanceWidth: advanceUnits, path: basePath });
      otGlyphs.push(glyph);

      // Per-glyph gradient geometry from the glyph's own outline bbox, along the
      // requested angle (0 = vertical, base->tip; +/- tilts it). The axis runs
      // through the glyph centre; p0/p1 are the bbox extremes projected onto it,
      // p2 sets the (perpendicular) rotation so the bands stay square to the axis.
      const gb = glyph.getBoundingBox();
      const cx = (gb.x1 + gb.x2) / 2, cyc = (gb.y1 + gb.y2) / 2;
      const th = (opts.gradientAngle || 0) * Math.PI / 180;
      const dx = Math.sin(th), dy = Math.cos(th);           // axis dir (0deg -> up)
      const corners = [[gb.x1, gb.y1], [gb.x2, gb.y1], [gb.x1, gb.y2], [gb.x2, gb.y2]];
      let tMin = Infinity, tMax = -Infinity;
      for (const [px, py] of corners) { const t = (px - cx) * dx + (py - cyc) * dy; if (t < tMin) tMin = t; if (t > tMax) tMax = t; }
      const span = Math.max(1, tMax - tMin);
      const grec = { gid,
        p0: [cx + tMin * dx, cyc + tMin * dy],
        p1: [cx + tMax * dx, cyc + tMax * dy],
        p2: [cx + tMin * dx + dy * span, cyc + tMin * dy - dx * span] };
      // Outline mode: the gradient fills an INSET (eroded) glyph; the base
      // silhouette behind it shows as the outline. No inset traced -> gradient
      // fills the base (that glyph just has no outline).
      if (opts.outline) {
        if (c.insetD) {
          const insetGid = otGlyphs.length;
          otGlyphs.push(new opentype.Glyph({ name: baseName + '.inset', advanceWidth: advanceUnits, path: svgPathToOpentypePath(c.insetD, transform, false) }));
          grec.insetGid = insetGid;
        } else grec.insetGid = gid;
      }
      // Gloss geometry: a vertical axis from the glyph's TOP (offset 0, where the
      // white sheen is opaque) straight down to the bottom (offset 1, transparent).
      // p2 is the perpendicular so the sheen bands stay horizontal.
      if (opts.gloss) {
        const gh = Math.max(1, gb.y2 - gb.y1);
        grec.gp0 = [cx, gb.y2];
        grec.gp1 = [cx, gb.y1];
        grec.gp2 = [cx + gh, gb.y2];
      }
      gradientGlyphs.push(grec);
    }

    const font = new opentype.Font(Object.assign({
      unitsPerEm: upm, ascender, descender, glyphs: otGlyphs, outlinesFormat: 'cff',
    }, nameFields(family, opts)));

    applyAutoKern(font, chars, scale, upm, opts.kern === false ? 0 : (opts.kernStrength || 1));
    let bytes = injectKernIfAny(new Uint8Array(font.toArrayBuffer()), font);
    // With outline, palette index 0 is black (the outline) and the gradient
    // stops shift up by one.
    const useOutline = !!opts.outline && gradientGlyphs.some(g => g.insetGid != null && g.insetGid !== g.gid);
    const useGloss = !!opts.gloss && gradientGlyphs.some(g => g.gp0);
    const palShift = useOutline ? 1 : 0;
    let colors = useOutline
      ? [{ r: 0, g: 0, b: 0 }].concat(gradientStops.map(s => ({ r: s.r, g: s.g, b: s.b })))
      : gradientStops.map(s => ({ r: s.r, g: s.g, b: s.b }));
    const stops = gradientStops.map((s, i) => ({ offset: s.offset, paletteIndex: i + palShift, alpha: 1 }));
    // Gloss: a white sheen on the upper part of each letter, as a second gradient.
    // Append white to the palette and a white -> transparent ColorLine (top down).
    let glossStops = null;
    if (useGloss) {
      const glossIndex = colors.length;
      colors = colors.concat([{ r: 255, g: 255, b: 255 }]);
      const a = Math.min(0.9, Math.max(0.1, opts.glossStrength != null ? opts.glossStrength : 0.55));
      glossStops = [
        { offset: 0.0, paletteIndex: glossIndex, alpha: a },
        { offset: 0.35, paletteIndex: glossIndex, alpha: a * 0.28 },
        { offset: 0.62, paletteIndex: glossIndex, alpha: 0 },
      ];
    }
    let colrStatus = 'skipped', colrReason = '';
    if (typeof addColrV1Gradient === 'function' && gradientGlyphs.length && stops.length >= 2) {
      const dark = opts.darkPalette ? darkVariant(colors) : null;
      const res = addColrV1Gradient(bytes, colors, { stops, glyphs: gradientGlyphs, outline: useOutline, outlineIndex: 0, gloss: useGloss, glossStops }, dark);
      bytes = res.bytes; colrStatus = res.status; colrReason = res.reason || '';
    }

    return {
      bytes, font,
      stats: {
        glyphs: otGlyphs.length, baseGlyphs: gradientGlyphs.length,
        stops: stops.length, palette: colors.length, scale, colrStatus, colrReason,
        mode: 'gradient',
      },
    };
  }

  global.buildColorFont = buildColorFont;
  global.buildGradientFont = buildGradientFont;
})(typeof self !== 'undefined' ? self : this);
