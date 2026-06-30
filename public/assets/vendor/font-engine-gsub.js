/* ============================================================
 * font-engine-gsub.js  (GSUB calt writer — natural variation)
 * ------------------------------------------------------------
 * Worker- and test-safe, no DOM. Hand-writes a minimal GSUB table
 * that cycles between variant glyphs of a letter as it repeats, so
 * a connected-cursive face built from a 3-sheet same-hand palette
 * reads hand-drawn instead of typeset (every 'a' identical).
 *
 * Modeled on font-engine-gpos.js: same IIFE wrapper + writeTag, the
 * bytes go into font._customTables.GSUB and ride injectCustomTables
 * (font-engine-tables.js). v1 is gated on ligatures-off, because
 * opentype.js owns GSUB whenever a 'liga' feature is added and
 * injectCustomTables skips any tag opentype.js already wrote.
 *
 * Public entries:
 *   collectVariantGroups(indexByName) -> Group[]
 *     indexByName: Map<glyphName, gid>. Variant glyphs are named
 *     base + '.cvNN' and appended unicode-less, so they live in the
 *     index by name only. Groups each base with its ordered variants;
 *     an orphan variant (base name absent) is dropped.
 *   buildGsubCalt(variantGroups, indexByName) -> Uint8Array | null  (Stage 3)
 * ============================================================ */
