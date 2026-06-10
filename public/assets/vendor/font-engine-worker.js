/* ============================================================
 * font-engine-worker.js  (orchestrator)
 * ------------------------------------------------------------
 * Thin entry point. Loads the vendor libs + the font-engine
 * modules via importScripts, then routes 'generate' messages to
 * the appropriate format writers.
 *
 * Module layout:
 *   font-engine-builder.js   — tokenize, bbox, paths, buildFontForStyle
 *                              (also loaded on main thread for live preview)
 *   font-engine-features.js  — Phase 2 ligatures + kern table
 *   font-engine-autokern.js  — Phase 3 silhouette analysis
 *   font-engine-tables.js    — custom-table injection + head checksum
 *   font-engine-formats.js   — WOFF1 (inline zlib) + WOFF2 (wawoff2)
 *
 * Message protocol unchanged:
 *   in:  { id, type: 'generate', payload }
 *   out: { id, type: 'progress', payload: { step, message } }
 *   out: { id, type: 'result',   payload: { otf?, ttf?, woff?, woff2? } }
 *   out: { id, type: 'error',    payload: { message } }
 * ============================================================ */
'use strict';

/* Cache-bust ?v=0.8.x on every importScripts. Bumped in lockstep with the
   masthead version in tracer.html so Stephen can verify a fresh build
   loaded by checking the visible version (and devtools network tab). */

/* opentype.js is loaded FIRST, before any module/exports shim is in scope.
   Its UMD prelude reads:
     "object"==typeof exports && "undefined"!=typeof module ? t(exports) :
     ... : t((e=e||self).opentype={})
   With no global `exports`/`module` defined yet, UMD falls through to the
   else branch and assigns self.opentype — which is the handle builder.js
   uses as `new opentype.Path()`. Defining the CJS shim BEFORE opentype
   (the old order) made UMD pick the CJS branch and attach API to
   module.exports instead, so self.opentype was undefined inside the
   worker. The bug was masked until the CSP fix because wawoff2 crashed
   earlier in the chain. */
importScripts('/assets/vendor/opentype.min.js?v=0.8.59');

/* NOW set up the CJS shim — cubic2quad ships as `module.exports = ...`
   and also writes self.cubic2quad as a courtesy. We use self.cubic2quad
   downstream; module.exports is only here to keep cubic2quad's assignment
   from throwing a ReferenceError at the top of its IIFE. */
var module = { exports: {} };
var exports = module.exports;
importScripts('/assets/vendor/cubic2quad.js?v=0.8.59');

/* Pre-define Module for Emscripten — wawoff2_compress.js detects the
   global and uses it. Set up the ready promise BEFORE the script loads
   so we never miss the runtime-init callback. The promise is exposed
   as a top-level binding so font-engine-formats.js can await it. */
var Module = {};
var wawoff2Ready = new Promise(function(resolve, reject){
  Module.onRuntimeInitialized = resolve;
  Module.onAbort = function(what){ reject(new Error('wawoff2 init failed: ' + what)); };
});
importScripts('/assets/vendor/wawoff2_compress.js?v=0.8.59');

/* Font-engine modules (order matters: builder first because the
   others reference its helpers; tables before formats because
   inject is called from the orchestrator. Features and autokern are
   peers — builder calls compileFeatures + analyzeAutoKern via the
   typeof === 'function' guards inside buildFontForStyle). */
importScripts('/assets/vendor/font-engine-builder.js?v=0.8.59');
importScripts('/assets/vendor/font-engine-features.js?v=0.8.59');
importScripts('/assets/vendor/font-engine-autokern.js?v=0.8.59');
importScripts('/assets/vendor/font-engine-tables.js?v=0.8.59');
importScripts('/assets/vendor/font-engine-hinting.js?v=0.8.59');
importScripts('/assets/vendor/font-engine-cff-hints.js?v=0.8.59');
/* CFF→TTF converter (v0.8.40): turns opentype.js's CFF output into
   a real TrueType font with glyf+loca tables. Re-enables the TTF
   format option that was dropped honestly in v0.8.39. Phase 5 TT
   hint modules still on disk; reactivate when 5b/5c land. */
