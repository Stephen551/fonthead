/* ============================================================
 * font-engine-vf-compat.js  (variable-font master compatibility)
 * ------------------------------------------------------------
 * Worker-only. Given two parsed master glyph sets (from
 * font-engine-glyf-parser), check pairwise compatibility and
 * compute per-glyph deltas (master2 - master1) for the variable
 * font's gvar table.
 *
 * Compatibility requirements for a per-glyph gvar variation:
 *   1. Both masters have a non-empty glyph at the same index
 *      (or both are empty — empty pairs contribute no variation).
 *   2. Same numContours.
 *   3. Same numPoints per contour (so endPtsOfContours match).
 *   4. Same on/off-curve flag sequence — gvar deltas can't change
 *      a point's curve type at runtime; if master1 has an off-curve
 *      where master2 has on-curve, the variation is invalid.
 *
 * When a glyph fails any check, the output's glyphVariations[i] is
 * null (no variation for that glyph; default outline used at all
 * axis positions). The compatibility report tells the caller which
 * glyphs failed and why, useful for UI feedback or future
 * point-matching tools.
 *
 * Public entry:
 *   computeVariationDeltas(master1, master2, opts?) -> {
 *     glyphVariations: [
 *       null  // incompatible / empty / no-variation
 *       OR
 *       { tuples: [{ peak, deltas }] },
 *       ...
 *     ],
 *     compatible: count,
 *     incompatible: count,
 *     empty: count,
 *     issues: [{ glyphIdx, code, message }, ...]  // first ~20 issues
 *   }
 *
 *   master1, master2 = { glyphs: [...], numGlyphs }  // from parseGlyfTable
 *   opts.peak = axis position for master2 (default 1.0, range -1..1)
 *
 * Phantom points: gvar deltas SHOULD include 4 trailing entries for
 * phantom points (LSB, advance, TSB, advance height). We emit zeros
 * for these since we don't yet vary metrics — Session 3 will add
 * actual metric deltas via HVAR.
 * ============================================================ */
(function(global){
  'use strict';

  function computeVariationDeltas(master1, master2, opts) {
    opts = opts || {};
    const peak = opts.peak != null ? opts.peak : 1.0;

    if (!master1 || !master2 || !master1.glyphs || !master2.glyphs) {
      throw new Error('vf-compat: both masters must have glyphs[]');
    }
    if (master1.numGlyphs !== master2.numGlyphs) {
      throw new Error('vf-compat: glyph count mismatch: '
        + master1.numGlyphs + ' vs ' + master2.numGlyphs);
    }
    const N = master1.numGlyphs;
    const result = {
      glyphVariations: new Array(N),
      compatible: 0,
      incompatible: 0,
      empty: 0,
      issues: [],
    };

    const recordIssue = (idx, code, message) => {
      if (result.issues.length < 20) {
        result.issues.push({ glyphIdx: idx, code, message });
      }
    };

    for (let gi = 0; gi < N; gi++) {
      const g1 = master1.glyphs[gi];
      const g2 = master2.glyphs[gi];

      /* Both empty: no variation needed, valid. */
      if (!g1 && !g2) {
        result.glyphVariations[gi] = null;
        result.empty++;
        continue;
      }
      /* One empty, one not — incompatible (can't interpolate from
         nothing). */
      if (!g1 || !g2) {
        result.glyphVariations[gi] = null;
        result.incompatible++;
        recordIssue(gi, 'one_empty', 'one master empty, other has ' + ((g1 || g2).contours.length) + ' contours');
        continue;
      }

      /* Same number of contours? */
      if (g1.contours.length !== g2.contours.length) {
        result.glyphVariations[gi] = null;
        result.incompatible++;
        recordIssue(gi, 'contour_count', 'numContours ' + g1.contours.length + ' vs ' + g2.contours.length);
        continue;
      }

      /* Per-contour: same number of points + same on/off-curve flags? */
      let ok = true;
      for (let ci = 0; ci < g1.contours.length; ci++) {
        const c1 = g1.contours[ci];
        const c2 = g2.contours[ci];
        if (c1.length !== c2.length) {
          result.glyphVariations[gi] = null;
          result.incompatible++;
          recordIssue(gi, 'point_count',
            'contour ' + ci + ' points ' + c1.length + ' vs ' + c2.length);
          ok = false;
          break;
        }
        for (let pi = 0; pi < c1.length; pi++) {
          if (!!c1[pi].onCurve !== !!c2[pi].onCurve) {
            result.glyphVariations[gi] = null;
            result.incompatible++;
            recordIssue(gi, 'curve_flag',
              'contour ' + ci + ' point ' + pi + ' onCurve mismatch');
            ok = false;
            break;
          }
        }
        if (!ok) break;
      }
      if (!ok) continue;

      /* Compatible — compute deltas. Audit B3: gvar deltas must fit
         in int16 (-32768..32767) per the packDeltas word encoding.
         Mismatched UPM masters or wildly-different glyph positions
         could produce out-of-range deltas; clamping silently would
         warp the glyph. Detect and mark incompatible with a clear
         issue code instead. */
      const deltas = [];
      let outOfRange = false;
      for (let ci = 0; ci < g1.contours.length && !outOfRange; ci++) {
        const c1 = g1.contours[ci];
        const c2 = g2.contours[ci];
        for (let pi = 0; pi < c1.length; pi++) {
          const dx = Math.round(c2[pi].x - c1[pi].x);
          const dy = Math.round(c2[pi].y - c1[pi].y);
          if (dx < -32768 || dx > 32767 || dy < -32768 || dy > 32767) {
            outOfRange = true;
            recordIssue(gi, 'delta_overflow',
              'contour ' + ci + ' point ' + pi + ' delta (' + dx + ',' + dy + ') exceeds int16 range');
            break;
          }
          deltas.push([dx, dy]);
        }
      }
      if (outOfRange) {
        result.glyphVariations[gi] = null;
        result.incompatible++;
        continue;
      }
      /* 4 phantom points (LSB, advance, TSB, advance height) — zeros
         until HVAR / metric variation support lands. */
      deltas.push([0, 0], [0, 0], [0, 0], [0, 0]);

      result.glyphVariations[gi] = {
        tuples: [{ peak: [peak], deltas }],
      };
      result.compatible++;
    }

    return result;
  }

  global.computeVariationDeltas = computeVariationDeltas;

})(typeof self !== 'undefined' ? self : this);
