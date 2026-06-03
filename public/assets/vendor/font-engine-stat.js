/* ============================================================
 * font-engine-stat.js  (STAT — Style Attributes Table writer)
 * ------------------------------------------------------------
 * Worker-and-main-thread-safe. Builds the STAT table that tells
 * the OS picker which axis values map to which named style.
 * Required for variable fonts per OpenType spec; without it
 * macOS / Windows may refuse to surface instances in the style
 * picker even when fvar declares them.
 *
 * STAT layout (version 1.2 minimum; we emit 1.2 for forward compat):
 *   uint16   majorVersion = 1
 *   uint16   minorVersion = 2
 *   uint16   designAxisSize    = 8 (size of one AxisRecord)
 *   uint16   designAxisCount
 *   Offset32 designAxesOffset
 *   uint16   axisValueCount
 *   Offset32 offsetToAxisValueOffsets
 *   uint16   elidedFallbackNameID   (name ID for "Regular" fallback)
 *
 *   AxisRecord[designAxisCount] (8 bytes each):
 *     Tag      axisTag         (e.g. 'ital')
 *     uint16   axisNameID
 *     uint16   axisOrdering    (sort order; 0 = first)
 *
 *   Offset16[axisValueCount] (relative to start of AxisValueArray)
 *   AxisValueTable[axisValueCount]:
 *     We use FORMAT 1 (simplest single-axis value):
 *       uint16   format = 1
 *       uint16   axisIndex
 *       uint16   flags
 *       uint16   valueNameID
 *       Fixed    value           (16.16 signed)
 *
 * Our writer emits one AxisRecord per axis + one Format-1 AxisValueTable
 * per instance. Multi-axis combinations (Format 4 — "this combo of axis
 * values = this style name") are skipped: 1-axis variable fonts work
 * fine without them.
 *
 * Public entry:
 *   buildStat({ axes, axisValues, elidedFallbackNameID }) -> { bytes }
 *
 *     axes = [
 *       { tag: 'ital', nameID: 256, ordering: 0 },
 *       ...
 *     ]
 *     axisValues = [
 *       { axisIndex: 0, value: 0, nameID: 257 },     // Regular
 *       { axisIndex: 0, value: 1, nameID: 258 },     // Italic
 *     ]
 *     elidedFallbackNameID: 257 normally (the "Regular" name ID)
 * ============================================================ */
(function(global){
  'use strict';

  function tagToInt(tag) {
    return (tag.charCodeAt(0) << 24) | (tag.charCodeAt(1) << 16)
         | (tag.charCodeAt(2) << 8)  |  tag.charCodeAt(3);
  }
  function toFixed(n) {
    const v = Math.round(n * 65536);
    return v < 0 ? v + 0x100000000 : v;
  }

  function buildStat(spec) {
    if (!spec || !spec.axes || spec.axes.length === 0) {
      throw new Error('STAT requires at least 1 axis');
    }
    if (!spec.axisValues) spec.axisValues = [];

    const designAxisSize = 8;
    const designAxisCount = spec.axes.length;
    const axisValueCount = spec.axisValues.length;
    const elidedFallbackNameID = spec.elidedFallbackNameID != null
      ? spec.elidedFallbackNameID : 2; /* fallback to 2 = "Regular" per spec */

    const headerSize = 20;
    const axisArraySize = designAxisCount * designAxisSize;
    const offsetTableSize = axisValueCount * 2;
    /* Format-1 axis value table size = 12 bytes (uint16 + uint16 + uint16 + uint16 + Fixed). */
    const valueTableSize = 12;
    const axisValueArraySize = offsetTableSize + axisValueCount * valueTableSize;

    const totalSize = headerSize + axisArraySize + axisValueArraySize;
    const out = new Uint8Array(totalSize);
    const dv = new DataView(out.buffer);

    let p = 0;
    dv.setUint16(p, 1, false); p += 2;                       /* majorVersion */
    dv.setUint16(p, 2, false); p += 2;                       /* minorVersion */
    dv.setUint16(p, designAxisSize, false); p += 2;
    dv.setUint16(p, designAxisCount, false); p += 2;
    const designAxesOffset = headerSize;
    dv.setUint32(p, designAxesOffset, false); p += 4;
    dv.setUint16(p, axisValueCount, false); p += 2;
    const axisValueArrayOffset = headerSize + axisArraySize;
    dv.setUint32(p, axisValueCount > 0 ? axisValueArrayOffset : 0, false); p += 4;
    dv.setUint16(p, elidedFallbackNameID, false); p += 2;

    /* Axis records. */
    for (const a of spec.axes) {
      dv.setUint32(p, tagToInt(a.tag), false); p += 4;
      dv.setUint16(p, a.nameID, false); p += 2;
      dv.setUint16(p, a.ordering || 0, false); p += 2;
    }

    /* Offset16 array — offsets are RELATIVE to start of axisValueArray
       (NOT the table start). Each Format-1 entry is 12 bytes; first
       entry starts immediately after the offset table. */
    let valEntryOffset = offsetTableSize;
    for (let i = 0; i < axisValueCount; i++) {
      dv.setUint16(p, valEntryOffset, false); p += 2;
      valEntryOffset += valueTableSize;
    }

    /* Axis value tables (Format 1). */
    for (const v of spec.axisValues) {
      dv.setUint16(p, 1, false); p += 2;                  /* format 1 */
      dv.setUint16(p, v.axisIndex || 0, false); p += 2;
      dv.setUint16(p, v.flags || 0, false); p += 2;
      dv.setUint16(p, v.nameID, false); p += 2;
      dv.setUint32(p, toFixed(v.value), false); p += 4;
    }

    return { bytes: out, axisCount: designAxisCount, valueCount: axisValueCount };
  }

  global.buildStat = buildStat;

})(typeof self !== 'undefined' ? self : this);
