/* ============================================================
 * font-engine-tt-glyph-hints.js  (Phase 5b/5c — per-glyph TT hint emission)
 * ------------------------------------------------------------
 * Worker-only. Generates per-glyph TrueType hint bytecode that
 * snaps points touching the four blue zones (baseline, x-height,
 * cap-height, descender) to their CVT-stored y values, then runs
 * IUP to interpolate every other point in proportion.
 *
 * This is the FUNCTIONAL half of TT hinting — the cvt/fpgm/prep
 * tables Phase 5a built define the standard values and helper
 * functions; this module is what makes the rasterizer USE them
 * per-glyph. Without per-glyph code, the rasterizer has the values
 * available but nothing tells it which points to snap.
 *
 * Scope (deliberately small for first per-glyph pass):
 *   - Only Y-axis snap. X-axis stem hints are richer work (Phase 5c
 *     full): per-glyph stem detection, MIRP/MDRP encoding, possibly
 *     hintmasks for >8 stems. Skipped here in favor of shipping
 *     the high-ROI Y blue-zone snap that 80% of the visual benefit
 *     comes from at small sizes.
 *   - Snap tolerance: BLUE_TOLERANCE font units. Points within this
 *     of a blue zone y value are considered "on" that zone. Wider
 *     than typical pixel error, narrower than two adjacent zones.
 *   - Round / overshoot logic: if a glyph has multiple points near
 *     the same zone, all of them are snapped. The CVT cut-in from
 *     prep handles the small/large size threshold for when to snap
 *     vs let things float.
 *
 * Stack budget per glyph: 3 (PUSHB N M; PUSHB fn; CALL = 3 items
 * peak) × number of zone touches + 0 for IUP. The Phase 5a maxp
 * sets maxStackElements=32, plenty.
 *
 * Public entry:
 *   buildGlyphHints(contours, blueZones, cvtMap, fpgmMap, opts?)
 *     -> { instructions: Uint8Array, touchedPoints, snapped: [...] }
 *
 *     contours = same format the glyf encoder takes:
 *       [ [ { x, y, onCurve }, ... ], ... ]
 *     blueZones = { baseline, capHeight, xHeight, ascender,
 *                   descender, capOvershoot, xHeightOvershoot,
 *                   descenderOvershoot }   (font units, baseline=0)
 *     cvtMap     = from font-engine-tt-tables.js (CVT slot indices)
 *     fpgmMap    = from font-engine-tt-tables.js (fn numbers)
 *     opts.tolerance: how close (in font units) a point's y must be
 *       to a zone to count as touching. Default 8.
 *
 *   Empty Uint8Array if no points touched any zone (caller should
 *   then write 0 as instructionLength in the glyf entry).
 * ============================================================ */
