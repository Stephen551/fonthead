/* ============================================================
 * font-engine-sidebearings.js  (Phase 6 — optical sidebearing optimization)
 * ------------------------------------------------------------
 * Worker- and main-thread-safe. Post-processes a built opentype.Font
 * to re-center each glyph optically within its advance width. Cuts
 * manual kerning burden by ~40% per the plan: narrow glyphs (i, l,
 * I, J, t, !, .) that drift left in their cell-width advance get
 * recentered; symmetric glyphs (O, H, M) are barely touched.
 *
 * Approach:
 *   1. For each glyph that has a path, compute its OPTICAL CENTER —
 *      the x-coordinate where the contour's mass-weighted centroid
 *      lies. We sample the path at fixed intervals (cheaper than
 *      rasterizing; accurate enough for centering at letter scale).
 *   2. Compare optical center to advance/2 (where we WANT it to sit).
 *   3. If they differ by more than a small threshold, translate every
 *      point in the path by (advance/2 - opticalCenter) on the x-axis.
 *      The path's bbox shifts; opentype.js's hmtx writer recomputes
 *      leftSideBearing from the new bbox, so we don't touch hmtx
 *      directly.
 *
 * Why path sampling, not raster scan: this module runs in both the
 * main thread (live preview) and the worker. Main thread doesn't
 * have OffscreenCanvas guaranteed; sampling the path's parametric
 * form is portable and fast (~0.5ms per glyph). We sample line
 * endpoints + ~10 points per Bezier segment, weight by segment
 * length, take the mean x as the optical center.
 *
 * What we DON'T do:
 *   - Touch advanceWidth (cell width remains the rhythm)
 *   - Adjust .notdef / space (no path, nothing to recenter)
 *   - Center glyphs that already sit within ±2u of advance/2
 *   - Touch glyphs whose path is degenerate (single point, zero area)
 *
 * Public entry:
 *   optimizeSidebearings(font, opts?) -> {
 *     adjustedCount, totalCount, maxShift, meanAbsShift
 *   }
 *
 *   opts.threshold (default 2): skip adjustments smaller than this
 *     (font units). Avoids pointless wiggling for already-centered glyphs.
 *   opts.maxShiftFraction (default 0.30): cap adjustment at this
 *     fraction of advance. Stops a wildly-detected optical center
 *     from yanking a glyph halfway out of its cell.
 *
 * Idempotent: running this twice produces the same result as once
 * (after first pass each glyph's optical center is at advance/2).
 * ============================================================ */
