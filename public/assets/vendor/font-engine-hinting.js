/* ============================================================
 * font-engine-hinting.js  (Phase 4 — hinting analyzer, detection-only)
 * ------------------------------------------------------------
 * Worker-only. Analyzes a built opentype.Font and computes the
 * telemetry that downstream CFF/TT hinting passes will need:
 *
 *   blueZones: { capHeight, capOvershoot, xHeight, xHeightOvershoot,
 *                ascender, descender, descenderOvershoot, baseline }
 *   stems:     { stdHW, stdVW, hCounts, vCounts }
 *   coverage:  per-class sample counts (so we know which numbers we
 *              can trust — a font with no lowercase reports xHeight=null)
 *
 * Detection-only by design. The next session (Phase 4b) extends
 * opentype.js's CFF writer to emit these values into the Private
 * dict (StdHW, StdVW, BlueValues, OtherBlues, FamilyBlues) and
 * teaches it to write hint operators into CharStrings. Keeping
 * detection isolated means the orchestrator can surface the
 * numbers in the tracer UI for visual verification BEFORE we
 * touch the byte stream — cheaper to get right.
 *
 * Public entry:
 *   computeHintingTelemetry(font, opts?) -> { blueZones, stems, coverage }
 *
 * Stem detection rasterizes each glyph to a 128×128 OffscreenCanvas
 * and runs scanline-crossing analysis at fixed y-fractions. Doing
 * the crossing test on the rasterized bitmap is ~10× simpler than
 * solving Bezier intersections analytically and accurate enough
 * for stem-mode detection (we want THE dominant width, not the
 * exact width of every stem). 128px is enough resolution to
 * distinguish stem widths down to ~8 font units in a UPM 1000 font.
 * ============================================================ */
