/* ============================================================
 * font-engine-tt-bytecode.js  (Phase 5a — TrueType bytecode emitter)
 * ------------------------------------------------------------
 * Worker-only. Typed primitives for writing TrueType instruction
 * sequences (the bytecode that lives in cvt/fpgm/prep tables and
 * in per-glyph glyf instruction sections). This module ONLY emits
 * bytes — it doesn't execute or simulate the graphics state. The
 * rasterizer (FreeType / DirectWrite / CoreText / browser fallback)
 * is what runs these instructions at render time.
 *
 * The TrueType instruction set is documented in the Apple TrueType
 * Reference Manual (1996, "Instructions for the Apple Advanced
 * Typography") and the Microsoft OpenType spec, chapter "TrueType
 * Instruction Set". Both define a stack-based VM with state
 * registers (round mode, freedom/projection vectors, ref points,
 * loop counter, etc.) and ~250 opcodes — we use ~30 of those for
 * the kinds of hinting our generated fonts need.
 *
 * Public entry: TTStream class
 *   new TTStream()
 *     .pushB(...vals)         small uint8s (0-255) via PUSHB
 *     .pushW(...vals)         signed int16s via PUSHW
 *     .pushNum(...vals)       auto-chooses byte/word/multi-push
 *     .svtca(axis)            set freedom+projection to axis (0=x, 1=y)
 *     .mdap(round, pt)        round point to grid (round=1) or just touch (0)
 *     .miap(round, pt, cvt)   move indirect absolute point to CVT value
 *     .iup(axis)              interpolate untouched points along axis
 *     .endf()                 end function definition
 *     .fdef()                 begin function definition
 *     .call()                 call function (function num on stack)
 *     .scfs(pt, val)          set coords from stack (rare)
 *     .raw(...bytes)          escape hatch for raw opcodes/operands
 *     .toBytes() -> Uint8Array
 *     .length -> number
 *
 * Push optimization: pushB/pushW can each carry up to 255 args in
 * a single instruction (the count byte limits this). pushNum picks
 * the cheapest encoding for each value and groups consecutive
 * same-sized values into a single push for compactness.
 * ============================================================ */
