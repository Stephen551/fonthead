/* ============================================================
 * font-engine-glyf-parser.js  (inverse of glyf-encoder for VF)
 * ------------------------------------------------------------
 * Worker-only. Decodes a `glyf` table back to per-glyph contour
 * point lists. Used by the variable-font compatibility layer to
 * read both master fonts' raw points (we can't go through
 * opentype.js's path API because it collapses implied on-curve
 * midpoints between consecutive off-curve points, losing the
 * 1:1 correspondence between gvar deltas and glyf points).
 *
 * Layout (per OpenType spec, simple glyphs only — composite
 * support deferred; the tracer doesn't emit composites):
 *
 *   int16   numberOfContours       (≥0 simple, <0 composite, 0 empty)
 *   int16   xMin
 *   int16   yMin
 *   int16   xMax
 *   int16   yMax
 *   uint16  endPtsOfContours[numberOfContours]
 *   uint16  instructionLength
 *   uint8   instructions[instructionLength]
 *   uint8   flags[N]               (with REPEAT_FLAG run-length)
 *   variable xCoordinates[N]
 *   variable yCoordinates[N]
 *
 *   N = endPtsOfContours[numContours-1] + 1
 *
 * Flag bits — see glyf-encoder for the full table; we read:
 *   0x01  ON_CURVE_POINT
 *   0x02  X_SHORT_VECTOR             1 byte unsigned
 *   0x04  Y_SHORT_VECTOR             1 byte unsigned
 *   0x08  REPEAT_FLAG                next byte = repeat count
 *   0x10  if X_SHORT then X_POSITIVE_SIGN else X_IS_SAME (no bytes)
 *   0x20  if Y_SHORT then Y_POSITIVE_SIGN else Y_IS_SAME
 *
 * Public entry:
 *   parseGlyfTable(sfntBytes) -> {
 *     glyphs: [
 *       null                       // empty/no-contour glyph
 *       OR
 *       {
 *         contours: [
 *           [ { x, y, onCurve }, ... ],
 *           ...
 *         ],
 *         bbox: { xMin, yMin, xMax, yMax },
 *         instructionLength,
 *       },
 *       ...
 *     ],
 *     numGlyphs
 *   }
 *   Throws on a composite glyph (numContours < 0) — composites need
 *   a separate decoder; out of scope for the tracer's output.
 * ============================================================ */