(function(global){
  'use strict';

  /* Glyph classification by Unicode character. Mirrors standard
     typographic conventions:
       - capFlat: uppercase with flat tops (no overshoot expected)
       - capRound: uppercase with round tops (overshoot above capHeight)
       - xFlat: lowercase x-height with flat tops
       - xRound: lowercase x-height with round tops (overshoot above xHeight)
       - ascender: lowercase reaching ascender height
       - descenderTop: lowercase whose body sits at x-height but descends below
       - descenderRound: same but with round bottoms (overshoot below baseline)
     'I' and 'l' are deliberately excluded from cap/x lists — their
     tops can be ambiguous in display fonts (drawn with serifs that
     extend above/below the geometric height). */
  const CLASSES = {
    capFlat:        'BDEFHKLMNPRTUVWXYZ',
    capRound:       'COQGS',
    xFlat:          'kmnruvwxyz',
    xRound:         'aceos',
    ascender:       'bdfhkl',
    descenderFlat:  'pq',
    descenderRound: 'gjy',
  };

  const CLASS_OF = (() => {
    const m = {};
    for (const [cls, chars] of Object.entries(CLASSES)) {
      for (const c of chars) m[c] = cls;
    }
    return m;
  })();

  function median(arr) {
    if (!arr || arr.length === 0) return null;
    const sorted = [...arr].sort((a, b) => a - b);
    const mid = sorted.length >> 1;
    return sorted.length & 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  }

  function analyzeBlueZones(font) {
    const samples = {
      capFlatTop: [], capRoundTop: [],
      xFlatTop: [], xRoundTop: [],
      ascenderTop: [],
      descenderFlatBot: [], descenderRoundBot: [],
    };

    const glyphs = font.glyphs.glyphs;
    for (let i = 0; i < font.glyphs.length; i++) {
      const g = glyphs[i];
      if (!g || !g.unicode) continue;
      const ch = String.fromCodePoint(g.unicode);
      const cls = CLASS_OF[ch];
      if (!cls) continue;
      if (!g.path || !g.path.commands || g.path.commands.length === 0) continue;

      const bb = g.getBoundingBox();
      if (!bb || !isFinite(bb.y1) || !isFinite(bb.y2)) continue;

      switch (cls) {
        case 'capFlat':        samples.capFlatTop.push(bb.y2); break;
        case 'capRound':       samples.capRoundTop.push(bb.y2); break;
        case 'xFlat':          samples.xFlatTop.push(bb.y2); break;
        case 'xRound':         samples.xRoundTop.push(bb.y2); break;
        case 'ascender':       samples.ascenderTop.push(bb.y2); break;
        case 'descenderFlat':  samples.descenderFlatBot.push(bb.y1); break;
        case 'descenderRound': samples.descenderRoundBot.push(bb.y1); break;
      }
    }

    const capHeight         = median(samples.capFlatTop);
    const capOvershoot      = median(samples.capRoundTop);
    const xHeight           = median(samples.xFlatTop);
    const xHeightOvershoot  = median(samples.xRoundTop);
    const ascender          = median(samples.ascenderTop);
    const descender         = median(samples.descenderFlatBot);
    const descenderOvershoot = median(samples.descenderRoundBot);

    return {
      baseline: 0, /* by construction — buildFontForStyle places baseline at y=0 */
      capHeight,
      capOvershoot,
      xHeight,
      xHeightOvershoot,
      ascender,
      descender,
      descenderOvershoot,
      coverage: {
        capFlat: samples.capFlatTop.length,
        capRound: samples.capRoundTop.length,
        xFlat: samples.xFlatTop.length,
        xRound: samples.xRoundTop.length,
        ascender: samples.ascenderTop.length,
        descenderFlat: samples.descenderFlatBot.length,
        descenderRound: samples.descenderRoundBot.length,
      },
    };
  }

  /* Stem detection via rasterized scanline crossing.
     For each non-empty letter glyph:
       1. Rasterize to a 128×128 OffscreenCanvas using opentype.js's
          glyph.draw (handles Y-flip and scaling for us).
       2. At three horizontal y-fractions (25%, 50%, 75% of bbox height),
          scan left→right and record widths of contiguous "inside" runs.
          Runs narrower than 35% of the rasterized cell count as vertical
          stems (rejects the full-letter-width run that a round/wide
          glyph produces).
       3. At three vertical x-fractions, do the same for horizontal stems.
       4. Convert each run width back to font units via the inverse of
          the rasterizer's scale.
     The mode of accumulated widths is the dominant stem (StdVW for
     vertical, StdHW for horizontal). */
  function analyzeStems(font, opts) {
    const RES = (opts && opts.rasterRes) || 128;
    const STEM_MAX_FRAC = 0.35; /* runs wider than this aren't stems */
    const hCounts = new Map();
    const vCounts = new Map();
    let glyphsAnalyzed = 0;

    const glyphs = font.glyphs.glyphs;
    for (let i = 0; i < font.glyphs.length; i++) {
      const g = glyphs[i];
      if (!g || !g.unicode) continue;
      const ch = String.fromCodePoint(g.unicode);
      /* Restrict to letters — symbols/punctuation muddy the stem mode
         (think `|` which is ALL stem, or `.` which has no stems at all). */
      if (!/[A-Za-z]/.test(ch)) continue;
      if (!g.path || !g.path.commands || g.path.commands.length === 0) continue;

      const bb = g.getBoundingBox();
      if (!bb) continue;
      const bbW = bb.x2 - bb.x1, bbH = bb.y2 - bb.y1;
      if (bbW < 10 || bbH < 10) continue;

      /* Fit the glyph into the RES×RES cell with a small margin so
         scanlines at the very top/bottom don't clip path edges. */
      const margin = RES * 0.05;
      const drawSize = RES - margin * 2;
      const scale = drawSize / Math.max(bbW, bbH);
      /* opentype.js's glyph.draw takes a fontSize in PIXELS; it
         scales by fontSize / unitsPerEm and flips Y. We want our
         own scale though, so we draw with fontSize = scale * UPM
         and offset so the bbox lands centered in the cell. */
      const fontSize = scale * font.unitsPerEm;
      const xOffset = margin + (drawSize - bbW * scale) / 2 - bb.x1 * scale;
      /* glyph.draw treats (x, y) as the baseline-left. Our bbox is in
         font units (y-up). To put the bbox top at (margin), we need
         to set y such that bb.y2 maps to margin in canvas coords.
         glyph.draw will plot a font-unit y at canvas y = (drawY - y*scale).
         So drawY = margin + bb.y2*scale. */
      const drawY = margin + bb.y2 * scale;

      const canvas = new OffscreenCanvas(RES, RES);
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, RES, RES);
      ctx.fillStyle = '#000000';
      try {
        g.draw(ctx, xOffset, drawY, fontSize);
      } catch (err) {
        /* If a glyph fails to rasterize (degenerate path, etc.) skip it. */
        continue;
      }

      const img = ctx.getImageData(0, 0, RES, RES);
      const bin = new Uint8Array(RES * RES);
      for (let p = 0; p < RES * RES; p++) bin[p] = img.data[p * 4] < 128 ? 1 : 0;

      const stemMaxPx = RES * STEM_MAX_FRAC;

      /* Horizontal scanlines → vertical-stem widths */
      for (const yFrac of [0.25, 0.5, 0.75]) {
        const y = Math.floor(margin + yFrac * (RES - 2 * margin));
        if (y < 0 || y >= RES) continue;
        let inRun = false, runStart = 0;
        for (let x = 0; x < RES; x++) {
          const on = bin[y * RES + x];
          if (on && !inRun) { inRun = true; runStart = x; }
          else if (!on && inRun) {
            const w = x - runStart;
            if (w > 1 && w <= stemMaxPx) {
              const wEm = Math.max(1, Math.round(w / scale));
              vCounts.set(wEm, (vCounts.get(wEm) || 0) + 1);
            }
            inRun = false;
          }
        }
      }

      /* Vertical scanlines → horizontal-stem widths */
      for (const xFrac of [0.25, 0.5, 0.75]) {
        const x = Math.floor(margin + xFrac * (RES - 2 * margin));
        if (x < 0 || x >= RES) continue;
        let inRun = false, runStart = 0;
        for (let y = 0; y < RES; y++) {
          const on = bin[y * RES + x];
          if (on && !inRun) { inRun = true; runStart = y; }
          else if (!on && inRun) {
            const h = y - runStart;
            if (h > 1 && h <= stemMaxPx) {
              const hEm = Math.max(1, Math.round(h / scale));
              hCounts.set(hEm, (hCounts.get(hEm) || 0) + 1);
            }
            inRun = false;
          }
        }
      }

      glyphsAnalyzed++;
    }

    /* Convert Map → sorted-by-count list and pick the top entry as
       the standard stem width. Return the top 8 of each for the UI to
       show distributions (useful for debugging "my font has two
       distinct stem widths" cases). */
    const sortByCount = (m) => Array.from(m.entries())
      .sort((a, b) => b[1] - a[1] || a[0] - b[0]);
    const vList = sortByCount(vCounts);
    const hList = sortByCount(hCounts);

    return {
      stdHW: hList.length ? hList[0][0] : null,
      stdVW: vList.length ? vList[0][0] : null,
      hCounts: hList.slice(0, 8),
      vCounts: vList.slice(0, 8),
      glyphsAnalyzed,
    };
  }

  /* Phase 4b-2: per-glyph stem detection.
     For each non-empty letter glyph, rasterize and find OBVIOUS
     stems (high-density column/row ranges). Conservative by design:
     emits stem hints only when detection is unambiguous, leaves
     diagonals (V, W, X) and pure rounds (O, C with no straight
     edges) unhinted rather than risk wrong hints that fight the
     rasterizer. This is the per-glyph data Type 2 CharStrings'
     hstem/vstem operators need.

     A "vertical stem" = an x-range where the column ink density is
     high (≥ STEM_DENSITY_MIN) and width is in [MIN_STEM, MAX_STEM]
     as fractions of glyph bbox. Same for horizontal stems with
     rows. Returns coordinates in FONT UNITS, y-up.

     Returns: Map<glyphIndex, { hstems: [{y, dy}, ...], vstems: [{x, dx}, ...] }>
     where (y, dy) means "stem starts at font y, height dy" with y referring
     to the BOTTOM of the stem in y-up coords. */
  function analyzePerGlyphStems(font, opts) {
    const RES = (opts && opts.rasterRes) || 128;
    const STEM_DENSITY_MIN = 0.75; /* column must be ≥75% filled to count as stem */
    const STEM_MIN_FRAC = 0.04;    /* skip widths < 4% of glyph bbox (noise) */
    const STEM_MAX_FRAC = 0.30;    /* skip widths > 30% (whole-letter ink, not a stem) */
    const MAX_STEMS_PER_AXIS = 8;  /* CFF accepts up to 96; we conservatively cap */

    const result = new Map();
    const diag = { considered: 0, rasterized: 0, hadVStems: 0, hadHStems: 0, rejectedFontSize: 0, rejectedNoInk: 0, samples: [] };
    const glyphs = font.glyphs.glyphs;
    for (let i = 0; i < font.glyphs.length; i++) {
      const g = glyphs[i];
      if (!g || !g.unicode) continue;
      const ch = String.fromCodePoint(g.unicode);
      if (!/[A-Za-z0-9]/.test(ch)) continue;
      if (!g.path || !g.path.commands || g.path.commands.length === 0) continue;
      diag.considered++;

      const bb = g.getBoundingBox();
      if (!bb) continue;
      const bbW = bb.x2 - bb.x1, bbH = bb.y2 - bb.y1;
      if (bbW < 10 || bbH < 10) continue;

      const margin = RES * 0.05;
      const drawSize = RES - margin * 2;
      const scale = drawSize / Math.max(bbW, bbH);
      const fontSize = scale * font.unitsPerEm;
      const xOffset = margin + (drawSize - bbW * scale) / 2 - bb.x1 * scale;
      const drawY = margin + bb.y2 * scale;

      const canvas = new OffscreenCanvas(RES, RES);
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, RES, RES);
      ctx.fillStyle = '#000000';
      try {
        g.draw(ctx, xOffset, drawY, fontSize);
      } catch (err) {
        continue;
      }

      const img = ctx.getImageData(0, 0, RES, RES);
      const bin = new Uint8Array(RES * RES);
      for (let p = 0; p < RES * RES; p++) bin[p] = img.data[p * 4] < 128 ? 1 : 0;

      /* Find the actual rasterized bounds (where ink ended up). The
         font-unit→raster conversion has rounding error; trust the
         bitmap. */
      let minX = RES, maxX = -1, minY = RES, maxY = -1;
      for (let y = 0; y < RES; y++) {
        for (let x = 0; x < RES; x++) {
          if (bin[y * RES + x]) {
            if (x < minX) minX = x;
            if (x > maxX) maxX = x;
            if (y < minY) minY = y;
            if (y > maxY) maxY = y;
          }
        }
      }
      if (maxX < 0) { diag.rejectedNoInk++; continue; }
      diag.rasterized++;
      const rasterW = maxX - minX + 1;
      const rasterH = maxY - minY + 1;
      const stemMinPx = Math.max(2, Math.floor(rasterW * STEM_MIN_FRAC));
      const stemMaxPx = Math.max(stemMinPx + 1, Math.floor(rasterW * STEM_MAX_FRAC));
      const stemMinPxV = Math.max(2, Math.floor(rasterH * STEM_MIN_FRAC));
      const stemMaxPxV = Math.max(stemMinPxV + 1, Math.floor(rasterH * STEM_MAX_FRAC));

      /* === Vertical stems via column density === */
      const colDensity = new Float32Array(RES);
      for (let x = 0; x < RES; x++) {
        let c = 0;
        for (let y = minY; y <= maxY; y++) if (bin[y * RES + x]) c++;
        colDensity[x] = c / rasterH;
      }
      const vstems = findStemsFromDensity(colDensity, STEM_DENSITY_MIN, stemMinPx, stemMaxPx);

      /* === Horizontal stems via row density === */
      const rowDensity = new Float32Array(RES);
      for (let y = 0; y < RES; y++) {
        let c = 0;
        for (let x = minX; x <= maxX; x++) if (bin[y * RES + x]) c++;
        rowDensity[y] = c / rasterW;
      }
      const hstems = findStemsFromDensity(rowDensity, STEM_DENSITY_MIN, stemMinPxV, stemMaxPxV);

      /* Convert raster (canvas) coords → font units. Canvas Y is flipped
         relative to font Y (canvas down, font up). For each stem we
         have (startPx, lenPx) in raster space; map back:
           xFont = (xPx - xOffset) / scale
           yFont = -(yPx - drawY) / scale  →  yFont = (drawY - yPx) / scale
         The y-up flip means a raster stem from yPx=A to yPx=B (A<B,
         A is "top" visually) corresponds to font y from (drawY-B)/scale
         (bottom) to (drawY-A)/scale (top). CFF wants (y, height) with
         y = BOTTOM in y-up. */
      const vstemsFont = vstems.slice(0, MAX_STEMS_PER_AXIS).map(s => {
        const xLeftFont = (s.start - xOffset) / scale;
        const widthFont = s.length / scale;
        return { x: Math.round(xLeftFont), dx: Math.max(1, Math.round(widthFont)) };
      });
      const hstemsFont = hstems.slice(0, MAX_STEMS_PER_AXIS).map(s => {
        /* s.start is the TOP edge in canvas y; s.start+s.length is BOTTOM edge */
        const yTopFont = (drawY - s.start) / scale;
        const yBotFont = (drawY - (s.start + s.length)) / scale;
        const yBottom = Math.round(yBotFont);
        const height = Math.max(1, Math.round(yTopFont - yBotFont));
        return { y: yBottom, dy: height };
      });

      /* CFF spec requires stems sorted ascending and non-overlapping.
         Sort + dedup. */
      vstemsFont.sort((a, b) => a.x - b.x);
      hstemsFont.sort((a, b) => a.y - b.y);
      const dedup = (stems, key) => {
        const out = [];
        for (const s of stems) {
          const prev = out[out.length - 1];
          if (!prev) { out.push(s); continue; }
          const prevEnd = (key === 'x') ? prev.x + prev.dx : prev.y + prev.dy;
          /* If new stem starts at or before previous ended, skip it (overlap). */
          if ((key === 'x' ? s.x : s.y) < prevEnd) continue;
          out.push(s);
        }
        return out;
      };

      const finalH = dedup(hstemsFont, 'y');
      const finalV = dedup(vstemsFont, 'x');

      if (finalH.length > 0) diag.hadHStems++;
      if (finalV.length > 0) diag.hadVStems++;

      /* Capture a few samples for diagnostics: which letters got
         stems, max column/row densities seen, etc. Keeps payload
         small (only first 4 samples). */
      if (diag.samples.length < 4) {
        let maxCol = 0, maxRow = 0;
        for (let k = 0; k < RES; k++) {
          if (colDensity[k] > maxCol) maxCol = colDensity[k];
          if (rowDensity[k] > maxRow) maxRow = rowDensity[k];
        }
        diag.samples.push({
          ch,
          rasterW, rasterH,
          stemPx: [stemMinPx, stemMaxPx],
          vstems: vstems.length, hstems: hstems.length,
          finalV: finalV.length, finalH: finalH.length,
          maxColDensity: +maxCol.toFixed(2),
          maxRowDensity: +maxRow.toFixed(2),
        });
      }

      if (finalH.length === 0 && finalV.length === 0) continue;
      result.set(i, { hstems: finalH, vstems: finalV });
    }
    /* Attach diagnostics to the result Map so they're visible without
       opening the console. Stored as a non-enumerable property so the
       Map iterator behavior is unchanged for the surgery code. */
    Object.defineProperty(result, '_diag', { value: diag, enumerable: false });
    return result;
  }

  /* Walk a 1D density array and extract "stem regions" where density
     stays above a threshold for stemMin..stemMax consecutive samples.
     Returns array of { start, length } in sample units. */
  function findStemsFromDensity(density, minDensity, minLen, maxLen) {
    const stems = [];
    let runStart = -1;
    for (let i = 0; i <= density.length; i++) {
      const above = i < density.length && density[i] >= minDensity;
      if (above && runStart < 0) runStart = i;
      else if (!above && runStart >= 0) {
        const len = i - runStart;
        if (len >= minLen && len <= maxLen) stems.push({ start: runStart, length: len });
        runStart = -1;
      }
    }
    return stems;
  }

  function computeHintingTelemetry(font, opts) {
    if (!font || !font.glyphs) {
      return { blueZones: null, stems: null, error: 'no font/glyphs' };
    }
    const t0 = (typeof performance !== 'undefined' && performance.now)
      ? performance.now() : Date.now();
    const blueZones = analyzeBlueZones(font);
    const stems = analyzeStems(font, opts || {});
    /* Default ON: only skip per-glyph detection if the caller
       explicitly passes { perGlyphStems: false }. The previous
       `opts && opts.perGlyphStems !== false` short-circuited to
       false when opts was undefined (the common case from the
       worker), silently disabling the analyzer. */
    const perGlyph = (!opts || opts.perGlyphStems !== false)
      ? analyzePerGlyphStems(font, opts || {}) : null;
    const t1 = (typeof performance !== 'undefined' && performance.now)
      ? performance.now() : Date.now();
    return {
      blueZones,
      stems,
      perGlyphStems: perGlyph, /* Map<glyphIndex, { hstems, vstems }> */
      perGlyphCount: perGlyph ? perGlyph.size : 0,
      unitsPerEm: font.unitsPerEm,
      analysisMs: Math.round(t1 - t0),
    };
  }

  global.computeHintingTelemetry = computeHintingTelemetry;
  global.analyzeBlueZones = analyzeBlueZones;
  global.analyzeStems = analyzeStems;
  global.analyzePerGlyphStems = analyzePerGlyphStems;

})(typeof self !== 'undefined' ? self : this);
