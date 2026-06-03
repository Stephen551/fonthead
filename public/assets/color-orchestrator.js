/* ============================================================
 * color-orchestrator.js  (main-thread color-font orchestration)
 * ------------------------------------------------------------
 * Self-contained, vendored extraction of the image -> font-bytes
 * pipeline from public/admin/tools/color-builder.html. The original
 * lives inside a page IIFE mixed with UI, telemetry, and preview; this
 * module ports ONLY the compute path (palette -> rows -> slice -> trace
 * -> assemble) faithfully — same algorithms, same thresholds — and
 * exposes a single global:
 *
 *   window.ColorMaker = { buildColorFromImage }
 *
 * It reuses the engine globals already loaded by the host page and does
 * NOT load or define any of them. Required at call time:
 *   window.ColorCore      (color-core.js)
 *   window.TracerCore     (tracer-core.js)
 *   window.buildColorFont (font-engine-color-build.js)   — flat mode
 *   window.buildGradientFont (font-engine-color-build.js)— gradient mode
 *   window.opentype       (used transitively by the build engine)
 *   window.Potrace        (used transitively by TracerCore.traceCellBitmap)
 *
 * The pipeline runs on the main thread and uses a DOM <canvas> for
 * getImageData — that is correct and required (Potrace + getImageData).
 *
 * Classic (non-module) script. No build step. No dependencies of its own.
 * ============================================================ */