importScripts('/assets/vendor/font-engine-glyf-encoder.js?v=0.8.59');
importScripts('/assets/vendor/font-engine-glyf-parser.js?v=0.8.59');
importScripts('/assets/vendor/font-engine-cff-to-tt.js?v=0.8.59');
importScripts('/assets/vendor/font-engine-validate.js?v=0.8.59');
importScripts('/assets/vendor/font-engine-sidebearings.js?v=0.8.59');
importScripts('/assets/vendor/font-engine-fvar.js?v=0.8.59');
importScripts('/assets/vendor/font-engine-gvar.js?v=0.8.59');
importScripts('/assets/vendor/font-engine-vf-compat.js?v=0.8.59');
importScripts('/assets/vendor/font-engine-stat.js?v=0.8.59');
importScripts('/assets/vendor/font-engine-name-extend.js?v=0.8.59');
importScripts('/assets/vendor/font-engine-variable.js?v=0.8.59');
/* Phase 5b/c (v0.8.43): re-enable the TT bytecode/tables/surgery
   modules now that a real TTF output path exists + per-glyph hint
   generator emits SNAP_Y_TO_CVT calls. tt-tables builds cvt/fpgm/prep
   from telemetry; tt-surgery inserts those into the SFNT directory;
   tt-glyph-hints emits per-glyph instructions that get embedded in
   glyf by cff-to-tt's hintCallback hook. */
importScripts('/assets/vendor/font-engine-tt-bytecode.js?v=0.8.59');
importScripts('/assets/vendor/font-engine-tt-tables.js?v=0.8.59');
importScripts('/assets/vendor/font-engine-tt-surgery.js?v=0.8.59');
importScripts('/assets/vendor/font-engine-tt-glyph-hints.js?v=0.8.59');
importScripts('/assets/vendor/font-engine-formats.js?v=0.8.59');

