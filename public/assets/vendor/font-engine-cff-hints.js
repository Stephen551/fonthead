/* ============================================================
 * font-engine-cff-hints.js  (Phase 4b — CFF Private DICT emission)
 * ------------------------------------------------------------
 * Worker-only. Takes the OTF bytes opentype.js produced (which
 * contain a degenerate zero-size Private DICT) and surgically
 * inserts a real Private DICT carrying our hinting telemetry:
 *
 *   BlueValues       — pairs of y-zones where stem ENDS snap to
 *                      crisp pixel boundaries at small sizes
 *                      (baseline / cap height / x-height / round-overshoots)
 *   OtherBlues       — pairs below baseline (descender zones)
 *   FamilyBlues      — copy of BlueValues (used when font is in a "family")
 *   FamilyOtherBlues — copy of OtherBlues
 *   StdHW            — dominant horizontal stem width
 *   StdVW            — dominant vertical stem width
 *   StemSnapH        — top horizontal stem widths (rasterizer snaps to these)
 *   StemSnapV        — top vertical stem widths
 *   BlueScale        — small-size threshold for overshoot suppression
 *   BlueShift        — pixel-shift threshold for hinting kick-in
 *   BlueFuzz         — blue zone tolerance
 *
 * This is the GLOBAL half of CFF hinting — per-glyph stem
 * declarations in CharStrings (hstem/vstem) is Phase 4b-2 and
 * needs separate Type 2 CharString surgery.
 *
 * Even without per-glyph hints, blue zones alone deliver
 * measurable rendering improvement at small sizes (FreeType /
 * CoreText / DirectWrite all align glyph features to the
 * declared blue zones during rasterization).
 *
 * Public entry:
 *   injectCFFHints(sfntBytes, telemetry, opts?) -> {
 *     bytes: Uint8Array,
 *     status: 'embedded' | 'skipped' | 'failed',
 *     reason?: string,
 *     privateDictSize?: number,
 *   }
 *
 * Safety: if anything goes wrong (parse failure, validation fail,
 * unexpected CFF layout), returns the ORIGINAL bytes with a
 * status flag. The font modal surfaces the status so the user
 * sees if their download has hints embedded or not.
 * ============================================================ */