(function (global) {
  'use strict';

  // Short references to the engine globals. Resolved at CALL TIME (not load
  // time) so this script can load in any order relative to the engines.
  function CC() { return global.ColorCore; }
  function TC() { return global.TracerCore; }

  /* ----------------------------------------------------------------
   * Ported page-level helpers (from color-builder.html).
   * Each adapts only names/scope; the algorithm and every threshold is
   * identical to the source. Source line numbers are noted per helper.
   * ---------------------------------------------------------------- */

  // [color-builder.html:397] unionInkBinary
  // Build a union ink mask (RGBA, ink=black) using color distance from bg —
  // luminance binarize would miss light inks (yellow), color distance does not.
  function unionInkBinary(data, w, h, palette) {
    const ColorCore = CC();
    const bgLab = ColorCore.rgbToLab(palette.bg.r, palette.bg.g, palette.bg.b);
    const bgD2 = (palette.bgDist || 20) * (palette.bgDist || 20);
    const m = new Uint8ClampedArray(w * h * 4);
    for (let i = 0; i < m.length; i += 4) { m[i] = m[i + 1] = m[i + 2] = 255; m[i + 3] = 255; }
    for (let p = 0; p < w * h; p++) { const i = p * 4; const lab = ColorCore.rgbToLab(data[i], data[i + 1], data[i + 2]); if (ColorCore.labDist2(lab, bgLab) > bgD2) { m[i] = m[i + 1] = m[i + 2] = 0; } }
    return m;
  }

  // [color-builder.html:419] detectRowsByProfile
  // Expected-count-aware row detection. The default detector splits rows only
  // at fully-empty scanlines, so a drop shadow's tail or a tall script's
  // ascenders/descenders that bridge the inter-row gap merge two rows into one.
  // Alphabet sheets are always evenly spaced, so given the expected row count
  // we lay down an equal-spacing prior and snap each of the n-1 interior
  // boundaries to the LOCAL ink minimum near it — finding the true gap even
  // when it's a shallow valley rather than zero ink. Returns n tight ink bands,
  // or null if it can't (caller keeps the default).
  function detectRowsByProfile(union, w, h, n) {
    if (n < 2) return null;
    const rowInk = new Uint32Array(h);
    for (let y = 0; y < h; y++) { let c = 0; const b = y * w * 4; for (let x = 0; x < w; x++) if (union[b + x * 4] === 0) c++; rowInk[y] = c; }
    let y0 = -1, y1 = -1; for (let y = 0; y < h; y++) if (rowInk[y]) { y0 = y; break; } for (let y = h - 1; y >= 0; y--) if (rowInk[y]) { y1 = y + 1; break; }
    if (y0 < 0 || y1 - y0 < n) return null;
    const band = (y1 - y0) / n;
    const bounds = [y0];
    for (let i = 1; i < n; i++) {
      const target = y0 + i * band;
      const lo = Math.max(bounds[bounds.length - 1] + 1, Math.round(target - band * 0.4));
      const hi = Math.min(y1 - 1, Math.round(target + band * 0.4));
      if (hi <= lo) return null;
      let bestY = lo, bestV = Infinity;
      for (let y = lo; y <= hi; y++) { if (rowInk[y] < bestV) { bestV = rowInk[y]; bestY = y; } }
      bounds.push(bestY);
    }
    bounds.push(y1);
    // Trim each [a,b) span to its actual ink extent so bands match the default
    // detector's tight runs (no leading/trailing blank scanlines).
    const rows = [];
    for (let i = 0; i < n; i++) {
      let a = bounds[i], b = bounds[i + 1], ya = -1, yb = -1;
      for (let y = a; y < b; y++) if (rowInk[y]) { ya = y; break; }
      for (let y = b - 1; y >= a; y--) if (rowInk[y]) { yb = y + 1; break; }
      if (ya < 0) return null; // a band with no ink -> wrong split, bail to default
      rows.push([ya, yb]);
    }
    return rows;
  }

  // [color-builder.html:601] extractColorCell
  // Per-cell color sub-rect. ownerFn/cellIdx (from ownership-based slicing)
  // erase ink that sits in this cell's rectangle but belongs to an ADJACENT
  // letter — repainting it as bg so separation + trace never see the neighbour.
  // This is what stops touching / bridging letters from merging (IJ, qr) and
  // keeps stray neighbour ink out of the silhouette. bg defaults to white.
  function extractColorCell(data, fullW, x0, x1, y0, y1, ownerFn, cellIdx, bg) {
    const w = x1 - x0, h = y1 - y0; const cell = new Uint8ClampedArray(w * h * 4);
    const br = bg ? bg.r : 255, bgc = bg ? bg.g : 255, bbl = bg ? bg.b : 255;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const s = ((y0 + y) * fullW + (x0 + x)) * 4, d = (y * w + x) * 4;
      let r = data[s], g = data[s + 1], b = data[s + 2];
      if (ownerFn) { const owner = ownerFn(x0 + x, y0 + y); if (owner !== -1 && owner !== cellIdx) { r = br; g = bgc; b = bbl; } }
      cell[d] = r; cell[d + 1] = g; cell[d + 2] = b; cell[d + 3] = 255;
    }
    return { data: cell, w, h };
  }

  // [color-builder.html:613] traceMask
  // Trace an RGBA mask (ink=black) to a single SVG path-d string via Potrace.
  async function traceMask(mask, w, h, turd) {
    const TracerCore = TC();
    const svg = await TracerCore.traceCellBitmap({ data: mask, w, h }, turd, true, 1.0, 0.2);
    return TracerCore.extractPathDFromSvg(svg).join(' ');
  }

  // [color-builder.html:626] sliceRowByGaps
  // Gap-based slicing for cleanly-separated rows (punctuation, well-spaced
  // letters/digits). Anchored slicing assumes ~even glyph pitch, which breaks
  // on punctuation where widths vary wildly. This cuts at the (n-1) WIDEST
  // whitespace gaps instead — so each glyph gets its real width and multi-part
  // marks (" : ; ! ?) stay whole (their internal gaps are narrower than the
  // inter-glyph ones). Returns null when the row doesn't separate into n clean
  // groups (e.g. touching italics) so the caller falls back to anchored+ownership.
  function sliceRowByGaps(union, w, y0, y1, n) {
    if (n <= 1) return null;
    const colInk = new Uint32Array(w);
    for (let x = 0; x < w; x++) { let c = 0; for (let y = y0; y < y1; y++) if (union[(y * w + x) * 4] === 0) c++; colInk[x] = c; }
    let x0 = -1, x1 = -1; for (let x = 0; x < w; x++) if (colInk[x]) { x0 = x; break; } for (let x = w - 1; x >= 0; x--) if (colInk[x]) { x1 = x + 1; break; }
    if (x0 < 0 || x1 - x0 < n) return null;
    const gaps = []; let g = -1;
    for (let x = x0; x < x1; x++) { if (colInk[x] === 0) { if (g < 0) g = x; } else if (g >= 0) { gaps.push({ s: g, e: x, wd: x - g }); g = -1; } }
    if (gaps.length < n - 1) return null;
    const boundaries = gaps.slice().sort((a, b) => b.wd - a.wd).slice(0, n - 1).sort((a, b) => a.s - b.s);
    const avgCell = (x1 - x0) / n;
    let minB = Infinity; for (const b of boundaries) if (b.wd < minB) minB = b.wd;
    // every boundary must be REAL whitespace, else this row isn't cleanly split.
    if (minB < Math.max(2, avgCell * 0.18)) return null;
    const cuts = [x0]; for (const b of boundaries) cuts.push(Math.round((b.s + b.e) / 2)); cuts.push(x1);
    const ranges = []; for (let i = 0; i < cuts.length - 1; i++) ranges.push([cuts[i], cuts[i + 1]]);
    return ranges;
  }

  // [color-builder.html:650] computeSeam
  // Min-ink seam between two cursive letters. A connected script joins letters
  // with a thin DIAGONAL stroke, so a straight vertical cut slices through
  // letter bodies and leaves stubs. Instead, run a top-to-bottom shortest-path
  // through an x-band that crosses the LEAST ink, stepping at most +/-1px per row
  // so it can wiggle along the thin connector. Returns x for each row (y1-y0).
  function computeSeam(union, w, y0, y1, lo, hi) {
    lo = Math.max(0, lo); hi = Math.min(w - 1, hi); const bw = hi - lo + 1, rowH = y1 - y0;
    if (bw < 1 || rowH < 1) return null;
    const INF = 1e9, cost = new Float64Array(bw * rowH), par = new Int32Array(bw * rowH);
    const ink = (x, y) => union[((y0 + y) * w + x) * 4] === 0 ? 1 : 0;
    for (let bx = 0; bx < bw; bx++) cost[bx] = ink(lo + bx, 0);
    for (let y = 1; y < rowH; y++) {
      for (let bx = 0; bx < bw; bx++) {
        let best = INF, bp = bx;
        for (let d = -1; d <= 1; d++) { const px = bx + d; if (px < 0 || px >= bw) continue; const c = cost[(y - 1) * bw + px]; if (c < best) { best = c; bp = px; } }
        cost[y * bw + bx] = ink(lo + bx, y) + best + Math.abs(bx - bp) * 0.001; par[y * bw + bx] = bp;
      }
    }
    let end = 0, bc = INF; for (let bx = 0; bx < bw; bx++) { const c = cost[(rowH - 1) * bw + bx]; if (c < bc) { bc = c; end = bx; } }
    const seam = new Int32Array(rowH); let cur = end;
    for (let y = rowH - 1; y >= 0; y--) { seam[y] = lo + cur; cur = par[y * bw + cur]; }
    return seam;
  }

  // [color-builder.html:678] seamCellsForRow
  // Blob-aware seam cells for a non-gap row -> n cells, each bounded by a left
  // and right seam (x-per-row). Works off the row's INK BLOBS (runs of inked
  // columns) instead of blind even pitch, so the cells land on actual letters:
  //   - one blob per letter (n blobs)  -> a cell per blob.
  //   - fewer blobs than letters       -> a blob holds 2+ merged letters; split
  //     it into that many sub-cells at internal min-ink seams (touching I-J, or
  //     a fully-connected cursive where one blob holds the whole row).
  //   - more blobs than letters        -> a letter fragmented; fall back to even
  //     pitch across the ink extent.
  function seamCellsForRow(union, w, y0, y1, n) {
    if (n < 1) return null;
    const rowH = y1 - y0;
    let x0 = -1, x1 = -1; const colInk = new Uint32Array(w);
    for (let x = 0; x < w; x++) { let c = 0; for (let y = y0; y < y1; y++) if (union[(y * w + x) * 4] === 0) c++; colInk[x] = c; if (c) { if (x0 < 0) x0 = x; x1 = x; } }
    if (x0 < 0) return null; x1 += 1;
    const flat = v => { const a = new Int32Array(rowH); a.fill(v); return a; };
    const seamOrFlat = (t, half) => { const s = computeSeam(union, w, y0, y1, Math.round(t - half), Math.round(t + half)); return s || flat(Math.round(t)); };
    // inked-column runs (visual blobs)
    const runs = []; let s = -1;
    for (let x = x0; x < x1; x++) { if (colInk[x] > 0) { if (s < 0) s = x; } else if (s >= 0) { runs.push([s, x]); s = -1; } }
    if (s >= 0) runs.push([s, x1]);
    if (!runs.length) return null;
    const cells = [];
    if (runs.length === n) { for (const [a, b] of runs) cells.push({ left: flat(a), right: flat(b) }); return cells; }
    if (runs.length > n) {
      const pitch = (x1 - x0) / n; const seams = [flat(x0)];
      for (let k = 1; k < n; k++) seams.push(seamOrFlat(x0 + k * pitch, pitch * 0.42));
      seams.push(flat(x1));
      for (let i = 0; i < n; i++) cells.push({ left: seams[i], right: seams[i + 1] });
      return cells;
    }
    // runs.length < n : distribute letters across blobs by width, split wide ones.
    const typ = (x1 - x0) / n;
    const counts = runs.map(([a, b]) => Math.max(1, Math.round((b - a) / typ)));
    let sum = counts.reduce((a, c) => a + c, 0);
    while (sum > n) { let bi = 0; for (let i = 1; i < counts.length; i++) if (counts[i] > counts[bi]) bi = i; if (counts[bi] <= 1) break; counts[bi]--; sum--; }
    while (sum < n) { let bi = 0, br = -1; for (let i = 0; i < runs.length; i++) { const r = (runs[i][1] - runs[i][0]) / counts[i]; if (r > br) { br = r; bi = i; } } counts[bi]++; sum++; }
    if (sum !== n) return null;
    for (let i = 0; i < runs.length; i++) {
      const [a, b] = runs[i], cnt = counts[i];
      if (cnt === 1) { cells.push({ left: flat(a), right: flat(b) }); continue; }
      const sub = (b - a) / cnt, edges = [flat(a)];
      for (let k = 1; k < cnt; k++) edges.push(seamOrFlat(a + k * sub, sub * 0.45));
      edges.push(flat(b));
      for (let k = 0; k < cnt; k++) cells.push({ left: edges[k], right: edges[k + 1] });
    }
    return cells;
  }

  // [color-builder.html:720] extractSeamCell
  // Extract a seam-bounded cell to an RGBA bitmap: crop to the seams' bbox (plus
  // pad) and set every pixel outside [leftSeam,rightSeam) to background.
  function extractSeamCell(data, fullW, fullH, cell, y0, y1, pad, bg) {
    const left = cell.left, right = cell.right, rowH = y1 - y0;
    let lminX = fullW, rmaxX = 0; for (let y = 0; y < rowH; y++) { if (left[y] < lminX) lminX = left[y]; if (right[y] > rmaxX) rmaxX = right[y]; }
    const cx0 = Math.max(0, lminX - pad), cx1 = Math.min(fullW, rmaxX + pad), cy0 = Math.max(0, y0 - pad), cy1 = Math.min(fullH, y1 + pad);
    const w = cx1 - cx0, h = cy1 - cy0, out = new Uint8ClampedArray(w * h * 4);
    for (let ly = 0; ly < h; ly++) {
      const sy = cy0 + ly, si = Math.min(rowH - 1, Math.max(0, sy - y0)); const lb = left[si], rb = right[si];
      for (let lx = 0; lx < w; lx++) {
        const sx = cx0 + lx, o = (ly * w + lx) * 4;
        if (sx >= lb && sx < rb) { const k = (sy * fullW + sx) * 4; out[o] = data[k]; out[o + 1] = data[k + 1]; out[o + 2] = data[k + 2]; out[o + 3] = 255; }
        else { out[o] = bg.r; out[o + 1] = bg.g; out[o + 2] = bg.b; out[o + 3] = 255; }
      }
    }
    return { data: out, w, h, rect: [cx0, cy0, cx1, cy1] };
  }

  // [color-builder.html:739] enclosedHoleArea
  // Enclosed-hole (counter) area of a glyph silhouette: flood-fill the
  // background inward from the cell border, then any non-ink pixel the flood
  // never reached is an enclosed counter (the hole in O, A, e, 0...). A glow /
  // halo bloats letters until their counters fill in, so this going to ~0 on
  // letters that should have a counter is the signature we warn on. union is
  // RGBA with ink = channel0 === 0.
  function enclosedHoleArea(union, w, h) {
    const N = w * h, seen = new Uint8Array(N), stack = new Int32Array(N); let sp = 0;
    const isBg = p => union[p * 4] !== 0;
    for (let x = 0; x < w; x++) { const t = x, b = (h - 1) * w + x; if (isBg(t) && !seen[t]) { seen[t] = 1; stack[sp++] = t; } if (isBg(b) && !seen[b]) { seen[b] = 1; stack[sp++] = b; } }
    for (let y = 0; y < h; y++) { const l = y * w, r = y * w + w - 1; if (isBg(l) && !seen[l]) { seen[l] = 1; stack[sp++] = l; } if (isBg(r) && !seen[r]) { seen[r] = 1; stack[sp++] = r; } }
    while (sp) {
      const p = stack[--sp], y = (p / w) | 0, x = p - y * w;
      if (x > 0) { const q = p - 1; if (!seen[q] && isBg(q)) { seen[q] = 1; stack[sp++] = q; } }
      if (x < w - 1) { const q = p + 1; if (!seen[q] && isBg(q)) { seen[q] = 1; stack[sp++] = q; } }
      if (y > 0) { const q = p - w; if (!seen[q] && isBg(q)) { seen[q] = 1; stack[sp++] = q; } }
      if (y < h - 1) { const q = p + w; if (!seen[q] && isBg(q)) { seen[q] = 1; stack[sp++] = q; } }
    }
    let hole = 0; for (let p = 0; p < N; p++) if (isBg(p) && !seen[p]) hole++;
    return hole;
  }

  // [color-builder.html:754] COUNTER_CHARS
  // Letters whose normal form has an enclosed counter — used to detect glow bloat.
  const COUNTER_CHARS = new Set(['A', 'B', 'D', 'O', 'P', 'Q', 'R', 'a', 'b', 'd', 'e', 'g', 'o', 'p', 'q', '0', '4', '6', '8', '9']);

  /* ----------------------------------------------------------------
   * Per-record trace + confidence (ported from traceRecord / computeConfidence).
   * These mutate a record object in place, exactly as the source does.
   * ---------------------------------------------------------------- */

  // [color-builder.html:833] traceRecord
  // Segment + trace one record's stored cell. Fills baseD / layers / metrics.
  // `ctx` carries the cross-record params the source pulled from state/DOM:
  //   { palette, mode, outline, outlineWidth }
  async function traceRecord(rec, ctx) {
    const ColorCore = CC(), TracerCore = TC();
    const pal = ctx.palette, cell = rec.cell; const [cx0, cy0, cx1, cy1] = rec.cellRect;
    const sep = ColorCore.separateGlyph(cell.data, cell.w, cell.h, pal);
    if (sep.totalInk === 0) { rec.status = 'empty'; rec.flags = ['empty']; rec.baseD = null; rec.layers = []; return; }
    const baseD = await traceMask(sep.union, cell.w, cell.h, rec.turd);
    if (!baseD) { rec.status = 'empty'; rec.flags = ['empty']; rec.baseD = null; rec.layers = []; return; }
    const cellMap = TracerCore.mapCellToGlyph(cx0, cy0, cx1, cy1, rec.baselineAbs);
    rec.baseD = baseD; rec.cellW = cellMap.cellW; rec.baselineYInCell = cellMap.baselineYInCell;
    rec.bodyMinX = sep.bodyMinX; rec.bodyMaxX = sep.bodyMaxX; rec.bodyW = sep.bodyMaxX - sep.bodyMinX;
    // Counter-hole area for glow/bloat detection. In flat mode measure it on the
    // largest colour LAYER (the letter's own fill), not the merged silhouette, so
    // a different-coloured offset block / 3D extrude sitting behind the letter
    // doesn't fill the counter and read as glow (false warning). Gradient mode has
    // no separate layers, so it uses the union (a real glow fills that).
    let holeMask = sep.union, holeInk = sep.totalInk;
    if (ctx.mode !== 'gradient' && sep.layers && sep.layers.length) {
      let bestInk = -1;
      for (const l of sep.layers) { const m = l.mask; let ink = 0; for (let p = 0; p < cell.w * cell.h; p++) if (m[p * 4] === 0) ink++; if (ink > bestInk) { bestInk = ink; holeMask = m; holeInk = ink; } }
    }
    rec.holeArea = enclosedHoleArea(holeMask, cell.w, cell.h); rec.inkArea = holeInk;
    rec.insetD = null;
    if (ctx.mode !== 'gradient') {
      const layers = [];
      for (const l of sep.layers) { const d = await traceMask(l.mask, cell.w, cell.h, rec.turd); if (d) layers.push({ paletteIndex: l.paletteIndex, d }); }
      rec.layers = layers;
    } else {
      rec.layers = [];
      // Outline mode: erode the silhouette to an inset, trace it. The inset gets
      // the gradient; the full base shows around it as the black outline ring.
      if (ctx.outline) {
        const w = cell.w, h = cell.h, bin = new Uint8Array(w * h);
        for (let p = 0; p < w * h; p++) bin[p] = sep.union[p * 4] === 0 ? 1 : 0;
        const ow = Math.max(1, ctx.outlineWidth || 4);
        const inset = ColorCore.erode(bin, w, h, ow);
        let any = false; for (let p = 0; p < w * h; p++) { if (inset[p]) { any = true; break; } }
        if (any) { const rgba = new Uint8ClampedArray(w * h * 4); for (let p = 0; p < w * h; p++) { const v = inset[p] ? 0 : 255, k = p * 4; rgba[k] = rgba[k + 1] = rgba[k + 2] = v; rgba[k + 3] = 255; } rec.insetD = await traceMask(rgba, w, h, rec.turd); }
      }
    }
    if (rec.status !== 'excluded') rec.status = 'ok';
  }

  // [color-builder.html:876] computeConfidence
  // Flag suspect glyphs: empty (no ink), wide (likely two letters merged) or
  // narrow (likely a sliver / partial slice) vs the median body width. Also a
  // sheet-level glow warning when counters (O, A, e, 0...) fill in.
  // Returns the glowWarning boolean (the source stored it on state.glowWarning).
  function computeConfidence(records, mode) {
    records.forEach(r => { if (r.status !== 'excluded') r.flags = r.status === 'empty' ? ['empty'] : []; });
    const ws = records.filter(r => r.status === 'ok' && r.bodyW > 0).map(r => r.bodyW).sort((a, b) => a - b);
    let glowWarning = false;
    if (!ws.length) return glowWarning;
    const med = ws[ws.length >> 1];
    records.forEach(r => {
      if (r.status !== 'ok' || !med) return;
      if (r.bodyW > med * 1.9) r.flags.push('wide');
      else if (r.bodyW < med * 0.34) r.flags.push('narrow');
    });
    // Glow / halo detection: counter-letters whose enclosed hole has filled in.
    let counters = 0, filled = 0;
    records.forEach(r => {
      if (r.status !== 'ok' || !COUNTER_CHARS.has(r.char) || !r.inkArea) return;
      counters++;
      if (r.holeArea < 0.02 * r.inkArea) { filled++; r.flags.push('filled'); }
    });
    glowWarning = (counters >= 6 && filled / counters >= 0.5);
    return glowWarning;
  }

  /* ----------------------------------------------------------------
   * analyze() pipeline — palette detect (+ shadow strip) + row detect.
   * Ported from color-builder.html:450. Returns the working set the rest of
   * the pipeline needs, instead of writing it onto `state`.
   * ---------------------------------------------------------------- */
  function analyze(colorData, w, h, cfg) {
    const ColorCore = CC(), TracerCore = TC();
    const K = cfg.K, bgDist = cfg.bgDist;
    // detectPalette gives us the background + a clean ink union for row
    // detection in BOTH modes (gradient mode only uses pal.bg / pal.bgDist).
    let pal = ColorCore.detectPalette(colorData, w, h, K, { bgDist });
    // Drop-shadow removal: if a dark offset-duplicate of the ink is present,
    // strip it into a shadow-free WORKING copy that every downstream step reads.
    // Detect on the ORIGINAL, then re-detect the palette on the clean copy so
    // the shadow colour leaves the set.
    let workData, shadowRemoved;
    const shadowMask = ColorCore.detectShadowMask(colorData, w, h, pal);
    if (shadowMask) {
      const clean = new Uint8ClampedArray(colorData), bg = pal.bg;
      for (let p = 0; p < w * h; p++) { if (shadowMask[p]) { const i = p * 4; clean[i] = bg.r; clean[i + 1] = bg.g; clean[i + 2] = bg.b; clean[i + 3] = 255; } }
      workData = clean; shadowRemoved = true;
      pal = ColorCore.detectPalette(workData, w, h, K, { bgDist });
    } else { workData = colorData; shadowRemoved = false; }

    const union = unionInkBinary(workData, w, h, pal);
    let rows = TracerCore.detectRowsInBinary(union, w, h);
    // If the default (empty-scanline) detector disagrees with the expected row
    // count, retry with the expected-count-aware profile detector — it recovers
    // rows bridged by drop shadows / tall scripts. Keep the default if the retry
    // can't produce that many clean bands.
    const expRows = cfg.expectedRows;
    if (expRows >= 2 && rows.length !== expRows) {
      const alt = detectRowsByProfile(union, w, h, expRows);
      if (alt && alt.length === expRows) rows = alt;
    }

    return { palette: pal, workData, shadowRemoved, union, rows };
  }

  /* ----------------------------------------------------------------
   * buildRecords() — slice each row, extract + trace each cell into a record.
   * Ported from color-builder.html:777.
   * ---------------------------------------------------------------- */
  async function buildRecords(work, cfg) {
    const TracerCore = TC();
    const pal = work.palette, turd = cfg.turd, pad = 2;
    const charLines = cfg.charLines; // array of arrays of chars (spaces dropped)
    const w = work.w, h = work.h, union = work.union, src = work.workData;
    const records = [];
    const usedRows = Math.min(work.rows.length, charLines.length);
    // Row-count guardrail: if detected row count != number of charset lines, the
    // rows-to-characters mapping is wrong and the font will be misaligned. Record
    // it so the caller can report LOUDLY instead of silently shipping garble.
    const expectedRows = charLines.filter(l => l.length).length;
    const rowWarning = (work.rows.length !== expectedRows)
      ? ('Detected ' + work.rows.length + ' row' + (work.rows.length === 1 ? '' : 's') + ', but your character set has ' + expectedRows + ' lines. Row detection likely failed (a drop shadow, tall script, or touching rows can bridge the gaps). ' + usedRows + ' row' + (usedRows === 1 ? '' : 's') + ' built, so glyphs are probably misaligned. Re-check the sheet, or edit the Characters to match what was detected.')
      : '';

    const traceCtx = { palette: pal, mode: cfg.mode, outline: cfg.outline, outlineWidth: cfg.outlineWidth };

    for (let r = 0; r < usedRows; r++) {
      const [y0r, y1r] = work.rows[r]; const rowChars = charLines[r]; if (!rowChars.length) continue;
      // Pick the slicer per row:
      //  1. Clean gaps (punctuation, spaced glyphs) -> gap slicing (uneven widths).
      //  2. Anything that DIDN'T separate into clean gaps (a fully-connected
      //     cursive, OR a mostly-separated row with one or two merged pairs like
      //     a touching I-J) -> diagonal min-ink seams. Seams force N hard cells
      //     split at the thinnest neck, so a merged pair is divided between two
      //     cells. Ownership-by-centroid can't do this.
      //  3. Anchored + ownership only as a last resort if seam-cutting can't run.
      let ranges, ownerFn = null, seamCells = null;
      const gapRanges = sliceRowByGaps(union, w, y0r, y1r, rowChars.length);
      if (gapRanges) { ranges = gapRanges; }
      else if (rowChars.length > 1) {
        seamCells = seamCellsForRow(union, w, y0r, y1r, rowChars.length);
      }
      if (!gapRanges && !seamCells) { const sr = TracerCore.sliceRowByAnchoredWithOwnership(union, w, y0r, y1r, rowChars.length, turd); ranges = sr.ranges; ownerFn = sr.ownerFn; }
      const baselineAbs = TracerCore.detectBaselineInRow(union, w, y0r, y1r);
      for (let i = 0; i < rowChars.length; i++) {
        const rec = { char: rowChars[i], row: r, status: 'ok', flags: [], turd };
        if (seamCells) {
          const sc = extractSeamCell(src, w, h, seamCells[i], y0r, y1r, pad, pal.bg);
          rec.cell = { data: sc.data, w: sc.w, h: sc.h }; rec.cellRect = sc.rect; rec.baselineAbs = baselineAbs; rec.cellH = sc.rect[3] - sc.rect[1];
        } else {
          const range = ranges[i];
          if (!range) { rec.status = 'empty'; rec.flags = ['empty']; records.push(rec); continue; }
          const [x0, x1] = range;
          const cx0 = Math.max(0, x0 - pad), cx1 = Math.min(w, x1 + pad), cy0 = Math.max(0, y0r - pad), cy1 = Math.min(h, y1r + pad);
          rec.cell = extractColorCell(src, w, cx0, cx1, cy0, cy1, ownerFn, i, pal.bg);
          rec.cellRect = [cx0, cy0, cx1, cy1]; rec.baselineAbs = baselineAbs; rec.cellH = cy1 - cy0;
        }
        await traceRecord(rec, traceCtx);
        records.push(rec);
      }
    }
    return { records, rowWarning };
  }

  /* ----------------------------------------------------------------
   * Public API
   * ---------------------------------------------------------------- */

  // Source's default 6-row charset (color-builder.html textarea, lines 197-202).
  const DEFAULT_CHAR_LINES = [
    'ABCDEFGHIJKLM',
    'NOPQRSTUVWXYZ',
    'abcdefghijklm',
    'nopqrstuvwxyz',
    '0123456789',
    ".,!?:;'\"-&@#",
  ];

  // Draw a loaded image to a canvas and return { data, w, h } RGBA pixels.
  // Accepts anything drawable with naturalWidth/naturalHeight or width/height.
  function imageToRGBA(img) {
    const w = img.naturalWidth || img.width;
    const h = img.naturalHeight || img.height;
    if (!w || !h) throw new Error('image has no dimensions (not loaded?)');
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    const ctx = c.getContext('2d'); ctx.drawImage(img, 0, 0);
    const data = ctx.getImageData(0, 0, w, h).data;
    return { data, w, h };
  }

  /* buildColorFromImage(img, opts) -> Promise<{
   *   otf: Uint8Array, mode, colrStatus, palette: [{r,g,b}],
   *   stops?: [{offset,r,g,b}], charCount, stats
   * }>
   *
   * Runs the SAME pipeline color-builder's assemble flow runs: detectPalette
   * (+ optional shadow strip) -> union ink mask -> row detect -> per-row slice
   * (gaps -> seam -> anchored-ownership fallback) -> per-cell separateGlyph ->
   * trace the union to baseD, plus (flat) trace each colour layer or (gradient)
   * sample sampleFireGradient -> buildColorFont / buildGradientFont.
   */
  async function buildColorFromImage(img, opts) {
    opts = opts || {};
    const ColorCore = CC();
    if (!ColorCore) throw new Error('window.ColorCore not loaded');
    if (!TC()) throw new Error('window.TracerCore not loaded');

    // ---- resolve opts with the source's defaults ----
    const mode = opts.mode === 'gradient' ? 'gradient' : 'flat';
    const K = opts.K != null ? opts.K : 3;
    const stopsN = opts.stops != null ? opts.stops : 5;
    const bgDist = opts.bgDist != null ? opts.bgDist : 20;
    const turd = opts.turd != null ? opts.turd : 2;
    const gradientAngle = opts.gradientAngle != null ? opts.gradientAngle : 0;
    const outline = !!opts.outline;
    const outlineWidth = opts.outlineWidth != null ? opts.outlineWidth : 4;
    const gloss = !!opts.gloss;
    const glossStrength = opts.glossStrength != null ? opts.glossStrength : 0.55;
    const familyName = opts.familyName || 'Color Font';
    const styleName = opts.styleName || 'Regular';
    const unitsPerEm = opts.unitsPerEm != null ? opts.unitsPerEm : 1000;
    const sideBearing = opts.sideBearing != null ? opts.sideBearing : 50;
    const kern = opts.kern !== false; // default true
    const charLinesRaw = (opts.charLines && opts.charLines.length) ? opts.charLines : DEFAULT_CHAR_LINES;
    // Split each row string into chars, drop spaces (matches the source's
    // `[...l].filter(ch=>ch!==' ')` and `expectedRowCount` line-filtering).
    const charLines = charLinesRaw.map(l => [...l].filter(ch => ch !== ' '));
    const expectedRows = charLines.filter(l => l.length).length;

    // ---- draw image -> RGBA ----
    const px = imageToRGBA(img);
    const w = px.w, h = px.h, colorData = px.data;

    // ---- analyze: palette (+ shadow strip) + rows ----
    const ana = analyze(colorData, w, h, { K, bgDist, mode, expectedRows });
    if (!ana.rows.length) throw new Error('No character rows detected — ensure dark characters on a light background, or raise bgDist.');

    // ---- gradient mode: sample the fire gradient up front (analyze does this) ----
    let gradientStops = null;
    if (mode === 'gradient') {
      const g = ColorCore.sampleFireGradient(ana.workData, w, h, ana.rows, { bg: ana.palette.bg, bgDist, stops: stopsN });
      gradientStops = g.stops;
      if (!gradientStops || gradientStops.length < 2) throw new Error('No ink found to sample a gradient.');
    } else {
      if (!ana.palette.colors.length) throw new Error('No palette colors detected.');
    }

    // ---- slice + trace every cell into records ----
    const work = {
      palette: ana.palette, workData: ana.workData, union: ana.union, rows: ana.rows, w, h,
    };
    const cfg = { mode, turd, outline, outlineWidth, charLines };
    const built = await buildRecords(work, cfg);
    const records = built.records;
    if (!records.length) throw new Error('No glyphs found — check the sheet and background sensitivity.');

    // ---- confidence flags (also produces the glow warning) ----
    const glowWarning = computeConfidence(records, mode);

    // ---- assemble: map usable records to engine `chars`, call the build engine ----
    // (Ported from assembleAndPreview, minus validate/preview/telemetry/DOM.)
    const recs = records.filter(r => r.status === 'ok' && r.baseD);
    if (!recs.length) throw new Error('No usable glyphs — fix or re-trace flagged ones.');
    const chars = recs.map(r => ({
      char: r.char, baseD: r.baseD, insetD: r.insetD, layers: r.layers,
      cellW: r.cellW, cellH: r.cellH, baselineYInCell: r.baselineYInCell,
      bodyMinX: r.bodyMinX, bodyMaxX: r.bodyMaxX,
    }));

    // Build-opts passed through to the engine. Mirrors the source's `opts` object
    // in assembleAndPreview (color-builder.html:901-904) with the resolved values.
    const buildOpts = {
      familyName: familyName,
      unitsPerEm: unitsPerEm,
      sideBearing: sideBearing,
      kern: kern,
      gradientAngle: gradientAngle,
      outline: outline,
      darkPalette: !!opts.darkPalette,
      gloss: gloss,
      glossStrength: glossStrength,
      outlineWidth: outlineWidth,
      styleName: styleName,
      version: opts.version || '1.0',
      designer: opts.designer || '',
      license: opts.license || '',
    };

    let res;
    if (mode === 'gradient') {
      if (typeof global.buildGradientFont !== 'function') throw new Error('window.buildGradientFont not loaded');
      res = global.buildGradientFont(chars, gradientStops, buildOpts);
    } else {
      if (typeof global.buildColorFont !== 'function') throw new Error('window.buildColorFont not loaded');
      res = global.buildColorFont(chars, ana.palette, buildOpts);
    }

    // The color writers fail SAFE to mono outlines and report the outcome on
    // stats.colrStatus (e.g. 'ok' / 'skipped'). Surface it so the caller can
    // confirm COLR actually got injected rather than assuming colour from a font
    // that silently fell back to monochrome.
    const colrStatus = res.stats ? res.stats.colrStatus : undefined;

    const out = {
      otf: res.bytes,                // Uint8Array sfnt (OTF/CFF) bytes
      mode: mode,
      colrStatus: colrStatus,
      palette: ana.palette.colors.map(c => ({ r: c.r, g: c.g, b: c.b })),
      charCount: chars.length,
      stats: res.stats,
    };
    if (mode === 'gradient') {
      out.stops = gradientStops.map(s => ({ offset: s.offset, r: s.r, g: s.g, b: s.b }));
    }
    // Pass through the build-time warnings the source surfaced in status/telemetry,
    // so a headless caller still sees them (row mismatch, glow bloat).
    out.rowWarning = built.rowWarning || '';
    out.glowWarning = glowWarning;
    // Per-glyph health report for the inspection grid (char, status, flags).
    // Includes dropped/excluded records so the grid shows what didn't make it.
    out.report = records.map(function (r) {
      return { char: r.char, status: r.status, flags: r.flags || [] };
    });
    return out;
  }

  global.ColorMaker = { buildColorFromImage };
})(typeof self !== 'undefined' ? self : this);