async function generateFonts(payload) {
  const { glyphs, family, style, upm, formats, useCellWidth, tightAdvance, sideBearingPct, id } = payload;
  const features = payload.features || null;
  const embedHints = !!payload.embedHints;
  const embedTTHints = !!payload.embedTTHints;
  const opticalSidebearings = !!payload.opticalSidebearings;
  /* Italic detection: the worker is called once per style (e.g. Regular
     + Italic). The styleName tells buildFontForStyle whether to apply
     the slant transform when emitting paths AND whether to set italic
     metadata (head.macStyle, post.italicAngle, OS/2.fsSelection). */
  const isItalic = /italic/i.test(style || '');
  const result = {};

  postProgress(id, 'otf', 'Building OTF outlines');
  const otfFont = buildFontForStyle(glyphs, {
    familyName: family, styleName: style, unitsPerEm: upm,
    useCellWidth, tightAdvance, sideBearingPct, outlinesFormat: 'cff', features, isItalic,
    spaceAdvance: payload.spaceAdvance,
  });

  /* Phase 6 (v0.8.42): optical sidebearing optimization. When the
     "Optical sidebearings" checkbox is ticked, translate each
     glyph's path so its optical center sits at advance/2. Narrow
     letters (i, l, I, j, !, .) get recentered in their cell-width
     advance; round/symmetric letters are barely touched. Runs on
     the Font object BEFORE serialization so the recentered bbox
     flows through opentype.js's hmtx writer naturally — no need
     to patch leftSideBearing after the fact. */
  let sidebearingStats = null;
  if (opticalSidebearings && typeof optimizeSidebearings === 'function') {
    postProgress(id, 'sidebearings', 'Optical sidebearings (re-centering glyphs)');
    try {
      sidebearingStats = optimizeSidebearings(otfFont);
    } catch (err) {
      sidebearingStats = { error: 'exception: ' + (err && err.message ? err.message : String(err)) };
    }
  }

  /* Phase 4 telemetry: blue zones + dominant stem widths. Runs on the
     built Font object (post-feature-compile, pre-serialize) so we
     measure exactly the glyphs the user will get. The numbers feed
     the next session's CFF Private-dict emission (StdHW, StdVW,
     BlueValues, OtherBlues). Surfaced in the tracer UI so we can
     eyeball-verify them on real fonts before they're written into
     bytes. Wrapped in try/catch so a hinting bug never kills the
     font build itself. */
  let hintingTelemetry = null;
  if (typeof computeHintingTelemetry === 'function') {
    postProgress(id, 'hint', 'Analyzing blue zones + stems');
    try {
      hintingTelemetry = computeHintingTelemetry(otfFont);
    } catch (err) {
      hintingTelemetry = { error: err && err.message ? err.message : String(err) };
    }
  }

  let otfBytes = new Uint8Array(otfFont.toArrayBuffer());
  otfBytes = injectCustomTables(otfBytes, otfFont._customTables);
  /* opentype.js hardcodes post.italicAngle and head.macStyle to 0 in
     its table writers — properties set on the Font object never reach
     the bytes. Binary-patch them here so Font Book / Word / browsers
     read the italic metadata correctly. -14° matches the de-skew and
     re-slant angles in the tracer + buildFontForStyle. */
  if (isItalic) otfBytes = patchItalicMetadata(otfBytes, -14);

  /* Phase 4b: CFF Private DICT injection (BlueValues, OtherBlues,
     StdHW, StdVW, StemSnap*, FamilyBlues). Opt-in via the
     "embed hints" checkbox in the tracer UI. Runs AFTER italic
     metadata patching so the byte stream is otherwise complete.
     On any failure (parse, validation, unexpected CFF layout)
     returns the unmodified bytes — the status flag tells the UI
     what happened. */
  let hintEmbed = null;
  if (embedHints && hintingTelemetry && typeof injectCFFHints === 'function') {
    postProgress(id, 'hint-embed', 'Embedding CFF hints (Private DICT + CharString stems)');
    try {
      /* Pass perGlyphStems if Phase 4b-2 detection produced any —
         the injector will rebuild CharStrings with hstem/vstem
         prefixes for each glyph that has stems detected. Glyphs
         without detected stems pass through untouched. */
      const perGlyphHints = hintingTelemetry.perGlyphStems;
      const r = injectCFFHints(otfBytes, hintingTelemetry, { perGlyphHints });
      hintEmbed = {
        status: r.status, reason: r.reason,
        privateDictSize: r.privateDictSize, cffDelta: r.cffDelta,
        perGlyphHinted: r.perGlyphHinted, perGlyphTotal: r.perGlyphTotal,
      };
      if (r.status === 'embedded') otfBytes = r.bytes;
    } catch (err) {
      hintEmbed = { status: 'failed', reason: 'exception: ' + (err && err.message ? err.message : String(err)) };
    }
  } else if (embedHints) {
    hintEmbed = { status: 'skipped', reason: 'analyzer or telemetry unavailable' };
  }
  if (hintingTelemetry && hintEmbed) hintingTelemetry.embed = hintEmbed;
  /* Capture detection diagnostics BEFORE deleting the Map. The
     _diag property hangs off the Map (non-enumerable) and tells us
     why no per-glyph stems were detected (most useful when count=0). */
  if (hintingTelemetry && hintingTelemetry.perGlyphStems) {
    hintingTelemetry.perGlyphDiag = hintingTelemetry.perGlyphStems._diag || null;
    delete hintingTelemetry.perGlyphStems;
  }

  if (formats.includes('otf')) result.otf = otfBytes;
  if (hintingTelemetry) result._hinting = hintingTelemetry;

  /* Pre-ship validation (v0.8.41). Run the byte-level validator over
     each format we're about to hand back. Errors mean the surgery
     broke something; warnings are advisory. The result lives on
     hintingTelemetry.validate so the UI can surface pass/fail per
     format. We do NOT auto-drop a failing format — the bytes still
     go to the user, but with a visible red marker so they know not
     to ship it. The validator runs entirely in the worker so the
     main thread stays responsive. */
  const validateResults = {};
  if (typeof validateFont === 'function') {
    if (result.otf) {
      try { validateResults.otf = validateFont(result.otf); }
      catch (err) { validateResults.otf = { ok: false, errors: [{ code: 'exception', message: String(err && err.message || err) }] }; }
    }
  }

  /* TTF output (v0.8.40): convert the CFF (OTF) we just produced
     into a real TrueType font with glyf+loca tables. opentype.js
     can't write glyf natively, so we built our own converter:
     parse the CFF via opentype.js, extract glyph paths, expand
     cubic→quadratic via cubic2quad, encode glyf entries, build
     loca, swap CFF out of the SFNT, flip sfnt version to 0x00010000,
     install maxp v1.0 with TT-specific fields. Wrap in try/catch:
     on failure, drop TTF from the result rather than ship malformed
     bytes. The hinted CFF lives on as OTF; TT-format hints are a
     separate (Phase 5) concern. */
  let ttfBytes = null;
  let ttfConvert = null;
  let ttHintEmbed = null;
  if (formats.includes('ttf') && typeof convertCFFToTTF === 'function') {
    /* Phase 5b/c: if user opted into TT hinting, set up the cvt/fpgm/prep
       table builder and the per-glyph hint callback. The callback gets
       called once per non-empty glyph during CFF→TTF conversion; it
       returns the bytecode to embed in that glyph's glyf instructions. */
    let hintCallback = null;
    let ttTables = null;
    if (embedTTHints && hintingTelemetry && hintingTelemetry.blueZones
        && typeof buildHintingTables === 'function'
        && typeof buildGlyphHints === 'function') {
      try {
        ttTables = buildHintingTables(hintingTelemetry);
        const cvtMap = ttTables.cvtMap;
        const fpgmMap = ttTables.fpgmMap;
        const blueZones = hintingTelemetry.blueZones;
        hintCallback = function(contours /*, meta */) {
          const r = buildGlyphHints(contours, blueZones, cvtMap, fpgmMap);
          return r.instructions;
        };
      } catch (err) {
        ttTables = null;
        hintCallback = null;
      }
    }

    postProgress(id, 'ttf', embedTTHints
      ? 'Converting CFF → TTF + emitting per-glyph hint bytecode'
      : 'Converting CFF → TTF (cubic→quad, glyf+loca)');
    try {
      const r = convertCFFToTTF(otfBytes, hintCallback ? { hintCallback } : {});
      ttfConvert = { status: r.status, reason: r.reason, stats: r.stats };
      if (r.status === 'converted') {
        ttfBytes = r.bytes;

        /* If hint generation ran, inject cvt/fpgm/prep tables (the
           values + functions per-glyph instructions reference) via
           Phase 5a tt-surgery. Without these tables present, the
           glyf instructions reference undefined CVT slots and the
           rasterizer either errors or silently ignores hints. */
        if (hintCallback && ttTables && typeof injectTTHints === 'function') {
          try {
            const hr = injectTTHints(ttfBytes, hintingTelemetry);
            if (hr.status === 'embedded') {
              ttfBytes = hr.bytes;
              ttHintEmbed = { status: 'embedded',
                tablesAdded: hr.tablesAdded,
                cvtBytes: hr.cvtBytes, fpgmBytes: hr.fpgmBytes, prepBytes: hr.prepBytes,
                hintedGlyphCount: r.stats && r.stats.hintedGlyphCount,
                maxInstructionLen: r.stats && r.stats.maxInstructionLen };
            } else {
              ttHintEmbed = { status: hr.status, reason: hr.reason };
            }
          } catch (err) {
            ttHintEmbed = { status: 'failed', reason: 'tt-surgery: ' + (err && err.message ? err.message : String(err)) };
          }
        }

        result.ttf = ttfBytes;
        if (typeof validateFont === 'function') {
          try { validateResults.ttf = validateFont(ttfBytes); }
          catch (err) { validateResults.ttf = { ok: false, errors: [{ code: 'exception', message: String(err && err.message || err) }] }; }
        }
      }
    } catch (err) {
      ttfConvert = { status: 'failed', reason: 'exception: ' + (err && err.message ? err.message : String(err)) };
    }
    if (hintingTelemetry) hintingTelemetry.ttfConvert = ttfConvert;
    if (hintingTelemetry && ttHintEmbed) hintingTelemetry.ttHintEmbed = ttHintEmbed;
  }
  if (hintingTelemetry && Object.keys(validateResults).length) {
    hintingTelemetry.validate = validateResults;
  }
  if (hintingTelemetry && sidebearingStats) {
    hintingTelemetry.sidebearings = sidebearingStats;
  }

  /* WOFF/WOFF2 always wrap the OTF (CFF) bytes. Two reasons:
     (1) The hinted CFF preserves Phase 4 blue zones + per-glyph
         stems; the TTF converted from this CFF doesn't carry those
         hints (glyf format encodes hints differently — Phase 5 work).
     (2) WOFF2's CFF transform is similar in compression efficiency
         to its glyf transform for our small (~50-100 glyph) fonts,
         so we don't lose meaningful size by sourcing from CFF.
     If you want TT-format WOFF2, that's a separate output path
     once Phase 5 ships TT hinting. */
  if (formats.includes('woff')) {
    postProgress(id, 'woff', 'Compressing tables (WOFF1)');
    result.woff = await wrapAsWoff1(otfBytes);
  }
  if (formats.includes('woff2')) {
    postProgress(id, 'woff2', 'Compressing with Google WOFF2');
    result.woff2 = await wrapAsWoff2(otfBytes);
  }

  return result;
}

