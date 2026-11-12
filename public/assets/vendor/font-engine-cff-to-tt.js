/* ============================================================
 * font-engine-cff-to-tt.js  (CFF→TTF converter)
 * ------------------------------------------------------------
 * Worker-only. Takes the OTF (CFF-flavored) bytes opentype.js
 * produces and converts them to a real TrueType font with glyf+loca
 * tables and an SFNT version of 0x00010000.
 *
 * Why this exists: opentype.js (every version through 2.0.0) silently
 * ignores `outlinesFormat: 'truetype'` and only ever writes CFF.
 * Before this module, the tracer's "TTF" output was a CFF font with
 * a .ttf extension — a lie. v0.8.39 dropped the broken TTF path
 * entirely; this module is the honest implementation that re-enables
 * it.
 *
 * Approach:
 *   1. Re-parse the CFF bytes via opentype.js to get glyphs as
 *      Path objects with M/L/C/Q/Z commands. This sidesteps writing
 *      a Type 2 CharString decoder (which would need to handle ~30
 *      operators, local+global subrs, hint stems, etc.).
 *   2. Convert any cubic (C) commands to one or more quadratic (Q)
 *      Beziers via cubic2quad. Quadratics encode each cubic
 *      approximately, but TT format only supports quadratics; the
 *      conversion is the standard FontForge / fontmake approach.
 *   3. Walk the Q/L/M sequence into contour data: each contour is a
 *      list of points with onCurve flags. Quadratic control points
 *      are OFF-curve (TrueType convention); line endpoints and curve
 *      anchors are ON-curve.
 *   4. Encode each glyph's contours via encodeGlyfEntry (glyf-encoder.js).
 *   5. Build glyf body (concat) + loca offset table.
 *   6. Swap CFF out of SFNT, insert glyf + loca, flip version to
 *      0x00010000, update maxp (v1.0 layout with TT-specific fields),
 *      set head.indexToLocFormat, recompute head.checkSumAdjustment.
 *
 * Public entry:
 *   convertCFFToTTF(otfBytes, opts?) -> {
 *     bytes: Uint8Array,
 *     status: 'converted' | 'skipped' | 'failed',
 *     reason?: string,
 *     stats?: { numGlyphs, glyfBytes, locaBytes, cubicCount, quadCount,
 *               hintedGlyphCount, maxInstructionLen }
 *   }
 *
 *   opts.hintCallback: (contours, glyphMeta) -> Uint8Array (or null)
 *     Optional per-glyph instruction generator. Called for each
 *     non-empty glyph with its contours and {index, char, advanceWidth}.
 *     Returns TT bytecode to embed in the glyph's instructions field,
 *     or null/undefined/empty array for no hints.
 *
 * Safety: returns ORIGINAL bytes on any failure. The CFF input is
 * never lost or modified — we synthesize a new font from scratch.
 * ============================================================ */
