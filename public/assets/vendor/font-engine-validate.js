/* ============================================================
 * font-engine-validate.js  (post-generation byte-level validator)
 * ------------------------------------------------------------
 * Worker-only. Runs a battery of structural checks on a generated
 * font's byte stream BEFORE we hand it to the user. Catches the
 * failure modes our pipeline can introduce:
 *   - Per-table checksum drift after a surgery step forgot to update
 *   - head.checkSumAdjustment stale after table bodies changed
 *   - SFNT directory out of sort order (some tools reject this)
 *   - Required tables missing (esp. after CFF→TTF surgery)
 *   - Tables overlapping or pointing past EOF
 *   - maxp.numGlyphs disagreeing with the actual glyph corpus
 *   - opentype.js failing to re-parse the bytes (structural rot)
 *
 * This is NOT a full OpenType Sanitizer (OTS) port — Google's OTS
 * is ~30K lines of C++ catching 100s of edge cases that production
 * font validators care about. Our validator targets the small set
 * of failure modes our specific tracer pipeline can produce. If a
 * real OTS pass becomes important later, we'd bundle the OTS WASM
 * (~500KB) rather than expand this module.
 *
 * Public entry:
 *   validateFont(bytes, opts?) -> {
 *     ok:        boolean    // true if no errors (warnings are OK)
 *     errors:    [{ code, message, where? }, ...]
 *     warnings:  [{ code, message }, ...]
 *     stats:     { sfntVersion, numTables, numGlyphs, sizeBytes,
 *                  hasGlyf, hasCFF, ... }
 *   }
 *
 * Errors block "ok" but never throw — caller can still decide to
 * ship anyway with eyes open.
 * ============================================================ */
