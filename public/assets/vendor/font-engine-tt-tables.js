/* ============================================================
 * font-engine-tt-tables.js  (Phase 5a — cvt / fpgm / prep builders)
 * ------------------------------------------------------------
 * Worker-only. Builds the three font-level hinting tables that a
 * TrueType hinted font needs. None of these contain per-glyph
 * bytecode — that lives in glyf (Phase 5b/5c, separate module).
 *
 *   cvt (Control Value Table)
 *     Array of font-unit values (Int16) referenced by MIAP/MIRP
 *     instructions. Conventional layout: blue zones first (cap
 *     height, x-height, baseline, descender), then standard stem
 *     widths (StdHW, StdVW). We expose a stable index map so the
 *     per-glyph instruction generator can reference cvt[BLUE_CAP],
 *     cvt[STEM_V] etc. by name.
 *
 *   fpgm (Font Program)
 *     Runs ONCE per font activation. Defines reusable functions
 *     (FDEF). We define a small set of stem-snap helpers that
 *     per-glyph code calls — saves bytes vs inlining at every site.
 *
 *   prep (Pre-Program / CV Program)
 *     Runs at every PPEM change. Sets initial graphics state
 *     (round mode, dropout control, CVT cut-in), and optionally
 *     deltas individual cvt entries at specific pixel sizes for
 *     pixel-perfect alignment. For Phase 5a we emit only the
 *     baseline state setup; per-PPEM deltas come later.
 *
 * Public entry:
 *   buildHintingTables(telemetry, opts?) -> {
 *     cvt:    Uint8Array,
 *     fpgm:   Uint8Array,
 *     prep:   Uint8Array,
 *     cvtMap: { BLUE_BASELINE, BLUE_X_HEIGHT, BLUE_CAP_HEIGHT,
 *               BLUE_ASCENDER, BLUE_DESCENDER, STEM_H, STEM_V,
 *               …reserved future slots… },
 *     fpgmMap:{ SNAP_TO_CVT, SNAP_PAIR, … },
 *     stats:  { cvtEntries, fpgmFunctions, prepBytes },
 *   }
 * ============================================================ */