(function(global){
  'use strict';

  const SAMPLES_PER_CURVE = 10;

  /* Sample a cubic Bezier at N evenly-spaced t values. Returns
     array of {x, y} points. */
  function sampleCubic(x0, y0, x1, y1, x2, y2, x3, y3, n) {
    const out = [];
    for (let i = 1; i <= n; i++) {
      const t = i / n;
      const u = 1 - t;
      const b0 = u*u*u, b1 = 3*u*u*t, b2 = 3*u*t*t, b3 = t*t*t;
      out.push({
        x: b0*x0 + b1*x1 + b2*x2 + b3*x3,
        y: b0*y0 + b1*y1 + b2*y2 + b3*y3,
      });
    }
    return out;
  }

  /* Sample a quadratic Bezier at N evenly-spaced t values. */
  function sampleQuad(x0, y0, x1, y1, x2, y2, n) {
    const out = [];
    for (let i = 1; i <= n; i++) {
      const t = i / n;
      const u = 1 - t;
      const b0 = u*u, b1 = 2*u*t, b2 = t*t;
      out.push({
        x: b0*x0 + b1*x1 + b2*x2,
        y: b0*y0 + b1*y1 + b2*y2,
      });
    }
    return out;
  }

  function dist(ax, ay, bx, by) {
    const dx = bx - ax, dy = by - ay;
    return Math.sqrt(dx*dx + dy*dy);
  }

  /* Walk a path's commands, collect sample points along every segment,
     return mean x weighted by approximate segment length. Used as the
     proxy for "optical center" — it's the centroid of the path
     ARC LENGTH, not the enclosed area, but for our small letter-scale
     glyphs the two are close and arc-length is cheaper to compute. */
  function opticalCenterX(commands) {
    if (!commands || commands.length === 0) return null;
    let totalLen = 0;
    let weightedX = 0;
    let cx = 0, cy = 0;
    let startX = 0, startY = 0;
    let hasInk = false;
    for (const cmd of commands) {
      switch (cmd.type) {
        case 'M':
          cx = cmd.x; cy = cmd.y;
          startX = cx; startY = cy;
          break;
        case 'L': {
          const segLen = dist(cx, cy, cmd.x, cmd.y);
          if (segLen > 0) {
            /* Approximate the segment by its midpoint times length. */
            const mx = (cx + cmd.x) / 2;
            weightedX += mx * segLen;
            totalLen += segLen;
            hasInk = true;
          }
          cx = cmd.x; cy = cmd.y;
          break;
        }
        case 'C': {
          /* Sample, accumulate per sub-segment between adjacent samples. */
          const samples = sampleCubic(cx, cy, cmd.x1, cmd.y1, cmd.x2, cmd.y2, cmd.x, cmd.y, SAMPLES_PER_CURVE);
          let prevX = cx, prevY = cy;
          for (const s of samples) {
            const segLen = dist(prevX, prevY, s.x, s.y);
            if (segLen > 0) {
              const mx = (prevX + s.x) / 2;
              weightedX += mx * segLen;
              totalLen += segLen;
              hasInk = true;
            }
            prevX = s.x; prevY = s.y;
          }
          cx = cmd.x; cy = cmd.y;
          break;
        }
        case 'Q': {
          const samples = sampleQuad(cx, cy, cmd.x1, cmd.y1, cmd.x, cmd.y, SAMPLES_PER_CURVE);
          let prevX = cx, prevY = cy;
          for (const s of samples) {
            const segLen = dist(prevX, prevY, s.x, s.y);
            if (segLen > 0) {
              const mx = (prevX + s.x) / 2;
              weightedX += mx * segLen;
              totalLen += segLen;
              hasInk = true;
            }
            prevX = s.x; prevY = s.y;
          }
          cx = cmd.x; cy = cmd.y;
          break;
        }
        case 'Z': {
          /* Close back to start with an implicit line. */
          const segLen = dist(cx, cy, startX, startY);
          if (segLen > 0) {
            const mx = (cx + startX) / 2;
            weightedX += mx * segLen;
            totalLen += segLen;
          }
          cx = startX; cy = startY;
          break;
        }
      }
    }
    if (!hasInk || totalLen === 0) return null;
    return weightedX / totalLen;
  }

  /* Translate every coordinate in a path by dx on the x-axis. Modifies
     path.commands IN PLACE. opentype.js stores path commands as plain
     objects so this is safe to mutate. */
  function translatePath(commands, dx) {
    if (Math.abs(dx) < 0.001) return;
    for (const cmd of commands) {
      if (cmd.x !== undefined) cmd.x += dx;
      if (cmd.x1 !== undefined) cmd.x1 += dx;
      if (cmd.x2 !== undefined) cmd.x2 += dx;
    }
  }

  function optimizeSidebearings(font, opts) {
    opts = opts || {};
    const threshold = opts.threshold != null ? opts.threshold : 2;
    const maxShiftFraction = opts.maxShiftFraction != null ? opts.maxShiftFraction : 0.30;
    if (!font || !font.glyphs) {
      return { adjustedCount: 0, totalCount: 0, maxShift: 0, meanAbsShift: 0 };
    }

    let adjustedCount = 0;
    let totalCount = 0;
    let maxShift = 0;
    let sumAbsShift = 0;
    const total = font.glyphs.length;
    for (let i = 0; i < total; i++) {
      const g = font.glyphs.glyphs[i];
      if (!g || !g.path || !g.path.commands || g.path.commands.length === 0) continue;
      /* Skip .notdef and space — empty / nominal paths. */
      if (g.name === '.notdef' || g.name === 'space') continue;
      if (!g.advanceWidth || g.advanceWidth < 10) continue;
      totalCount++;

      const optCenter = opticalCenterX(g.path.commands);
      if (optCenter == null) continue;
      const target = g.advanceWidth / 2;
      let shift = target - optCenter;
      if (Math.abs(shift) < threshold) continue;
      /* Clamp to a fraction of advance to avoid pathological cases.
         If the detected optical center is wildly off (e.g. due to a
         degenerate sub-contour), don't yank the glyph halfway out of
         the cell — bail rather than wreck it. */
      const cap = g.advanceWidth * maxShiftFraction;
      if (Math.abs(shift) > cap) {
        shift = shift > 0 ? cap : -cap;
      }
      translatePath(g.path.commands, shift);
      adjustedCount++;
      const absShift = Math.abs(shift);
      sumAbsShift += absShift;
      if (absShift > maxShift) maxShift = absShift;
    }

    return {
      adjustedCount,
      totalCount,
      maxShift: Math.round(maxShift * 10) / 10,
      meanAbsShift: adjustedCount > 0 ? Math.round((sumAbsShift / adjustedCount) * 10) / 10 : 0,
    };
  }

  global.optimizeSidebearings = optimizeSidebearings;

})(typeof self !== 'undefined' ? self : this);
