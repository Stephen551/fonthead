/* ============================================================
 * font-engine-features.js  (Phase 2 — OpenType feature compiler)
 * ------------------------------------------------------------
 * Worker-only. Adds ligature substitutions (GSUB Lookup Type 4 via
 * opentype.js Substitution API). Pair-positioning kerning CAN be
 * written as a legacy `kern` table (raw binary blob stashed on
 * font._customTables for injection by font-engine-tables) — but that
 * table is Safari-only on the modern web (Chrome/Firefox kern from
 * GPOS and ignore it), so shipping it alone overlaps letters in
 * Safari while Chrome looks fine. It is therefore OFF by default and
 * only written when a caller passes featureOpts.legacyKernTable===true.
 * Cross-browser kerning needs a GPOS PairPos writer (the planned-but-
 * unbuilt phase noted in font-engine-tables.js). See the LANDMINE note
 * in compileFeatures below.
 *
 * Public entry: compileFeatures(font, featureOpts, upm, scale, computedKernPairs)
 *   - font: opentype.Font produced by buildFontForStyle
 *   - featureOpts: { kerning, ligatures, kerningStrength, legacyKernTable }
 *   - upm: unitsPerEm (for scaling per-mille values to font units)
 *   - scale: source-pixel → font-unit scale (currently unused here
 *     but reserved for future feature-compiler work)
 *   - computedKernPairs: array of { leftChar, rightChar, value } in
 *     font units, or null to fall back to STANDARD_KERN_PAIRS
 * ============================================================ */
