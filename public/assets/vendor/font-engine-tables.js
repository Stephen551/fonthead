/* ============================================================
 * font-engine-tables.js  (custom-table injection + checksums)
 * ------------------------------------------------------------
 * Worker-only. opentype.js's toArrayBuffer doesn't accept
 * arbitrary tables, so we patch the SFNT byte stream after the
 * fact: rewrite the table directory to include the custom tables
 * (currently just `kern`; future phases will use this for GPOS,
 * gasp, fpgm, prep, cvt) and recompute `head.checkSumAdjustment`
 * so OTS/Word/Font Book don't flag the font as corrupt.
 *
 * Public entry:
 *   injectCustomTables(sfntBytes, customTablesObj) -> Uint8Array
 * ============================================================ */
(function(global){
  'use strict';

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

  function injectCustomTables(sfntBytes, customTables) {
    if (!customTables || Object.keys(customTables).length === 0) return sfntBytes;

    const view = new DataView(sfntBytes.buffer, sfntBytes.byteOffset, sfntBytes.byteLength);
    const sfntVersion = view.getUint32(0, false);
    const origNumTables = view.getUint16(4, false);

    const existing = [];
    for (let i = 0; i < origNumTables; i++) {
      const recOff = 12 + i * 16;
      existing.push({
        tag: view.getUint32(recOff, false),
        checksum: view.getUint32(recOff + 4, false),
        offset: view.getUint32(recOff + 8, false),
        length: view.getUint32(recOff + 12, false),
      });
    }

    /* Build new directory entries (skip tags that already exist —
       custom tables don't overwrite anything opentype.js wrote). */
    const newEntries = [];
    for (const [tagStr, data] of Object.entries(customTables)) {
      if (tagStr.length !== 4) continue;
      const tag = (tagStr.charCodeAt(0) << 24) | (tagStr.charCodeAt(1) << 16) |
                  (tagStr.charCodeAt(2) << 8)  |  tagStr.charCodeAt(3);
      if (existing.some(e => e.tag === tag)) continue;
      newEntries.push({ tag, data, checksum: tableChecksum(data) });
    }
    if (newEntries.length === 0) return sfntBytes;

    const totalTables = existing.length + newEntries.length;
    const headerSize = 12;
    const dirSize = totalTables * 16;
    const padded = (n) => (n + 3) & ~3;

    /* Lay out table BODIES in the order they should appear in the
       file. Existing tables keep their relative order; new ones
       append. The DIRECTORY ENTRIES are sorted by tag below, but the
       offsets we assign here point at body positions and are
       preserved through the sort. */
    let bodyCursor = headerSize + dirSize;
    const newDir = [];
    for (const e of existing) {
      newDir.push({
        tag: e.tag, checksum: e.checksum,
        offset: bodyCursor, length: e.length,
        src: 'existing', srcRef: e,
      });
      bodyCursor += padded(e.length);
    }
    for (const n of newEntries) {
      newDir.push({
        tag: n.tag, checksum: n.checksum,
        offset: bodyCursor, length: n.data.length,
        src: 'new', srcRef: n,
      });
      bodyCursor += padded(n.data.length);
    }
    /* Directory order: sorted by tag per spec. (Body positions stay
       in original layout order, indexed via the offset field.) */
    newDir.sort((a, b) => a.tag - b.tag);

    const out = new Uint8Array(bodyCursor);
    const dvOut = new DataView(out.buffer);

    /* SFNT header */
    dvOut.setUint32(0, sfntVersion, false);
    dvOut.setUint16(4, totalTables, false);
    let largestPow2 = 1;
    while (largestPow2 * 2 <= totalTables) largestPow2 *= 2;
    dvOut.setUint16(6, largestPow2 * 16, false);
    dvOut.setUint16(8, Math.log2(largestPow2), false);
    dvOut.setUint16(10, (totalTables - largestPow2) * 16, false);

    /* Directory */
    let dirOff = headerSize;
    for (const e of newDir) {
      dvOut.setUint32(dirOff,      e.tag, false);
      dvOut.setUint32(dirOff + 4,  e.checksum, false);
      dvOut.setUint32(dirOff + 8,  e.offset, false);
      dvOut.setUint32(dirOff + 12, e.length, false);
      dirOff += 16;
    }

    /* Bodies */
    for (const e of newDir) {
      if (e.src === 'existing') {
        const src = sfntBytes.subarray(e.srcRef.offset, e.srcRef.offset + e.srcRef.length);
        out.set(src, e.offset);
      } else {
        out.set(e.srcRef.data, e.offset);
      }
    }

    /* head.checkSumAdjustment recipe (per OpenType spec):
         1. Zero the field
         2. Compute whole-font checksum
         3. checkSumAdjustment = 0xB1B0AFBA - that checksum
       The directory entry's per-table checksum for `head` was
       originally computed with checkSumAdjustment=0, so that value
       remains valid after this dance. */
    const headEntry = newDir.find(e => e.tag === 0x68656164); /* 'head' */
    if (headEntry) {
      dvOut.setUint32(headEntry.offset + 8, 0, false);
      let sum = 0;
      /* out.length is guaranteed 4-aligned because every padded() is
         a multiple of 4 and headerSize + dirSize are too. */
      for (let i = 0; i + 3 < out.length; i += 4) {
        sum = (sum + dvOut.getUint32(i, false)) >>> 0;
      }
      const adjustment = (0xB1B0AFBA - sum) >>> 0;
      dvOut.setUint32(headEntry.offset + 8, adjustment, false);
    }

    return out;
  }

  /* Patch italic metadata fields that opentype.js's table writers
     hardcode to zero. The library defines its post and head tables
     with `{name:"italicAngle", value:0}` and `{name:"macStyle",
     value:0}` and never reads italic-related properties off the
     Font object — so any font.italicAngle / font.tables.post
     modifications get overwritten at serialize time. The only fix
     is binary surgery on the output bytes.

     Patches done here:
       - post.italicAngle (offset 4 in post table, Fixed 16.16
         signed) ← italicAngleDeg * 65536. Forward italic is
         NEGATIVE per OpenType convention.
       - head.macStyle (offset 44 in head table, USHORT) ← bit 1
         set to 1 (italic).

     Recomputes per-table checksums for post and head, then
     re-runs the head.checkSumAdjustment dance over the full font
     buffer (because we changed bytes that contribute to the
     whole-font sum). Tag literals: 0x70657374 = 'post',
     0x68656164 = 'head'. */
  function patchItalicMetadata(sfntBytes, italicAngleDeg) {
    const view = new DataView(sfntBytes.buffer, sfntBytes.byteOffset, sfntBytes.byteLength);
    const numTables = view.getUint16(4, false);
    let postEntry = null, headEntry = null;
    for (let i = 0; i < numTables; i++) {
      const recOff = 12 + i * 16;
      const tag = view.getUint32(recOff, false);
      const offset = view.getUint32(recOff + 8, false);
      const length = view.getUint32(recOff + 12, false);
      if (tag === 0x706F7374) postEntry = { dirOff: recOff, offset, length };
      else if (tag === 0x68656164) headEntry = { dirOff: recOff, offset, length };
    }
    if (postEntry) {
      const italicAngleFixed = Math.round(italicAngleDeg * 65536);
      view.setInt32(postEntry.offset + 4, italicAngleFixed, false);
      const postData = sfntBytes.subarray(postEntry.offset, postEntry.offset + postEntry.length);
      view.setUint32(postEntry.dirOff + 4, tableChecksum(postData), false);
    }
    if (headEntry) {
      /* head's per-table checksum is computed with checkSumAdjustment=0
         per spec. Zero it before computing this table's checksum, then
         the whole-font sum below picks up the same zero. */
      view.setUint32(headEntry.offset + 8, 0, false);
      const currentMacStyle = view.getUint16(headEntry.offset + 44, false);
      view.setUint16(headEntry.offset + 44, currentMacStyle | 2, false);
      const headData = sfntBytes.subarray(headEntry.offset, headEntry.offset + headEntry.length);
      view.setUint32(headEntry.dirOff + 4, tableChecksum(headData), false);
      /* Whole-font checksum recompute. The font has been modified
         (post and head bytes both changed); the prior adjustment is
         no longer valid. */
      let sum = 0;
      for (let i = 0; i + 3 < sfntBytes.length; i += 4) {
        sum = (sum + view.getUint32(i, false)) >>> 0;
      }
      const adjustment = (0xB1B0AFBA - sum) >>> 0;
      view.setUint32(headEntry.offset + 8, adjustment, false);
    }
    return sfntBytes;
  }

  global.injectCustomTables = injectCustomTables;
  global.tableChecksum = tableChecksum;
  global.patchItalicMetadata = patchItalicMetadata;
})(typeof self !== 'undefined' ? self : this);