(function(global){
  'use strict';

  function tagToString(n) {
    return String.fromCharCode((n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff);
  }

  function checksum(bytes, offset, length) {
    let sum = 0;
    const padded = (length + 3) & ~3;
    const view = new DataView(bytes.buffer, bytes.byteOffset);
    /* Read 4-byte chunks; for the final chunk that may be padded
       past EOF, treat past-EOF bytes as zero. */
    for (let i = 0; i < padded; i += 4) {
      let v;
      if (i + 4 <= length) {
        v = view.getUint32(offset + i, false);
      } else {
        v = 0;
        for (let j = 0; j < 4; j++) {
          if (i + j < length) v = (v << 8) | bytes[offset + i + j];
          else v = (v << 8);
        }
      }
      sum = (sum + (v >>> 0)) >>> 0;
    }
    return sum;
  }

  /* Required-table sets per outline format. Some are universally
     required (head, hhea, hmtx, maxp, name, OS/2, post, cmap);
     CFF fonts add 'CFF '; TT fonts add 'glyf' + 'loca'. */
  const REQUIRED_COMMON = ['head', 'hhea', 'hmtx', 'maxp', 'name', 'OS/2', 'post', 'cmap'];
  const REQUIRED_CFF = ['CFF '];
  const REQUIRED_TT  = ['glyf', 'loca'];

  function validateFont(bytes, opts) {
    opts = opts || {};
    const errors = [];
    const warnings = [];
    const stats = {
      sizeBytes: bytes ? bytes.length : 0,
    };

    if (!bytes || bytes.length < 12) {
      errors.push({ code: 'sfnt_too_small', message: 'SFNT bytes < 12 (no header)' });
      return { ok: false, errors, warnings, stats };
    }

    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const sfntVersion = view.getUint32(0, false);
    const numTables = view.getUint16(4, false);
    stats.sfntVersion = '0x' + sfntVersion.toString(16);
    stats.numTables = numTables;

    /* Header: SFNT version must be one of the known magic values. */
    const knownVersions = new Set([
      0x00010000, /* TrueType */
      0x4F54544F, /* 'OTTO' = CFF */
      0x74727565, /* 'true' = Apple TT */
      0x74797031, /* 'typ1' = PostScript (rare) */
    ]);
    if (!knownVersions.has(sfntVersion >>> 0)) {
      errors.push({ code: 'unknown_sfnt_version', message: 'unrecognized SFNT version ' + stats.sfntVersion });
    }
    if (numTables < 1 || numTables > 100) {
      errors.push({ code: 'bad_table_count', message: 'numTables ' + numTables + ' out of sane range [1, 100]' });
    }

    /* Parse directory. */
    const dirSize = numTables * 16;
    if (bytes.length < 12 + dirSize) {
      errors.push({ code: 'truncated_directory', message: 'file ends before directory does' });
      return { ok: false, errors, warnings, stats };
    }

    const tables = [];
    for (let i = 0; i < numTables; i++) {
      const recOff = 12 + i * 16;
      const tagNum = view.getUint32(recOff, false);
      const tag = tagToString(tagNum);
      const declaredChecksum = view.getUint32(recOff + 4, false);
      const offset = view.getUint32(recOff + 8, false);
      const length = view.getUint32(recOff + 12, false);
      tables.push({ tag, tagNum, declaredChecksum, offset, length });
    }

    /* Directory MUST be sorted by tag (ascending uint32). Some
       validators are lenient; OTS rejects out-of-order. */
    for (let i = 1; i < tables.length; i++) {
      if (tables[i].tagNum < tables[i - 1].tagNum) {
        errors.push({
          code: 'directory_not_sorted',
          message: 'directory tag order violation at index ' + i + ' (' + tables[i - 1].tag + ' precedes ' + tables[i].tag + ')',
        });
        break; /* one report is enough */
      }
    }

    /* Bounds + overlap. */
    const byOffset = tables.slice().sort((a, b) => a.offset - b.offset);
    for (const t of byOffset) {
      if (t.offset < 12 + dirSize) {
        errors.push({ code: 'table_in_header', message: t.tag + ' at offset ' + t.offset + ' overlaps SFNT directory' });
      }
      if (t.offset + t.length > bytes.length) {
        errors.push({ code: 'table_past_eof', message: t.tag + ' ends at ' + (t.offset + t.length) + ' past file end ' + bytes.length });
      }
    }
    for (let i = 1; i < byOffset.length; i++) {
      const prev = byOffset[i - 1];
      const cur = byOffset[i];
      const prevEnd = prev.offset + prev.length;
      if (cur.offset < prevEnd) {
        errors.push({ code: 'tables_overlap', message: cur.tag + ' starts at ' + cur.offset + ', within previous ' + prev.tag + ' [' + prev.offset + ', ' + prevEnd + ')' });
      }
    }

    /* Required tables. */
    const tagSet = new Set(tables.map(t => t.tag));
    for (const req of REQUIRED_COMMON) {
      if (!tagSet.has(req)) errors.push({ code: 'missing_table', message: 'missing required table: ' + req });
    }
    const hasCFF = tagSet.has('CFF ');
    const hasGlyf = tagSet.has('glyf');
    const hasLoca = tagSet.has('loca');
    stats.hasCFF = hasCFF;
    stats.hasGlyf = hasGlyf;
    if (!hasCFF && !hasGlyf) {
      errors.push({ code: 'no_outlines', message: 'neither CFF nor glyf present' });
    }
    if (hasCFF && hasGlyf) {
      warnings.push({ code: 'both_outlines', message: 'both CFF and glyf present — unusual, may confuse some renderers' });
    }
    if (hasGlyf && !hasLoca) {
      errors.push({ code: 'glyf_without_loca', message: 'glyf table without loca' });
    }
    if (hasLoca && !hasGlyf) {
      errors.push({ code: 'loca_without_glyf', message: 'loca table without glyf' });
    }

    /* SFNT version vs outline format consistency. */
    if (hasCFF && sfntVersion !== 0x4F54544F) {
      warnings.push({ code: 'cff_wrong_sig', message: 'CFF outlines should have SFNT version OTTO; got ' + stats.sfntVersion });
    }
    if (hasGlyf && sfntVersion === 0x4F54544F) {
      errors.push({ code: 'glyf_with_otto', message: 'glyf outlines with OTTO SFNT version — should be 0x00010000' });
    }

    /* Per-table checksum check. The 'head' table is special: its
       checksum is computed WITH checkSumAdjustment set to 0, then
       restored. We replicate that. */
    const headEntry = tables.find(t => t.tag === 'head');
    for (const t of tables) {
      let actual;
      if (t.tag === 'head') {
        /* Save adjustment, zero it, compute, restore. We don't mutate
           bytes — work on a copy of just the head bytes. */
        const headCopy = new Uint8Array(t.length);
        headCopy.set(bytes.subarray(t.offset, t.offset + t.length));
        const dv = new DataView(headCopy.buffer);
        dv.setUint32(8, 0, false);
        actual = checksum(headCopy, 0, t.length);
      } else {
        actual = checksum(bytes, t.offset, t.length);
      }
      if (actual !== t.declaredChecksum) {
        errors.push({
          code: 'bad_table_checksum',
          message: t.tag + ' declared checksum 0x' + t.declaredChecksum.toString(16) + ' != actual 0x' + actual.toString(16),
        });
      }
    }

    /* head.checkSumAdjustment: zero head's field, sum whole font as
       uint32 BE, expected adjustment = 0xB1B0AFBA - sum. */
    if (headEntry && headEntry.length >= 12) {
      const adjActual = view.getUint32(headEntry.offset + 8, false);
      /* Zero the field in a temp copy of the bytes, compute whole-font
         sum. Cheaper: compute the full sum INCLUDING the current
         adjustment, then subtract that to model "sum with field = 0". */
      let fullSum = 0;
      const fontDv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      const len4 = bytes.length & ~3;
      for (let i = 0; i < len4; i += 4) {
        fullSum = (fullSum + fontDv.getUint32(i, false)) >>> 0;
      }
      /* If file length isn't 4-aligned, treat trailing bytes as zero-padded. */
      if (len4 < bytes.length) {
        let tail = 0;
        for (let j = 0; j < 4; j++) {
          tail = (tail << 8) | (len4 + j < bytes.length ? bytes[len4 + j] : 0);
        }
        fullSum = (fullSum + (tail >>> 0)) >>> 0;
      }
      /* Subtract the current adjustment value (it's part of the sum
         and we need to model what the sum would be with it=0). */
      const sumWithZero = (fullSum - adjActual) >>> 0;
      const expectedAdj = (0xB1B0AFBA - sumWithZero) >>> 0;
      if (adjActual !== expectedAdj) {
        errors.push({
          code: 'bad_head_checksum_adjustment',
          message: 'head.checkSumAdjustment 0x' + adjActual.toString(16) + ' != expected 0x' + expectedAdj.toString(16),
        });
      }
    }

    /* maxp.numGlyphs sanity. */
    const maxpEntry = tables.find(t => t.tag === 'maxp');
    if (maxpEntry && maxpEntry.length >= 6) {
      const numGlyphs = view.getUint16(maxpEntry.offset + 4, false);
      stats.numGlyphs = numGlyphs;
      if (numGlyphs < 1) {
        errors.push({ code: 'no_glyphs', message: 'maxp.numGlyphs = 0' });
      }
      /* Cross-check loca: loca should have numGlyphs+1 entries. */
      if (hasLoca) {
        const locaEntry = tables.find(t => t.tag === 'loca');
        if (headEntry && headEntry.length >= 52) {
          const indexToLocFormat = view.getInt16(headEntry.offset + 50, false);
          const stride = indexToLocFormat === 0 ? 2 : 4;
          const expectedLocaLen = (numGlyphs + 1) * stride;
          if (locaEntry.length !== expectedLocaLen) {
            errors.push({
              code: 'loca_size_mismatch',
              message: 'loca length ' + locaEntry.length + ' != expected ' + expectedLocaLen + ' (numGlyphs=' + numGlyphs + ', stride=' + stride + ')',
            });
          }
        }
      }
      /* Cross-check hmtx: hhea.numberOfHMetrics ≤ numGlyphs, hmtx
         length = numberOfHMetrics * 4 + (numGlyphs - numberOfHMetrics) * 2. */
      const hheaEntry = tables.find(t => t.tag === 'hhea');
      const hmtxEntry = tables.find(t => t.tag === 'hmtx');
      if (hheaEntry && hheaEntry.length >= 36 && hmtxEntry) {
        const nhm = view.getUint16(hheaEntry.offset + 34, false);
        if (nhm > numGlyphs) {
          errors.push({ code: 'hhea_too_many_metrics', message: 'hhea.numberOfHMetrics ' + nhm + ' > numGlyphs ' + numGlyphs });
        }
        const expectedHmtx = nhm * 4 + (numGlyphs - nhm) * 2;
        if (hmtxEntry.length < expectedHmtx) {
          errors.push({ code: 'hmtx_too_short', message: 'hmtx length ' + hmtxEntry.length + ' < expected ' + expectedHmtx });
        }
      }
    }

    /* loca monotonic + within glyf bounds. */
    if (hasLoca && hasGlyf && headEntry && headEntry.length >= 52) {
      const locaEntry = tables.find(t => t.tag === 'loca');
      const glyfEntry = tables.find(t => t.tag === 'glyf');
      const indexToLocFormat = view.getInt16(headEntry.offset + 50, false);
      const stride = indexToLocFormat === 0 ? 2 : 4;
      const count = (locaEntry.length / stride) | 0;
      let prev = -1;
      for (let i = 0; i < count; i++) {
        const raw = indexToLocFormat === 0
          ? view.getUint16(locaEntry.offset + i * 2, false) * 2
          : view.getUint32(locaEntry.offset + i * 4, false);
        if (raw < prev) {
          errors.push({ code: 'loca_not_monotonic', message: 'loca[' + i + ']=' + raw + ' < loca[' + (i - 1) + ']=' + prev });
          break;
        }
        if (raw > glyfEntry.length) {
          errors.push({ code: 'loca_past_glyf', message: 'loca[' + i + ']=' + raw + ' > glyf length ' + glyfEntry.length });
          break;
        }
        prev = raw;
      }
    }

    /* Optional opentype.js re-parse for deep structural validation.
       Skipped if opentype isn't loaded (main-thread context) or if
       opts.skipReparse is set. */
    if (!opts.skipReparse && typeof global.opentype !== 'undefined' && global.opentype.parse) {
      try {
        const ab = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
        const font = global.opentype.parse(ab);
        stats.numGlyphsReparsed = font.glyphs.length;
        stats.unitsPerEm = font.unitsPerEm;
        /* Sample first ~5 glyphs — make sure their paths decode. */
        const sampleCount = Math.min(5, font.glyphs.length);
        for (let i = 0; i < sampleCount; i++) {
          try {
            const g = font.glyphs.glyphs[i];
            if (g && g.getBoundingBox) g.getBoundingBox();
          } catch (gerr) {
            errors.push({ code: 'glyph_decode_failed', message: 'glyph ' + i + ': ' + (gerr.message || gerr) });
            break;
          }
        }
      } catch (perr) {
        errors.push({ code: 'reparse_failed', message: 'opentype.js parse: ' + (perr.message || perr) });
      }
    }

    return {
      ok: errors.length === 0,
      errors,
      warnings,
      stats,
    };
  }

  global.validateFont = validateFont;

})(typeof self !== 'undefined' ? self : this);
