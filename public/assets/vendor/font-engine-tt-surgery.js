/* ============================================================
 * font-engine-tt-surgery.js  (Phase 5a — SFNT injection for cvt/fpgm/prep)
 * ------------------------------------------------------------
 * Worker-only. Inserts cvt/fpgm/prep tables into a TTF byte stream
 * and updates the maxp limits so rasterizers don't reject the font
 * for insufficient stack / function-def headroom.
 *
 * What this DOES (Phase 5a):
 *   - Inserts cvt, fpgm, prep into the SFNT directory + body
 *   - Updates maxp.maxStackElements, maxFunctionDefs, maxSizeOfInstructions
 *   - Recomputes head.checkSumAdjustment over the new font buffer
 *   - Reuses the existing checksumming + directory-rebuild scaffolding
 *     from font-engine-tables.js when present (we just call it).
 *
 * What this DOES NOT do (Phase 5b/5c):
 *   - Inject per-glyph instructions into glyf — that requires
 *     parsing each glyph's outline, choosing snap points, encoding
 *     bytecode per-glyph, and reflowing all loca offsets. Bigger
 *     surgery, separate file.
 *
 * Until Phase 5b adds per-glyph instructions, this surgery makes
 * the font FORMALLY hinted (rasterizers will execute prep at
 * size changes) but contributes ZERO visible improvement: prep
 * sets state, fpgm defines unused functions, no glyph touches a
 * single point. We ship it anyway because:
 *   (a) it validates the surgery infrastructure works on real fonts
 *   (b) Phase 5b can then plug in per-glyph bytecode with confidence
 *       the tables are correctly written
 *   (c) the bytes added are tiny (~50 bytes of cvt + ~20 of fpgm
 *       + ~10 of prep), so cost is negligible
 *
 * Public entry:
 *   injectTTHints(sfntBytes, telemetry, opts?) -> {
 *     bytes: Uint8Array,
 *     status: 'embedded' | 'skipped' | 'failed',
 *     reason?: string,
 *     tablesAdded?: string[],
 *     cvtBytes?, fpgmBytes?, prepBytes?
 *   }
 *
 * Safety: returns the ORIGINAL bytes with a status flag on any
 * unexpected condition. Never produces a half-modified font.
 * ============================================================ */
