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

  function writeTag(view, off, tag) {
    for (let i = 0; i < 4; i++) view.setUint8(off + i, tag.charCodeAt(i));
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

    /* ---- PairPos format 1 subtable ---- */
    const n = firsts.length;
    const headerLen = 10 + 2 * n; /* fixed header + pairSetOffsets */
    const covOffset = headerLen;
    const covLen = 4 + 2 * n; /* coverage format 1 */
    let cursor = covOffset + covLen;
    const pairSetOffsets = pairSets.map((recs) => {
      const o = cursor;
      cursor += 2 + 4 * recs.length; /* count + (glyph u16 + xAdvance s16) each */
      return o;
    });
    const subLen = cursor;
    const sub = new DataView(new ArrayBuffer(subLen));
    sub.setUint16(0, 1); /* posFormat 1 */
    sub.setUint16(2, covOffset);
    sub.setUint16(4, 0x0004); /* valueFormat1: XAdvance only */
    sub.setUint16(6, 0x0000); /* valueFormat2: none */
    sub.setUint16(8, n);
    firsts.forEach((_, i) => sub.setUint16(10 + 2 * i, pairSetOffsets[i]));
    sub.setUint16(covOffset, 1); /* coverage format 1 */
    sub.setUint16(covOffset + 2, n);
    firsts.forEach((g, i) => sub.setUint16(covOffset + 4 + 2 * i, g));
    pairSets.forEach((recs, i) => {
      let o = pairSetOffsets[i];
      sub.setUint16(o, recs.length);
      o += 2;
      for (const rec of recs) {
        sub.setUint16(o, rec[0]);
        sub.setInt16(o + 2, rec[1]);
        o += 4;
      }
    });

    /* ---- GPOS envelope ----
       header(10) ScriptList ScriptTable LangSys FeatureList Feature
       LookupList Lookup subtable. All Offset16s are relative to the
       start of their parent table, per spec. */
    const gposHeaderLen = 10;
    const scriptListLen = 2 + 6 * 2; /* DFLT + latn, sorted by tag */
    const scriptTableLen = 4;
    const langSysLen = 8;
    const featureListLen = 2 + 6;
    const featureLen = 6;
    const lookupListLen = 2 + 2;
    const lookupLen = 8;

    const scriptListOff = gposHeaderLen;
    const scriptTableOff = scriptListOff + scriptListLen;
    const langSysOff = scriptTableOff + scriptTableLen;
    const featureListOff = langSysOff + langSysLen;
    const featureOff = featureListOff + featureListLen;
    const lookupListOff = featureOff + featureLen;
    const lookupOff = lookupListOff + lookupListLen;
    const subOff = lookupOff + lookupLen;
    const total = subOff + subLen;

    const buf = new DataView(new ArrayBuffer(total));
    buf.setUint16(0, 1); /* majorVersion */
    buf.setUint16(2, 0); /* minorVersion */
    buf.setUint16(4, scriptListOff);
    buf.setUint16(6, featureListOff);
    buf.setUint16(8, lookupListOff);

    /* ScriptList: both scripts share one Script table. */
    buf.setUint16(scriptListOff, 2);
    writeTag(buf, scriptListOff + 2, 'DFLT');
    buf.setUint16(scriptListOff + 6, scriptTableOff - scriptListOff);
    writeTag(buf, scriptListOff + 8, 'latn');
    buf.setUint16(scriptListOff + 12, scriptTableOff - scriptListOff);

    /* Script table -> default LangSys, no language-specific ones. */
    buf.setUint16(scriptTableOff, langSysOff - scriptTableOff);
    buf.setUint16(scriptTableOff + 2, 0);

    /* LangSys: no reorder table, no required feature, feature 0. */
    buf.setUint16(langSysOff, 0);
    buf.setUint16(langSysOff + 2, 0xffff);
    buf.setUint16(langSysOff + 4, 1);
    buf.setUint16(langSysOff + 6, 0);

    /* FeatureList: one 'kern' feature. */
    buf.setUint16(featureListOff, 1);
    writeTag(buf, featureListOff + 2, 'kern');
    buf.setUint16(featureListOff + 6, featureOff - featureListOff);

    /* Feature: lookup 0. */
    buf.setUint16(featureOff, 0);
    buf.setUint16(featureOff + 2, 1);
    buf.setUint16(featureOff + 4, 0);

    /* LookupList + Lookup: one type-2 (PairPos) lookup. */
    buf.setUint16(lookupListOff, 1);
    buf.setUint16(lookupListOff + 2, lookupOff - lookupListOff);
    buf.setUint16(lookupOff, 2);
    buf.setUint16(lookupOff + 2, 0);
    buf.setUint16(lookupOff + 4, 1);
    buf.setUint16(lookupOff + 6, subOff - lookupOff);

    const out = new Uint8Array(buf.buffer);
    out.set(new Uint8Array(sub.buffer), subOff);
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
