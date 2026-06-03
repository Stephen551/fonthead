/* ============================================================
 * font-engine-name-extend.js  (name table extender for VF labels)
 * ------------------------------------------------------------
 * Worker-and-main-thread-safe. Takes an SFNT byte stream + a list
 * of { nameID, value } entries, parses the existing `name` table,
 * appends new NameRecords + UTF-16 BE strings, swaps the rebuilt
 * name table into the SFNT, recomputes per-table + head checksums.
 *
 * Used by the variable-font orchestrator (font-engine-variable.js)
 * to register axis labels and instance subfamily names so OS style
 * pickers display "Italic" instead of "Axis 256".
 *
 * `name` table layout (version 0, the common case):
 *   uint16   format                 (0 or 1)
 *   uint16   count                  (number of NameRecords)
 *   Offset16 stringOffset           (start of string storage area)
 *   NameRecord[count] (12 bytes each):
 *     uint16  platformID
 *     uint16  encodingID
 *     uint16  languageID
 *     uint16  nameID
 *     uint16  length                (in bytes)
 *     Offset16 stringOffset         (relative to stringOffset above)
 *   String storage area             (variable; UTF-16 BE for Windows
 *                                    platform, Mac Roman for Apple, etc.)
 *
 * Strategy:
 *   - Add records on BOTH platform 3 (Windows Unicode, language US English)
 *     AND platform 0 (Unicode, language 0) for maximum compatibility.
 *     Most modern OSs prefer platform 3; some legacy tools want platform 0.
 *   - Both use UTF-16 BE encoding so we can share the string blob.
 *   - Don't deduplicate against existing strings — adds parsing
 *     complexity for marginal byte savings on a ~30-byte name addition.
 *
 * Public entry:
 *   extendNameTable(sfntBytes, entries, opts?) -> {
 *     bytes: Uint8Array,
 *     status, reason?,
 *     stats: { addedRecords, addedStringsBytes, newNameTableSize }
 *   }
 *
 *   entries = [
 *     { nameID: 256, value: 'Italic' },
 *     { nameID: 257, value: 'Regular' },
 *     { nameID: 258, value: 'Italic' },
 *     ...
 *   ]
 *
 *   opts.platforms (default ['win', 'unicode']) — which platform-ID
 *     pairs to emit records for.
 *
 * Safety: returns ORIGINAL bytes with a status flag on any failure.
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
    return (tag.charCodeAt(0) << 24) | (tag.charCodeAt(1) << 16)
         | (tag.charCodeAt(2) << 8)  |  tag.charCodeAt(3);
  }

  /* Encode a JS string as UTF-16 BE bytes (each code unit = 2 bytes,
     high byte first). For chars outside BMP (surrogate pairs), this
     emits two code units = 4 bytes, which is correct UTF-16 BE. */
  function encodeUTF16BE(s) {
    const out = new Uint8Array(s.length * 2);
    for (let i = 0; i < s.length; i++) {
      const c = s.charCodeAt(i);
      out[i * 2] = (c >> 8) & 0xff;
      out[i * 2 + 1] = c & 0xff;
    }
    return out;
  }

  function extendNameTable(sfntBytes, entries, opts) {
    opts = opts || {};
    const platforms = opts.platforms || ['win', 'unicode'];
    if (!sfntBytes || sfntBytes.length < 12) {
      return { bytes: sfntBytes, status: 'failed', reason: 'sfnt too small' };
    }
    if (!entries || entries.length === 0) {
      return { bytes: sfntBytes, status: 'skipped', reason: 'no entries' };
    }

    /* Find name + head tables in directory. */
    const view = new DataView(sfntBytes.buffer, sfntBytes.byteOffset, sfntBytes.byteLength);
    const numTables = view.getUint16(4, false);
    let nameEntry = null, headEntry = null;
    const allEntries = [];
    for (let i = 0; i < numTables; i++) {
      const recOff = 12 + i * 16;
      const tag = String.fromCharCode(sfntBytes[recOff], sfntBytes[recOff + 1],
                                       sfntBytes[recOff + 2], sfntBytes[recOff + 3]);
      const offset = view.getUint32(recOff + 8, false);
      const length = view.getUint32(recOff + 12, false);
      const ent = { tag, offset, length };
      allEntries.push(ent);
      if (tag === 'name') nameEntry = ent;
      if (tag === 'head') headEntry = ent;
    }
    if (!nameEntry) {
      return { bytes: sfntBytes, status: 'failed', reason: 'no name table' };
    }

    /* Parse existing name table. */
    const nameAbs = nameEntry.offset;
    const nameFormat = view.getUint16(nameAbs, false);
    const oldCount = view.getUint16(nameAbs + 2, false);
    const oldStringOffset = view.getUint16(nameAbs + 4, false);
    if (nameFormat !== 0 && nameFormat !== 1) {
      return { bytes: sfntBytes, status: 'failed', reason: 'name format ' + nameFormat + ' not supported' };
    }

    const existingRecords = [];
    for (let i = 0; i < oldCount; i++) {
      const r = nameAbs + 6 + i * 12;
      existingRecords.push({
        platformID: view.getUint16(r, false),
        encodingID: view.getUint16(r + 2, false),
        languageID: view.getUint16(r + 4, false),
        nameID: view.getUint16(r + 6, false),
        length: view.getUint16(r + 8, false),
        stringOffset: view.getUint16(r + 10, false),
      });
    }
    /* Copy existing string storage as-is — we don't touch old strings. */
    const oldStringAreaStart = nameAbs + oldStringOffset;
    const oldStringAreaEnd = nameAbs + nameEntry.length;
    const oldStringArea = sfntBytes.subarray(oldStringAreaStart, oldStringAreaEnd);

    /* Build new records + new strings.
       For each entry: encode the value as UTF-16 BE once, then emit
       NameRecords on each requested platform pointing at the same
       bytes (shared offset). */
    const newStringBytes = [];
    const newRecords = [];
    for (const e of entries) {
      const enc = encodeUTF16BE(e.value);
      const offsetInNewStrings = newStringBytes.length;
      for (const b of enc) newStringBytes.push(b);
      const finalOffsetInCombined = oldStringArea.length + offsetInNewStrings;
      for (const plat of platforms) {
        if (plat === 'win') {
          newRecords.push({
            platformID: 3,    /* Windows */
            encodingID: 1,    /* Unicode BMP */
            languageID: 0x0409, /* US English */
            nameID: e.nameID,
            length: enc.length,
            stringOffset: finalOffsetInCombined,
          });
        } else if (plat === 'unicode') {
          newRecords.push({
            platformID: 0,    /* Unicode */
            encodingID: 3,    /* Unicode 2.0, BMP */
            languageID: 0,
            nameID: e.nameID,
            length: enc.length,
            stringOffset: finalOffsetInCombined,
          });
        }
      }
    }

    /* Combine records, then sort per spec:
       NameRecords MUST be sorted by (platformID, encodingID, languageID, nameID). */
    const combinedRecords = existingRecords.concat(newRecords);
    combinedRecords.sort((a, b) => {
      if (a.platformID !== b.platformID) return a.platformID - b.platformID;
      if (a.encodingID !== b.encodingID) return a.encodingID - b.encodingID;
      if (a.languageID !== b.languageID) return a.languageID - b.languageID;
      return a.nameID - b.nameID;
    });

    /* Compose new name table:
       header (6) + records (12 * count) + string storage. */
    const newCount = combinedRecords.length;
    const newStringTableStart = 6 + newCount * 12;
    const combinedStringSize = oldStringArea.length + newStringBytes.length;
    const newNameTableSize = newStringTableStart + combinedStringSize;
    const newName = new Uint8Array(newNameTableSize);
    const newDv = new DataView(newName.buffer);
    newDv.setUint16(0, 0, false);              /* format 0 */
    newDv.setUint16(2, newCount, false);
    newDv.setUint16(4, newStringTableStart, false);
    let recPos = 6;
    for (const r of combinedRecords) {
      newDv.setUint16(recPos, r.platformID, false); recPos += 2;
      newDv.setUint16(recPos, r.encodingID, false); recPos += 2;
      newDv.setUint16(recPos, r.languageID, false); recPos += 2;
      newDv.setUint16(recPos, r.nameID, false); recPos += 2;
      newDv.setUint16(recPos, r.length, false); recPos += 2;
      newDv.setUint16(recPos, r.stringOffset, false); recPos += 2;
    }
    /* Old string area copied verbatim at offset 0 of string storage. */
    newName.set(oldStringArea, newStringTableStart);
    /* New strings appended after old strings. */
    newName.set(new Uint8Array(newStringBytes), newStringTableStart + oldStringArea.length);

    /* SFNT surgery: swap the name table in place, shift subsequent
       tables if the new size differs from old. */
    const oldNameLen = nameEntry.length;
    const newNameLen = newName.length;
    const lenDelta = newNameLen - oldNameLen;

    if (lenDelta === 0) {
      /* Same size — just overwrite + recompute checksums. */
      const out = new Uint8Array(sfntBytes);
      const ov = new DataView(out.buffer);
      out.set(newName, nameEntry.offset);
      /* Update name's directory entry checksum. */
      for (let i = 0; i < numTables; i++) {
        const recOff = 12 + i * 16;
        const tag = String.fromCharCode(out[recOff], out[recOff + 1], out[recOff + 2], out[recOff + 3]);
        if (tag === 'name') {
          ov.setUint32(recOff + 4, checksum(newName), false);
          break;
        }
      }
      /* head.checkSumAdjustment recompute. */
      if (headEntry) {
        ov.setUint32(headEntry.offset + 8, 0, false);
        let sum = 0;
        const len4 = out.length & ~3;
        for (let i = 0; i < len4; i += 4) sum = (sum + ov.getUint32(i, false)) >>> 0;
        if (len4 < out.length) {
          let tail = 0;
          for (let j = 0; j < 4; j++) {
            tail = (tail << 8) | (len4 + j < out.length ? out[len4 + j] : 0);
          }
          sum = (sum + (tail >>> 0)) >>> 0;
        }
        ov.setUint32(headEntry.offset + 8, (0xB1B0AFBA - sum) >>> 0, false);
      }
      return { bytes: out, status: 'extended',
               stats: { addedRecords: newRecords.length,
                        addedStringsBytes: newStringBytes.length,
                        newNameTableSize: newNameLen } };
    }

    /* Different size — full directory rebuild, shifting tables after
       'name' in file order. */
    const byOffset = allEntries.slice().sort((a, b) => a.offset - b.offset);
    const newOffsets = new Map();
    const headerSize = 12;
    const dirSize = numTables * 16;
    let cursor = headerSize + dirSize;
    for (const t of byOffset) {
      cursor = (cursor + 3) & ~3;
      newOffsets.set(t.tag, cursor);
      cursor += (t.tag === 'name' ? newNameLen : t.length);
    }
    const totalLen = cursor;
    const out = new Uint8Array(totalLen);
    const ov = new DataView(out.buffer);

    /* SFNT header — copy version + reuse rest. */
    out.set(sfntBytes.subarray(0, 12), 0);
    ov.setUint16(4, numTables, false); /* unchanged */

    /* Directory entries, in tag-sorted order (per spec). */
    const sortedByTag = allEntries.slice().sort((a, b) => tagToInt(a.tag) - tagToInt(b.tag));
    for (let i = 0; i < sortedByTag.length; i++) {
      const e = sortedByTag[i];
      const dirOff = 12 + i * 16;
      const body = e.tag === 'name'
        ? newName
        : sfntBytes.subarray(e.offset, e.offset + e.length);
      const len = e.tag === 'name' ? newNameLen : e.length;
      ov.setUint32(dirOff, tagToInt(e.tag), false);
      /* For head, we'll compute checksum AFTER zeroing checkSumAdjustment
         below — for now write a placeholder. */
      const isHead = e.tag === 'head';
      ov.setUint32(dirOff + 4, isHead ? 0 : checksum(body), false);
      ov.setUint32(dirOff + 8, newOffsets.get(e.tag), false);
      ov.setUint32(dirOff + 12, len, false);
    }

    /* Bodies. */
    for (const e of allEntries) {
      const newOff = newOffsets.get(e.tag);
      if (e.tag === 'name') {
        out.set(newName, newOff);
      } else {
        out.set(sfntBytes.subarray(e.offset, e.offset + e.length), newOff);
      }
    }

    /* head: zero checkSumAdjustment + recompute its per-table checksum. */
    const newHeadOff = newOffsets.get('head');
    if (newHeadOff != null) {
      ov.setUint32(newHeadOff + 8, 0, false);
      /* Per-table checksum AFTER zeroing the adjustment. */
      const headLen = allEntries.find(e => e.tag === 'head').length;
      const headBody = out.subarray(newHeadOff, newHeadOff + headLen);
      /* Patch the directory entry's checksum field. */
      for (let i = 0; i < sortedByTag.length; i++) {
        if (sortedByTag[i].tag === 'head') {
          ov.setUint32(12 + i * 16 + 4, checksum(headBody), false);
          break;
        }
      }
      /* Whole-font sum with tail zero-pad. */
      let sum = 0;
      const len4 = out.length & ~3;
      for (let i = 0; i < len4; i += 4) sum = (sum + ov.getUint32(i, false)) >>> 0;
      if (len4 < out.length) {
        let tail = 0;
        for (let j = 0; j < 4; j++) {
          tail = (tail << 8) | (len4 + j < out.length ? out[len4 + j] : 0);
        }
        sum = (sum + (tail >>> 0)) >>> 0;
      }
      ov.setUint32(newHeadOff + 8, (0xB1B0AFBA - sum) >>> 0, false);
    }

    return {
      bytes: out,
      status: 'extended',
      stats: {
        addedRecords: newRecords.length,
        addedStringsBytes: newStringBytes.length,
        newNameTableSize: newNameLen,
        sfntDelta: out.length - sfntBytes.length,
      },
    };
  }

  global.extendNameTable = extendNameTable;

})(typeof self !== 'undefined' ? self : this);