(function(global){
  'use strict';

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
    return (tag.charCodeAt(0) << 24) | (tag.charCodeAt(1) << 16) | (tag.charCodeAt(2) << 8) | tag.charCodeAt(3);
  }

  function intToTag(n) {
    return String.fromCharCode((n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff);
  }

  function injectTTHints(sfntBytes, telemetry, opts) {
    opts = opts || {};
    if (!sfntBytes || sfntBytes.length < 12) {
      return { bytes: sfntBytes, status: 'failed', reason: 'sfnt too small' };
    }
    if (typeof global.buildHintingTables !== 'function') {
      return { bytes: sfntBytes, status: 'failed', reason: 'tt-tables module not loaded' };
    }
    if (!telemetry || !telemetry.blueZones) {
      return { bytes: sfntBytes, status: 'skipped', reason: 'no telemetry' };
    }

    /* Identify outline format. CFF fonts (OTF) use Phase 4 hinting,
       not Phase 5 — refuse politely. */
    const sfntVersion = (sfntBytes[0] << 24) | (sfntBytes[1] << 16) | (sfntBytes[2] << 8) | sfntBytes[3];
    /* 0x00010000 = TrueType; 0x4F54544F (OTTO) = CFF/OTF; true = OS/2 Apple TT */
    if (sfntVersion === 0x4F54544F /* 'OTTO' */) {
      return { bytes: sfntBytes, status: 'skipped', reason: 'CFF font (use Phase 4 CFF hints instead)' };
    }
    const isTrueType = (sfntVersion === 0x00010000) || (sfntVersion === 0x74727565 /* 'true' */);
    if (!isTrueType) {
      return { bytes: sfntBytes, status: 'skipped', reason: 'unknown SFNT version 0x' + sfntVersion.toString(16) };
    }

    const tables = global.buildHintingTables(telemetry);
    if (!tables) {
      return { bytes: sfntBytes, status: 'skipped', reason: 'tables builder declined' };
    }

    /* Parse SFNT directory. */
    const view = new DataView(sfntBytes.buffer, sfntBytes.byteOffset, sfntBytes.byteLength);
    const numTables = view.getUint16(4, false);
    const existing = [];
    let maxpEntry = null, headEntry = null;
    const existingTags = new Set();
    for (let i = 0; i < numTables; i++) {
      const recOff = 12 + i * 16;
      const tagNum = view.getUint32(recOff, false);
      const tag = intToTag(tagNum);
      const offset = view.getUint32(recOff + 8, false);
      const length = view.getUint32(recOff + 12, false);
      existing.push({ tag, tagNum, offset, length });
      existingTags.add(tag);
      if (tag === 'maxp') maxpEntry = existing[existing.length - 1];
      if (tag === 'head') headEntry = existing[existing.length - 1];
    }
    if (!maxpEntry) {
      return { bytes: sfntBytes, status: 'failed', reason: 'no maxp table' };
    }
    if (!headEntry) {
      return { bytes: sfntBytes, status: 'failed', reason: 'no head table' };
    }

    /* If any hinting table already exists, abort — opentype.js doesn't
       emit any of these, so their presence means another writer ran. */
    for (const t of ['cvt ', 'fpgm', 'prep']) {
      if (existingTags.has(t)) {
        return { bytes: sfntBytes, status: 'skipped', reason: t + ' table already present' };
      }
    }

    /* Build replacement maxp.
       maxp v1.0 (TrueType) layout:
         0:  version (Fixed)
         4:  numGlyphs (uint16)
         6:  maxPoints
         8:  maxContours
         10: maxCompositePoints
         12: maxCompositeContours
         14: maxZones
         16: maxTwilightPoints
         18: maxStorage
         20: maxFunctionDefs
         22: maxInstructionDefs
         24: maxStackElements
         26: maxSizeOfInstructions
         28: maxComponentElements
         30: maxComponentDepth
       Total 32 bytes. We patch fields 18, 20, 22, 24, 26. */
    const oldMaxp = sfntBytes.subarray(maxpEntry.offset, maxpEntry.offset + maxpEntry.length);
    if (oldMaxp.length < 32) {
      return { bytes: sfntBytes, status: 'failed', reason: 'maxp is v0.5 (not extensible for TT hints)' };
    }
    const newMaxp = new Uint8Array(oldMaxp);
    const mv = new DataView(newMaxp.buffer);
    /* maxStorage: number of cells in the Storage Area used by our
       bytecode. We use ZERO storage in Phase 5a (just stack-based
       ops). Leave at max(existing, 0). */
    /* maxFunctionDefs: must be ≥ the number of FDEFs we use. We
       define 4 functions in fpgm. */
    const haveFnDefs = mv.getUint16(20, false);
    if (haveFnDefs < tables.stats.fpgmFunctions) {
      mv.setUint16(20, tables.stats.fpgmFunctions, false);
    }
    /* maxStackElements: must be ≥ deepest stack we push. Our
       per-glyph code in 5b will push at most 2 values per CALL,
       plus the function number = 3. Reserve 32 for headroom. */
    const haveStack = mv.getUint16(24, false);
    const needStack = 32;
    if (haveStack < needStack) {
      mv.setUint16(24, needStack, false);
    }
    /* maxSizeOfInstructions: longest glyph instruction stream in
       bytes. Phase 5a glyphs have ZERO instructions; we'll bump
       this in Phase 5b when actually emitting per-glyph code. For
       now reserve 256 as headroom. */
    const haveInsn = mv.getUint16(26, false);
    if (haveInsn < 256) {
      mv.setUint16(26, 256, false);
    }
    /* maxTwilightPoints: bytecode can reference points in "zone 0"
       (twilight zone). We don't use it. Leave existing. */

    /* Build the new SFNT.
       Strategy: keep the existing maxp body sequence the same length
       (we only patch fields, no length change), then insert three
       NEW tables (cvt, fpgm, prep) by adding directory entries and
       appending their bodies at the end of the file. This keeps
       existing offsets stable EXCEPT for tables AFTER the inserted
       directory rows (the directory grows by 3*16 bytes). */

    const oldDirSize = 12 + numTables * 16;
    const newNumTables = numTables + 3;
    const newDirSize = 12 + newNumTables * 16;
    const dirDelta = newDirSize - oldDirSize; /* = 48 bytes */

    /* New layout: header + new directory + (all old table bodies,
       shifted by dirDelta, with maxp replaced by newMaxp) + cvt body
       + fpgm body + prep body. All bodies padded to 4-byte alignment. */

    /* Sort existing entries by file offset so we walk them in layout
       order. */
    const byOffset = existing.slice().sort((a, b) => a.offset - b.offset);
    const newOffsets = new Map();
    let cursor = newDirSize;
    for (const e of byOffset) {
      cursor = (cursor + 3) & ~3;
      newOffsets.set(e.tag, cursor);
      const len = (e.tag === 'maxp') ? newMaxp.length : e.length;
      cursor += len;
    }
    /* Append cvt, fpgm, prep at the end, in alphabetical order
       (matches SFNT directory sort convention). */
    const newTables = [
      { tag: 'cvt ', bytes: tables.cvt },
      { tag: 'fpgm', bytes: tables.fpgm },
      { tag: 'prep', bytes: tables.prep },
    ];
    for (const nt of newTables) {
      cursor = (cursor + 3) & ~3;
      newOffsets.set(nt.tag, cursor);
      cursor += nt.bytes.length;
    }
    const totalLen = cursor;
    const out = new Uint8Array(totalLen);
    const ov = new DataView(out.buffer);

    /* SFNT header */
    ov.setUint32(0, sfntVersion, false);
    ov.setUint16(4, newNumTables, false);
    let largestPow2 = 1;
    while (largestPow2 * 2 <= newNumTables) largestPow2 *= 2;
    ov.setUint16(6, largestPow2 * 16, false);
    ov.setUint16(8, Math.log2(largestPow2), false);
    ov.setUint16(10, (newNumTables - largestPow2) * 16, false);

    /* Directory entries sorted by tag (spec requirement). Build full
       list of {tag, checksum, offset, length}. Original entries
       contribute their existing checksum (except maxp which we patch)
       at their NEW offsets. New tables contribute fresh checksums. */
    const dirEntries = [];
    const view2 = new DataView(sfntBytes.buffer, sfntBytes.byteOffset, sfntBytes.byteLength);
    for (const e of existing) {
      const newOff = newOffsets.get(e.tag);
      const len = (e.tag === 'maxp') ? newMaxp.length : e.length;
      const ck = (e.tag === 'maxp') ? checksum(newMaxp)
                                    : view2.getUint32(12 + existing.indexOf(e) * 16 + 4, false);
      dirEntries.push({ tag: e.tag, tagNum: e.tagNum, checksum: ck, offset: newOff, length: len });
    }
    for (const nt of newTables) {
      const newOff = newOffsets.get(nt.tag);
      dirEntries.push({ tag: nt.tag, tagNum: tagToInt(nt.tag), checksum: checksum(nt.bytes), offset: newOff, length: nt.bytes.length });
    }
    dirEntries.sort((a, b) => a.tagNum - b.tagNum);

    let dirOff = 12;
    for (const e of dirEntries) {
      ov.setUint32(dirOff, e.tagNum, false);
      ov.setUint32(dirOff + 4, e.checksum, false);
      ov.setUint32(dirOff + 8, e.offset, false);
      ov.setUint32(dirOff + 12, e.length, false);
      dirOff += 16;
    }

    /* Copy table bodies into their new positions. */
    for (const e of existing) {
      const newOff = newOffsets.get(e.tag);
      if (e.tag === 'maxp') {
        out.set(newMaxp, newOff);
      } else {
        out.set(sfntBytes.subarray(e.offset, e.offset + e.length), newOff);
      }
    }
    for (const nt of newTables) {
      out.set(nt.bytes, newOffsets.get(nt.tag));
    }

    /* Recompute head.checkSumAdjustment over the entire new file:
       zero the field, sum-of-uint32-BE for whole buffer, set
       adjustment = 0xB1B0AFBA - sum. Per OpenType spec: if the
       file length isn't a multiple of 4, the trailing bytes are
       summed AS IF zero-padded to align — so we tack on a tail
       chunk after the main loop. Previously this code dropped the
       tail entirely, which diverged from validators that follow
       the spec (caught by validateFont on a hinted TTF whose
       length was 23947 = 4n+3). */
    const newHeadOff = newOffsets.get('head');
    ov.setUint32(newHeadOff + 8, 0, false);
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
    ov.setUint32(newHeadOff + 8, adj, false);

    return {
      bytes: out,
      status: 'embedded',
      tablesAdded: ['cvt ', 'fpgm', 'prep'],
      cvtBytes: tables.cvt.length,
      fpgmBytes: tables.fpgm.length,
      prepBytes: tables.prep.length,
      maxpDelta: 0, /* length unchanged, only fields patched */
      sfntDelta: out.length - sfntBytes.length,
      cvtMap: tables.cvtMap,
      fpgmMap: tables.fpgmMap,
    };
  }

  global.injectTTHints = injectTTHints;

})(typeof self !== 'undefined' ? self : this);
