/* ============================================================
 * font-engine-gpos.js  (GPOS PairPos writer — cross-browser kerning)
 * ------------------------------------------------------------
 * Worker- and test-safe, no DOM. Builds a minimal GPOS table from
 * auto-kern analyzer pairs: one 'kern' feature under DFLT + latn,
 * one lookup (type 2, PairPos format 1), XAdvance-only values.
 * This is the kerning path every modern text stack honors (Chrome,
 * Firefox, and Safari all position from GPOS), unlike the legacy
 * `kern` table that font-engine-features.js refuses to write by
 * default (Safari-only rendering; see the 2026-06-02 note there).
 *
 * The bytes go into font._customTables.GPOS and ride the existing
 * injectCustomTables surgery (font-engine-tables.js), whose header
 * has named GPOS as a future phase since it was written.
 *
 * Public entry:
 *   buildGposKern(pairs, indexByChar) -> Uint8Array | null
 *     pairs:       [{ leftChar, rightChar, value }] value in font
 *                  units, negative pulls the pair together
 *     indexByChar: Map<codepoint, glyphIndex> (the same map
 *                  compileFeatures already builds)
 *   Returns null when no resolvable nonzero pair survives.
 * ============================================================ */
(function (global) {
  'use strict';

  const MAX_SUBTABLE_BYTES = 60000;

  function writeTag(view, off, tag) {
    for (let i = 0; i < 4; i++) view.setUint8(off + i, tag.charCodeAt(i));
  }

  function checkU16(val, label) {
    if (!(val >= 0 && val <= 0xffff)) {
      throw new Error('GPOS uint16 offset overflow (' + label + '=' + val + ')');
    }
    return val;
  }

  function encodePairPosSubtable(subFirsts, subPairSets) {
    const n = subFirsts.length;
    const headerLen = 10 + 2 * n; /* fixed header + pairSetOffsets */
    const covOffset = headerLen;
    const covLen = 4 + 2 * n; /* coverage format 1 */
    let cursor = covOffset + covLen;
    const pairSetOffsets = subPairSets.map((recs, i) => {
      const o = checkU16(cursor, 'pairSetOffset[' + i + ']');
      cursor += 2 + 4 * recs.length; /* count + (glyph u16 + xAdvance s16) each */
      return o;
    });
    const subLen = cursor;
    const sub = new DataView(new ArrayBuffer(subLen));
    sub.setUint16(0, 1); /* posFormat 1 */
    sub.setUint16(2, checkU16(covOffset, 'covOffset'));
    sub.setUint16(4, 0x0004); /* valueFormat1: XAdvance only */
    sub.setUint16(6, 0x0000); /* valueFormat2: none */
    sub.setUint16(8, checkU16(n, 'pairSetCount'));
    subFirsts.forEach((_, i) => sub.setUint16(10 + 2 * i, pairSetOffsets[i]));
    sub.setUint16(covOffset, 1); /* coverage format 1 */
    sub.setUint16(covOffset + 2, n);
    subFirsts.forEach((g, i) => sub.setUint16(covOffset + 4 + 2 * i, checkU16(g, 'coverageGid')));
    subPairSets.forEach((recs, i) => {
      let o = pairSetOffsets[i];
      sub.setUint16(o, checkU16(recs.length, 'pairValueCount'));
      o += 2;
      for (const rec of recs) {
        sub.setUint16(o, checkU16(rec[0], 'secondGlyph'));
        sub.setInt16(o + 2, rec[1]);
        o += 4;
      }
    });
    return new Uint8Array(sub.buffer);
  }

  /* GID-pair core: write a GPOS kern table directly from resolved glyph-id pairs
     [{l, r, value}]. Shared by the char-based buildGposKern and the variant-kern
     path — variant glyphs have no cmap entry, so they can only be addressed by
     gid. */
  function buildGposKernFromGidPairs(gidPairs) {
    if (!gidPairs || !gidPairs.length) return null;

    /* Clamp values, last-wins on duplicate gid pairs. */
    const byFirst = new Map();
    for (const p of gidPairs) {
      if (!p || typeof p.l !== 'number' || typeof p.r !== 'number') continue;
      const v = Math.max(-32768, Math.min(32767, Math.round(p.value)));
      if (!v) continue;
      if (!byFirst.has(p.l)) byFirst.set(p.l, new Map());
      byFirst.get(p.l).set(p.r, v);
    }
    if (byFirst.size === 0) return null;

    /* Coverage glyphs ascending; PairSets in the same order; records
       within a PairSet ascending by second glyph (all spec-required). */
    const firsts = Array.from(byFirst.keys()).sort((a, b) => a - b);
    const pairSets = firsts.map((f) =>
      Array.from(byFirst.get(f).entries()).sort((a, b) => a[0] - b[0]),
    );

    /* ---- Split into PairPos format 1 subtables <= MAX_SUBTABLE_BYTES ----
       A first glyph's PairSet is never split across two subtables. */
    const chunks = [];
    let curFirsts = [];
    let curPairSets = [];
    let curBytes = 14; /* 10 PairPos header + 4 Coverage format 1 header */
    for (let i = 0; i < firsts.length; i++) {
      const f = firsts[i];
      const recs = pairSets[i];
      const addBytes = 6 + 4 * recs.length; /* 2 pairSetOffset + 2 covGid + 2 count + 4*recs */
      if (curFirsts.length > 0 && curBytes + addBytes > MAX_SUBTABLE_BYTES) {
        chunks.push([curFirsts, curPairSets]);
        curFirsts = [];
        curPairSets = [];
        curBytes = 14;
      }
      curFirsts.push(f);
      curPairSets.push(recs);
      curBytes += addBytes;
    }
    if (curFirsts.length > 0) chunks.push([curFirsts, curPairSets]);

    const subTables = chunks.map(([cf, cp]) => encodePairPosSubtable(cf, cp));
    const subCount = checkU16(subTables.length, 'subTableCount');

    /* ---- GPOS envelope ----
       header(10) ScriptList ScriptTable LangSys FeatureList Feature
       LookupList Lookup subtables. All Offset16s are relative to the
       start of their parent table, per spec. */
    const gposHeaderLen = 10;
    const scriptListLen = 2 + 6 * 2; /* DFLT + latn, sorted by tag */
    const scriptTableLen = 4;
    const langSysLen = 8;
    const featureListLen = 2 + 6;
    const featureLen = 6;
    const lookupListLen = 2 + 2;
    const lookupLen = 6 + 2 * subCount;

    const scriptListOff = gposHeaderLen;
    const scriptTableOff = scriptListOff + scriptListLen;
    const langSysOff = scriptTableOff + scriptTableLen;
    const featureListOff = langSysOff + langSysLen;
    const featureOff = featureListOff + featureListLen;
    const lookupListOff = featureOff + featureLen;
    const lookupOff = lookupListOff + lookupListLen;
    let subCursor = lookupOff + lookupLen;
    const subAbsOffsets = [];
    const subRelOffsets = [];
    for (let s = 0; s < subCount; s++) {
      subRelOffsets.push(checkU16(subCursor - lookupOff, 'subtableOffset[' + s + ']'));
      subAbsOffsets.push(subCursor);
      subCursor += subTables[s].byteLength;
    }
    const total = subCursor;

    const buf = new DataView(new ArrayBuffer(total));
    buf.setUint16(0, 1); /* majorVersion */
    buf.setUint16(2, 0); /* minorVersion */
    buf.setUint16(4, checkU16(scriptListOff, 'scriptListOffset'));
    buf.setUint16(6, checkU16(featureListOff, 'featureListOffset'));
    buf.setUint16(8, checkU16(lookupListOff, 'lookupListOffset'));

    /* ScriptList: both scripts share one Script table. */
    buf.setUint16(scriptListOff, 2);
    writeTag(buf, scriptListOff + 2, 'DFLT');
    buf.setUint16(scriptListOff + 6, checkU16(scriptTableOff - scriptListOff, 'scriptOffset'));
    writeTag(buf, scriptListOff + 8, 'latn');
    buf.setUint16(scriptListOff + 12, checkU16(scriptTableOff - scriptListOff, 'scriptOffset'));

    /* Script table -> default LangSys, no language-specific ones. */
    buf.setUint16(scriptTableOff, checkU16(langSysOff - scriptTableOff, 'defaultLangSysOffset'));
    buf.setUint16(scriptTableOff + 2, 0);

    /* LangSys: no reorder table, no required feature, feature 0. */
    buf.setUint16(langSysOff, 0);
    buf.setUint16(langSysOff + 2, 0xffff);
    buf.setUint16(langSysOff + 4, 1);
    buf.setUint16(langSysOff + 6, 0);

    /* FeatureList: one 'kern' feature. */
    buf.setUint16(featureListOff, 1);
    writeTag(buf, featureListOff + 2, 'kern');
    buf.setUint16(featureListOff + 6, checkU16(featureOff - featureListOff, 'featureOffset'));

    /* Feature: lookup 0. */
    buf.setUint16(featureOff, 0);
    buf.setUint16(featureOff + 2, 1);
    buf.setUint16(featureOff + 4, 0);

    /* LookupList + Lookup: one type-2 (PairPos) lookup. */
    buf.setUint16(lookupListOff, 1);
    buf.setUint16(lookupListOff + 2, checkU16(lookupOff - lookupListOff, 'lookupOffset'));
    buf.setUint16(lookupOff, 2);
    buf.setUint16(lookupOff + 2, 0);
    buf.setUint16(lookupOff + 4, subCount);
    for (let s = 0; s < subCount; s++) {
      buf.setUint16(lookupOff + 6 + 2 * s, subRelOffsets[s]);
    }

    const out = new Uint8Array(buf.buffer);
    for (let s = 0; s < subCount; s++) {
      out.set(subTables[s], subAbsOffsets[s]);
    }
    return out;
  }

  /* Char-based entry: resolve each pair's chars to glyph ids via the cmap index,
     then delegate to the gid core. */
  function buildGposKern(pairs, indexByChar) {
    if (!pairs || !pairs.length || !indexByChar) return null;
    const gidPairs = [];
    for (const p of pairs) {
      if (!p || !p.leftChar || !p.rightChar) continue;
      const l = indexByChar.get(p.leftChar.codePointAt(0));
      const r = indexByChar.get(p.rightChar.codePointAt(0));
      if (typeof l !== 'number' || typeof r !== 'number') continue;
      gidPairs.push({ l: l, r: r, value: p.value });
    }
    return buildGposKernFromGidPairs(gidPairs);
  }

  global.buildGposKern = buildGposKern;
  global.buildGposKernFromGidPairs = buildGposKernFromGidPairs;
})(typeof self !== 'undefined' ? self : this);