(function(global){
  'use strict';

  /* TrueType opcode constants. Hex notation matches the spec for
     easy cross-reference. We define every opcode our codebase needs
     even if some are only used by Phase 5b/5c (forward-looking so
     callers can grow without re-importing constants). */
  const OP = {
    /* Push operators */
    NPUSHB:   0x40, /* push N (byte after opcode) unsigned bytes */
    NPUSHW:   0x41, /* push N (byte after opcode) signed shorts */
    PUSHB:    0xB0, /* PUSHB[abc]: low 3 bits = (count-1), push 1-8 bytes */
    PUSHW:    0xB8, /* PUSHW[abc]: low 3 bits = (count-1), push 1-8 shorts */

    /* Storage / CVT */
    RS:       0x43, /* read store */
    WS:       0x42, /* write store */
    RCVT:     0x45, /* read CVT entry */
    WCVTP:    0x44, /* write CVT in pixels */
    WCVTF:    0x70, /* write CVT in font units */

    /* Graphics state */
    SVTCA_x:  0x01, /* set freedom & projection vectors to X axis */
    SVTCA_y:  0x00, /* set freedom & projection vectors to Y axis */
    SPVTCA_x: 0x03, /* set projection vector to X */
    SPVTCA_y: 0x02, /* set projection vector to Y */
    SFVTCA_x: 0x05, /* set freedom vector to X */
    SFVTCA_y: 0x04, /* set freedom vector to Y */
    SRP0:     0x10, /* set reference point 0 */
    SRP1:     0x11,
    SRP2:     0x12,
    SLOOP:    0x17, /* set loop variable */
    SMD:      0x1A, /* set minimum distance */
    SCANCTRL: 0x85, /* dropout control */
    SCANTYPE: 0x8D,
    SCVTCI:   0x1D, /* set CVT cut-in */

    /* Rounding state */
    RTG:      0x18, /* round to grid */
    RTHG:     0x19, /* round to half-grid */
    RUTG:     0x7C, /* round up to grid */
    RDTG:     0x7D, /* round down to grid */
    ROFF:     0x7A, /* round off (no rounding) */
    RTDG:     0x3D, /* round to double grid */

    /* Point manipulation */
    MDAP_0:   0x2E, /* move direct absolute point, no round */
    MDAP_1:   0x2F, /* move direct absolute point, round */
    MIAP_0:   0x3E, /* move indirect abs point to CVT, no round */
    MIAP_1:   0x3F, /* move indirect abs point to CVT, round */
    MDRP:     0x20, /* base byte; flags in low nibble (0x20-0x2F) */
    MIRP:     0xE0, /* base byte; flags in low nibble (0xE0-0xFF) */
    IUP_y:    0x30, /* interpolate untouched points in Y */
    IUP_x:    0x31, /* interpolate untouched points in X */
    SHC:      0x34, /* shift contour */
    SHP_rp1:  0x32,
    SHP_rp2:  0x33,
    ALIGNRP:  0x3C, /* align relative point */
    IP:       0x39, /* interpolate point */
    MSIRP_0:  0x3A,
    MSIRP_1:  0x3B,

    /* Functions */
    FDEF:     0x2C, /* function definition begin */
    ENDF:     0x2D, /* function definition end */
    CALL:     0x2B, /* call function */
    LOOPCALL: 0x2A,

    /* Flow control (rare in our output but defined for completeness) */
    IF:       0x58,
    ELSE:     0x1B,
    EIF:      0x59,
    JMPR:     0x1C,

    /* Stack arithmetic (used in fpgm function bodies) */
    DUP:      0x20, /* WARNING: 0x20 collides with MDRP base — DUP is used
                       in different contexts and disambiguated by stack
                       state. We don't emit DUP for now to avoid the
                       collision risk. */
    POP:      0x21,
    CLEAR:    0x22,
    SWAP:     0x23,
    DEPTH:    0x24,
    CINDEX:   0x25,
    MINDEX:   0x26,
    ADD:      0x60,
    SUB:      0x61,
    DIV:      0x62,
    MUL:      0x63,
    ABS:      0x64,
    NEG:      0x65,
    FLOOR:    0x66,
    CEILING:  0x67,
    MAX:      0x8B,
    MIN:      0x8C,
    LT:       0x50,
    LTEQ:     0x51,
    GT:       0x52,
    GTEQ:     0x53,
    EQ:       0x54,
    NEQ:      0x55,
    AND:      0x5A,
    OR:       0x5B,
    NOT:      0x5C,

    /* Common composite ends */
    ENDCHAR:  0x14, /* note: this is CFF endchar — TT has no such op.
                       Renamed conceptually below. We don't emit it. */
  };

  function TTStream() {
    /* Internal buffer; we keep it as a regular array of bytes and
       convert to Uint8Array at toBytes() time so push() / unshift()
       remain cheap during construction. */
    this._bytes = [];
  }

  /* ---- Low-level: append raw bytes ---- */
  TTStream.prototype.raw = function() {
    for (let i = 0; i < arguments.length; i++) {
      const b = arguments[i] & 0xff;
      this._bytes.push(b);
    }
    return this;
  };

  /* ---- Push operators ----
     PUSHB[abc] (0xB0-0xB7): inline-count, push 1-8 unsigned bytes
     PUSHW[abc] (0xB8-0xBF): inline-count, push 1-8 signed shorts
     NPUSHB     (0x40):      next byte = count (1-255), push N bytes
     NPUSHW     (0x41):      next byte = count (1-255), push N shorts
     We always emit the cheapest form for the count. */
  TTStream.prototype.pushB = function() {
    const vals = Array.prototype.slice.call(arguments);
    for (const v of vals) {
      if (v < 0 || v > 255 || !Number.isInteger(v)) {
        throw new Error('pushB value out of range (0-255): ' + v);
      }
    }
    if (vals.length === 0) return this;
    if (vals.length <= 8) {
      /* PUSHB[abc] family: opcode encodes count-1 in low 3 bits. */
      this._bytes.push(OP.PUSHB + (vals.length - 1));
    } else {
      if (vals.length > 255) {
        throw new Error('pushB > 255 values; split into multiple calls');
      }
      this._bytes.push(OP.NPUSHB);
      this._bytes.push(vals.length);
    }
    for (const v of vals) this._bytes.push(v);
    return this;
  };

  TTStream.prototype.pushW = function() {
    const vals = Array.prototype.slice.call(arguments);
    for (const v of vals) {
      if (v < -32768 || v > 32767 || !Number.isInteger(v)) {
        throw new Error('pushW value out of range (-32768..32767): ' + v);
      }
    }
    if (vals.length === 0) return this;
    if (vals.length <= 8) {
      this._bytes.push(OP.PUSHW + (vals.length - 1));
    } else {
      if (vals.length > 255) {
        throw new Error('pushW > 255 values; split into multiple calls');
      }
      this._bytes.push(OP.NPUSHW);
      this._bytes.push(vals.length);
    }
    for (const v of vals) {
      const u = v < 0 ? v + 0x10000 : v;
      this._bytes.push((u >> 8) & 0xff);
      this._bytes.push(u & 0xff);
    }
    return this;
  };

  /* pushNum: takes any number of integers, decides per-value whether
     they need byte or word encoding, and groups consecutive same-type
     values into a single push for compactness. The CFF analogue is
     encInt's range-based dispatch. */
  TTStream.prototype.pushNum = function() {
    const vals = Array.prototype.slice.call(arguments);
    let i = 0;
    while (i < vals.length) {
      /* Look ahead for a run of values that fit in the same width. */
      const fitsByte = (v) => Number.isInteger(v) && v >= 0 && v <= 255;
      const startsAsByte = fitsByte(vals[i]);
      let j = i;
      /* PUSHB max 8 args (with inline encoding); 255 with NPUSHB. We
         cap at 255 per call regardless. */
      while (j < vals.length && j < i + 255 && fitsByte(vals[j]) === startsAsByte) j++;
      const run = vals.slice(i, j);
      if (startsAsByte) this.pushB.apply(this, run);
      else this.pushW.apply(this, run);
      i = j;
    }
    return this;
  };

  /* ---- High-level helpers ----
     These are named after the assembly mnemonics from the spec for
     easy cross-reference with hinting documentation. */
  TTStream.prototype.svtca = function(axis) {
    this._bytes.push(axis === 0 ? OP.SVTCA_x : OP.SVTCA_y);
    return this;
  };
  TTStream.prototype.srp0 = function() { this._bytes.push(OP.SRP0); return this; };
  TTStream.prototype.srp1 = function() { this._bytes.push(OP.SRP1); return this; };
  TTStream.prototype.srp2 = function() { this._bytes.push(OP.SRP2); return this; };

  /* Round modes — set once and they persist until next call. */
  TTStream.prototype.rtg  = function() { this._bytes.push(OP.RTG);  return this; };
  TTStream.prototype.rthg = function() { this._bytes.push(OP.RTHG); return this; };
  TTStream.prototype.rtdg = function() { this._bytes.push(OP.RTDG); return this; };
  TTStream.prototype.rdtg = function() { this._bytes.push(OP.RDTG); return this; };
  TTStream.prototype.rutg = function() { this._bytes.push(OP.RUTG); return this; };
  TTStream.prototype.roff = function() { this._bytes.push(OP.ROFF); return this; };

  /* MDAP — Move Direct Absolute Point.
     Pops point index from stack. round=1 → round to grid, 0 → just
     "touch" the point (mark it so IUP knows it was hinted). */
  TTStream.prototype.mdap = function(round) {
    this._bytes.push(round ? OP.MDAP_1 : OP.MDAP_0);
    return this;
  };

  /* MIAP — Move Indirect Absolute Point (to CVT value).
     Pops point + CVT index. Snaps point's projection-axis coord to
     the CVT[cvtIdx] value (after scaling). round=1 applies current
     round mode after the snap. */
  TTStream.prototype.miap = function(round) {
    this._bytes.push(round ? OP.MIAP_1 : OP.MIAP_0);
    return this;
  };

  /* MDRP — Move Direct Relative Point.
     Flags (low nibble): bit 4 = set RP0 to this point after,
     bit 3 = keep distance ≥ minimum, bit 2 = round, bits 1-0 = distance type.
     Common form 0x20 (no flags) — most basic move. */
  TTStream.prototype.mdrp = function(flags) {
    this._bytes.push(0x20 | (flags & 0x1F));
    return this;
  };

  /* MIRP — Move Indirect Relative Point.
     Flags (low nibble): bit 4 = set RP0, bit 3 = keep min dist,
     bit 2 = round, bits 1-0 = distance type.
     The base byte 0xE0 plus flags. */
  TTStream.prototype.mirp = function(flags) {
    this._bytes.push(0xE0 | (flags & 0x1F));
    return this;
  };

  /* IUP — Interpolate Untouched Points along axis (0=X, 1=Y).
     IUP[1] is 0x30, IUP[0] is 0x31 (yes the spec mapping is
     counter-intuitive — IUP[0] means "Y axis" in opcode name but
     "X axis" in many docs). We follow the OPCODE values literally:
     IUP_y opcode 0x30 = interpolate in y; IUP_x opcode 0x31 = x. */
  TTStream.prototype.iupY = function() { this._bytes.push(OP.IUP_y); return this; };
  TTStream.prototype.iupX = function() { this._bytes.push(OP.IUP_x); return this; };
  TTStream.prototype.iup = function(axis) { return axis === 0 ? this.iupX() : this.iupY(); };

  /* Functions */
  TTStream.prototype.fdef = function() { this._bytes.push(OP.FDEF); return this; };
  TTStream.prototype.endf = function() { this._bytes.push(OP.ENDF); return this; };
  TTStream.prototype.call = function() { this._bytes.push(OP.CALL); return this; };
  TTStream.prototype.loopcall = function() { this._bytes.push(OP.LOOPCALL); return this; };

  /* CVT operations */
  TTStream.prototype.rcvt = function() { this._bytes.push(OP.RCVT); return this; };
  TTStream.prototype.wcvtp = function() { this._bytes.push(OP.WCVTP); return this; };
  TTStream.prototype.wcvtf = function() { this._bytes.push(OP.WCVTF); return this; };
  TTStream.prototype.scvtci = function() { this._bytes.push(OP.SCVTCI); return this; };

  /* Misc state */
  TTStream.prototype.sloop = function() { this._bytes.push(OP.SLOOP); return this; };
  TTStream.prototype.smd = function() { this._bytes.push(OP.SMD); return this; };
  TTStream.prototype.scanctrl = function() { this._bytes.push(OP.SCANCTRL); return this; };
  TTStream.prototype.scantype = function() { this._bytes.push(OP.SCANTYPE); return this; };

  /* Arithmetic — only the common ones we'd need in a prep program. */
  TTStream.prototype.mul = function() { this._bytes.push(OP.MUL); return this; };
  TTStream.prototype.div = function() { this._bytes.push(OP.DIV); return this; };
  TTStream.prototype.add = function() { this._bytes.push(OP.ADD); return this; };
  TTStream.prototype.sub = function() { this._bytes.push(OP.SUB); return this; };

  /* Output */
  Object.defineProperty(TTStream.prototype, 'length', {
    get: function() { return this._bytes.length; },
  });

  TTStream.prototype.toBytes = function() {
    return new Uint8Array(this._bytes);
  };

  /* Convenience: clone for splicing prefix/suffix. */
  TTStream.prototype.clone = function() {
    const s = new TTStream();
    s._bytes = this._bytes.slice();
    return s;
  };

  global.TTStream = TTStream;
  global.TT_OP = OP;

})(typeof self !== 'undefined' ? self : this);