(function(global){
  'use strict';

  function parseGlyfTable(sfntBytes) {
    if (!sfntBytes || sfntBytes.length < 12) {
      throw new Error('glyf-parser: sfnt too small');
    }
    const view = new DataView(sfntBytes.buffer, sfntBytes.byteOffset, sfntBytes.byteLength);
    const numTables = view.getUint16(4, false);
    let headEntry = null, maxpEntry = null, locaEntry = null, glyfEntry = null;
    for (let i = 0; i < numTables; i++) {
      const recOff = 12 + i * 16;
      const tag = String.fromCharCode(sfntBytes[recOff], sfntBytes[recOff + 1],
                                       sfntBytes[recOff + 2], sfntBytes[recOff + 3]);
      const offset = view.getUint32(recOff + 8, false);
      const length = view.getUint32(recOff + 12, false);
      const e = { tag, offset, length };
      if (tag === 'head') headEntry = e;
      else if (tag === 'maxp') maxpEntry = e;
      else if (tag === 'loca') locaEntry = e;
      else if (tag === 'glyf') glyfEntry = e;
    }
    if (!headEntry || !maxpEntry || !locaEntry || !glyfEntry) {
      throw new Error('glyf-parser: missing required table (head/maxp/loca/glyf)');
    }
    const numGlyphs = view.getUint16(maxpEntry.offset + 4, false);
    const indexToLocFormat = view.getInt16(headEntry.offset + 50, false);
    const locaStride = indexToLocFormat === 0 ? 2 : 4;

    /* Read loca offsets. */
    const locaOffs = new Array(numGlyphs + 1);
    for (let i = 0; i <= numGlyphs; i++) {
      if (indexToLocFormat === 0) {
        locaOffs[i] = view.getUint16(locaEntry.offset + i * 2, false) * 2;
      } else {
        locaOffs[i] = view.getUint32(locaEntry.offset + i * 4, false);
      }
    }

    /* Per-glyph decode. */
    const glyphs = new Array(numGlyphs);
    for (let gi = 0; gi < numGlyphs; gi++) {
      const start = locaOffs[gi];
      const end = locaOffs[gi + 1];
      if (start === end) {
        glyphs[gi] = null;
        continue;
      }
      const glyphAbs = glyfEntry.offset + start;
      const numContours = view.getInt16(glyphAbs, false);
      if (numContours < 0) {
        throw new Error('glyf-parser: composite glyph at index ' + gi + ' not supported');
      }
      if (numContours === 0) {
        glyphs[gi] = null;
        continue;
      }
      const xMin = view.getInt16(glyphAbs + 2, false);
      const yMin = view.getInt16(glyphAbs + 4, false);
      const xMax = view.getInt16(glyphAbs + 6, false);
      const yMax = view.getInt16(glyphAbs + 8, false);

      /* endPtsOfContours. */
      const endPts = new Array(numContours);
      let p = glyphAbs + 10;
      for (let c = 0; c < numContours; c++) {
        endPts[c] = view.getUint16(p, false);
        p += 2;
      }
      const totalPoints = endPts[numContours - 1] + 1;

      /* Instructions. */
      const instructionLength = view.getUint16(p, false);
      p += 2;
      p += instructionLength; /* skip instruction bytes */

      /* Flags — with REPEAT_FLAG expansion. */
      const flags = new Array(totalPoints);
      let fi = 0;
      while (fi < totalPoints) {
        const flag = sfntBytes[p++];
        flags[fi++] = flag;
        if (flag & 0x08) {
          /* REPEAT_FLAG: next byte = how many MORE times to use this flag. */
          const repeat = sfntBytes[p++];
          for (let r = 0; r < repeat && fi < totalPoints; r++) {
            flags[fi++] = flag;
          }
        }
      }

      /* X coordinates (deltas from previous; absolute for first). */
      const xs = new Array(totalPoints);
      let xPrev = 0;
      for (let i = 0; i < totalPoints; i++) {
        const f = flags[i];
        let dx;
        if (f & 0x02) {
          /* X_SHORT: 1 byte unsigned, sign from bit 4. */
          const mag = sfntBytes[p++];
          dx = (f & 0x10) ? mag : -mag;
        } else if (f & 0x10) {
          /* X_IS_SAME: delta is 0. */
          dx = 0;
        } else {
          /* Signed int16. */
          dx = view.getInt16(p, false);
          p += 2;
        }
        xPrev += dx;
        xs[i] = xPrev;
      }

      /* Y coordinates (same scheme). */
      const ys = new Array(totalPoints);
      let yPrev = 0;
      for (let i = 0; i < totalPoints; i++) {
        const f = flags[i];
        let dy;
        if (f & 0x04) {
          const mag = sfntBytes[p++];
          dy = (f & 0x20) ? mag : -mag;
        } else if (f & 0x20) {
          dy = 0;
        } else {
          dy = view.getInt16(p, false);
          p += 2;
        }
        yPrev += dy;
        ys[i] = yPrev;
      }

      /* Group into contours. */
      const contours = new Array(numContours);
      let pi = 0;
      for (let c = 0; c < numContours; c++) {
        const contour = [];
        while (pi <= endPts[c]) {
          contour.push({
            x: xs[pi],
            y: ys[pi],
            onCurve: !!(flags[pi] & 0x01),
          });
          pi++;
        }
        contours[c] = contour;
      }

      glyphs[gi] = {
        contours,
        bbox: { xMin, yMin, xMax, yMax },
        instructionLength,
      };
    }
    return { glyphs, numGlyphs };
  }

  global.parseGlyfTable = parseGlyfTable;

})(typeof self !== 'undefined' ? self : this);
