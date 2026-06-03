/* ============================================================
 * font-engine-fvar.js  (Phase 7 — font variations axes writer)
 * ------------------------------------------------------------
 * Worker-only. Builds the `fvar` table, which declares the design
 * axes a variable font ranges over (e.g. weight 100→900, slant
 * 0→14, italic 0→1) plus optional "named instances" the OS can
 * surface as discrete style picks ("Regular", "Bold", "Italic").
 *
 * fvar layout (per OpenType spec, simplified for our 1-axis case):
 *   uint16   majorVersion = 1
 *   uint16   minorVersion = 0
 *   Offset16 axesArrayOffset  (= 16, the header size)
 *   uint16   reserved = 2
 *   uint16   axisCount
 *   uint16   axisSize    = 20 (size of each VariationAxisRecord)
 *   uint16   instanceCount
 *   uint16   instanceSize  = 4 + 4*axisCount (no PSname) or +2 more
 *
 *   VariationAxisRecord[axisCount]:
 *     Tag      axisTag         (4 ASCII bytes, e.g. 'wght', 'ital')
 *     Fixed    minValue        (16.16 signed)
 *     Fixed    defaultValue
 *     Fixed    maxValue
 *     uint16   flags           (0 normally; bit 0 = HIDDEN)
 *     uint16   axisNameID      (name table ID for axis label)
 *
 *   InstanceRecord[instanceCount]:
 *     uint16   subfamilyNameID (name table ID for instance label)
 *     uint16   flags
 *     Fixed    coordinates[axisCount]
 *     uint16   postScriptNameID  (only if instanceSize accommodates)
 *
 * Numeric encoding: Fixed = signed 32-bit, 16.16 fixed point.
 * So defaultValue 400.0 → 400 << 16 = 0x01900000.
 *
 * Public entry:
 *   buildFvar(axes, instances, opts?) -> { bytes, axisCount, instanceCount }
 *
 *     axes = [
 *       { tag: 'wght', min: 100, default: 400, max: 900, nameID: 256 },
 *       { tag: 'ital', min: 0,   default: 0,   max: 1,   nameID: 257 },
 *       ...
 *     ]
 *     instances = [
 *       { nameID: 258, coords: { wght: 400, ital: 0 } },     // Regular
 *       { nameID: 259, coords: { wght: 700, ital: 0 } },     // Bold
 *       { nameID: 260, coords: { wght: 400, ital: 1 } },     // Italic
 *     ]
 *     opts.includePostScriptNames: if true, each instance gets a
 *       postScriptNameID slot (default false to keep size minimal).
 *
 *   nameID is a 16-bit ID that must be matched by an entry in the
 *   `name` table. The variable-font orchestrator (font-engine-variable.js)
 *   is responsible for inserting those name entries — fvar only stores IDs.
 * ============================================================ */
(function(global){
  'use strict';

  function tagToInt(tag) {
    if (tag.length !== 4) throw new Error('axis tag must be 4 chars: ' + tag);
    return (tag.charCodeAt(0) << 24) | (tag.charCodeAt(1) << 16)
         | (tag.charCodeAt(2) << 8)  |  tag.charCodeAt(3);
  }

  /* Convert float to Fixed 16.16 signed (Int32). Range is roughly
     -32768.0 to 32768.0 with 1/65536 resolution. */
  function toFixed(n) {
    const v = Math.round(n * 65536);
    if (v > 0x7FFFFFFF || v < -0x80000000) {
      throw new Error('value out of Fixed 16.16 range: ' + n);
    }
    return v < 0 ? v + 0x100000000 : v;
  }

  function buildFvar(axes, instances, opts) {
    opts = opts || {};
    const includePSName = !!opts.includePostScriptNames;
    if (!axes || axes.length === 0) {
      throw new Error('fvar requires at least 1 axis');
    }
    if (axes.length > 65535) {
      throw new Error('fvar supports at most 65535 axes');
    }

    /* Validate axes. */
    for (const a of axes) {
      if (!a.tag || a.tag.length !== 4) {
        throw new Error('axis missing or bad tag: ' + JSON.stringify(a));
      }
      if (a.min == null || a.default == null || a.max == null) {
        throw new Error('axis ' + a.tag + ' missing min/default/max');
      }
      if (a.min > a.default || a.default > a.max) {
        throw new Error('axis ' + a.tag + ' must satisfy min ≤ default ≤ max');
      }
      if (a.nameID == null) {
        throw new Error('axis ' + a.tag + ' missing nameID');
      }
    }

    instances = instances || [];
    const axisCount = axes.length;
    const instanceCount = instances.length;
    const axisSize = 20;
    const instanceSize = 4 + 4 * axisCount + (includePSName ? 2 : 0);

    const headerSize = 16;
    const totalSize = headerSize + axisCount * axisSize + instanceCount * instanceSize;
    const out = new Uint8Array(totalSize);
    const dv = new DataView(out.buffer);
    let p = 0;

    /* Header. */
    dv.setUint16(p, 1, false); p += 2;            /* majorVersion */
    dv.setUint16(p, 0, false); p += 2;            /* minorVersion */
    dv.setUint16(p, headerSize, false); p += 2;   /* axesArrayOffset */
    dv.setUint16(p, 2, false); p += 2;            /* reserved (must be 2) */
    dv.setUint16(p, axisCount, false); p += 2;
    dv.setUint16(p, axisSize, false); p += 2;
    dv.setUint16(p, instanceCount, false); p += 2;
    dv.setUint16(p, instanceSize, false); p += 2;

    /* Axis records. */
    for (const a of axes) {
      dv.setUint32(p, tagToInt(a.tag), false); p += 4;
      dv.setUint32(p, toFixed(a.min), false); p += 4;
      dv.setUint32(p, toFixed(a.default), false); p += 4;
      dv.setUint32(p, toFixed(a.max), false); p += 4;
      dv.setUint16(p, a.flags || 0, false); p += 2;
      dv.setUint16(p, a.nameID, false); p += 2;
    }

    /* Instance records. */
    for (const inst of instances) {
      dv.setUint16(p, inst.nameID, false); p += 2;
      dv.setUint16(p, inst.flags || 0, false); p += 2;
      for (const a of axes) {
        const coord = inst.coords && inst.coords[a.tag] != null
          ? inst.coords[a.tag] : a.default;
        dv.setUint32(p, toFixed(coord), false); p += 4;
      }
      if (includePSName) {
        dv.setUint16(p, inst.postScriptNameID || 0, false); p += 2;
      }
    }

    return { bytes: out, axisCount, instanceCount };
  }

  global.buildFvar = buildFvar;

})(typeof self !== 'undefined' ? self : this);
