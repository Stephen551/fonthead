/* ============================================================
 * font-engine-gvar.js  (Phase 7 — glyph variations table writer)
 * ------------------------------------------------------------
 * Worker-only. Builds the `gvar` table, which stores per-glyph
 * point deltas at non-default axis positions. The rasterizer
 * interpolates between the default outline (stored in `glyf`) and
 * the gvar deltas at runtime based on the user's axis settings.
 *
 * Layout (OpenType spec, simplified for our common case):
 *
 *   gvar header (20 bytes):
 *     uint16   majorVersion = 1
 *     uint16   minorVersion = 0
 *     uint16   axisCount
 *     uint16   sharedTupleCount       = 0 in our writer (no shared tuples)
 *     Offset32 sharedTuplesOffset     = unused when count=0
 *     uint16   glyphCount
 *     uint16   flags                  bit 0 = long offsets (we use short)
 *     Offset32 glyphVariationDataArrayOffset
 *
 *   glyphVariationDataOffsets[glyphCount + 1]
 *     uint16 each (short offsets, /2 per spec when flag=0)
 *     glyphCount+1 entries — last one marks end of data
 *
 *   sharedTuples (empty when count=0)
 *
 *   glyphVariationDataArray (concat of per-glyph TupleVariationStore):
 *
 *     For each glyph that has variations:
 *       uint16    tupleVariationCount    (low bits = count;
 *                                         bit 15 = SHARED_POINT_NUMBERS flag)
 *       Offset16  dataOffset             (from glyph start to packed data)
 *       TupleVariationHeader * count
 *       [shared points data if flag set]
 *       per-tuple packed point + delta data
 *
 *     Tuple variation header (≥ 4 bytes, more if peak/intermediate embedded):
 *       uint16    variationDataSize
 *       uint16    tupleIndex            (low 12 bits = shared tuple index
 *                                        if EMBEDDED_PEAK_TUPLE not set;
 *                                        otherwise reserved 0)
 *                                       flags:
 *                                         0x8000 EMBEDDED_PEAK_TUPLE
 *                                         0x4000 INTERMEDIATE_REGION
 *                                         0x2000 PRIVATE_POINT_NUMBERS
 *       F2DOT14   peakTuple[axisCount]            (if EMBEDDED_PEAK_TUPLE)
 *       F2DOT14   intermediateStart[axisCount]    (if INTERMEDIATE_REGION)
 *       F2DOT14   intermediateEnd[axisCount]      (if INTERMEDIATE_REGION)
 *
 *     Packed point numbers (per glyph, shared OR private):
 *       If first byte == 0: "all points" (single byte)
 *       Else: explicit point list, with run-length encoding
 *
 *     Packed deltas (one block for x, one for y, after point numbers):
 *       Sequence of runs. Each run:
 *         control byte:
 *           0x80 = DELTAS_ARE_ZERO    (no data follows)
 *           0x40 = DELTAS_ARE_WORDS   (16-bit signed deltas)
 *           bits 5-0 = (runLength - 1), 1..64 entries per run
 *         encoding cases:
 *           0x00 | n = signed bytes (1 byte per delta)
 *           0x40 | n = signed shorts (2 bytes per delta)
 *           0x80 | n = all zeros (no bytes)
 *         then run data (or none for the all-zeros form)
 *
 * Our writer targets the common case: 1 axis, all glyphs use embedded
 * peak tuples (we don't bother with shared), all points per glyph
 * (no PRIVATE_POINT_NUMBERS — implicit "all points" via single 0x00),
 * single-master variations (one tuple per glyph). Multi-master and
 * intermediate regions are future expansions.
 *
 * Public entry:
 *   buildGvar({
 *     axisCount: 1,
 *     glyphCount: N,
 *     glyphs: [
 *       null    // (or undefined) — no variations for this glyph
 *       OR
 *       {
 *         tuples: [
 *           {
 *             peak: [F2DOT14_per_axis...],   // e.g. [1.0]
 *             deltas: [[dx0,dy0], [dx1,dy1], ...]
 *             // length = numPoints + 4 phantom points
 *             // OR just numPoints (we'll pad phantoms with zeros)
 *           },
 *           ...
 *         ]
 *       }
 *     ]
 *   }) -> { bytes, stats }
 *
 *   Returns gvar table bytes. Caller is responsible for wiring it
 *   into the SFNT directory.
 * ============================================================ */