(function(global){
  'use strict';

  const STANDARD_LIGATURES = [
    /* [...components, resultName, optionalUnicode] */
    ['f', 'f', 'i', 'f_f_i', 0xFB03],
    ['f', 'f', 'l', 'f_f_l', 0xFB04],
    ['f', 'f',      'f_f',   0xFB00],
    ['f', 'i',      'f_i',   0xFB01],
    ['f', 'l',      'f_l',   0xFB02],
    ['f', 't',      'f_t',   null],
    ['s', 't',      's_t',   null],
  ];

  /* Per-mille em values (assume 1000-unit em); scaled to actual upm
     before writing. Signs are "advance offset of FIRST glyph";
     negative pulls letters closer. */
  const STANDARD_KERN_PAIRS = [
    ['A', 'V', -60], ['A', 'W', -55], ['A', 'T', -65], ['A', 'Y', -65],
    ['L', 'V', -55], ['L', 'W', -50], ['L', 'T', -50], ['L', 'Y', -60],
    ['L', "'", -120], ['L', '"', -120],
    ['P', 'A', -60], ['F', 'A', -65], ['T', 'A', -65], ['V', 'A', -60],
    ['W', 'A', -55], ['Y', 'A', -65],
    ['R', 'V', -25], ['R', 'W', -25], ['R', 'Y', -30], ['R', 'T', -30],
    ['T', 'a', -55], ['T', 'e', -55], ['T', 'o', -55], ['T', 'u', -45],
    ['T', 'r', -45], ['T', 'i', -30], ['T', 'y', -45], ['T', 's', -45],
    ['V', 'a', -45], ['V', 'e', -45], ['V', 'o', -45], ['V', 'i', -15],
    ['W', 'a', -35], ['W', 'e', -35], ['W', 'o', -35],
    ['Y', 'a', -55], ['Y', 'e', -55], ['Y', 'o', -55], ['Y', 'u', -40],
    ['F', 'a', -25], ['F', 'e', -25], ['F', 'o', -25], ['F', 'i', -10],
    ['P', 'a', -10], ['P', 'e', -10], ['P', 'o', -10],
    ['r', 'a',  -5], ['r', 'e',  -5], ['r', 'o',  -5],
    ['v', 'a', -15], ['v', 'e', -15], ['v', 'o', -15],
    ['w', 'a', -15], ['w', 'e', -15], ['w', 'o', -15],
    ['y', 'a', -10], ['y', 'e', -10], ['y', 'o', -10],
    ['.', '"', -40], [',', '"', -40], ['.', "'", -40], [',', "'", -40],
  ];

  function compileFeatures(font, featureOpts, upm, sourceScale, computedKernPairs) {
    /* Build the char→glyph-index map ONCE here and pass it down.
       Replaces the previous O(n*pairs) lookups with a single hash. */
    const indexByChar = buildIndexByChar(font);
    const indexByName = buildIndexByName(font);

    if (featureOpts.ligatures) {
      addLigatureSubstitutions(font, indexByChar, indexByName);
    }
    if (featureOpts.kerning) {
      /* Honest semantics: if auto-kern was requested AND it produced
         results, use those; if auto-kern produced ZERO pairs (silhouette
         analysis decided no kerning needed), respect that decision
         rather than falling back to the typographic standard pairs
         which were tuned for OTHER fonts. */
      const useStandard = !computedKernPairs;
      const pairs = useStandard ? STANDARD_KERN_PAIRS : computedKernPairs;
      /* CROSS-BROWSER LANDMINE (fixed 2026-06-02). The only kerning this
         engine can emit is a legacy TrueType `kern` table. On the modern
         web that table is honored by Safari/CoreText but IGNORED by
         Chrome and Firefox (they kern from GPOS only). Shipping it alone
         makes a font render correctly in Chrome yet crunch/overlap badly
         in Safari/iOS — exactly the bug that shipped on acmeridian.co's
         four brand fonts (every pair pulled up to -0.25em, applied only
         by Safari). So the legacy table is now opt-in: it writes ONLY
         when the caller explicitly sets featureOpts.legacyKernTable.
         Default exports stay un-kerned, which renders IDENTICALLY in
         every browser. Real cross-browser kerning is the unbuilt GPOS
         PairPos phase (see font-engine-tables.js). */
      if (featureOpts.legacyKernTable === true) {
        addKernTable(font, upm, pairs, useStandard, indexByChar);
      } else if (typeof console !== 'undefined' && console.warn) {
        console.warn('[font-engine] kerning requested but NOT written: a legacy `kern` table only applies in Safari (Chrome/Firefox ignore it), which overlaps letters cross-browser. Cross-browser kerning needs a GPOS writer (not yet implemented). Exporting un-kerned so all browsers match. Pass legacyKernTable:true to force the Safari-only table.');
      }
    }
  }

  function buildIndexByChar(font) {
    const map = new Map();
    const n = font.glyphs.length;
    for (let i = 0; i < n; i++) {
      const g = font.glyphs.get(i);
      if (g && typeof g.unicode === 'number') map.set(g.unicode, i);
    }
    return map;
  }
  function buildIndexByName(font) {
    const map = new Map();
    const n = font.glyphs.length;
    for (let i = 0; i < n; i++) {
      const g = font.glyphs.get(i);
      if (g && g.name) map.set(g.name, i);
    }
    return map;
  }
  function findGlyphIndex(char, name, indexByChar, indexByName) {
    if (char && char.length === 1) {
      const cp = char.codePointAt(0);
      const idx = indexByChar.get(cp);
      if (typeof idx === 'number') return idx;
    }
    if (name) {
      const idx = indexByName.get(name);
      if (typeof idx === 'number') return idx;
    }
    return -1;
  }

  function addLigatureSubstitutions(font, indexByChar, indexByName) {
    if (!font.substitution || typeof font.substitution.add !== 'function') return 0;
    let added = 0;
    for (const rule of STANDARD_LIGATURES) {
      const components = rule.slice(0, -2);
      const resultName = rule[rule.length - 2];
      const resultUnicode = rule[rule.length - 1];

      const compIndices = components.map(ch => findGlyphIndex(ch, null, indexByChar, indexByName));
      if (compIndices.some(i => i < 0)) continue;

      const resultGlyphChar = resultUnicode ? String.fromCodePoint(resultUnicode) : null;
      const resultIndex = findGlyphIndex(resultGlyphChar, resultName, indexByChar, indexByName);
      if (resultIndex < 0) continue;

      try {
        font.substitution.add('liga', { sub: compIndices, by: resultIndex });
        added++;
      } catch (e) {
        /* opentype.js Substitution.add can throw under specific
           internal states; swallow per-rule so partial success still
           emits useful liga rules. */
      }
    }
    return added;
  }

  /* Legacy `kern` table writer (format 0).
     Spec: https://learn.microsoft.com/en-us/typography/opentype/spec/kern */
  function addKernTable(font, upm, sourcePairs, valuesArePerMille, indexByChar) {
    const pairs = [];
    const perMilleScale = upm / 1000;
    for (const entry of sourcePairs) {
      let leftChar, rightChar, value;
      if (Array.isArray(entry)) {
        [leftChar, rightChar, value] = entry;
      } else {
        leftChar = entry.leftChar; rightChar = entry.rightChar; value = entry.value;
      }
      const leftGid = findGlyphIndex(leftChar, null, indexByChar, /*indexByName*/new Map());
      const rightGid = findGlyphIndex(rightChar, null, indexByChar, new Map());
      if (leftGid < 0 || rightGid < 0) continue;
      const v = valuesArePerMille ? Math.round(value * perMilleScale) : Math.round(value);
      if (v === 0) continue;
      pairs.push({ leftGid, rightGid, value: v });
    }
    if (pairs.length === 0) return 0;
    pairs.sort((a, b) => (a.leftGid - b.leftGid) || (a.rightGid - b.rightGid));

    const nPairs = pairs.length;
    /* Layout (offsets within the kern table buffer):
         0   uint16 version           = 0
         2   uint16 nTables           = 1
         4   uint16 subtableVersion   = 0
         6   uint16 subtableLength    (includes the 6-byte subtable hdr)
         8   uint16 coverage          = 0x0001 (format 0, horizontal)
        10   uint16 nPairs
        12   uint16 searchRange       (largest pow2 <= nPairs) * 6
        14   uint16 entrySelector     log2 of that pow2
        16   uint16 rangeShift        (nPairs - that pow2) * 6
        18+  pairs (6 bytes each, sorted ascending by composite key) */
    const subtableLength = 14 + nPairs * 6;
    const totalLength = 4 + subtableLength;
    const buf = new Uint8Array(totalLength);
    const dv = new DataView(buf.buffer);

    dv.setUint16(0, 0, false);
    dv.setUint16(2, 1, false);
    dv.setUint16(4, 0, false);
    dv.setUint16(6, subtableLength, false);
    dv.setUint16(8, 0x0001, false);

    let largestPow2 = 1;
    while (largestPow2 * 2 <= nPairs) largestPow2 *= 2;
    dv.setUint16(10, nPairs, false);
    dv.setUint16(12, largestPow2 * 6, false);
    dv.setUint16(14, Math.log2(largestPow2), false);
    dv.setUint16(16, (nPairs - largestPow2) * 6, false);

    let off = 18;
    for (const p of pairs) {
      dv.setUint16(off, p.leftGid, false);
      dv.setUint16(off + 2, p.rightGid, false);
      dv.setInt16(off + 4, p.value, false);
      off += 6;
    }

    font._customTables = font._customTables || {};
    font._customTables.kern = buf;
    return pairs.length;
  }

  global.compileFeatures = compileFeatures;
  global.STANDARD_LIGATURES = STANDARD_LIGATURES;
  global.STANDARD_KERN_PAIRS = STANDARD_KERN_PAIRS;
})(typeof self !== 'undefined' ? self : this);