(function(global){
  'use strict';

  /* CFF DICT operator codes. Single-byte ops < 22; ops 12+ are
     2-byte (escape 12 + sub-op). Operands precede their operator
     in DICT byte stream. */
  const OP = {
    /* Top DICT operators we touch */
    charset:      15,
    encoding:     16,
    charStrings:  17,
    private:      18,
    /* Private DICT operators we emit */
    blueValues:        6,
    otherBlues:        7,
    familyBlues:       8,
    familyOtherBlues:  9,
    stdHW:            10,
    stdVW:            11,
    blueScale:    [12, 9],
    blueShift:    [12, 10],
    blueFuzz:     [12, 11],
    stemSnapH:    [12, 12],
    stemSnapV:    [12, 13],
    /* Private DICT operators we PRESERVE if present */
    subrs:            19,
    defaultWidthX:    20,
    nominalWidthX:    21,
  };

  /* === DICT operand/operator encoding ===
     Per Adobe Technical Note #5176 ("The Compact Font Format
     Specification"), Table 3. encInt picks the smallest valid
     encoding for the value's range. */
  function encInt(n) {
    n = n | 0;
    if (n >= -107 && n <= 107) return [n + 139];
    if (n >= 108 && n <= 1131) {
      const b = n - 108;
      return [(b >> 8) + 247, b & 0xff];
    }
    if (n >= -1131 && n <= -108) {
      const b = -n - 108;
      return [(b >> 8) + 251, b & 0xff];
    }
    if (n >= -32768 && n <= 32767) {
      return [28, (n >> 8) & 0xff, n & 0xff];
    }
    return [29, (n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff];
  }

  /* Force int32 encoding (always 5 bytes) — used for Top DICT
     offset operators so re-encoding doesn't change byte length
     based on value. Critical for offset surgery: we compute
     offsets that depend on Top DICT size, which depends on
     offset encoding length, which depends on offsets… circular
     unless encoding length is fixed. */
  function encInt32(n) {
    return [29, (n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff];
  }

  /* BCD-encoded real number, operator 30. Nibbles 0-9 are digits,
     0xa = '.', 0xb = 'E', 0xc = 'E-', 0xe = '-', 0xf = terminator. */
  function encReal(n) {
    let s;
    if (n === 0) s = '0';
    else {
      s = n.toString();
      /* Strip the implicit-0 mantissa form (e.g. '.039625' stays as
         '.039625' which has a leading 0 in JS, so just stringify). */
    }
    const nibbles = [];
    for (const c of s) {
      if (c >= '0' && c <= '9') nibbles.push(c.charCodeAt(0) - 48);
      else if (c === '.') nibbles.push(0xa);
      else if (c === 'e' || c === 'E') {
        /* Look ahead: if next char is '-', emit 0xc and skip the '-'
           in the next iteration. Standard ED-LE5176-style packing. */
        nibbles.push(0xb);
      }
      else if (c === '-') nibbles.push(0xe);
      else if (c === '+') {} /* skipped */
    }
    nibbles.push(0xf);
    if (nibbles.length & 1) nibbles.push(0xf);
    const bytes = [30];
    for (let i = 0; i < nibbles.length; i += 2) {
      bytes.push((nibbles[i] << 4) | nibbles[i + 1]);
    }
    return bytes;
  }

  function encOpBytes(op) {
    if (Array.isArray(op)) return [op[0], op[1]];
    return [op];
  }

  /* Encode one complete DICT entry: operands followed by operator. */
  function encEntry(operands, op, useInt32) {
    const out = [];
    for (const v of operands) {
      if (Number.isInteger(v)) {
        if (useInt32) out.push(...encInt32(v));
        else out.push(...encInt(v));
      } else {
        out.push(...encReal(v));
      }
    }
    out.push(...encOpBytes(op));
    return out;
  }

  /* Delta-array entry. CFF stores arrays like BlueValues as
     CUMULATIVE deltas, not absolute values, to keep the byte
     stream compact. First value is absolute; subsequent are
     differences. E.g. BlueValues [-12, 0, 700, 712] is encoded
     as deltas [-12, 12, 700, 12]. The decoder reverses this. */
  function encDelta(values, op) {
    if (!values || values.length === 0) return [];
    const deltas = [values[0]];
    for (let i = 1; i < values.length; i++) {
      deltas.push(values[i] - values[i - 1]);
    }
    return encEntry(deltas, op, false);
  }

  /* === DICT decoder ===
     Walks bytes from `start` to `end` and returns an array of
     { op, opBytes, operands } entries. opBytes is the raw byte
     representation of the operator (length 1 or 2) which we use
     to compare/sort. We DO NOT preserve the original operand
     encoding — re-encoders will pick a fresh encoding. */
  function decodeDict(buf, start, end) {
    const entries = [];
    let operands = [];
    let p = start;
    while (p < end) {
      const b = buf[p];
      if (b <= 21) {
        let op = b;
        let opBytes = 1;
        if (op === 12) {
          op = [12, buf[p + 1]];
          opBytes = 2;
        }
        entries.push({ op, opBytes, operands });
        operands = [];
        p += opBytes;
      } else if (b === 28) {
        const v = (buf[p + 1] << 24 >> 16) | buf[p + 2];
        operands.push(v);
        p += 3;
      } else if (b === 29) {
        const v = (buf[p + 1] << 24) | (buf[p + 2] << 16) | (buf[p + 3] << 8) | buf[p + 4];
        operands.push(v);
        p += 5;
      } else if (b === 30) {
        let s = '';
        p++;
        let done = false;
        while (!done) {
          const x = buf[p];
          const hi = x >> 4, lo = x & 0xf;
          for (const n of [hi, lo]) {
            if (n < 10) s += String(n);
            else if (n === 0xa) s += '.';
            else if (n === 0xb) s += 'E';
            else if (n === 0xc) s += 'E-';
            else if (n === 0xe) s += '-';
            else if (n === 0xf) { done = true; break; }
          }
          p++;
          if (done) break;
        }
        operands.push(parseFloat(s));
      } else if (b >= 32 && b <= 246) {
        operands.push(b - 139); p++;
      } else if (b >= 247 && b <= 250) {
        operands.push((b - 247) * 256 + buf[p + 1] + 108); p += 2;
      } else if (b >= 251 && b <= 254) {
        operands.push(-(b - 251) * 256 - buf[p + 1] - 108); p += 2;
      } else {
        /* Reserved / invalid byte — skip to avoid infinite loop on
           malformed input. */
        p++;
      }
    }
    return entries;
  }

  /* === INDEX read/write ===
     CFF INDEX format: count (Card16), offSize (1-4), offset[count+1],
     data. Offsets are 1-based and relative to data start. */
  function readIndex(buf, off) {
    const count = (buf[off] << 8) | buf[off + 1];
    off += 2;
    if (count === 0) {
      return { count: 0, oSize: 0, offsets: [], dataStart: off, dataEnd: off, end: off };
    }
    const oSize = buf[off]; off += 1;
    const offsets = [];
    for (let i = 0; i <= count; i++) {
      let v = 0;
      for (let j = 0; j < oSize; j++) v = (v << 8) | buf[off + i * oSize + j];
      offsets.push(v);
    }
    const dataStart = off + (count + 1) * oSize;
    const dataEnd = dataStart + offsets[count] - 1;
    return { count, oSize, offsets, dataStart, dataEnd, end: dataEnd };
  }

  function copyIndexData(buf, idx) {
    const items = [];
    for (let i = 0; i < idx.count; i++) {
      items.push(buf.subarray(idx.dataStart + idx.offsets[i] - 1, idx.dataStart + idx.offsets[i + 1] - 1));
    }
    return items;
  }

  /* Build INDEX bytes from an array of Uint8Array items. Picks the
     smallest offSize that fits. */
  function writeIndex(items) {
    if (items.length === 0) return new Uint8Array([0, 0]);
    let total = 1; /* offsets are 1-based; offset[0] is always 1 */
    const offsets = [1];
    for (const it of items) { total += it.length; offsets.push(total); }
    const maxOff = offsets[offsets.length - 1];
    let oSize;
    if (maxOff <= 0xff) oSize = 1;
    else if (maxOff <= 0xffff) oSize = 2;
    else if (maxOff <= 0xffffff) oSize = 3;
    else oSize = 4;
    const headerSize = 2 + 1 + (items.length + 1) * oSize;
    let dataSize = 0;
    for (const it of items) dataSize += it.length;
    const out = new Uint8Array(headerSize + dataSize);
    out[0] = (items.length >> 8) & 0xff;
    out[1] = items.length & 0xff;
    out[2] = oSize;
    let p = 3;
    for (const o of offsets) {
      for (let j = oSize - 1; j >= 0; j--) out[p++] = (o >> (j * 8)) & 0xff;
    }
    for (const it of items) { out.set(it, p); p += it.length; }
    return out;
  }

  /* === Private DICT builder ===
     Translates our blueZones/stems telemetry into the spec-shaped
     Private DICT bytes. CFF blue zones are PAIRS of y-values
     (bottom, top of each zone) where rasterizers snap edges. */
  function buildPrivateDict(telemetry, preservedFromExisting) {
    const bz = telemetry.blueZones || {};
    const stems = telemetry.stems || {};

    /* BlueValues: baseline pair + flat-top zones (cap, x-height,
       ascender). MUST be sorted ascending. Each zone is a pair
       [bottomEdge, topEdge]. The baseline pair is special — it's
       treated as (overshoot_below, exact_baseline). */
    const blues = [];
    /* Baseline pair: [0, 0] (we don't track baseline overshoot
       separately from descender zones — opentype's default). */
    blues.push(0, 0);
    if (bz.xHeight != null) {
      const overshoot = (bz.xHeightOvershoot != null && bz.xHeightOvershoot > bz.xHeight)
        ? bz.xHeightOvershoot : bz.xHeight;
      blues.push(Math.round(bz.xHeight), Math.round(overshoot));
    }
    if (bz.capHeight != null) {
      const overshoot = (bz.capOvershoot != null && bz.capOvershoot > bz.capHeight)
        ? bz.capOvershoot : bz.capHeight;
      blues.push(Math.round(bz.capHeight), Math.round(overshoot));
    }
    if (bz.ascender != null && (bz.capHeight == null || bz.ascender > bz.capHeight + 1)) {
      blues.push(Math.round(bz.ascender), Math.round(bz.ascender));
    }
    /* Spec limit: BlueValues max 14 entries (7 zones). We've added at
       most 8 entries so we're safe. Also: pairs must not overlap;
       enforce strict ascending. */
    for (let i = 2; i < blues.length; i += 2) {
      if (blues[i] <= blues[i - 1]) blues[i] = blues[i - 1] + 1;
      if (blues[i + 1] < blues[i]) blues[i + 1] = blues[i];
    }

    /* OtherBlues: below-baseline zones (descender area). Each pair
       [bottomEdge, topEdge] with topEdge ≤ 0 (below baseline).
       Ordered ASCENDING (lower y first). */
    const otherBlues = [];
    if (bz.descender != null) {
      const overshoot = (bz.descenderOvershoot != null && bz.descenderOvershoot < bz.descender)
        ? bz.descenderOvershoot : bz.descender;
      otherBlues.push(Math.round(overshoot), Math.round(bz.descender));
    }

    /* StemSnap arrays: top N stem widths from the histogram, ordered
       ascending. Skip if the standard stem isn't set (no stems detected). */
    const topWidths = (counts, max) => {
      if (!counts || counts.length === 0) return [];
      const widths = counts.slice(0, max).map(([w]) => w).filter(w => w > 0);
      widths.sort((a, b) => a - b);
      /* Dedupe — adjacent same values are invalid in StemSnap */
      const dedup = [];
      for (const w of widths) if (dedup[dedup.length - 1] !== w) dedup.push(w);
      return dedup;
    };
    const snapH = topWidths(stems.hCounts, 4);
    const snapV = topWidths(stems.vCounts, 4);

    /* Assemble the Private DICT byte stream. Order is arbitrary per
       spec (decoders don't care). We emit operators in roughly the
       order they appear in Adobe's reference fonts: blues first,
       stems next, scale/shift/fuzz last, then preserved values. */
    const out = [];
    if (blues.length >= 2) {
      out.push(...encDelta(blues, OP.blueValues));
      /* FamilyBlues = same as BlueValues so the font behaves the same
         whether referenced standalone or as part of a family. */
      out.push(...encDelta(blues, OP.familyBlues));
    }
    if (otherBlues.length >= 2) {
      out.push(...encDelta(otherBlues, OP.otherBlues));
      out.push(...encDelta(otherBlues, OP.familyOtherBlues));
    }
    if (stems.stdHW != null && stems.stdHW > 0) {
      out.push(...encEntry([Math.round(stems.stdHW)], OP.stdHW, false));
    }
    if (stems.stdVW != null && stems.stdVW > 0) {
      out.push(...encEntry([Math.round(stems.stdVW)], OP.stdVW, false));
    }
    if (snapH.length >= 1) out.push(...encDelta(snapH, OP.stemSnapH));
    if (snapV.length >= 1) out.push(...encDelta(snapV, OP.stemSnapV));
    /* BlueScale default is 0.039625. Lower = overshoot suppressed
       at smaller sizes. Stock value works for most fonts. */
    out.push(...encEntry([0.039625], OP.blueScale, false));
    out.push(...encEntry([7], OP.blueShift, false));
    out.push(...encEntry([1], OP.blueFuzz, false));

    /* Preserve any operators opentype.js wrote (defaultWidthX,
       nominalWidthX, Subrs). Our hints are additive — we don't
       want to clobber CharString width semantics. */
    if (preservedFromExisting) {
      for (const e of preservedFromExisting) out.push(...e);
    }

    return new Uint8Array(out);
  }

  /* === Type 2 CharString integer encoding ===
     Different from DICT integers: no op 29 (4-byte int32) — Type 2
     supports only -107..107 (1B), 108..1131 (2B), -1131..-108 (2B),
     short int -32768..32767 (3B), and fixed 16.16 (5B, op 255).
     Stem deltas in font units fit comfortably in int16 for fonts
     with UPM ≤ 32767, which covers our 1000-2048 range. */
  function encCSInt(n) {
    n = Math.round(n);
    if (n >= -107 && n <= 107) return [n + 139];
    if (n >= 108 && n <= 1131) {
      const b = n - 108;
      return [(b >> 8) + 247, b & 0xff];
    }
    if (n >= -1131 && n <= -108) {
      const b = -n - 108;
      return [(b >> 8) + 251, b & 0xff];
    }
    if (n >= -32768 && n <= 32767) {
      return [28, (n >> 8) & 0xff, n & 0xff];
    }
    throw new Error('CharString int out of range: ' + n);
  }

  /* Encode a sequence of stems as Type 2 hstem/vstem operands.
     Stems are stored as cumulative-edge deltas: first stem's
     position is absolute from origin (baseline for hstem, LSB for
     vstem), then alternating (height, gap_to_next_position, height,
     gap, …). E.g. 2 hstems at y=100 (height 10) and y=500 (height 12):
       absolute encoding:    [100, 10, 500, 12]
       delta encoding:       [100, 10, 390, 12]
       (390 = 500 - (100+10) — gap from top edge of stem 1 to bottom
       edge of stem 2). The Type 2 spec calls these "y" and "dy"
       values where dy alternates between stem-height and gap-to-next. */
  function encStemHints(stems, opByte, posKey, lenKey) {
    if (!stems || stems.length === 0) return [];
    const out = [];
    let prevEdge = 0;
    for (const s of stems) {
      const pos = s[posKey];
      const len = s[lenKey];
      const delta = pos - prevEdge;
      out.push(...encCSInt(delta));
      out.push(...encCSInt(len));
      prevEdge = pos + len;
    }
    out.push(opByte);
    return out;
  }

  /* Build the hint prefix bytes (hstem block + vstem block) to
     prepend to an existing CharString. Per Type 2 spec, hstem MUST
     come before vstem, and both MUST appear before any path operator
     or hintmask. CFF integer "width" prefix (if present in original
     CharString) sits in front of all of this — since we prepend
     hint bytes AFTER any width on the stack… wait, we prepend BYTES.
     The original CharString already has its width operand (if any)
     as its first byte(s). We prepend hint bytes BEFORE those, which
     pushes the width to the stack BEFORE the hints — wrong.

     Actually: per spec, the width is interpreted by the FIRST stack
     consumer (hstem, vstem, *moveto, or endchar). When we prepend
     hstem, the original width operand (if any) is no longer at the
     front of the byte stream — OUR bytes are. So we'd need to
     extract any leading width operand from the original CharString,
     re-emit it FIRST in our prefix, then our hints, then the rest
     of the original.

     For opentype.js output: nominalWidthX defaults to 0 and most
     glyph widths are emitted as actual advance widths. So there
     WILL be a leading width operand in many CharStrings.

     Detection: walk the original CharString bytes counting operands
     until the first operator. If that operator is *moveto and the
     operand count is odd (3 instead of 2), the first operand is
     width. We extract it, emit it first, then our hints, then the
     rest of the CharString starting from the second operand.

     If the operator is hstem (which opentype.js doesn't emit but
     could in theory), the width detection is "odd count > expected".
     For simplicity we only handle the common case (moveto leading)
     and skip hint emission if the CharString opens with anything
     unexpected. */
  function buildHintPrefix(csBytes, hstems, vstems) {
    const hintBytes = [];
    if (hstems && hstems.length > 0) {
      hintBytes.push(...encStemHints(hstems, 0x01, 'y', 'dy')); /* hstem = 1 */
    }
    if (vstems && vstems.length > 0) {
      /* If hstems were declared, vstem MUST be vstemhm (op 23) if a
         hintmask follows — but we don't emit hintmasks, so plain
         vstem (op 3) is correct here. */
      hintBytes.push(...encStemHints(vstems, 0x03, 'x', 'dx')); /* vstem = 3 */
    }
    if (hintBytes.length === 0) return csBytes;

    /* Width extraction. Walk operand bytes until first operator. */
    const widthInfo = extractWidth(csBytes);
    if (widthInfo === null) {
      /* Defensive: unrecognized leading shape — skip hint emission for
         this glyph rather than risk producing an invalid CharString. */
      return csBytes;
    }
    const out = new Uint8Array(widthInfo.widthBytes.length + hintBytes.length + (csBytes.length - widthInfo.widthBytes.length));
    let p = 0;
    out.set(widthInfo.widthBytes, p); p += widthInfo.widthBytes.length;
    for (const b of hintBytes) out[p++] = b;
    out.set(csBytes.subarray(widthInfo.widthBytes.length), p);
    return out;
  }

  /* Inspect CharString head to find any leading width operand.
     Returns { widthBytes: Uint8Array } where widthBytes is empty if
     no width is present, or returns null if the CharString shape is
     unexpected (don't risk hinting it). */
  function extractWidth(cs) {
    let p = 0;
    const operandStartOffsets = [];
    while (p < cs.length) {
      const b = cs[p];
      if (b <= 31) {
        /* First operator. Check its identity. */
        const opByte = b;
        if (opByte === 4 || opByte === 22) {
          /* vmoveto (1 operand expected) or hmoveto (1) */
          if (operandStartOffsets.length === 2) {
            /* width then the moveto coord */
            return { widthBytes: cs.subarray(0, operandStartOffsets[1]) };
          }
          if (operandStartOffsets.length === 1) return { widthBytes: new Uint8Array(0) };
        } else if (opByte === 21) {
          /* rmoveto (2 operands expected) */
          if (operandStartOffsets.length === 3) {
            return { widthBytes: cs.subarray(0, operandStartOffsets[1]) };
          }
          if (operandStartOffsets.length === 2) return { widthBytes: new Uint8Array(0) };
        } else if (opByte === 1 || opByte === 3 || opByte === 18 || opByte === 23) {
          /* hstem/vstem/hstemhm/vstemhm — width is leftmost if odd-count operands */
          if (operandStartOffsets.length & 1) {
            return { widthBytes: cs.subarray(0, operandStartOffsets[1]) };
          }
          return { widthBytes: new Uint8Array(0) };
        } else if (opByte === 14) {
          /* endchar bare (empty glyph). 0 or 1 operand (width). */
          if (operandStartOffsets.length === 1) return { widthBytes: cs.subarray(0, operandStartOffsets[0] + (p - operandStartOffsets[0])) };
          if (operandStartOffsets.length === 0) return { widthBytes: new Uint8Array(0) };
        }
        return null; /* unrecognized */
      }
      /* Operand byte — record start and advance past full operand. */
      operandStartOffsets.push(p);
      if (b === 28) p += 3;
      else if (b === 255) p += 5;
      else if (b >= 32 && b <= 246) p += 1;
      else if (b >= 247 && b <= 254) p += 2;
      else p += 1;
    }
    return null;
  }

  /* Rebuild the CharStrings INDEX with hint prefixes for glyphs that
     have entries in perGlyphHints. Glyphs without entries pass
     through untouched. */
  function rebuildCharStringsIndex(buf, csIdxOffsetAbs, perGlyphHints) {
    const idx = readIndex(buf, csIdxOffsetAbs);
    const items = [];
    let hintedCount = 0;
    for (let i = 0; i < idx.count; i++) {
      const orig = buf.subarray(
        idx.dataStart + idx.offsets[i] - 1,
        idx.dataStart + idx.offsets[i + 1] - 1
      );
      const hints = perGlyphHints && perGlyphHints.get(i);
      if (hints && (hints.hstems.length || hints.vstems.length)) {
        const modified = buildHintPrefix(orig, hints.hstems, hints.vstems);
        if (modified !== orig) hintedCount++;
        items.push(modified);
      } else {
        items.push(orig);
      }
    }
    return { bytes: writeIndex(items), hintedCount, totalGlyphs: idx.count };
  }

  /* === Main entry: surgery on SFNT bytes === */
  function injectCFFHints(sfntBytes, telemetry, opts) {
    opts = opts || {};
    if (!sfntBytes || sfntBytes.length < 12) {
      return { bytes: sfntBytes, status: 'failed', reason: 'sfnt too small' };
    }
    if (!telemetry || !telemetry.blueZones) {
      return { bytes: sfntBytes, status: 'skipped', reason: 'no telemetry' };
    }

    /* Locate CFF table in SFNT directory. */
    const view = new DataView(sfntBytes.buffer, sfntBytes.byteOffset, sfntBytes.byteLength);
    const numTables = view.getUint16(4, false);
    let cffEntry = null;
    let headEntry = null;
    const allEntries = [];
    for (let i = 0; i < numTables; i++) {
      const recOff = 12 + i * 16;
      const tag = String.fromCharCode(sfntBytes[recOff], sfntBytes[recOff + 1], sfntBytes[recOff + 2], sfntBytes[recOff + 3]);
      const offset = view.getUint32(recOff + 8, false);
      const length = view.getUint32(recOff + 12, false);
      const entry = { tag, recOff, offset, length };
      allEntries.push(entry);
      if (tag === 'CFF ') cffEntry = entry;
      if (tag === 'head') headEntry = entry;
    }
    if (!cffEntry) {
      return { bytes: sfntBytes, status: 'skipped', reason: 'not a CFF font (TTF outlines)' };
    }

    /* Parse CFF top-level structure. */
    let cff;
    try {
      cff = parseCFF(sfntBytes, cffEntry.offset, cffEntry.length);
    } catch (err) {
      return { bytes: sfntBytes, status: 'failed', reason: 'CFF parse: ' + (err.message || err) };
    }

    /* Decode existing Private DICT (likely empty) to preserve any
       defaultWidthX / nominalWidthX / Subrs that opentype.js wrote. */
    const preserved = [];
    if (cff.privateSize > 0) {
      const privStart = cffEntry.offset + cff.privateOffset;
      const privEntries = decodeDict(sfntBytes, privStart, privStart + cff.privateSize);
      for (const e of privEntries) {
        const opNum = Array.isArray(e.op) ? -1 : e.op;
        if (opNum === OP.defaultWidthX || opNum === OP.nominalWidthX) {
          preserved.push(encEntry(e.operands, e.op, false));
        }
        /* NOTE: Subrs (op 19) is intentionally NOT preserved — its
           operand is the offset of Local Subrs RELATIVE to Private
           DICT start, which our new Private DICT changes. If
           opentype.js ever ships Subrs, Phase 4b-2 handles it
           alongside per-glyph hints. */
      }
    }

    /* Build the new Private DICT bytes. */
    const privDictBytes = buildPrivateDict(telemetry, preserved);
    if (privDictBytes.length < 4) {
      return { bytes: sfntBytes, status: 'skipped', reason: 'empty private dict (no usable telemetry)' };
    }

    /* Phase 4b-2: optionally rebuild CharStrings INDEX with stem
       hint prefixes. If perGlyphHints is provided, we re-emit each
       glyph's CharString with hstem/vstem operators prepended (and
       any leading width operand preserved). Glyphs without hint
       entries pass through untouched. */
    const oldCharStringsAbs = cffEntry.offset + cff.topDict.charStrings;
    let newCharStringsBytes;
    let csRebuildInfo = null;
    if (opts.perGlyphHints && opts.perGlyphHints.size > 0) {
      try {
        const r = rebuildCharStringsIndex(sfntBytes, oldCharStringsAbs, opts.perGlyphHints);
        newCharStringsBytes = r.bytes;
        csRebuildInfo = { hintedCount: r.hintedCount, totalGlyphs: r.totalGlyphs };
      } catch (err) {
        return { bytes: sfntBytes, status: 'failed', reason: 'charstrings rebuild: ' + (err.message || err) };
      }
    } else {
      /* Pass-through: read old CharStrings INDEX bytes as-is. */
      const oldCSIdx = readIndex(sfntBytes, oldCharStringsAbs);
      newCharStringsBytes = sfntBytes.subarray(oldCharStringsAbs, oldCSIdx.dataEnd);
    }

    /* Lay out the new CFF. Re-encode the Top DICT with fixed-int32
       offset operators so its encoded size is constant regardless
       of the offset VALUES — this lets us compute offsets once
       without iteration. The four offset-bearing targets are
       charset / encoding / charstrings / private. */
    let newTopDict;
    try {
      newTopDict = rebuildTopDict(sfntBytes, cff, /* placeholder offsets */ {
        charset: cff.topDict.charset,
        encoding: cff.topDict.encoding,
        charStrings: cff.topDict.charStrings,
        privateSize: privDictBytes.length,
        privateOffset: 0, /* placeholder */
      });
    } catch (err) {
      return { bytes: sfntBytes, status: 'failed', reason: 'top dict rebuild: ' + (err.message || err) };
    }

    /* Compute the offset shift from the OLD Top DICT INDEX to the
       new one. Everything in the CFF AFTER the Top DICT INDEX
       shifts by this delta. */
    const newTopDictIndex = writeIndex([newTopDict]);
    const oldTopIdxLen = cff.topIdxEnd - cff.topIdxStart;
    const shift = newTopDictIndex.length - oldTopIdxLen;

    /* Resolved offsets in the new CFF (CFF-relative). CharStrings
       INDEX sits at the same offset relative to old (shifted by
       Top DICT delta). Private DICT goes immediately AFTER the new
       CharStrings INDEX, so its offset depends on the new INDEX's
       size (which may differ from old when per-glyph hints were
       added). */
    const resolved = {
      charset: cff.topDict.charset > 0 ? cff.topDict.charset + shift : 0,
      encoding: cff.topDict.encoding > 0 ? cff.topDict.encoding + shift : 0,
      charStrings: cff.topDict.charStrings + shift,
      privateSize: privDictBytes.length,
      privateOffset: cff.topDict.charStrings + shift + newCharStringsBytes.length,
    };

    let finalTopDict;
    try {
      finalTopDict = rebuildTopDict(sfntBytes, cff, resolved);
    } catch (err) {
      return { bytes: sfntBytes, status: 'failed', reason: 'top dict resolve: ' + (err.message || err) };
    }
    /* Sanity: rebuilt Top DICT must match the placeholder length,
       otherwise our fixed-int32 invariant has a bug. */
    if (finalTopDict.length !== newTopDict.length) {
      return { bytes: sfntBytes, status: 'failed', reason: 'top dict length unstable (' + newTopDict.length + ' vs ' + finalTopDict.length + ')' };
    }
    const finalTopIdx = writeIndex([finalTopDict]);
    if (finalTopIdx.length !== newTopDictIndex.length) {
      return { bytes: sfntBytes, status: 'failed', reason: 'top idx length unstable' };
    }

    /* Assemble the new CFF table:
         header + name idx + new top idx + middle blob (string idx,
         gsubr idx, charsets, encoding — verbatim) + new CharStrings
         INDEX + new Private DICT. */
    const headerAndName = sfntBytes.subarray(cffEntry.offset, cff.topIdxStart);
    const middleBlob = sfntBytes.subarray(cff.topIdxEnd, oldCharStringsAbs);
    const newCFFLen = headerAndName.length + finalTopIdx.length + middleBlob.length + newCharStringsBytes.length + privDictBytes.length;
    const newCFF = new Uint8Array(newCFFLen);
    let cffP = 0;
    newCFF.set(headerAndName, cffP); cffP += headerAndName.length;
    newCFF.set(finalTopIdx, cffP); cffP += finalTopIdx.length;
    newCFF.set(middleBlob, cffP); cffP += middleBlob.length;
    newCFF.set(newCharStringsBytes, cffP); cffP += newCharStringsBytes.length;
    newCFF.set(privDictBytes, cffP); cffP += privDictBytes.length;

    /* Validate: re-parse the new CFF and confirm Private DICT lands
       at the expected offset with the expected size. */
    try {
      const reparsed = parseCFF(newCFF, 0, newCFF.length);
      if (reparsed.privateSize !== privDictBytes.length) {
        return { bytes: sfntBytes, status: 'failed', reason: 'private size mismatch after rebuild: ' + reparsed.privateSize + ' vs ' + privDictBytes.length };
      }
      if (reparsed.privateOffset !== resolved.privateOffset) {
        return { bytes: sfntBytes, status: 'failed', reason: 'private offset mismatch: ' + reparsed.privateOffset + ' vs ' + resolved.privateOffset };
      }
      const privCheck = decodeDict(newCFF, reparsed.privateOffset, reparsed.privateOffset + reparsed.privateSize);
      if (privCheck.length === 0) {
        return { bytes: sfntBytes, status: 'failed', reason: 'private dict decoded to zero entries' };
      }
    } catch (err) {
      return { bytes: sfntBytes, status: 'failed', reason: 'reparse failed: ' + (err.message || err) };
    }

    /* Replace CFF in SFNT. Tables BEFORE 'CFF ' keep offset; tables
       AFTER shift by (newCFFLen - oldCFFLen), rounded up to 4. */
    const cffDelta = newCFFLen - cffEntry.length;
    const cffPaddedDelta = ((newCFFLen + 3) & ~3) - ((cffEntry.length + 3) & ~3);
    const newSfnt = rebuildSFNT(sfntBytes, allEntries, cffEntry, newCFF, cffPaddedDelta, headEntry, view);
    const oldCSLen = readIndex(sfntBytes, oldCharStringsAbs).dataEnd - oldCharStringsAbs;
    return {
      bytes: newSfnt,
      status: 'embedded',
      privateDictSize: privDictBytes.length,
      cffDelta,
      perGlyphHinted: csRebuildInfo ? csRebuildInfo.hintedCount : 0,
      perGlyphTotal: csRebuildInfo ? csRebuildInfo.totalGlyphs : 0,
      details: {
        privateOffset: resolved.privateOffset,
        charStringsDelta: newCharStringsBytes.length - oldCSLen,
      },
    };
  }

  /* Parse CFF top-level structure into the offsets we need for
     surgery. Doesn't decode CharStrings or strings — just enough
     to locate the Top DICT and Private DICT. */
  function parseCFF(buf, cffOff, cffLen) {
    if (cffLen < 4) throw new Error('CFF too small');
    const hdrSize = buf[cffOff + 2];
    let pos = cffOff + hdrSize;
    const nameIdx = readIndex(buf, pos);
    pos = nameIdx.dataStart + nameIdx.offsets[nameIdx.count] - 1;
    const topIdxStart = pos;
    const topIdx = readIndex(buf, pos);
    if (topIdx.count !== 1) throw new Error('expected single Top DICT, got ' + topIdx.count);
    const topDictStart = topIdx.dataStart + topIdx.offsets[0] - 1;
    const topDictEnd = topIdx.dataStart + topIdx.offsets[1] - 1;
    pos = topIdx.dataStart + topIdx.offsets[topIdx.count] - 1;
    const topIdxEnd = pos;

    const topDictEntries = decodeDict(buf, topDictStart, topDictEnd);
    const topDict = {
      entries: topDictEntries,
      charset: 0, encoding: 0, charStrings: 0,
      privateSize: 0, privateOffset: 0,
    };
    for (const e of topDictEntries) {
      if (e.op === OP.charset) topDict.charset = e.operands[0];
      else if (e.op === OP.encoding) topDict.encoding = e.operands[0];
      else if (e.op === OP.charStrings) topDict.charStrings = e.operands[0];
      else if (e.op === OP.private) {
        topDict.privateSize = e.operands[0];
        topDict.privateOffset = e.operands[1];
      }
    }
    if (topDict.charStrings === 0) throw new Error('no CharStrings offset in Top DICT');
    if (topDict.privateOffset === 0 && topDict.privateSize === 0) {
      /* Some CFF writers omit Private entirely. Spec allows this
         only for synthetic fonts; tracer-built fonts should always
         have a Private op (even if size 0). Treat as error to flag
         unexpected layouts. */
      throw new Error('no Private operator in Top DICT');
    }
    return {
      hdrSize, topIdxStart, topIdxEnd, topDictStart, topDictEnd,
      topDict,
      privateOffset: topDict.privateOffset,
      privateSize: topDict.privateSize,
      oldCFFEnd: cffLen, /* end of CFF table, CFF-relative */
    };
  }

  /* Re-encode Top DICT with offset operators using fixed int32 so
     encoded length is stable regardless of operand values. */
  function rebuildTopDict(buf, cff, resolved) {
    const out = [];
    for (const e of cff.topDict.entries) {
      if (e.op === OP.charset) {
        out.push(...encEntry([resolved.charset], OP.charset, true));
      } else if (e.op === OP.encoding) {
        out.push(...encEntry([resolved.encoding], OP.encoding, true));
      } else if (e.op === OP.charStrings) {
        out.push(...encEntry([resolved.charStrings], OP.charStrings, true));
      } else if (e.op === OP.private) {
        out.push(...encEntry([resolved.privateSize, resolved.privateOffset], OP.private, true));
      } else {
        /* All other entries: re-encode with optimal int encoding.
           These don't reference offsets so their encoding length
           can vary safely. */
        out.push(...encEntry(e.operands, e.op, false));
      }
    }
    return new Uint8Array(out);
  }

  /* Build new SFNT bytes with the CFF table replaced. Handles
     directory updates (offsets shift for tables AFTER 'CFF '),
     padding to 4-byte boundaries, and head.checkSumAdjustment
     recomputation. */
  function rebuildSFNT(oldBytes, allEntries, cffEntry, newCFF, paddedDelta, headEntry, oldView) {
    /* Sort entries by file offset so we can walk them in layout order. */
    const byOffset = allEntries.slice().sort((a, b) => a.offset - b.offset);
    const newLen = oldBytes.length + paddedDelta;
    const out = new Uint8Array(newLen);

    /* Copy SFNT header + directory verbatim — we'll patch entries below. */
    const dirEnd = 12 + allEntries.length * 16;
    out.set(oldBytes.subarray(0, dirEnd), 0);

    /* Walk tables in layout order, copying bodies and recording
       new offsets. CFF is replaced by newCFF; other tables shift
       by paddedDelta if they followed CFF. */
    const newOffsets = new Map();
    let cursor = dirEnd;
    /* Tables can have inter-table padding to 4-byte alignment;
       we recompute it canonically. */
    for (const entry of byOffset) {
      cursor = (cursor + 3) & ~3;
      newOffsets.set(entry.tag, cursor);
      if (entry.tag === 'CFF ') {
        out.set(newCFF, cursor);
        cursor += newCFF.length;
      } else {
        out.set(oldBytes.subarray(entry.offset, entry.offset + entry.length), cursor);
        cursor += entry.length;
      }
    }

    /* Patch directory: update offset (and length for CFF). Per spec
       the per-table checksum should be recomputed when bytes change;
       we only changed CFF, so only its checksum needs updating. */
    const newView = new DataView(out.buffer);
    for (const entry of allEntries) {
      const newOff = newOffsets.get(entry.tag);
      newView.setUint32(entry.recOff + 8, newOff, false);
      if (entry.tag === 'CFF ') {
        newView.setUint32(entry.recOff + 12, newCFF.length, false);
        newView.setUint32(entry.recOff + 4, tableChecksum(newCFF), false);
      }
    }

    /* head.checkSumAdjustment recipe (same as font-engine-tables.js):
       zero the field, sum whole font in big-endian uint32, set
       adjustment = 0xB1B0AFBA - sum. */
    if (headEntry) {
      const newHeadOff = newOffsets.get('head');
      newView.setUint32(newHeadOff + 8, 0, false);
      let sum = 0;
      for (let i = 0; i + 3 < out.length; i += 4) {
        sum = (sum + newView.getUint32(i, false)) >>> 0;
      }
      const adj = (0xB1B0AFBA - sum) >>> 0;
      newView.setUint32(newHeadOff + 8, adj, false);
    }

    /* Truncate cursor padding: out was sized for paddedDelta which
       assumed canonical 4-byte alignment; if any source table was
       not 4-aligned we may have a trailing few empty bytes. Return
       the populated prefix. */
    if (cursor < newLen) return out.subarray(0, cursor);
    return out;
  }

  function tableChecksum(data) {
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

  global.injectCFFHints = injectCFFHints;

})(typeof self !== 'undefined' ? self : this);