(function(global){
  'use strict';

  const DEFAULT_TOLERANCE = 8;

  /* Each zone gets two CVT slots: the "ideal" position (flat-top
     reference) and the "overshoot" (round-top reference). Points
     close to either snap to that CVT entry. We prefer the flat
     reference when both are within tolerance — most glyphs we
     generate don't have overshoot drawn in. */
  function pickZoneForY(y, blueZones, cvtMap, tolerance) {
    const cand = [];
    if (blueZones.baseline != null) cand.push({ y: blueZones.baseline, cvt: cvtMap.BLUE_BASELINE });
    if (blueZones.xHeight != null) cand.push({ y: blueZones.xHeight, cvt: cvtMap.BLUE_X_HEIGHT });
    if (blueZones.xHeightOvershoot != null && blueZones.xHeightOvershoot !== blueZones.xHeight) {
      cand.push({ y: blueZones.xHeightOvershoot, cvt: cvtMap.BLUE_X_HEIGHT_OS });
    }
    if (blueZones.capHeight != null) cand.push({ y: blueZones.capHeight, cvt: cvtMap.BLUE_CAP_HEIGHT });
    if (blueZones.capOvershoot != null && blueZones.capOvershoot !== blueZones.capHeight) {
      cand.push({ y: blueZones.capOvershoot, cvt: cvtMap.BLUE_CAP_HEIGHT_OS });
    }
    if (blueZones.ascender != null && (blueZones.capHeight == null || Math.abs(blueZones.ascender - blueZones.capHeight) > tolerance)) {
      cand.push({ y: blueZones.ascender, cvt: cvtMap.BLUE_ASCENDER });
    }
    if (blueZones.descender != null) cand.push({ y: blueZones.descender, cvt: cvtMap.BLUE_DESCENDER });
    if (blueZones.descenderOvershoot != null && blueZones.descenderOvershoot !== blueZones.descender) {
      cand.push({ y: blueZones.descenderOvershoot, cvt: cvtMap.BLUE_DESCENDER_OS });
    }

    let best = null;
    let bestDist = tolerance + 1;
    for (const c of cand) {
      const d = Math.abs(y - c.y);
      if (d <= tolerance && d < bestDist) {
        bestDist = d;
        best = c;
      }
    }
    return best;
  }

  /* Emit ONE byte to the stream. Helper used by the encoder
     loop below — kept inline for clarity rather than calling
     TTStream (which would be heavier for a small flat sequence). */
  function pushU8(stream, b) { stream.push(b & 0xff); }

  /* CharString-style integer encoding for TT bytecode operands.
     Mirrors the encoders in font-engine-cff-hints / tt-bytecode
     but compact-inline since we only use small positives here. */
  function pushTTInt(stream, n) {
    if (n >= 0 && n <= 255) {
      /* PUSHB[0] (push 1 byte) — opcode 0xB0 */
      stream.push(0xB0);
      stream.push(n);
      return;
    }
    if (n >= -32768 && n <= 32767) {
      /* PUSHW[0] (push 1 short) — opcode 0xB8 */
      stream.push(0xB8);
      const u = n < 0 ? n + 0x10000 : n;
      stream.push((u >> 8) & 0xff);
      stream.push(u & 0xff);
      return;
    }
    throw new Error('hint operand out of TT range: ' + n);
  }

  function buildGlyphHints(contours, blueZones, cvtMap, fpgmMap, opts) {
    opts = opts || {};
    const tolerance = opts.tolerance != null ? opts.tolerance : DEFAULT_TOLERANCE;

    if (!contours || contours.length === 0) {
      return { instructions: new Uint8Array(0), touchedPoints: 0, snapped: [] };
    }
    if (!blueZones || !cvtMap || !fpgmMap) {
      return { instructions: new Uint8Array(0), touchedPoints: 0, snapped: [] };
    }
    if (fpgmMap.SNAP_Y_TO_CVT == null) {
      /* Phase 5a's fpgm doesn't define this function — refuse to
         emit calls to a missing function. */
      return { instructions: new Uint8Array(0), touchedPoints: 0, snapped: [] };
    }

    /* Walk contours building a flat point array. Index = position
       in this flattened list (matches glyf encoder's point order). */
    const flat = [];
    for (const c of contours) for (const p of c) flat.push(p);

    /* For each point, decide whether to snap to a CVT zone. */
    const snaps = []; /* {pointIdx, cvtIdx, y} */
    for (let i = 0; i < flat.length; i++) {
      const p = flat[i];
      /* Only snap on-curve points — off-curve (Bezier controls) are
         interpolated by IUP, and snapping them can warp curves. */
      if (p.onCurve === false) continue;
      const zone = pickZoneForY(p.y, blueZones, cvtMap, tolerance);
      if (zone) snaps.push({ pointIdx: i, cvtIdx: zone.cvt, y: zone.y });
    }

    if (snaps.length === 0) {
      /* No point touches a blue zone — emit nothing. The glyph still
         renders correctly; it just doesn't snap-align at small sizes.
         IUP-only with no touched points is a no-op so we skip it too. */
      return { instructions: new Uint8Array(0), touchedPoints: 0, snapped: [] };
    }

    /* Emit the byte stream:
       For each snap:
         PUSHB[1] pointIdx cvtIdx       (push two values in one instruction)
         PUSHB[0] fnNum
         CALL
       Then:
         SVTCA[y]
         IUP[1]            (interpolate untouched in Y; touched points
                            are now snapped to their CVT-derived pixels)
         SVTCA[x]
         IUP[0]            (interpolate in X — no touches in X, but
                            this preserves x positions cleanly through
                            the round mode applied above) */
    const stream = [];

    for (const s of snaps) {
      if (s.pointIdx <= 255 && s.cvtIdx <= 255) {
        /* PUSHB[1] = 0xB1: push 2 bytes */
        stream.push(0xB1);
        stream.push(s.pointIdx);
        stream.push(s.cvtIdx);
      } else {
        /* Fall back to single pushes if out of range. */
        pushTTInt(stream, s.pointIdx);
        pushTTInt(stream, s.cvtIdx);
      }
      pushTTInt(stream, fpgmMap.SNAP_Y_TO_CVT);
      stream.push(0x2B); /* CALL */
    }

    /* Switch to Y, IUP Y, then X, IUP X. opcodes:
       SVTCA[y] = 0x00
       IUP[1]   = 0x30 (Y axis)
       SVTCA[x] = 0x01
       IUP[0]   = 0x31 (X axis) */
    stream.push(0x00);
    stream.push(0x30);
    stream.push(0x01);
    stream.push(0x31);

    return {
      instructions: new Uint8Array(stream),
      touchedPoints: snaps.length,
      snapped: snaps.map(s => ({ pt: s.pointIdx, cvt: s.cvtIdx, y: s.y })),
    };
  }

  global.buildGlyphHints = buildGlyphHints;

})(typeof self !== 'undefined' ? self : this);
