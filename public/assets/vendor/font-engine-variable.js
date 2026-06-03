/* ============================================================
 * font-engine-variable.js  (Phase 7 — variable font assembly orchestrator)
 * ------------------------------------------------------------
 * Worker-only. Given a base TTF + axis definition + per-glyph
 * variation deltas, assembles a variable font: adds fvar + gvar
 * tables to the SFNT, updates checksums, returns new bytes.
 *
 * Scope (Session 1 foundation):
 *   - Caller supplies the deltas. Computing them from two master
 *     fonts (parsing glyf, matching points across masters,
 *     subtracting coordinates) is Session 2's job — handled in a
 *     separate module so this orchestrator stays focused on table
 *     assembly + SFNT surgery.
 *   - Single axis, multiple instances supported. Multi-axis works
 *     in principle (fvar / gvar both axis-aware) but hasn't been
 *     exercised here.
 *   - Name table extension is deferred to Session 3. We use raw
 *     nameIDs (256+) — most OS pickers will still display axis +
 *     instance pickers; the labels may show as "Axis 256" until
 *     name entries land.
 *   - HVAR / MVAR / STAT tables: also Session 3. Without HVAR,
 *     metric variations come from gvar phantom-point deltas; without
 *     STAT the OS uses default style-attribute inference.
 *
 * Public entry:
 *   buildVariableFont({
 *     baseTTF: Uint8Array,    // an existing TT-format font (sfntVersion 0x00010000)
 *     axis: {
 *       tag, min, default, max,
 *       nameID,               // name table ID for axis label
 *       label,                // (optional) human-readable string to register
 *                             //   in the name table at nameID (Session 3)
 *     },
 *     instances: [
 *       { nameID, coord, name },  // name = human label for instance (Session 3)
 *       ...
 *     ],
 *     glyphVariations: [
 *       null                  // glyph has no variations
 *       OR
 *       { tuples: [{ peak: [1.0], deltas: [[dx,dy],...] }] }
 *       // length must equal numGlyphs in baseTTF
 *     ],
 *   }) -> { bytes, status, reason?, stats }
 *
 * Safety: any failure returns the unmodified baseTTF with a status
 * flag. We never produce a half-modified font.
 * ============================================================ */
