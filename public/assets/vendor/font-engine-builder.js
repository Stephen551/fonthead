/* ============================================================
 * font-engine-builder.js
 * ------------------------------------------------------------
 * Shared between the main thread (live preview in the font modal)
 * and the Web Worker (full generation pipeline). Both contexts
 * load opentype.js first, then this script, so buildFontForStyle
 * is the ONE source of truth for how a Font is assembled from
 * traced glyphs. If the worker's other modules (features, auto-
 * kern, custom-table injection) are present in scope, this script
 * will call them; otherwise it skips them gracefully so the main
 * thread can run a feature-free preview without loading the rest.
 *
 * Exports (as globals on self/window):
 *   tokenizePath(d) -> [[cmd, [args...]], ...]
 *   estimateBBox(d) -> { minX, minY, maxX, maxY } | null
 *   glyphName(ch)   -> string (Adobe name or the char)
 *   svgPathToOpentypePath(d, transform, quadratic) -> opentype.Path
 *   measureGlyphBounds(glyphs) -> { maxAsc, maxDesc }
 *   buildFontForStyle(glyphs, opts) -> opentype.Font
 * ============================================================ */
(function(global){
  'use strict';

  /* Tokenize an SVG path d-attribute into [[cmd, [args...]], ...] tuples.
     Handles implicit repetition (M followed by extra coord pairs becomes
     M + L's) and case-sensitive relative variants. */
  function tokenizePath(d) {
    const tokens = [];
    const re = /([MmLlHhVvCcSsQqTtAaZz])|(-?\d*\.?\d+(?:[eE][+-]?\d+)?)/g;
    const argCount = { M:2,L:2,H:1,V:1,C:6,S:4,Q:4,T:2,A:7,Z:0 };
    let m, cmd = '', args = [];
    function flush() {
      if (!cmd) return;
      const need = argCount[cmd.toUpperCase()];
      if (need === 0) { tokens.push([cmd, []]); return; }
      for (let i = 0; i + need <= args.length; i += need) {
        tokens.push([i === 0 ? cmd : implicitNext(cmd), args.slice(i, i + need)]);
      }
    }
    function implicitNext(c) {
      if (c === 'M') return 'L';
      if (c === 'm') return 'l';
      return c;
    }
    while ((m = re.exec(d)) !== null) {
      if (m[1]) { flush(); cmd = m[1]; args = []; }
      else { args.push(parseFloat(m[2])); }
    }
    flush();
    return tokens;
  }

  /* Tokenized bounding box. Walks the path and tracks (cx, cy) so H/V
     and arc/etc. commands are interpreted correctly. The earlier
     regex-based "every number is x,y" approach worked for Potrace
     output (M/L/C/Z only) but would silently misreport bboxes if H/V/A
     ever appeared. Fix per the modulate audit. */
  function estimateBBox(d) {
    const tokens = tokenizePath(d);
    if (tokens.length === 0) return null;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    let cx = 0, cy = 0;
    function pt(x, y) {
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
    }
    for (const [cmd, args] of tokens) {
      const upper = cmd.toUpperCase();
      const isRel = cmd !== upper;
      switch (upper) {
        case 'M': case 'L': case 'T': {
          const ax = isRel ? cx + args[0] : args[0];
          const ay = isRel ? cy + args[1] : args[1];
          pt(ax, ay); cx = ax; cy = ay; break;
        }
        case 'H': {
          const ax = isRel ? cx + args[0] : args[0];
          pt(ax, cy); cx = ax; break;
        }
        case 'V': {
          const ay = isRel ? cy + args[0] : args[0];
          pt(cx, ay); cy = ay; break;
        }
        case 'C': {
          /* Control points contribute to a conservative bbox — actual
             curve extent is bounded by the convex hull of {start, ctrl1,
             ctrl2, end}. Cheap and correct as an upper bound. */
          const c1x = isRel ? cx + args[0] : args[0];
          const c1y = isRel ? cy + args[1] : args[1];
          const c2x = isRel ? cx + args[2] : args[2];
          const c2y = isRel ? cy + args[3] : args[3];
          const ax  = isRel ? cx + args[4] : args[4];
          const ay  = isRel ? cy + args[5] : args[5];
          pt(c1x, c1y); pt(c2x, c2y); pt(ax, ay);
          cx = ax; cy = ay; break;
        }
        case 'S': case 'Q': {
          const c1x = isRel ? cx + args[0] : args[0];
          const c1y = isRel ? cy + args[1] : args[1];
          const ax  = isRel ? cx + args[2] : args[2];
          const ay  = isRel ? cy + args[3] : args[3];
          pt(c1x, c1y); pt(ax, ay);
          cx = ax; cy = ay; break;
        }
        case 'A': {
          /* Conservative: ignore arc params, just include endpoint.
             Arcs aren't emitted by Potrace, so this branch is mostly
             defensive. */
          const ax = isRel ? cx + args[5] : args[5];
          const ay = isRel ? cy + args[6] : args[6];
          pt(ax, ay); cx = ax; cy = ay; break;
        }
        case 'Z': break;
      }
    }
    if (minX === Infinity) return null;
    return { minX, minY, maxX, maxY };
  }

  const SPECIAL_NAMES = {
    '!': 'exclam', '?': 'question', '@': 'at', '#': 'numbersign', '$': 'dollar',
    '%': 'percent', '^': 'asciicircum', '&': 'ampersand', '*': 'asterisk',
    '(': 'parenleft', ')': 'parenright', '-': 'hyphen', '_': 'underscore',
    '+': 'plus', '=': 'equal', '[': 'bracketleft', ']': 'bracketright',
    '{': 'braceleft', '}': 'braceright', ';': 'semicolon', ':': 'colon',
    "'": 'quotesingle', '"': 'quotedbl', ',': 'comma', '.': 'period',
    '<': 'less', '>': 'greater', '/': 'slash', '\\': 'backslash', '|': 'bar',
    ' ': 'space',
    /* Digits: Adobe PostScript glyph names cannot start with a digit, so
       a glyph literally named "0" would fail Font Book / OTS validation.
       Map every digit to its canonical Adobe name. */
    '0': 'zero', '1': 'one', '2': 'two', '3': 'three', '4': 'four',
    '5': 'five', '6': 'six', '7': 'seven', '8': 'eight', '9': 'nine',
  };
  function glyphName(ch) { return SPECIAL_NAMES[ch] || ch; }

  /* Walk a tokenized path and emit opentype.Path commands via the
     supplied transform fn (handles per-glyph Y-flip + scale +
     sidebearing shift). If `quadratic` is true, every cubic curveTo is
     split into adjacent quadratic curves via cubic2quad (must be loaded
     into scope). The TTF outline format requires quadratics; OTF/CFF
     accepts cubics natively. */
  function svgPathToOpentypePath(d, transform, quadratic) {
    const tokens = tokenizePath(d);
    const path = new opentype.Path();
    let cx = 0, cy = 0;
    for (const [cmd, args] of tokens) {
      const upper = cmd.toUpperCase();
      const isRel = cmd !== upper;
      switch (upper) {
        case 'M': {
          const ax = isRel ? cx + args[0] : args[0];
          const ay = isRel ? cy + args[1] : args[1];
          const [fx, fy] = transform(ax, ay);
          path.moveTo(fx, fy);
          cx = ax; cy = ay; break;
        }
        case 'L': {
          const ax = isRel ? cx + args[0] : args[0];
          const ay = isRel ? cy + args[1] : args[1];
          const [fx, fy] = transform(ax, ay);
          path.lineTo(fx, fy);
          cx = ax; cy = ay; break;
        }
        case 'H': {
          const ax = isRel ? cx + args[0] : args[0];
          const [fx, fy] = transform(ax, cy);
          path.lineTo(fx, fy);
          cx = ax; break;
        }
        case 'V': {
          const ay = isRel ? cy + args[0] : args[0];
          const [fx, fy] = transform(cx, ay);
          path.lineTo(fx, fy);
          cy = ay; break;
        }
        case 'C': {
          const c1x = isRel ? cx + args[0] : args[0];
          const c1y = isRel ? cy + args[1] : args[1];
          const c2x = isRel ? cx + args[2] : args[2];
          const c2y = isRel ? cy + args[3] : args[3];
          const ax  = isRel ? cx + args[4] : args[4];
          const ay  = isRel ? cy + args[5] : args[5];
          if (quadratic) {
            if (typeof cubic2quad !== 'function') {
              throw new Error('TTF output requires cubic2quad in scope');
            }
            const [tp0x, tp0y] = transform(cx, cy);
            const [tp3x, tp3y] = transform(ax, ay);
            const [tc1x, tc1y] = transform(c1x, c1y);
            const [tc2x, tc2y] = transform(c2x, c2y);
            const quads = cubic2quad(tp0x, tp0y, tc1x, tc1y, tc2x, tc2y, tp3x, tp3y, 0.5);
            /* Output: [p0x, p0y, ctrl, end, ctrl, end, ...] — start
               point already matches current pen, skip it; then emit
               quadraticCurveTo per (ctrl, end) pair. */
            for (let i = 2; i + 4 <= quads.length; i += 4) {
              path.quadraticCurveTo(quads[i], quads[i + 1], quads[i + 2], quads[i + 3]);
            }
          } else {
            const [f1x, f1y] = transform(c1x, c1y);
            const [f2x, f2y] = transform(c2x, c2y);
            const [fx,  fy]  = transform(ax,  ay);
            path.curveTo(f1x, f1y, f2x, f2y, fx, fy);
          }
          cx = ax; cy = ay; break;
        }
        case 'Q': {
          const c1x = isRel ? cx + args[0] : args[0];
          const c1y = isRel ? cy + args[1] : args[1];
          const ax  = isRel ? cx + args[2] : args[2];
          const ay  = isRel ? cy + args[3] : args[3];
          const [f1x, f1y] = transform(c1x, c1y);
          const [fx,  fy]  = transform(ax,  ay);
          path.quadraticCurveTo(f1x, f1y, fx, fy);
          cx = ax; cy = ay; break;
        }
        case 'Z':
          path.close();
          break;
        /* T, S, A — not emitted by Potrace. Silently ignored. */
      }
    }
    return path;
  }

  function measureGlyphBounds(glyphs) {
    let maxAsc = 0, maxDesc = 0;
    for (const g of glyphs) {
      for (const d of g.paths) {
        const bb = estimateBBox(d);
        if (!bb) continue;
        const ascPx = g.baselineYInCell - bb.minY;
        const descPx = bb.maxY - g.baselineYInCell;
        if (ascPx > maxAsc) maxAsc = ascPx;
        if (descPx > maxDesc) maxDesc = descPx;
      }
    }
    /* Floor at 1px so scale calc never divides by zero — but the
       calling code should check for degenerate input separately. */
    if (maxAsc < 1) maxAsc = 1;
    return { maxAsc, maxDesc };
  }

  /* PostScript name sanitizer per Adobe rules:
     - allowed chars: A-Z a-z 0-9 . _ -
     - max 63 chars
     - cannot start with a digit or period (we don't enforce; family
       names are user-supplied and Adobe-compliant in practice). */
  function sanitizePostScriptName(s) {
    return String(s).replace(/[^A-Za-z0-9._-]/g, '').slice(0, 63) || 'Untitled';
  }

  /* Build an opentype.Font for one style. outlinesFormat controls
     whether we emit cubic (CFF/OTF) or quadratic (glyf/TTF) outlines.
     If feature-compilation modules are in scope (worker context),
     compileFeatures is called with auto-kern values from analyzeAutoKern
     when kerning is enabled.

     When opts.isItalic is true, the per-glyph transform applies a 12°
     slant shear (x += y_font * tan), the font's italicAngle metadata
     is set to -12 (forward italic per OpenType convention), and the
     head.macStyle + OS/2.fsSelection italic bits are flipped so the
     OS treats it as a proper italic. Glyph paths come in upright
     (tracer de-skewed the source bitmap before tracing); we re-apply
     the slant here so the rendered font shows slanted glyphs.

     Angle MUST match tracer.html's de-skew angle. Bumped to 14° in
     v0.8.25 because 12° wasn't enough to fully straighten Stephen's
     hand-drawn italic at wider letters (W cascading into X). */
  const ITALIC_ANGLE_DEG = 14;
  function buildFontForStyle(glyphs, opts) {
    const upm = opts.unitsPerEm;
    const family = opts.familyName;
    const style = opts.styleName;
    const useCellWidth = opts.useCellWidth;
    const tightAdvance = opts.tightAdvance;
    const quadratic = opts.outlinesFormat === 'truetype';
    const isItalic = !!opts.isItalic;
    const italicTan = isItalic ? Math.tan(ITALIC_ANGLE_DEG * Math.PI / 180) : 0;
    /* v0.8.48: sidebearingPct lets the caller tune the symmetric
       sidebearing constant used by Tighten Advance + the non-tight
       paths. Default 0.05 (5% of UPM) preserves legacy behavior. For
       high-contrast display fonts where the bbox already includes
       serifs / swashes, 0.02-0.03 produces a tighter letter rhythm. */
    const sideBearingPct = (typeof opts.sideBearingPct === 'number' && opts.sideBearingPct > 0)
      ? opts.sideBearingPct : 0.05;

    const { maxAsc, maxDesc } = measureGlyphBounds(glyphs);
    const targetAsc = upm * 0.80;
    const scale = targetAsc / maxAsc;
    const ascender = Math.ceil(targetAsc);
    /* Descender = max ink below baseline + ~5% padding, in font units.
       Min absolute floor of 50 units so even an all-x-height font
       has SOME descender region. */
    const descender = -Math.max(50, Math.ceil(maxDesc * scale * 1.05));
    /* Italic slant adds horizontal span: ascender shifts right, descender
       shifts left. Add this to per-glyph advance widths so slanted
       glyphs don't crowd their neighbors. */
    const italicSlantSpan = isItalic ? Math.ceil((ascender - descender) * italicTan) : 0;

    const notdef = new opentype.Glyph({
      name: '.notdef',
      unicode: 0,
      advanceWidth: Math.round(upm * 0.5),
      path: new opentype.Path(),
    });

    const byCodepoint = new Map();
    for (const g of glyphs) {
      const cp = g.char.codePointAt(0);
      byCodepoint.set(cp, g);
    }

    const otGlyphs = [notdef];
    /* spaceAdvance (additive, opt-in): the word space as a fraction of UPM.
       Default 0.28 preserves legacy behavior; script faces whose swash tails
       overhang into the space need a wider word space (~0.38) to keep word
       breaks legible. */
    const spaceAdvance = (typeof opts.spaceAdvance === 'number' && opts.spaceAdvance > 0)
      ? opts.spaceAdvance : 0.28;
    otGlyphs.push(new opentype.Glyph({
      name: 'space',
      unicode: 0x20,
      advanceWidth: Math.round(upm * spaceAdvance),
      path: new opentype.Path(),
    }));

    /* Iterate in codepoint order so byte-identical fonts result from
       identical inputs (Map insertion order isn't deterministic
       across runs that build glyphs in different orders).
       Skip U+0020 — we already emitted a hardcoded space glyph above
       (with a fixed 28%-em advance). Letting a traced space through
       would push a second glyph with the same unicode + same name,
       which opentype.js writes into cmap as a duplicate and Font Book
       / OTS flag as malformed. */
    const orderedCps = Array.from(byCodepoint.keys())
      .filter(cp => cp !== 0x20)
      .sort((a, b) => a - b);
    for (const cp of orderedCps) {
      const g = byCodepoint.get(cp);
      let inkMinX = Infinity, inkMaxX = -Infinity;
      for (const d of g.paths) {
        const bb = estimateBBox(d);
        if (!bb) continue;
        if (bb.minX < inkMinX) inkMinX = bb.minX;
        if (bb.maxX > inkMaxX) inkMaxX = bb.maxX;
      }
      if (inkMinX === Infinity) continue;

      const inkWidthPx = inkMaxX - inkMinX;
      const inkWidthUnits = inkWidthPx * scale;
      const sideBearing = Math.round(upm * sideBearingPct);
      let advanceUnits, shiftX;
      if (tightAdvance) {
        advanceUnits = Math.round(inkWidthUnits + sideBearing * 2);
        shiftX = sideBearing - inkMinX * scale;
      } else if (useCellWidth) {
        advanceUnits = Math.round(g.cellW * scale);
        shiftX = 0;
      } else {
        advanceUnits = Math.round(g.cellW * scale);
        shiftX = sideBearing - inkMinX * scale;
      }
      /* Italic: add slant span to advance so slanted glyphs don't crowd
         their neighbors; bias shiftX rightward by half so the slanted
         glyph stays roughly centered in its advance. */
      if (isItalic) {
        advanceUnits += italicSlantSpan;
        shiftX += italicSlantSpan * 0.5;
      }

      const baseY = g.baselineYInCell;
      const transform = (x, y) => {
        const yFont = -(y - baseY) * scale;
        const xFont = x * scale + shiftX;
        const xSlanted = isItalic ? xFont + yFont * italicTan : xFont;
        return [
          Math.round(xSlanted * 100) / 100,
          Math.round(yFont * 100) / 100,
        ];
      };

      const otPath = new opentype.Path();
      for (const d of g.paths) {
        const sub = svgPathToOpentypePath(d, transform, quadratic);
        for (const c of sub.commands) otPath.commands.push(c);
      }

      const rawName = glyphName(g.char);
      const name = rawName.replace(/[^a-zA-Z0-9_.]/g, '_') || 'glyph';

      otGlyphs.push(new opentype.Glyph({
        name,
        unicode: cp,
        advanceWidth: Math.max(1, advanceUnits),
        path: otPath,
      }));
    }

    const subfamily = style;
    const fullName = `${family} ${subfamily}`;
    const postScriptName = sanitizePostScriptName(
      family.replace(/\s+/g, '') + '-' + subfamily.replace(/\s+/g, '')
    );

    const font = new opentype.Font({
      familyName: family,
      styleName: subfamily,
      unitsPerEm: upm,
      ascender,
      descender,
      glyphs: otGlyphs,
      designer: 'A&C Meridian',
      designerURL: 'https://acmeridian.co',
      manufacturer: 'A&C Meridian Glyph Tracer',
      manufacturerURL: 'https://acmeridian.co/admin/tools/tracer',
      fullName,
      postScriptName,
      version: '1.0',
      outlinesFormat: opts.outlinesFormat,
      italicAngle: isItalic ? -ITALIC_ANGLE_DEG : 0,
    });

    /* Italic metadata. opentype.js's minified write-side reads from
       a mix of direct font properties (font.fsSelection, etc) and
       table entries (font.tables.head.macStyle), depending on field.
       v0.8.23 only modified the tables and only fsSelection stuck;
       italicAngle and head.macStyle came out as 0. Setting on BOTH
       sides covers whichever path opentype.js takes for each field. */
    if (isItalic) {
      font.italicAngle = -ITALIC_ANGLE_DEG;
      font.macStyle = 2;
      font.fsSelection = 1;
      if (font.tables) {
        if (font.tables.post) font.tables.post.italicAngle = -ITALIC_ANGLE_DEG;
        if (font.tables.head) font.tables.head.macStyle = 2;
        if (font.tables.os2) font.tables.os2.fsSelection = 1;
      }
    }

    /* If the feature/auto-kern modules are loaded (worker context),
       compile features into the font. Skipped on main thread where
       only the preview-quality font is needed and these modules
       aren't loaded. */
    if (opts.features && typeof compileFeatures === 'function') {
      let computedKernPairs = null;
      const featureOpts = opts.features;
      const kernStrength = (typeof featureOpts.kerningStrength === 'number')
        ? featureOpts.kerningStrength : 1.0;
      if (featureOpts.kerning && kernStrength > 0
          && glyphs && glyphs.length > 0
          && typeof analyzeAutoKern === 'function') {
        computedKernPairs = analyzeAutoKern(glyphs, scale, kernStrength);
      }
      compileFeatures(font, featureOpts, upm, scale, computedKernPairs);
    }

    return font;
  }

  /* Expose */
  global.tokenizePath = tokenizePath;
  global.estimateBBox = estimateBBox;
  global.glyphName = glyphName;
  global.svgPathToOpentypePath = svgPathToOpentypePath;
  global.measureGlyphBounds = measureGlyphBounds;
  global.buildFontForStyle = buildFontForStyle;
  global.sanitizePostScriptName = sanitizePostScriptName;
})(typeof self !== 'undefined' ? self : this);