(function(global){
  'use strict';

  const CUBIC_ERR_BOUND = 0.5; /* font-unit tolerance for cubic→quad approx */

  function checksum(data) {
    let sum = 0;
    const padded = (data.length + 3) & ~3;
    const tmp = new Uint8Array(padded);
    tmp.set(data);
    const dv = new DataView(tmp.buffer);
    for (let i = 0; i < padded; i += 4) {
      sum = (sum + dv.getUint32(i, false)) >>> 0;
    }
    return sum;
  }

  function tagToInt(tag) {
    return (tag.charCodeAt(0) << 24) | (tag.charCodeAt(1) << 16)
         | (tag.charCodeAt(2) << 8)  |  tag.charCodeAt(3);
  }

  /* Walk an opentype.js Path's commands into a list of contours.
     opentype.js paths use the same M/L/C/Q/Z conventions as SVG.
     Quadratics (Q) pass through directly; cubics (C) get expanded
     via cubic2quad into one or more quadratics each. Returns:
       { contours: [[{x,y,onCurve},...], ...], cubics, quads } */
  function pathToContours(path) {
    if (!path || !path.commands) return { contours: [], cubics: 0, quads: 0 };
    const contours = [];
    let cur = null;          /* current contour being built */
    let cx = 0, cy = 0;      /* current point (pen position) */
    let cubics = 0, quads = 0;

    const startContour = (x, y) => {
      cur = [];
      cur.push({ x, y, onCurve: true });
      contours.push(cur);
      cx = x; cy = y;
    };

    for (const cmd of path.commands) {
      switch (cmd.type) {
        case 'M':
          startContour(cmd.x, cmd.y);
          break;
        case 'L':
          if (!cur) startContour(cx, cy);
          cur.push({ x: cmd.x, y: cmd.y, onCurve: true });
          cx = cmd.x; cy = cmd.y;
          break;
        case 'Q':
          if (!cur) startContour(cx, cy);
          quads++;
          /* Q has one off-curve control + one on-curve end. TrueType
             would let us imply the on-curve end via midpoint
             interpolation between two adjacent off-curves; that's a
             size optimization we skip for clarity. */
          cur.push({ x: cmd.x1, y: cmd.y1, onCurve: false });
          cur.push({ x: cmd.x,  y: cmd.y,  onCurve: true });
          cx = cmd.x; cy = cmd.y;
          break;
        case 'C': {
          if (!cur) startContour(cx, cy);
          cubics++;
          /* cubic2quad signature:
               cubicToQuad(x1, y1, c1x, c1y, c2x, c2y, x2, y2, errBound)
             returns flat number array: [x1, y1, q1cx, q1cy, q1x2, q1y2,
                                         q2cx, q2cy, q2x2, q2y2, ...]
             — the original start point, then for each quad in sequence
             its control point + end point. */
          const out = global.cubic2quad(
            cx, cy,
            cmd.x1, cmd.y1,
            cmd.x2, cmd.y2,
            cmd.x,  cmd.y,
            CUBIC_ERR_BOUND
          );
          if (!out || out.length < 6) {
            /* Conversion failed somehow — fall back to a line for safety. */
            cur.push({ x: cmd.x, y: cmd.y, onCurve: true });
          } else {
            /* Skip the first pair (it's the start point cx,cy which is
               already the last on-curve point in cur). Walk each
               subsequent quad as [cx, cy, x, y]. */
            for (let i = 2; i + 3 < out.length; i += 4) {
              cur.push({ x: out[i],     y: out[i + 1], onCurve: false });
              cur.push({ x: out[i + 2], y: out[i + 3], onCurve: true });
            }
          }
          cx = cmd.x; cy = cmd.y;
          break;
        }
        case 'Z':
          /* glyf format assumes contours are closed implicitly.
             If the last point of the contour equals the first, drop
             the redundant copy (some renderers tolerate it; some
             complain). */
          if (cur && cur.length > 1) {
            const first = cur[0];
            const last = cur[cur.length - 1];
            if (last.onCurve && Math.abs(last.x - first.x) < 0.001
                              && Math.abs(last.y - first.y) < 0.001) {
              cur.pop();
            }
          }
          cur = null;
          break;
      }
    }

    return { contours, cubics, quads };
  }

  /* Build a maxp v1.0 (TrueType) byte block. opentype.js's CFF output
     gives us maxp v0.5 (6 bytes); v1.0 is 32 bytes with stem-/composite-
     specific fields. We compute the required fields by scanning the
     glyphs we just encoded. */
  function buildMaxp(stats) {
    const buf = new Uint8Array(32);
    const dv = new DataView(buf.buffer);
    dv.setUint32(0, 0x00010000, false); /* version 1.0 */
    dv.setUint16(4, stats.numGlyphs, false);
    dv.setUint16(6, stats.maxPoints, false);
    dv.setUint16(8, stats.maxContours, false);
    dv.setUint16(10, 0, false); /* maxCompositePoints (no composites) */
    dv.setUint16(12, 0, false); /* maxCompositeContours */
    dv.setUint16(14, 2, false); /* maxZones (1 or 2; 2 = standard) */
    dv.setUint16(16, 0, false); /* maxTwilightPoints */
    dv.setUint16(18, 0, false); /* maxStorage */
    dv.setUint16(20, 0, false); /* maxFunctionDefs */
    dv.setUint16(22, 0, false); /* maxInstructionDefs */
    dv.setUint16(24, 0, false); /* maxStackElements */
    dv.setUint16(26, 0, false); /* maxSizeOfInstructions */
    dv.setUint16(28, 0, false); /* maxComponentElements */
    dv.setUint16(30, 0, false); /* maxComponentDepth */
    return buf;
  }

  function buildLoca(glyfOffsets, useShortFormat) {
    /* loca stores numGlyphs+1 offsets into glyf. Short format =
       uint16 of (offset / 2); long format = uint32. */
    if (useShortFormat) {
      const buf = new Uint8Array(glyfOffsets.length * 2);
      const dv = new DataView(buf.buffer);
      for (let i = 0; i < glyfOffsets.length; i++) {
        dv.setUint16(i * 2, glyfOffsets[i] / 2, false);
      }
      return buf;
    }
    const buf = new Uint8Array(glyfOffsets.length * 4);
    const dv = new DataView(buf.buffer);
    for (let i = 0; i < glyfOffsets.length; i++) {
      dv.setUint32(i * 4, glyfOffsets[i], false);
    }
    return buf;
  }

  /* Pad a Uint8Array up to 4-byte alignment with zeros and return
     the padded array. SFNT tables are concatenated with 4-byte
     alignment between them. */
  function pad4(data) {
    const need = (4 - (data.length & 3)) & 3;
    if (need === 0) return data;
    const out = new Uint8Array(data.length + need);
    out.set(data, 0);
    return out;
  }

  function convertCFFToTTF(otfBytes, opts) {
    opts = opts || {};
    if (!otfBytes || otfBytes.length < 12) {
      return { bytes: otfBytes, status: 'failed', reason: 'sfnt too small' };
    }
    if (typeof global.encodeGlyfEntry !== 'function') {
      return { bytes: otfBytes, status: 'failed', reason: 'glyf-encoder not loaded' };
    }
    if (typeof global.opentype === 'undefined' || !global.opentype.parse) {
      return { bytes: otfBytes, status: 'failed', reason: 'opentype.js not loaded in scope' };
    }
    if (typeof global.cubic2quad !== 'function') {
      return { bytes: otfBytes, status: 'failed', reason: 'cubic2quad not loaded' };
    }

    /* Quick sanity: only operate on CFF fonts. */
    const sig = (otfBytes[0] << 24) | (otfBytes[1] << 16) | (otfBytes[2] << 8) | otfBytes[3];
    if (sig !== 0x4F54544F /* 'OTTO' */) {
      return { bytes: otfBytes, status: 'skipped', reason: 'already TTF (sfnt version is not OTTO)' };
    }

    let font;
    try {
      /* opentype.parse expects an ArrayBuffer. Slice off our view. */
      const ab = otfBytes.buffer.slice(otfBytes.byteOffset, otfBytes.byteOffset + otfBytes.byteLength);
      font = global.opentype.parse(ab);
    } catch (err) {
      return { bytes: otfBytes, status: 'failed', reason: 'cff parse: ' + (err.message || err) };
    }
    if (!font || !font.glyphs) {
      return { bytes: otfBytes, status: 'failed', reason: 'parsed font has no glyphs' };
    }

    /* Walk every glyph, encode glyf entries. */
    const numGlyphs = font.glyphs.length;
    const glyfEntries = new Array(numGlyphs);
    const glyphBBoxes = new Array(numGlyphs);
    let totalGlyfBytes = 0;
    let maxPoints = 0, maxContours = 0;
    let totalCubics = 0, totalQuads = 0;
    let hintedGlyphCount = 0, maxInstructionLen = 0;

    for (let i = 0; i < numGlyphs; i++) {
      const g = font.glyphs.glyphs[i];
      let entry;
      try {
        const { contours, cubics, quads } = pathToContours(g.path);
        totalCubics += cubics;
        totalQuads += quads;
        if (contours.length === 0) {
          entry = new Uint8Array(0); /* empty glyph (notdef/space may be empty) */
          glyphBBoxes[i] = null;
        } else {
          /* Reverse each contour for TrueType clockwise outer winding while keeping
             pts[0], rounding coordinates to integer font units first so the glyf
             bbox matches the encoded TrueType points exactly. */
          const revContours = contours.map((pts) => {
            const rounded = pts.map((p) => ({
              x: Math.round(p.x),
              y: Math.round(p.y),
              onCurve: p.onCurve !== false,
            }));
            return rounded.length > 1
              ? [rounded[0]].concat(rounded.slice(1).reverse())
              : rounded;
          }).filter((c) => c.length > 0);
          if (revContours.length === 0) {
            entry = new Uint8Array(0);
            glyphBBoxes[i] = null;
          } else {
            let gxMin = Infinity, gyMin = Infinity, gxMax = -Infinity, gyMax = -Infinity;
            for (const c of revContours) {
              for (const p of c) {
                if (p.x < gxMin) gxMin = p.x;
                if (p.y < gyMin) gyMin = p.y;
                if (p.x > gxMax) gxMax = p.x;
                if (p.y > gyMax) gyMax = p.y;
              }
            }
            glyphBBoxes[i] = { xMin: gxMin, yMin: gyMin, xMax: gxMax, yMax: gyMax };
            /* Per-glyph hint generation. Caller passes a callback; we
               invoke it with this glyph's contours + meta. Null/empty
               return = no hints for this glyph (passes through unhinted). */
            let instructions = null;
            if (typeof opts.hintCallback === 'function') {
              try {
                instructions = opts.hintCallback(revContours, {
                  index: i,
                  char: g.unicode ? String.fromCodePoint(g.unicode) : null,
                  advanceWidth: g.advanceWidth,
                  name: g.name,
                });
              } catch (hintErr) {
                /* A bad hint shouldn't break the conversion — skip
                   hints for this glyph and continue. */
                instructions = null;
              }
              if (instructions && instructions.length > 0) {
                hintedGlyphCount++;
                if (instructions.length > maxInstructionLen) maxInstructionLen = instructions.length;
              }
            }
            entry = global.encodeGlyfEntry(revContours, undefined, instructions);
            let pts = 0;
            for (const c of revContours) pts += c.length;
            if (pts > maxPoints) maxPoints = pts;
            if (revContours.length > maxContours) maxContours = revContours.length;
          }
        }
      } catch (err) {
        return { bytes: otfBytes, status: 'failed',
                 reason: 'glyph ' + i + ' encode: ' + (err.message || err) };
      }
      glyfEntries[i] = pad4(entry);
      totalGlyfBytes += glyfEntries[i].length;
    }

    /* Concatenate glyf entries + compute loca offsets. loca has
       numGlyphs+1 entries; loca[i] = byte offset where glyph i starts,
       loca[numGlyphs] = total glyf length. */
    const glyf = new Uint8Array(totalGlyfBytes);
    const glyfOffsets = new Array(numGlyphs + 1);
    let cursor = 0;
    for (let i = 0; i < numGlyphs; i++) {
      glyfOffsets[i] = cursor;
      glyf.set(glyfEntries[i], cursor);
      cursor += glyfEntries[i].length;
    }
    glyfOffsets[numGlyphs] = cursor;

    /* loca format: short (uint16, offsets/2) fits when glyf ≤ 131070 bytes. */
    const useShortLoca = glyfOffsets[numGlyphs] <= 0x1FFFE;
    const loca = buildLoca(glyfOffsets, useShortLoca);

    /* Build new maxp v1.0. */
    const maxp = buildMaxp({
      numGlyphs,
      maxPoints,
      maxContours,
    });

    /* Now reconstruct the SFNT. We take the original directory,
       drop 'CFF ', add 'glyf' and 'loca', replace 'maxp', then
       lay the bodies out in tag-sorted order. */
    const view = new DataView(otfBytes.buffer, otfBytes.byteOffset, otfBytes.byteLength);
    const oldNumTables = view.getUint16(4, false);
    const tables = [];
    let cffOffset = -1, cffLength = 0;
    let oldHeadOffset = -1;
    for (let i = 0; i < oldNumTables; i++) {
      const recOff = 12 + i * 16;
      const tag = String.fromCharCode(otfBytes[recOff], otfBytes[recOff + 1],
                                       otfBytes[recOff + 2], otfBytes[recOff + 3]);
      const offset = view.getUint32(recOff + 8, false);
      const length = view.getUint32(recOff + 12, false);
      if (tag === 'CFF ') { cffOffset = offset; cffLength = length; continue; }
      if (tag === 'head') oldHeadOffset = offset;
      let body;
      if (tag === 'maxp') {
        body = maxp;
      } else {
        body = otfBytes.subarray(offset, offset + length);
      }
      tables.push({ tag, body });
    }
    if (cffOffset < 0) {
      return { bytes: otfBytes, status: 'failed', reason: 'no CFF table to replace' };
    }
    /* Rebuild hmtx (advanceWidth preserved, lsb = glyf xMin or 0 for empty),
       and compute updated head bbox + hhea extrema across non-empty glyphs. */
    const headTable = tables.find((t) => t.tag === 'head');
    const hheaTable = tables.find((t) => t.tag === 'hhea');
    const hmtxTable = tables.find((t) => t.tag === 'hmtx');

    let unionXMin = Infinity, unionYMin = Infinity, unionXMax = -Infinity, unionYMax = -Infinity;
    let minLSB = Infinity, minRSB = Infinity, xMaxExtent = -Infinity;
    let hasNonEmpty = false;

    if (hheaTable && hmtxTable) {
      const hheaCopy = new Uint8Array(hheaTable.body);
      const hheaDv = new DataView(hheaCopy.buffer);
      const origHmtxDv = new DataView(hmtxTable.body.buffer, hmtxTable.body.byteOffset, hmtxTable.body.byteLength);
      const numberOfHMetrics = Math.max(1, Math.min(numGlyphs, hheaDv.getUint16(34, false)));
      const newHmtx = new Uint8Array(numberOfHMetrics * 4 + (numGlyphs - numberOfHMetrics) * 2);
      const newHmtxDv = new DataView(newHmtx.buffer);

      for (let i = 0; i < numGlyphs; i++) {
        const adv = i < numberOfHMetrics
          ? origHmtxDv.getUint16(i * 4, false)
          : origHmtxDv.getUint16((numberOfHMetrics - 1) * 4, false);
        const bb = glyphBBoxes[i];
        const lsb = bb ? bb.xMin : 0;
        if (i < numberOfHMetrics) {
          newHmtxDv.setUint16(i * 4, adv, false);
          newHmtxDv.setInt16(i * 4 + 2, lsb, false);
        } else {
          newHmtxDv.setInt16(numberOfHMetrics * 4 + (i - numberOfHMetrics) * 2, lsb, false);
        }
        if (bb) {
          hasNonEmpty = true;
          if (bb.xMin < unionXMin) unionXMin = bb.xMin;
          if (bb.yMin < unionYMin) unionYMin = bb.yMin;
          if (bb.xMax > unionXMax) unionXMax = bb.xMax;
          if (bb.yMax > unionYMax) unionYMax = bb.yMax;
          const rsb = adv - lsb - (bb.xMax - bb.xMin);
          const extent = lsb + (bb.xMax - bb.xMin);
          if (lsb < minLSB) minLSB = lsb;
          if (rsb < minRSB) minRSB = rsb;
          if (extent > xMaxExtent) xMaxExtent = extent;
        }
      }
      hmtxTable.body = newHmtx;

      hheaDv.setInt16(12, hasNonEmpty ? minLSB : 0, false);
      hheaDv.setInt16(14, hasNonEmpty ? minRSB : 0, false);
      hheaDv.setInt16(16, hasNonEmpty ? xMaxExtent : 0, false);
      hheaTable.body = hheaCopy;
    }

    /* head: clone and patch bbox (36..42), indexToLocFormat (offset 50, int16:
       0 = short loca, 1 = long loca). We patch the bytes IN our per-table body,
       not in the original. */
    if (headTable) {
      const copy = new Uint8Array(headTable.body);
      const dv = new DataView(copy.buffer);
      dv.setInt16(36, hasNonEmpty ? unionXMin : 0, false);
      dv.setInt16(38, hasNonEmpty ? unionYMin : 0, false);
      dv.setInt16(40, hasNonEmpty ? unionXMax : 0, false);
      dv.setInt16(42, hasNonEmpty ? unionYMax : 0, false);
      dv.setInt16(50, useShortLoca ? 0 : 1, false);
      /* Zero checkSumAdjustment (offset 8) — recomputed below. */
      dv.setUint32(8, 0, false);
      headTable.body = copy;
    }

    /* Add glyf + loca. */
    tables.push({ tag: 'glyf', body: glyf });
    tables.push({ tag: 'loca', body: loca });

    /* Sort tables by tag (OpenType requires directory order = tag order). */
    tables.sort((a, b) => tagToInt(a.tag) - tagToInt(b.tag));

    const newNumTables = tables.length;
    const headerSize = 12;
    const dirSize = newNumTables * 16;
    let bodyCursor = headerSize + dirSize;
    const bodyStarts = [];
    for (const t of tables) {
      bodyCursor = (bodyCursor + 3) & ~3;
      bodyStarts.push(bodyCursor);
      bodyCursor += t.body.length;
    }
    const totalLen = bodyCursor;
    const out = new Uint8Array(totalLen);
    const ov = new DataView(out.buffer);

    /* SFNT header — flip version to 0x00010000 (TrueType). */
    ov.setUint32(0, 0x00010000, false);
    ov.setUint16(4, newNumTables, false);
    let largestPow2 = 1;
    while (largestPow2 * 2 <= newNumTables) largestPow2 *= 2;
    ov.setUint16(6, largestPow2 * 16, false);
    ov.setUint16(8, Math.log2(largestPow2), false);
    ov.setUint16(10, (newNumTables - largestPow2) * 16, false);

    /* Directory + bodies. */
    let newHeadOffset = -1;
    for (let i = 0; i < newNumTables; i++) {
      const t = tables[i];
      const start = bodyStarts[i];
      out.set(t.body, start);
      const dirOff = 12 + i * 16;
      ov.setUint32(dirOff, tagToInt(t.tag), false);
      ov.setUint32(dirOff + 4, checksum(t.body), false);
      ov.setUint32(dirOff + 8, start, false);
      ov.setUint32(dirOff + 12, t.body.length, false);
      if (t.tag === 'head') newHeadOffset = start;
    }

    /* head.checkSumAdjustment: zero, sum whole font, adjustment = magic - sum.
       Spec treats the file as zero-padded to a 4-byte boundary, so we
       tack a tail chunk on if the SFNT length isn't 4-aligned. */
    if (newHeadOffset >= 0) {
      ov.setUint32(newHeadOffset + 8, 0, false);
      let sum = 0;
      const len4 = out.length & ~3;
      for (let i = 0; i < len4; i += 4) {
        sum = (sum + ov.getUint32(i, false)) >>> 0;
      }
      if (len4 < out.length) {
        let tail = 0;
        for (let j = 0; j < 4; j++) {
          tail = (tail << 8) | (len4 + j < out.length ? out[len4 + j] : 0);
        }
        sum = (sum + (tail >>> 0)) >>> 0;
      }
      const adj = (0xB1B0AFBA - sum) >>> 0;
      ov.setUint32(newHeadOffset + 8, adj, false);
    }

    return {
      bytes: out,
      status: 'converted',
      stats: {
        numGlyphs,
        glyfBytes: glyf.length,
        locaBytes: loca.length,
        cubicCount: totalCubics,
        quadCount: totalQuads,
        useShortLoca,
        maxPoints, maxContours,
        hintedGlyphCount,
        maxInstructionLen,
      },
    };
  }

  global.convertCFFToTTF = convertCFFToTTF;

})(typeof self !== 'undefined' ? self : this);