(function (global) {
  'use strict';

  // base + '.cvNN' — the OpenType character-variant naming the builder appends.
  var VARIANT_RE = /^(.+)\.cv(\d\d)$/;

  function collectVariantGroups(indexByName) {
    if (!indexByName) return [];

    var byBase = new Map(); // base name -> [{ nn, suffix, name, gid }]
    for (var entry of indexByName) {
      var name = entry[0];
      var gid = entry[1];
      var m = VARIANT_RE.exec(name);
      if (!m) continue;
      var base = m[1];
      var nn = m[2];
      if (!byBase.has(base)) byBase.set(base, []);
      byBase.get(base).push({ nn: nn, suffix: '.cv' + nn, name: name, gid: gid });
    }

    var groups = [];
    byBase.forEach(function (variants, base) {
      var baseGid = indexByName.get(base);
      if (typeof baseGid !== 'number') return; // orphan: no base to substitute from
      variants.sort(function (a, b) {
        return a.nn < b.nn ? -1 : a.nn > b.nn ? 1 : 0;
      });
      groups.push({
        base: base,
        baseGid: baseGid,
        variants: variants.map(function (v) {
          return { suffix: v.suffix, name: v.name, gid: v.gid };
        }),
      });
    });
    groups.sort(function (a, b) {
      return a.baseGid - b.baseGid;
    });
    return groups;
  }

  function writeTag(view, off, tag) {
    for (var i = 0; i < 4; i++) view.setUint8(off + i, tag.charCodeAt(i));
  }

  function concatBytes(arrays) {
    var len = 0;
    for (var i = 0; i < arrays.length; i++) len += arrays[i].length;
    var out = new Uint8Array(len);
    var o = 0;
    for (var j = 0; j < arrays.length; j++) {
      out.set(arrays[j], o);
      o += arrays[j].length;
    }
    return out;
  }

  // Coverage format 1: ascending glyph-id list. Caller guarantees ascending.
  function coverageBytes(gids) {
    var dv = new DataView(new ArrayBuffer(4 + 2 * gids.length));
    dv.setUint16(0, 1); // coverageFormat
    dv.setUint16(2, gids.length); // glyphCount
    for (var i = 0; i < gids.length; i++) dv.setUint16(4 + 2 * i, gids[i]);
    return new Uint8Array(dv.buffer);
  }

  // SingleSubst format 2: coverage (sorted source gids) co-indexed with an
  // explicit substitute array. Coverage lives after the fixed part.
  function singleSubst2Bytes(covGids, substGids) {
    var n = covGids.length;
    var fixed = 6 + 2 * n; // format + coverageOffset + glyphCount + substitutes
    var cov = coverageBytes(covGids);
    var out = new Uint8Array(fixed + cov.length);
    var dv = new DataView(out.buffer);
    dv.setUint16(0, 2); // substFormat 2
    dv.setUint16(2, fixed); // coverageOffset, from this subtable's start
    dv.setUint16(4, n); // glyphCount
    for (var i = 0; i < n; i++) dv.setUint16(6 + 2 * i, substGids[i]);
    out.set(cov, fixed);
    return out;
  }

  // ChainContextSubst format 3: `backtrackLen` slots (all the shared letterSet
  // coverage), one input coverage (the source glyphs), no lookahead, one nested
  // SequenceLookupRecord. Backtrack offsets are reverse logical order, but every
  // slot is the same set here so order is moot. The whole cycling scheme relies
  // on HarfBuzz/OTS in-pass backtrack visibility (a sub at position N is seen by
  // the backtrack of position N+1 in the SAME pass).
  function chainContext3Bytes(backtrackLen, sourceGids, letterSetGids, nestedLookupIndex) {
    var fixed = 2 /*format*/ + 2 /*btCount*/ + 2 * backtrackLen /*bt offsets*/ +
      2 /*inputCount*/ + 2 /*input offset*/ + 2 /*lookaheadCount*/ +
      2 /*seqLookupCount*/ + 4 /*one seq record*/;
    var letterCov = coverageBytes(letterSetGids);
    var inputCov = coverageBytes(sourceGids);
    var letterCovOff = fixed;
    var inputCovOff = fixed + letterCov.length;
    var out = new Uint8Array(inputCovOff + inputCov.length);
    var dv = new DataView(out.buffer);
    var o = 0;
    dv.setUint16(o, 3); o += 2; // format
    dv.setUint16(o, backtrackLen); o += 2; // backtrackGlyphCount
    for (var i = 0; i < backtrackLen; i++) { dv.setUint16(o, letterCovOff); o += 2; }
    dv.setUint16(o, 1); o += 2; // inputGlyphCount
    dv.setUint16(o, inputCovOff); o += 2; // inputCoverageOffset
    dv.setUint16(o, 0); o += 2; // lookaheadGlyphCount (no offsets follow)
    dv.setUint16(o, 1); o += 2; // seqLookupCount
    dv.setUint16(o, 0); o += 2; // sequenceIndex = first input glyph
    dv.setUint16(o, nestedLookupIndex); o += 2; // lookupListIndex
    out.set(letterCov, letterCovOff);
    out.set(inputCov, inputCovOff);
    return out;
  }

  // Lookup table wrapping a single subtable (flag 0, no markFilteringSet).
  function lookupBytes(lookupType, subtable) {
    var header = 8; // type + flag + subTableCount + one offset
    var out = new Uint8Array(header + subtable.length);
    var dv = new DataView(out.buffer);
    dv.setUint16(0, lookupType);
    dv.setUint16(2, 0); // lookupFlag
    dv.setUint16(4, 1); // subTableCount
    dv.setUint16(6, header); // subtableOffset, from this Lookup's start
    out.set(subtable, header);
    return out;
  }

  /**
   * Build a GSUB 'calt' table that cycles repeated letters through their
   * .cvNN variants. Each base glyph ladders base -> .cv01 -> .cv02 (-> ...);
   * a SingleSubst per level promotes the previous rung to the next, fired by a
   * chaining context keyed on how many letters precede (1 letter -> cv01, >=2 ->
   * cv02). For "aaaa" this yields a a.cv01 a.cv02 a.cv02. Returns null when no
   * group carries a usable variant (so the default build stays plain).
   *
   * `indexByName` is accepted for parity with the GPOS writer's call site and
   * future use (the groups already carry resolved gids); it is not read here.
   */
  function buildGsubCalt(variantGroups, indexByName) {
    if (!variantGroups || !variantGroups.length) return null;

    // Per group, a contiguous gid ladder [baseGid, cv01, cv02, ...], stopping at
    // the first missing rung (a 2-sheet palette ladders only base -> cv01).
    var ladders = [];
    var maxDepth = 0;
    for (var gi = 0; gi < variantGroups.length; gi++) {
      var grpv = variantGroups[gi];
      var bySuffix = new Map();
      for (var vi = 0; vi < grpv.variants.length; vi++) bySuffix.set(grpv.variants[vi].suffix, grpv.variants[vi].gid);
      var seq = [grpv.baseGid];
      var k = 1;
      for (;;) {
        var suf = '.cv' + String(k).padStart(2, '0');
        if (!bySuffix.has(suf)) break;
        seq.push(bySuffix.get(suf));
        k++;
      }
      if (seq.length >= 2) {
        ladders.push(seq);
        if (seq.length - 1 > maxDepth) maxDepth = seq.length - 1;
      }
    }
    if (!ladders.length) return null;
    var L = maxDepth; // number of variant levels = number of chains

    // letterSet: every gid that participates (bases + all variant rungs), the
    // shared backtrack coverage for every chain. MUST include cv02 — at the run
    // tail a chain backtracks over a neighbor just promoted to cv02.
    var letterSetSet = new Set();
    for (var li = 0; li < ladders.length; li++) for (var si = 0; si < ladders[li].length; si++) letterSetSet.add(ladders[li][si]);
    var letterSet = Array.from(letterSetSet).sort(function (a, b) { return a - b; });

    // Per level k: SingleSubst seq[k] -> seq[k+1] for every ladder deep enough,
    // plus a chain with k+1 backtrack slots firing on the seq[k] glyphs.
    var singleSubts = [];
    var chains = [];
    for (var lvl = 0; lvl < L; lvl++) {
      var pairs = [];
      for (var l2 = 0; l2 < ladders.length; l2++) {
        if (ladders[l2].length > lvl + 1) pairs.push([ladders[l2][lvl], ladders[l2][lvl + 1]]);
      }
      pairs.sort(function (a, b) { return a[0] - b[0]; });
      var covGids = pairs.map(function (p) { return p[0]; });
      var substGids = pairs.map(function (p) { return p[1]; });
      singleSubts.push(singleSubst2Bytes(covGids, substGids));
      chains.push(chainContext3Bytes(lvl + 1, covGids, letterSet, lvl));
    }

    // Lookups: [ss0..ss(L-1), chain0..chain(L-1)]; chain k nests single-sub k.
    var lookups = [];
    for (var a = 0; a < L; a++) lookups.push(lookupBytes(1, singleSubts[a]));
    for (var b = 0; b < L; b++) lookups.push(lookupBytes(6, chains[b]));

    // LookupList.
    var numLookups = lookups.length;
    var llHeader = 2 + 2 * numLookups;
    var cur = llHeader;
    var lookupOffsets = lookups.map(function (lk) { var o = cur; cur += lk.length; return o; });
    var lookupListDv = new DataView(new ArrayBuffer(cur));
    lookupListDv.setUint16(0, numLookups);
    for (var lo = 0; lo < numLookups; lo++) lookupListDv.setUint16(2 + 2 * lo, lookupOffsets[lo]);
    var lookupListBytes = new Uint8Array(lookupListDv.buffer);
    for (var lk2 = 0; lk2 < numLookups; lk2++) lookupListBytes.set(lookups[lk2], lookupOffsets[lk2]);

    // Feature 'calt' lists ONLY the chains (lookup indices L..2L-1). Listing the
    // single-subs would blanket-convert every glyph and destroy the count.
    var featureIndices = [];
    for (var fc = 0; fc < L; fc++) featureIndices.push(L + fc);
    var featureDv = new DataView(new ArrayBuffer(4 + 2 * featureIndices.length));
    featureDv.setUint16(0, 0); // featureParamsOffset null
    featureDv.setUint16(2, featureIndices.length);
    for (var fi = 0; fi < featureIndices.length; fi++) featureDv.setUint16(4 + 2 * fi, featureIndices[fi]);
    var featureBytes = new Uint8Array(featureDv.buffer);

    var flHeader = 2 + 6; // featureCount + one FeatureRecord
    var featureListBytes = new Uint8Array(flHeader + featureBytes.length);
    var flDv = new DataView(featureListBytes.buffer);
    flDv.setUint16(0, 1); // featureCount
    writeTag(flDv, 2, 'calt');
    flDv.setUint16(6, flHeader); // featureOffset, from FeatureList start
    featureListBytes.set(featureBytes, flHeader);

    // ScriptList: DFLT + latn share one Script table whose default LangSys points
    // at feature 0 (same shape as font-engine-gpos.js).
    var scriptListLen = 2 + 6 * 2;
    var scriptTableLen = 4;
    var langSysLen = 8;
    var scriptTableOff = scriptListLen;
    var langSysOff = scriptTableOff + scriptTableLen;
    var scriptListBytes = new Uint8Array(scriptListLen + scriptTableLen + langSysLen);
    var slDv = new DataView(scriptListBytes.buffer);
    slDv.setUint16(0, 2); // scriptCount
    writeTag(slDv, 2, 'DFLT');
    slDv.setUint16(6, scriptTableOff); // scriptOffset, from ScriptList start
    writeTag(slDv, 8, 'latn');
    slDv.setUint16(12, scriptTableOff); // shared Script table
    slDv.setUint16(scriptTableOff, langSysOff - scriptTableOff); // defaultLangSysOffset, from Script start
    slDv.setUint16(scriptTableOff + 2, 0); // langSysCount
    slDv.setUint16(langSysOff, 0); // lookupOrderOffset
    slDv.setUint16(langSysOff + 2, 0xffff); // requiredFeatureIndex
    slDv.setUint16(langSysOff + 4, 1); // featureIndexCount
    slDv.setUint16(langSysOff + 6, 0); // featureIndices[0] = feature 0

    // GSUB header + assembled sections.
    var headerLen = 10;
    var scriptListOff = headerLen;
    var featureListOff = scriptListOff + scriptListBytes.length;
    var lookupListOff = featureListOff + featureListBytes.length;
    var headerBytes = new Uint8Array(headerLen);
    var hDv = new DataView(headerBytes.buffer);
    hDv.setUint16(0, 1); // majorVersion
    hDv.setUint16(2, 0); // minorVersion
    hDv.setUint16(4, scriptListOff);
    hDv.setUint16(6, featureListOff);
    hDv.setUint16(8, lookupListOff);

    return concatBytes([headerBytes, scriptListBytes, featureListBytes, lookupListBytes]);
  }

  global.collectVariantGroups = collectVariantGroups;
  global.buildGsubCalt = buildGsubCalt;
})(typeof self !== 'undefined' ? self : this);