(function(global){
  'use strict';

  function tagToInt(tag) {
    return (tag.charCodeAt(0) << 24) | (tag.charCodeAt(1) << 16)
         | (tag.charCodeAt(2) << 8)  |  tag.charCodeAt(3);
  }

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

  function buildVariableFont(opts) {
    if (!opts || !opts.baseTTF) {
      return { bytes: opts && opts.baseTTF, status: 'failed', reason: 'baseTTF required' };
    }
    const baseTTF = opts.baseTTF;
    if (baseTTF.length < 12) {
      return { bytes: baseTTF, status: 'failed', reason: 'baseTTF too small' };
    }
    if (typeof global.buildFvar !== 'function') {
      return { bytes: baseTTF, status: 'failed', reason: 'fvar writer not loaded' };
    }
    if (typeof global.buildGvar !== 'function') {
      return { bytes: baseTTF, status: 'failed', reason: 'gvar writer not loaded' };
    }
    if (!opts.axis) {
      return { bytes: baseTTF, status: 'failed', reason: 'axis required' };
    }
    if (!opts.glyphVariations) {
      return { bytes: baseTTF, status: 'failed', reason: 'glyphVariations required' };
    }

    /* Confirm baseTTF is TT format. */
    const sfntVersion = (baseTTF[0] << 24) | (baseTTF[1] << 16) | (baseTTF[2] << 8) | baseTTF[3];
    if (sfntVersion !== 0x00010000 && sfntVersion !== 0x74727565) {
      return { bytes: baseTTF, status: 'skipped',
               reason: 'baseTTF is not TT-format (got 0x' + (sfntVersion >>> 0).toString(16) + ')' };
    }

    /* Build the fvar bytes. Use `!= null` for nameID defaults instead
       of `|| 256` so that a legitimate nameID of 0 (or 256 already)
       doesn't get incorrectly remapped, and multiple instances don't
       all collapse onto nameID 256 when caller forgets to supply IDs.
       Audit B2: `inst.nameID || 256` would fire for nameID=0 or
       undefined, causing OS pickers to display "Italic, Italic" for
       both Regular + Italic instances. */
    const axis = opts.axis;
    const axes = [{
      tag: axis.tag, min: axis.min, default: axis.default, max: axis.max,
      nameID: axis.nameID != null ? axis.nameID : 256,
    }];
    const instances = (opts.instances || []).map((inst, i) => ({
      nameID: inst.nameID != null ? inst.nameID : 257 + i,
      coords: { [axis.tag]: inst.coord },
    }));
    let fvarOut;
    try { fvarOut = global.buildFvar(axes, instances); }
    catch (err) {
      return { bytes: baseTTF, status: 'failed', reason: 'fvar build: ' + (err.message || err) };
    }

    /* Build the gvar bytes from glyphVariations. */
    const view = new DataView(baseTTF.buffer, baseTTF.byteOffset, baseTTF.byteLength);
    const numTables = view.getUint16(4, false);
    let maxpEntry = null, headEntry = null;
    const existing = [];
    for (let i = 0; i < numTables; i++) {
      const recOff = 12 + i * 16;
      const tag = String.fromCharCode(baseTTF[recOff], baseTTF[recOff + 1], baseTTF[recOff + 2], baseTTF[recOff + 3]);
      const offset = view.getUint32(recOff + 8, false);
      const length = view.getUint32(recOff + 12, false);
      existing.push({ tag, offset, length });
      if (tag === 'maxp') maxpEntry = existing[existing.length - 1];
      if (tag === 'head') headEntry = existing[existing.length - 1];
    }
    if (!maxpEntry) return { bytes: baseTTF, status: 'failed', reason: 'no maxp table' };
    if (!headEntry) return { bytes: baseTTF, status: 'failed', reason: 'no head table' };

    const numGlyphs = view.getUint16(maxpEntry.offset + 4, false);
    if (opts.glyphVariations.length !== numGlyphs) {
      return { bytes: baseTTF, status: 'failed',
               reason: 'glyphVariations length ' + opts.glyphVariations.length + ' != numGlyphs ' + numGlyphs };
    }

    let gvarOut;
    try {
      gvarOut = global.buildGvar({
        axisCount: 1,
        glyphCount: numGlyphs,
        glyphs: opts.glyphVariations,
      });
    } catch (err) {
      return { bytes: baseTTF, status: 'failed', reason: 'gvar build: ' + (err.message || err) };
    }

    /* SFNT surgery: insert fvar + gvar. If fvar or gvar already
       exist in the base font, abort — caller should pass an
       unhinted base, not one already-converted to VF. */
    const tagsSet = new Set(existing.map(t => t.tag));
    if (tagsSet.has('fvar') || tagsSet.has('gvar')) {
      return { bytes: baseTTF, status: 'skipped', reason: 'base already has fvar or gvar' };
    }

    /* Session 3: build STAT table if requested + name table extension
       data is available. STAT is required for OS pickers to recognize
       the axis values as style attributes. Without it, even with fvar
       declaring instances, macOS sometimes won't surface them in the
       Format menu's style picker. */
    let statBytes = null;
    if (typeof global.buildStat === 'function') {
      try {
        const statSpec = {
          axes: [{ tag: axis.tag, nameID: axis.nameID != null ? axis.nameID : 256, ordering: 0 }],
          axisValues: (opts.instances || []).map((inst, i) => ({
            axisIndex: 0,
            value: inst.coord,
            nameID: inst.nameID != null ? inst.nameID : 257 + i,
          })),
          /* Fallback to first instance's nameID, typically "Regular". */
          elidedFallbackNameID: (opts.instances && opts.instances[0] && opts.instances[0].nameID != null)
            ? opts.instances[0].nameID : 257,
        };
        statBytes = global.buildStat(statSpec).bytes;
      } catch (err) {
        /* STAT failure shouldn't break VF assembly — log and continue
           without STAT. The fvar/gvar tables alone produce a functional
           if slightly less OS-friendly variable font. */
        statBytes = null;
      }
    }

    const newTables = [
      { tag: 'fvar', body: fvarOut.bytes },
      { tag: 'gvar', body: gvarOut.bytes },
    ];
    if (statBytes) {
      newTables.push({ tag: 'STAT', body: statBytes });
    }

    /* Layout: header + new directory + all old table bodies (shifted
       by directory growth) + new fvar/gvar/STAT bodies. Sort directory
       entries by tag (spec requirement). Previously hardcoded
       newNumTables = numTables + 2, which silently dropped a
       directory slot when STAT joined the new-tables list — the
       last new table fell off the end of the directory and the post
       table the file expected to follow it appeared corrupt. Caught
       by validateFont's "missing required table" check on a Session 3
       VF that added STAT. */
    const oldDirSize = 12 + numTables * 16;
    const newNumTables = numTables + newTables.length;
    const newDirSize = 12 + newNumTables * 16;

    /* Walk old tables in file-offset order; place them at the same
       relative positions after the new directory, padded to 4 bytes. */
    const byOffset = existing.slice().sort((a, b) => a.offset - b.offset);
    const newOffsets = new Map();
    let cursor = newDirSize;
    for (const t of byOffset) {
      cursor = (cursor + 3) & ~3;
      newOffsets.set(t.tag, cursor);
      cursor += t.length;
    }
    /* Append new tables. */
    for (const nt of newTables) {
      cursor = (cursor + 3) & ~3;
      newOffsets.set(nt.tag, cursor);
      cursor += nt.body.length;
    }
    const totalLen = cursor;
    const out = new Uint8Array(totalLen);
    const ov = new DataView(out.buffer);

    /* SFNT header. */
    ov.setUint32(0, sfntVersion, false);
    ov.setUint16(4, newNumTables, false);
    let largestPow2 = 1;
    while (largestPow2 * 2 <= newNumTables) largestPow2 *= 2;
    ov.setUint16(6, largestPow2 * 16, false);
    ov.setUint16(8, Math.log2(largestPow2), false);
    ov.setUint16(10, (newNumTables - largestPow2) * 16, false);

    /* Build sorted directory (existing + new). For head, copy + zero
       the checkSumAdjustment field BEFORE computing the per-table
       checksum — spec requires head's directory checksum to reflect
       the body as if adjustment were 0. We recompute the real
       adjustment after the whole-font sum below. Skipping this zero
       step produced an incorrect head checksum that validateFont
       caught on the first synthetic VF test. */
    const allEntries = [];
    for (const t of existing) {
      let body = baseTTF.subarray(t.offset, t.offset + t.length);
      if (t.tag === 'head') {
        const copy = new Uint8Array(body);
        const dv = new DataView(copy.buffer);
        dv.setUint32(8, 0, false);
        body = copy;
      }
      allEntries.push({
        tag: t.tag, tagNum: tagToInt(t.tag),
        body,
        offset: newOffsets.get(t.tag),
        length: t.length,
      });
    }
    for (const nt of newTables) {
      allEntries.push({
        tag: nt.tag, tagNum: tagToInt(nt.tag),
        body: nt.body,
        offset: newOffsets.get(nt.tag),
        length: nt.body.length,
      });
    }
    allEntries.sort((a, b) => a.tagNum - b.tagNum);

    let dirOff = 12;
    for (const e of allEntries) {
      ov.setUint32(dirOff, e.tagNum, false);
      ov.setUint32(dirOff + 4, checksum(e.body), false);
      ov.setUint32(dirOff + 8, e.offset, false);
      ov.setUint32(dirOff + 12, e.length, false);
      dirOff += 16;
    }
    /* Bodies. */
    for (const e of allEntries) {
      out.set(e.body, e.offset);
    }

    /* head.checkSumAdjustment: zero, sum (with 4-byte zero-pad tail), restore. */
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

    /* Session 3: extend the name table with axis + instance labels
       so OS style pickers display "Italic" instead of "Axis 256".
       Only runs if labels are supplied and the name-extend module is
       loaded. On failure, fall back to the un-extended font (still
       valid, just with placeholder labels). */
    let finalBytes = out;
    let nameExtended = null;
    if (typeof global.extendNameTable === 'function') {
      const entries = [];
      if (axis.label) {
        entries.push({ nameID: axis.nameID != null ? axis.nameID : 256, value: axis.label });
      }
      (opts.instances || []).forEach((inst, i) => {
        if (inst.name) {
          entries.push({ nameID: inst.nameID != null ? inst.nameID : 257 + i, value: inst.name });
        }
      });
      if (entries.length > 0) {
        try {
          const nx = global.extendNameTable(out, entries);
          if (nx.status === 'extended') {
            finalBytes = nx.bytes;
            nameExtended = nx.stats;
          }
        } catch (err) {
          /* Keep the unlabeled font rather than ship nothing. */
          nameExtended = { error: 'name extend exception: ' + (err.message || err) };
        }
      }
    }

    return {
      bytes: finalBytes,
      status: 'built',
      stats: {
        axisCount: fvarOut.axisCount,
        instanceCount: fvarOut.instanceCount,
        fvarBytes: fvarOut.bytes.length,
        gvarBytes: gvarOut.bytes.length,
        statBytes: statBytes ? statBytes.length : 0,
        glyphsWithVariations: gvarOut.stats.glyphsWithVariations,
        totalTuples: gvarOut.stats.totalTuples,
        sfntDelta: finalBytes.length - baseTTF.length,
        nameExtended,
      },
    };
  }

  global.buildVariableFont = buildVariableFont;

})(typeof self !== 'undefined' ? self : this);