(function(global){
  'use strict';

  /* F2DOT14: signed 16.14 fixed-point. Range -2.0 to ~1.99994. */
  function toF2DOT14(n) {
    const v = Math.round(n * 16384);
    if (v > 0x7FFF || v < -0x8000) {
      throw new Error('F2DOT14 out of range: ' + n);
    }
    return v < 0 ? v + 0x10000 : v;
  }

  /* Pack a delta run with the most compact encoding possible.
     Walks the deltas, batches them into runs of:
       - "all zeros" (type 01)
       - "fits in signed byte" (type 00)
       - "needs signed short" (type 10)
     Each run is up to 64 entries. Returns an array of bytes. */
  function packDeltas(deltas) {
    const out = [];
    let i = 0;
    const N = deltas.length;
    while (i < N) {
      /* Detect run type at position i. */
      let runType;
      const v = deltas[i];
      if (v === 0) runType = 'zero';
      else if (v >= -128 && v <= 127) runType = 'byte';
      else runType = 'short';

      /* Extend run while same type continues, up to 64 entries. */
      let runEnd = i + 1;
      while (runEnd < N && runEnd - i < 64) {
        const w = deltas[runEnd];
        if (runType === 'zero') {
          if (w === 0) runEnd++;
          else break;
        } else if (runType === 'byte') {
          if (w >= -128 && w <= 127) runEnd++;
          else break;
        } else {
          /* short: any non-fitting value */
          runEnd++;
        }
      }

      const count = runEnd - i;
      /* Control byte per OpenType gvar spec:
           0x80 (bit 7) = DELTAS_ARE_ZERO  — no data follows
           0x40 (bit 6) = DELTAS_ARE_WORDS — 16-bit signed deltas
           bits 5-0    = (runLength - 1)
         Audit caught these two flags swapped in v0.8.44-46; the
         writer was emitting 0x40 for zero-runs (which a rasterizer
         interprets as "16-bit deltas follow") and 0x80 for word-runs
         ("all zeros, skip"). Every VF produced before this fix is
         unreadable by spec-compliant rasterizers. */
      if (runType === 'zero') {
        out.push(0x80 | (count - 1));   /* DELTAS_ARE_ZERO, no data */
      } else if (runType === 'byte') {
        out.push(0x00 | (count - 1));   /* signed bytes */
        for (let k = i; k < runEnd; k++) {
          const d = deltas[k];
          out.push(d < 0 ? d + 256 : d);
        }
      } else {
        out.push(0x40 | (count - 1));   /* DELTAS_ARE_WORDS */
        for (let k = i; k < runEnd; k++) {
          const d = deltas[k];
          const u = d < 0 ? d + 0x10000 : d;
          out.push((u >> 8) & 0xff);
          out.push(u & 0xff);
        }
      }
      i = runEnd;
    }
    return out;
  }

  /* Pack the per-glyph point numbers block. For "all points implicit"
     we emit a single zero byte. Anything else would need explicit
     point list encoding (more complex; not used by our writer yet). */
  function packAllPoints() {
    return [0x00];
  }

  function buildGvar(spec) {
    if (!spec || !spec.glyphs) throw new Error('buildGvar requires { glyphs: [...] }');
    const axisCount = spec.axisCount;
    const glyphCount = spec.glyphCount;
    if (!axisCount || axisCount < 1) throw new Error('axisCount must be ≥ 1');
    if (glyphCount == null || glyphCount < 1) throw new Error('glyphCount must be ≥ 1');
    if (spec.glyphs.length !== glyphCount) {
      throw new Error('glyphs array length ' + spec.glyphs.length + ' != glyphCount ' + glyphCount);
    }

    /* First pass: build the per-glyph variation data bytes. */
    const glyphData = new Array(glyphCount);
    const glyphSizes = new Array(glyphCount);
    let totalTuples = 0;
    let totalDeltaBytes = 0;
    for (let g = 0; g < glyphCount; g++) {
      const glyph = spec.glyphs[g];
      if (!glyph || !glyph.tuples || glyph.tuples.length === 0) {
        glyphData[g] = new Uint8Array(0);
        glyphSizes[g] = 0;
        continue;
      }

      const tuples = glyph.tuples;
      totalTuples += tuples.length;

      /* For each tuple: encode header bytes + packed data bytes.
         Headers go first (contiguous), then a packed-points block
         (shared if SHARED_POINT_NUMBERS at glyph level; private
         otherwise), then per-tuple deltas. We use ALL POINTS implicit
         via the SHARED_POINT_NUMBERS bit + 0x00 byte = "shared = all
         points; no need for private-points-per-tuple". */
      const tupleHeaders = [];
      const tupleDataBlocks = []; /* one packed-deltas block per tuple */

      for (const t of tuples) {
        if (!t.peak || t.peak.length !== axisCount) {
          throw new Error('tuple.peak must be array of length axisCount');
        }
        if (!t.deltas || t.deltas.length === 0) {
          throw new Error('tuple.deltas required');
        }

        const xs = [];
        const ys = [];
        for (const d of t.deltas) {
          xs.push(d[0] | 0);
          ys.push(d[1] | 0);
        }

        /* Encode peak tuple as F2DOT14 per axis. */
        const peakBytes = [];
        for (const c of t.peak) {
          const v = toF2DOT14(c);
          peakBytes.push((v >> 8) & 0xff, v & 0xff);
        }

        /* Pack x deltas, then y deltas. They share the "all points"
           assumption emitted once at glyph level. */
        const xPacked = packDeltas(xs);
        const yPacked = packDeltas(ys);
        const dataBlock = xPacked.concat(yPacked);
        tupleDataBlocks.push(dataBlock);

        /* tupleIndex with EMBEDDED_PEAK_TUPLE (0x8000) flag. We don't
           set PRIVATE_POINT_NUMBERS because we use the shared-at-
           glyph-level all-points marker. */
        const tupleIndex = 0x8000;
        const variationDataSize = dataBlock.length;

        const hdr = [];
        hdr.push((variationDataSize >> 8) & 0xff, variationDataSize & 0xff);
        hdr.push((tupleIndex >> 8) & 0xff, tupleIndex & 0xff);
        for (const b of peakBytes) hdr.push(b);
        tupleHeaders.push(hdr);
      }

      /* Assemble per-glyph TupleVariationStore.
         tupleVariationCount with SHARED_POINT_NUMBERS bit (0x8000).
         Then dataOffset = (relative to start of this glyph's data)
         points at the start of packed-points-block. */
      const sharedPointsBytes = packAllPoints(); /* always [0x00] for our writer */
      /* Compute header section size: count(2) + offset(2) + sum of tuple headers. */
      let headerSize = 4;
      for (const h of tupleHeaders) headerSize += h.length;
      const dataOffset = headerSize;

      const glyphBytes = [];
      /* tupleVariationCount: SHARED_POINT_NUMBERS | count */
      const tupleCountField = 0x8000 | (tuples.length & 0x0FFF);
      glyphBytes.push((tupleCountField >> 8) & 0xff, tupleCountField & 0xff);
      glyphBytes.push((dataOffset >> 8) & 0xff, dataOffset & 0xff);
      for (const h of tupleHeaders) for (const b of h) glyphBytes.push(b);
      for (const b of sharedPointsBytes) glyphBytes.push(b);
      for (const blk of tupleDataBlocks) for (const b of blk) glyphBytes.push(b);

      glyphData[g] = new Uint8Array(glyphBytes);
      glyphSizes[g] = glyphBytes.length;
      totalDeltaBytes += glyphBytes.length;
    }

    /* Build glyphVariationDataOffsets[]: each entry = byte offset
       into the variation data array. Last entry = total data size.
       Short format requires all offsets / 2 to fit in uint16, and
       all glyph data must be at even-byte-aligned positions. */
    const offsets = [];
    let cursor = 0;
    /* Ensure each glyph's data starts at an even byte (short-offset format requires this). */
    for (let g = 0; g < glyphCount; g++) {
      if (cursor & 1) {
        /* Pad with a zero byte so the next glyph starts at even offset. */
        cursor++;
      }
      offsets.push(cursor);
      cursor += glyphSizes[g];
    }
    if (cursor & 1) cursor++;
    offsets.push(cursor); /* sentinel = total size */

    /* Decide short vs long offsets. Short is preferred (smaller); use
       long if any offset / 2 exceeds uint16 range. */
    const maxOff = offsets[offsets.length - 1];
    const longFmt = (maxOff / 2) > 0xFFFF;
    const flags = longFmt ? 0x0001 : 0x0000;
    const offsetStride = longFmt ? 4 : 2;
    const offsetTableSize = (glyphCount + 1) * offsetStride;

    const headerSize = 20;
    /* No shared tuples: sharedTuplesOffset is meaningless but set to
       point past the offset table. */
    const dataArrayStart = headerSize + offsetTableSize;
    const sharedTuplesStart = dataArrayStart; /* zero shared tuples */

    /* Assemble final gvar bytes. */
    const totalSize = dataArrayStart + cursor;
    const out = new Uint8Array(totalSize);
    const dv = new DataView(out.buffer);
    let p = 0;
    dv.setUint16(p, 1, false); p += 2;                 /* majorVersion */
    dv.setUint16(p, 0, false); p += 2;                 /* minorVersion */
    dv.setUint16(p, axisCount, false); p += 2;
    dv.setUint16(p, 0, false); p += 2;                 /* sharedTupleCount */
    dv.setUint32(p, sharedTuplesStart, false); p += 4; /* sharedTuplesOffset */
    dv.setUint16(p, glyphCount, false); p += 2;
    dv.setUint16(p, flags, false); p += 2;
    dv.setUint32(p, dataArrayStart, false); p += 4;    /* glyphVariationDataArrayOffset */

    /* Offset table. Short offsets are /2 per spec. */
    for (const off of offsets) {
      if (longFmt) {
        dv.setUint32(p, off, false); p += 4;
      } else {
        dv.setUint16(p, off / 2, false); p += 2;
      }
    }

    /* Per-glyph data, padded to even boundaries. */
    let dataPos = dataArrayStart;
    for (let g = 0; g < glyphCount; g++) {
      if ((dataPos - dataArrayStart) & 1) dataPos++; /* pad byte (zeros by default) */
      out.set(glyphData[g], dataPos);
      dataPos += glyphSizes[g];
    }

    return {
      bytes: out,
      stats: {
        axisCount,
        glyphCount,
        glyphsWithVariations: glyphData.filter(g => g.length > 0).length,
        totalTuples,
        totalDeltaBytes,
        longOffsets: longFmt,
      },
    };
  }

  global.buildGvar = buildGvar;

})(typeof self !== 'undefined' ? self : this);