function postProgress(id, step, message) {
  self.postMessage({ id, type: 'progress', payload: { step, message } });
}

/* Phase 7 Session 2: variable-font assembly. Caller sends two
   already-built TTF byte streams (typically Regular + Italic) plus
   an axis definition; we parse both via parseGlyfTable, check per-
   glyph compatibility, compute (m2 - m1) deltas via
   computeVariationDeltas, hand to buildVariableFont. The result is
   the variable TTF bytes plus a compat report telling the UI how
   many glyphs actually got variations vs. were skipped (typical for
   hand-traced fonts where Regular + Italic have divergent point
   structures). */
function assembleVariableFont(payload) {
  const { regularTTF, italicTTF, axis, instances } = payload;
  if (!regularTTF || !italicTTF) {
    throw new Error('regularTTF and italicTTF required');
  }
  if (typeof parseGlyfTable !== 'function'
      || typeof computeVariationDeltas !== 'function'
      || typeof buildVariableFont !== 'function') {
    throw new Error('vf modules not loaded');
  }

  const m1 = parseGlyfTable(regularTTF);
  const m2 = parseGlyfTable(italicTTF);
  const compat = computeVariationDeltas(m1, m2, { peak: 1.0 });

  const vf = buildVariableFont({
    baseTTF: regularTTF,
    axis: axis || { tag: 'ital', min: 0, default: 0, max: 1, nameID: 256 },
    instances: instances || [
      { nameID: 257, coord: 0 },
      { nameID: 258, coord: 1 },
    ],
    glyphVariations: compat.glyphVariations,
  });

  if (vf.status !== 'built') {
    throw new Error('buildVariableFont: ' + (vf.reason || 'unknown'));
  }

  let validate = null;
  if (typeof validateFont === 'function') {
    try { validate = validateFont(vf.bytes); }
    catch (verr) { validate = { ok: false, errors: [{ code: 'exception', message: String(verr.message || verr) }] }; }
  }

  return {
    bytes: vf.bytes,
    stats: {
      ...vf.stats,
      compatible: compat.compatible,
      incompatible: compat.incompatible,
      empty: compat.empty,
      sampleIssues: compat.issues.slice(0, 5),
    },
    validate,
  };
}