(function(global){
  'use strict';

  /* Stable CVT index assignments. Per-glyph code (Phase 5b) will
     reference these by name via the returned cvtMap. Reserved
     numeric slots avoid collisions when later phases add more zones
     (e.g. descender overshoot, cap overshoot, stem snap arrays). */
  const CVT_SLOTS = {
    BLUE_BASELINE:        0,
    BLUE_X_HEIGHT:        1,
    BLUE_X_HEIGHT_OS:     2, /* overshoot (round x-letter tops) */
    BLUE_CAP_HEIGHT:      3,
    BLUE_CAP_HEIGHT_OS:   4,
    BLUE_ASCENDER:        5,
    BLUE_DESCENDER:       6,
    BLUE_DESCENDER_OS:    7,
    STEM_H:               8, /* StdHW */
    STEM_V:               9, /* StdVW */
    /* 10-15 reserved for stem snap entries (h0,h1,h2,v0,v1,v2) */
  };

  /* Stable fpgm function numbers. Per-glyph instructions push args
     then `pushB N; CALL` to invoke. */
  const FPGM_SLOTS = {
    /* fn 0: snap a single point to a CVT value on Y axis.
       Stack input: ( pointIndex cvtIndex -- )
       Body: SVTCA[y] ; MIAP[1] */
    SNAP_Y_TO_CVT:        0,
    /* fn 1: snap a single point to a CVT value on X axis.
       Stack input: ( pointIndex cvtIndex -- )
       Body: SVTCA[x] ; MIAP[1] */
    SNAP_X_TO_CVT:        1,
    /* fn 2: round a single point to grid on Y axis.
       Stack input: ( pointIndex -- )
       Body: SVTCA[y] ; MDAP[1] */
    ROUND_Y_TO_GRID:      2,
    /* fn 3: round a single point to grid on X axis.
       Stack input: ( pointIndex -- )
       Body: SVTCA[x] ; MDAP[1] */
    ROUND_X_TO_GRID:      3,
  };

  /* === cvt builder ===
     cvt is a flat sequence of big-endian Int16 values in font units.
     We populate slots from telemetry; null/missing telemetry fields
     leave the slot at 0 (harmless — MIAP to a 0-valued cvt simply
     snaps the point to baseline). Returns Uint8Array of cvt bytes
     plus the entry count so maxp.maxStorage can be set correctly. */
  function buildCVT(telemetry) {
    const bz = telemetry.blueZones || {};
    const stems = telemetry.stems || {};
    const numSlots = 16; /* reserve a fixed block so later phases can
                            add entries without reshuffling indices */
    const buf = new Uint8Array(numSlots * 2);
    const dv = new DataView(buf.buffer);

    const set = (slot, val) => {
      if (val == null || !isFinite(val)) val = 0;
      const v = Math.max(-32768, Math.min(32767, Math.round(val)));
      dv.setInt16(slot * 2, v, false);
    };

    set(CVT_SLOTS.BLUE_BASELINE,      0);
    set(CVT_SLOTS.BLUE_X_HEIGHT,      bz.xHeight);
    set(CVT_SLOTS.BLUE_X_HEIGHT_OS,   bz.xHeightOvershoot);
    set(CVT_SLOTS.BLUE_CAP_HEIGHT,    bz.capHeight);
    set(CVT_SLOTS.BLUE_CAP_HEIGHT_OS, bz.capOvershoot);
    set(CVT_SLOTS.BLUE_ASCENDER,      bz.ascender);
    set(CVT_SLOTS.BLUE_DESCENDER,     bz.descender);
    set(CVT_SLOTS.BLUE_DESCENDER_OS,  bz.descenderOvershoot);
    set(CVT_SLOTS.STEM_H,             stems.stdHW);
    set(CVT_SLOTS.STEM_V,             stems.stdVW);

    return { bytes: buf, entryCount: numSlots };
  }

  /* === fpgm builder ===
     Format per spec: a sequence of FDEF/ENDF blocks. Each FDEF takes
     ONE arg on the stack — the function number being defined — pushed
     by the preamble. So a definition looks like:
       PUSHB[0] <fn_num> ; FDEF ; <body opcodes> ; ENDF
     Multiple functions concatenate. */
  function buildFPGM() {
    const TTStream = global.TTStream;
    if (typeof TTStream !== 'function') {
      throw new Error('font-engine-tt-bytecode.js must load before tt-tables.js');
    }
    const s = new TTStream();

    /* fn SNAP_Y_TO_CVT (0): on entry stack = [point, cvtIdx].
       SVTCA[y] sets projection+freedom to Y. MIAP[1] pops cvtIdx
       then pointIdx, snaps point's Y to cvt[cvtIdx] (scaled to pixels)
       and rounds per current round mode. */
    s.pushB(FPGM_SLOTS.SNAP_Y_TO_CVT).fdef();
    s.svtca(1);
    s.miap(1);
    s.endf();

    /* fn SNAP_X_TO_CVT (1): same but X axis. */
    s.pushB(FPGM_SLOTS.SNAP_X_TO_CVT).fdef();
    s.svtca(0);
    s.miap(1);
    s.endf();

    /* fn ROUND_Y_TO_GRID (2): stack = [point]. SVTCA[y], MDAP[1]. */
    s.pushB(FPGM_SLOTS.ROUND_Y_TO_GRID).fdef();
    s.svtca(1);
    s.mdap(1);
    s.endf();

    /* fn ROUND_X_TO_GRID (3): stack = [point]. SVTCA[x], MDAP[1]. */
    s.pushB(FPGM_SLOTS.ROUND_X_TO_GRID).fdef();
    s.svtca(0);
    s.mdap(1);
    s.endf();

    return { bytes: s.toBytes(), functionCount: Object.keys(FPGM_SLOTS).length };
  }

  /* === prep builder ===
     Runs at every PPEM change. We set:
       SCANCTRL ON     — enable dropout control at all sizes (1 ≤ 8 → keep on at 8ppem too)
       SCANTYPE        — set dropout mode 4 (smart dropout, both directions)
       SCVTCI          — set CVT cut-in to 1/16 pixel (default for most fonts)
       RTG             — round to grid
     Future: per-PPEM deltas via DELTAP / DELTAC for pixel-perfect
     alignment at specific sizes. */
  function buildPREP() {
    const TTStream = global.TTStream;
    const s = new TTStream();
    /* SCANCTRL takes one uint16 arg on stack. 511 doesn't fit in
       pushB (uint8 max 255), so use pushW (int16). The value 511
       means "enable dropout control at all ppem ≤ 511 in all
       conditions" — effectively always on. */
    s.pushW(511).scanctrl();
    s.pushB(4).scantype();   /* smart dropout, exclude stubs */
    /* SCVTCI takes one F26Dot6 arg (1/64 pixel units). 64 = 1 pixel,
       4 = 1/16 pixel. Standard cut-in is 17/16 pixel = 68 (so any
       point within 1/16px of the CVT value snaps to it). */
    s.pushB(68).scvtci();
    s.rtg();
    return { bytes: s.toBytes() };
  }

  function buildHintingTables(telemetry) {
    if (!telemetry || !telemetry.blueZones) {
      return null;
    }
    const cvt = buildCVT(telemetry);
    const fpgm = buildFPGM();
    const prep = buildPREP();
    return {
      cvt: cvt.bytes,
      fpgm: fpgm.bytes,
      prep: prep.bytes,
      cvtMap: Object.assign({}, CVT_SLOTS),
      fpgmMap: Object.assign({}, FPGM_SLOTS),
      stats: {
        cvtEntries: cvt.entryCount,
        fpgmFunctions: fpgm.functionCount,
        prepBytes: prep.bytes.length,
        cvtBytes: cvt.bytes.length,
        fpgmBytes: fpgm.bytes.length,
      },
    };
  }

  global.buildHintingTables = buildHintingTables;
  global.TT_CVT_SLOTS = CVT_SLOTS;
  global.TT_FPGM_SLOTS = FPGM_SLOTS;

})(typeof self !== 'undefined' ? self : this);
