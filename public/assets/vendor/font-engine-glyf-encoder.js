/* ============================================================
 * font-engine-glyf-encoder.js  (CFF→TTF support — glyf table writer)
 * ------------------------------------------------------------
 * Worker-only. Encodes a glyph's contours into TrueType `glyf`
 * table format. Used by the CFF→TTF converter (font-engine-cff-to-tt.js)
 * to swap a CFF table for glyf+loca, producing a real TrueType font.
 *
 * `glyf` per-glyph layout (simple glyph, OpenType spec):
 *   int16   numberOfContours       (≥0 = simple, <0 = composite, 0 = empty body)
 *   int16   xMin                    glyph ink bbox
 *   int16   yMin
 *   int16   xMax
 *   int16   yMax
 *   uint16  endPtsOfContours[numberOfContours]   last point index per contour
 *   uint16  instructionLength
 *   uint8   instructions[instructionLength]      TT bytecode (we emit empty)
 *   uint8   flags[N]                             with optional REPEAT compression
 *   variable xCoordinates[N]                     delta-encoded, per-point width
 *   variable yCoordinates[N]                     same
 *
 *   N = endPtsOfContours[numberOfContours-1] + 1 (total point count)
 *
 * Flag bits (uint8 per point):
 *   0x01  ON_CURVE_POINT             1 = on the curve, 0 = off (control point)
 *   0x02  X_SHORT_VECTOR             x delta fits in 1 byte (unsigned magnitude)
 *   0x04  Y_SHORT_VECTOR             y delta fits in 1 byte
 *   0x08  REPEAT_FLAG                next byte = repeat count of this flag
 *   0x10  if X_SHORT: x sign (1=+, 0=−)     ELSE: X_IS_SAME (1) → emit nothing
 *   0x20  if Y_SHORT: y sign                  ELSE: Y_IS_SAME → emit nothing
 *   0x40  OVERLAP_SIMPLE             reserved/optional
 *   0x80  reserved
 *
 * Encoding strategy per coord delta d:
 *   d == 0            → SAME flag bit set, no bytes written
 *   d in [-255, -1]   → SHORT flag set, SIGN clear; emit (uint8)(-d)
 *   d in [1, 255]     → SHORT flag set, SIGN set;   emit (uint8)d
 *   else              → SHORT clear, SIGN clear;    emit (int16)d
 *
 * We do NOT use flag REPEAT_FLAG compression — adds complexity for ~5%
 * size savings on letter-shaped contours. Cheap correctness over cheap bytes.
 *
 * Public entry:
 *   encodeGlyfEntry(contours, bbox?, instructions?) -> Uint8Array
 *     contours = [
 *       [ { x, y, onCurve }, ... ],  // contour 1 (closed implicitly by glyf format)
 *       [ { x, y, onCurve }, ... ],  // contour 2
 *       ...
 *     ]
 *     bbox = { xMin, yMin, xMax, yMax }  (optional — computed if missing)
 *     instructions = Uint8Array of TT bytecode to embed for this glyph
 *       (optional — empty by default; Phase 5b/5c hint emitter passes
 *       per-glyph snap programs here). Up to 65535 bytes per the spec.
 *
 *   encodeEmptyGlyfEntry() -> Uint8Array  (zero-byte entry, for .notdef/space)
 * ============================================================ */