self.addEventListener('message', async function(e) {
  const { id, type, payload } = e.data;
  if (type === 'generate') {
    try {
      const result = await generateFonts({ ...payload, id });
      /* Only Uint8Array values (the font bytes themselves) are
         transferable. Non-byte fields like _hinting (a small JSON
         object) get cloned via the structured-clone path. Filtering
         on instanceof prevents a TypeError when a non-byte field
         appears in the result envelope. */
      const transfer = Object.values(result)
        .filter(v => v instanceof Uint8Array)
        .map(u8 => u8.buffer);
      self.postMessage({ id, type: 'result', payload: result }, transfer);
    } catch (err) {
      console.error('[font-engine-worker] generate failed:', err);
      self.postMessage({ id, type: 'error', payload: {
        message: err && err.message ? err.message : String(err),
      } });
    }
  } else if (type === 'generateVariable') {
    try {
      const result = assembleVariableFont(payload);
      const transfer = result.bytes ? [result.bytes.buffer] : [];
      self.postMessage({ id, type: 'result', payload: result }, transfer);
    } catch (err) {
      console.error('[font-engine-worker] generateVariable failed:', err);
      self.postMessage({ id, type: 'error', payload: {
        message: err && err.message ? err.message : String(err),
      } });
    }
  }
});
