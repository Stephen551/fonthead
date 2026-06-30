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

  global.collectVariantGroups = collectVariantGroups;
})(typeof self !== 'undefined' ? self : this);