(function(global){
  'use strict';

  /* Flag bit constants — named for clarity at call sites. */
  const F_ON_CURVE = 0x01;
  const F_X_SHORT  = 0x02;
  const F_Y_SHORT  = 0x04;
  const F_X_SIGN_OR_SAME = 0x10;
  const F_Y_SIGN_OR_SAME = 0x20;

  /* Compute bbox from contours if caller didn't supply one. Only counts
     ON-CURVE points + off-curve points (both contribute to the rasterizer's
     fill envelope, so the bbox is the convex hull of ALL points, which is
     what TrueType expects in glyf header). */
  function computeBBox(contours) {
    let xMin = Infinity, yMin = Infinity, xMax = -Infinity, yMax = -Infinity;
    for (const c of contours) {
      for (const p of c) {
        if (p.x < xMin) xMin = p.x;
        if (p.x > xMax) xMax = p.x;
        if (p.y < yMin) yMin = p.y;
        if (p.y > yMax) yMax = p.y;
      }
    }
    if (xMin === Infinity) {
      return { xMin: 0, yMin: 0, xMax: 0, yMax: 0 };
    }
    return {
      xMin: Math.round(xMin), yMin: Math.round(yMin),
      xMax: Math.round(xMax), yMax: Math.round(yMax),
    };
  }

  /* Per-coordinate encoding. Decides flag bits AND emits bytes.
     `signOrSameBit` is the bit value (F_X_SIGN_OR_SAME or F_Y_SIGN_OR_SAME).
     `shortBit` is F_X_SHORT or F_Y_SHORT.
     Returns { flagBits, bytes } — flagBits OR'd into the point's flag byte;
     bytes pushed into the coord stream. */
  function encodeDelta(d, shortBit, signOrSameBit) {
    if (d === 0) {
      /* SAME: short bit clear, sign-or-same bit set, no bytes emitted */
      return { flagBits: signOrSameBit, bytes: [] };
    }
    if (d > 0 && d <= 255) {
      /* SHORT positive: short bit set, sign-or-same set (=positive), 1 byte */
      return { flagBits: shortBit | signOrSameBit, bytes: [d] };
    }
    if (d < 0 && d >= -255) {
      /* SHORT negative: short bit set, sign-or-same clear (=negative), 1 byte */
      return { flagBits: shortBit, bytes: [-d] };
    }
    /* Long form (int16): short clear, sign-or-same clear, 2 bytes */
    const clamped = Math.max(-32768, Math.min(32767, d));
    const u = clamped < 0 ? clamped + 0x10000 : clamped;
    return { flagBits: 0, bytes: [(u >> 8) & 0xff, u & 0xff] };
  }

  function encodeGlyfEntry(contours, bbox, instructions) {
    /* Empty / no-contour glyph: glyf entry is ZERO bytes per spec
       (numberOfContours+bbox are STILL written when the loca offset
       differs from the next, but for truly empty glyphs we emit nothing
       and the two loca entries point at the same offset). Caller
       decides; this function returns a header-bearing entry for any
       glyph with ≥1 contour, and an empty Uint8Array otherwise. */
    if (!contours || contours.length === 0) {
      return new Uint8Array(0);
    }
    /* Filter out empty contours (zero-point) so endPtsOfContours stays well-formed. */
    contours = contours.filter(c => c && c.length > 0);
    if (contours.length === 0) return new Uint8Array(0);

    const bb = bbox || computeBBox(contours);
    const numContours = contours.length;

    /* Build endPtsOfContours + flatten points into a single sequence. */
    const allPoints = [];
    const endPts = [];
    for (const c of contours) {
      for (const p of c) {
        allPoints.push({
          x: Math.round(p.x),
          y: Math.round(p.y),
          onCurve: p.onCurve !== false,
        });
      }
      endPts.push(allPoints.length - 1);
    }
    const N = allPoints.length;

    /* Walk points emitting flag bytes + coord bytes. Deltas are from
       the previous point (first point's delta is from (0,0) per spec). */
    const flagBytes = [];
    const xBytes = [];
    const yBytes = [];
    let prevX = 0, prevY = 0;
    for (const p of allPoints) {
      const dx = p.x - prevX;
      const dy = p.y - prevY;
      const xEnc = encodeDelta(dx, F_X_SHORT, F_X_SIGN_OR_SAME);
      const yEnc = encodeDelta(dy, F_Y_SHORT, F_Y_SIGN_OR_SAME);
      let flag = (p.onCurve ? F_ON_CURVE : 0) | xEnc.flagBits | yEnc.flagBits;
      flagBytes.push(flag);
      for (const b of xEnc.bytes) xBytes.push(b);
      for (const b of yEnc.bytes) yBytes.push(b);
      prevX = p.x;
      prevY = p.y;
    }

    /* Compose final entry:
         header (10 bytes) + endPts (2*numContours) + instructionLength (2)
         + N instruction bytes + flags + xBytes + yBytes */
    const insBytes = instructions instanceof Uint8Array ? instructions : new Uint8Array(0);
    const insLen = insBytes.length;
    if (insLen > 0xFFFF) {
      throw new Error('glyf instructions too long for one glyph: ' + insLen);
    }
    const headerSize = 10;
    const endPtsSize = 2 * numContours;
    const instructionFieldSize = 2; /* length field */
    const totalSize = headerSize + endPtsSize + instructionFieldSize
                    + insLen
                    + flagBytes.length + xBytes.length + yBytes.length;
    const out = new Uint8Array(totalSize);
    const dv = new DataView(out.buffer);
    let p = 0;
    dv.setInt16(p, numContours, false); p += 2;
    dv.setInt16(p, bb.xMin, false); p += 2;
    dv.setInt16(p, bb.yMin, false); p += 2;
    dv.setInt16(p, bb.xMax, false); p += 2;
    dv.setInt16(p, bb.yMax, false); p += 2;
    for (const e of endPts) {
      dv.setUint16(p, e, false); p += 2;
    }
    dv.setUint16(p, insLen, false); p += 2;
    for (let i = 0; i < insLen; i++) out[p++] = insBytes[i];
    for (const f of flagBytes) out[p++] = f;
    for (const b of xBytes) out[p++] = b;
    for (const b of yBytes) out[p++] = b;
    return out;
  }

  function encodeEmptyGlyfEntry() {
    return new Uint8Array(0);
  }

  global.encodeGlyfEntry = encodeGlyfEntry;
  global.encodeEmptyGlyfEntry = encodeEmptyGlyfEntry;

})(typeof self !== 'undefined' ? self : this);
