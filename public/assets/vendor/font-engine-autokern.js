/* ============================================================
 * font-engine-autokern.js  (Phase 3 — auto-kerning analyzer)
 * ------------------------------------------------------------
 * Worker-only. Reads glyph silhouettes via OffscreenCanvas
 * rasterization, measures gaps for a candidate pair set, and
 * emits per-pair adjustments scaled to font units.
 *
 * Public entry: analyzeAutoKern(glyphs, scale, strength)
 *   returns [{ leftChar, rightChar, value }, ...] in font units.
 *
 * Depends on:
 *   - tokenizePath (font-engine-builder.js)
 *   - OffscreenCanvas (worker runtime: Chrome 69+, FF 105+,
 *     Safari 16.4+)
 * ============================================================ */
(function(global){
  'use strict';

  /* Class membership for predefined kern-pair expansion. Kept tight
     because false positives (pairs that shouldn't kern but do) cost
     more typographically than misses (pairs that should kern but
     don't get analyzed). */
  const CLASS_RIGHT = {
    openCap:  'TVWYF',
    roundCap: 'OCDGQU',
    vertCap:  'HIMNKLEBJPR',
    diagCap:  'AXZ',
    openLow:  'tvwyf',
    roundLow: 'oceqdpb',
    vertLow:  'inmhlkr',
    tailLow:  'asjg',
  };

  const CLASS_LEFT = {
    openCap:  'AJTYV',
    roundCap: 'OCGQ',
    vertCap:  'HIMNKLEBPRDFU',
    diagCap:  'WX',
    openLow:  'aceojy',
    roundLow: 'cosde',
    vertLow:  'inmhlkrtbpdfqu',
  };

  /* Explicit pairs always tried (in addition to class expansion).
     Drawn from the Latin tight-pair canon. */
  const CANDIDATE_BASE_PAIRS = [
    ['A','V'],['A','W'],['A','T'],['A','Y'],['A','C'],['A','G'],['A','O'],['A','Q'],['A','U'],
    ['L','V'],['L','W'],['L','T'],['L','Y'],
    ['P','A'],['F','A'],['T','A'],['V','A'],['W','A'],['Y','A'],
    ['R','V'],['R','W'],['R','Y'],['R','T'],['R','U'],
    ['K','V'],['K','W'],['K','Y'],
    ['T','a'],['T','e'],['T','o'],['T','u'],['T','r'],['T','i'],['T','y'],['T','s'],['T','w'],['T','c'],
    ['V','a'],['V','e'],['V','o'],['V','i'],['V','u'],['V','r'],
    ['W','a'],['W','e'],['W','o'],['W','i'],['W','u'],['W','r'],
    ['Y','a'],['Y','e'],['Y','o'],['Y','u'],['Y','i'],['Y','s'],
    ['F','a'],['F','e'],['F','o'],['F','i'],['F','r'],
    ['P','a'],['P','e'],['P','o'],
    ['r','a'],['r','e'],['r','o'],['r','c'],['r','d'],['r','g'],['r','q'],
    ['v','a'],['v','e'],['v','o'],
    ['w','a'],['w','e'],['w','o'],
    ['y','a'],['y','e'],['y','o'],
    ['o','v'],['o','w'],['o','y'],
    ['e','v'],['e','w'],['e','y'],
  ];

  /* Rasterize a glyph onto a cell-pixel-sized OffscreenCanvas and
     extract per-scanline leftmost/rightmost ink x. Result is cached
     on the glyph; subsequent measurePairGap calls reuse it. */
  function silhouetteForGlyph(g) {
    if (g._silhouette) return g._silhouette;
    const w = Math.max(1, Math.ceil(g.cellW));
    const h = Math.max(1, Math.ceil(g.cellH));
    /* Overhang-aware (2026-06-10): with body advances a swash tail can ride
       OUTSIDE [0, cellW] (negative bearings). A canvas sized to the cell
       clips that ink, so the analyzer would see overlapped pairs as wide
       open and over-pull them into collisions (the chancery capitals bug).
       Pad the raster on both sides and subtract the pad on extraction, so
       left/right stay in advance coordinates but may run negative or past
       cellW, exactly like the rendered glyph. */
    const pad = Math.ceil(Math.max(w, h) / 2);
    const cw = w + pad * 2;
    /* Supersample the raster (2026-06-29): a thin connecting/exit stroke is only a
       fraction of a cell pixel wide, so at cell resolution its rightmost reach
       anti-aliases below the alpha threshold and is dropped. The kern then
       UNDER-measures the overlap a long exit makes with the next letter, reads the
       pair as loose, and TIGHTENS it into a crash (the delicate-cursive de/nn
       over-kern). Rendering at a higher factor makes a sub-pixel stroke a solid
       pixel so the exit reach is seen; results downsample back to cell rows below. */
    let ss = 4;
    while (ss > 1 && (cw * ss > 4096 || h * ss > 4096)) ss--;
    let canvas;
    try {
      canvas = new OffscreenCanvas(cw * ss, h * ss);
    } catch (e) {
      return null;
    }
    const ctx = canvas.getContext('2d');
    ctx.scale(ss, ss);
    ctx.translate(pad, 0);
    ctx.fillStyle = '#000';
    /* Re-walk path tokens and reissue as canvas calls. Path2D-from-
       string has spotty worker support across browsers; this path is
       universal. */
    for (const d of g.paths) {
      ctx.beginPath();
      const tokens = tokenizePath(d);
      let cx = 0, cy = 0;
      for (const [cmd, args] of tokens) {
        const upper = cmd.toUpperCase();
        const isRel = cmd !== upper;
        switch (upper) {
          case 'M': {
            const ax = isRel ? cx + args[0] : args[0];
            const ay = isRel ? cy + args[1] : args[1];
            ctx.moveTo(ax, ay); cx = ax; cy = ay; break;
          }
          case 'L': {
            const ax = isRel ? cx + args[0] : args[0];
            const ay = isRel ? cy + args[1] : args[1];
            ctx.lineTo(ax, ay); cx = ax; cy = ay; break;
          }
          case 'H': {
            const ax = isRel ? cx + args[0] : args[0];
            ctx.lineTo(ax, cy); cx = ax; break;
          }
          case 'V': {
            const ay = isRel ? cy + args[0] : args[0];
            ctx.lineTo(cx, ay); cy = ay; break;
          }
          case 'C': {
            const c1x = isRel ? cx + args[0] : args[0];
            const c1y = isRel ? cy + args[1] : args[1];
            const c2x = isRel ? cx + args[2] : args[2];
            const c2y = isRel ? cy + args[3] : args[3];
            const ax  = isRel ? cx + args[4] : args[4];
            const ay  = isRel ? cy + args[5] : args[5];
            ctx.bezierCurveTo(c1x, c1y, c2x, c2y, ax, ay);
            cx = ax; cy = ay; break;
          }
          case 'Q': {
            const c1x = isRel ? cx + args[0] : args[0];
            const c1y = isRel ? cy + args[1] : args[1];
            const ax  = isRel ? cx + args[2] : args[2];
            const ay  = isRel ? cy + args[3] : args[3];
            ctx.quadraticCurveTo(c1x, c1y, ax, ay);
            cx = ax; cy = ay; break;
          }
          case 'Z':
            ctx.closePath();
            break;
        }
      }
      /* even-odd matches the SVG fill rule we use; ligature glyphs
         can have nested counter-paths. */
      ctx.fill('evenodd');
    }

    const W = cw * ss, H = h * ss;
    const img = ctx.getImageData(0, 0, W, H);
    const data = img.data;
    const left = new Float64Array(h);
    const right = new Float64Array(h);
    for (let y = 0; y < h; y++) { left[y] = Infinity; right[y] = -Infinity; }
    let inkY0 = h, inkY1 = 0;
    /* Extract at hi-res, downsample to cell rows: each cell row's left/right is the
       min-left / max-right over its ss sub-rows, in cell advance coordinates, so
       measurePairGap still indexes rows baseline-relative in cell pixels. */
    for (let Y = 0; Y < H; Y++) {
      const cy = (Y / ss) | 0;
      const rowOff = Y * W * 4 + 3;
      let hasInk = false;
      for (let X = 0; X < W; X++) {
        if (data[rowOff + X * 4] > 128) {
          const ax = X / ss - pad; /* hi-px back to cell advance coordinates */
          if (ax < left[cy]) left[cy] = ax;
          if (ax > right[cy]) right[cy] = ax;
          hasInk = true;
        }
      }
      if (hasInk) {
        if (cy < inkY0) inkY0 = cy;
        if (cy > inkY1) inkY1 = cy;
      }
    }
    if (inkY1 < inkY0) { inkY0 = 0; inkY1 = h - 1; }
    const sil = { left, right, w, h, inkY0, inkY1 };
    g._silhouette = sil;
    return sil;
  }

  function measurePairGap(L, R, xhPx) {
    const sL = silhouetteForGlyph(L);
    const sR = silhouetteForGlyph(R);
    if (!sL || !sR) return null;
    /* Register both silhouettes to the baseline before comparing. Each
       glyph is rasterized in its OWN cell — a cap fills a short cell, an
       x-height glyph sits low in a tall one — so a raw row index means
       different baseline-relative heights for the two glyphs. Comparing
       right[y] vs left[y] at equal y was lining an F's arm up against the
       wrong slice of the next letter, reading a real collision as wide
       open (the LaunchSans F+a / r+a weld). baselineYInCell is the baseline
       row in cell (= silhouette) coordinates and the font-wide px scale is
       uniform, so rows measured from the baseline are directly comparable
       once aligned. Fall back to the ink bottom if a glyph has no baseline. */
    const baseL = Math.round(isFinite(L.baselineYInCell) ? L.baselineYInCell : sL.inkY1);
    const baseR = Math.round(isFinite(R.baselineYInCell) ? R.baselineYInCell : sR.inkY1);
    /* height above baseline, px: ink at row r sits (base - r) above it. */
    const aHi = Math.min(baseL - sL.inkY0, baseR - sR.inkY0); // lower of the two tops
    const aLo = Math.max(baseL - sL.inkY1, baseR - sR.inkY1); // higher of the two bottoms
    if (aHi <= aLo) return null;
    const advanceL = L.cellW;
    let weightedSum = 0;
    let weightSum = 0;
    let minGap = Infinity;
    /* body strip = the x-height zone where letters actually connect; an
       ascender or a high dot sits far from a narrow neighbour and would
       otherwise inflate the average into a false "loose" reading (the h+i
       fuse: loose on the full-height avg, already tight in the body). When
       xhPx is given (connect kern) the avg is taken over the body strip only;
       min stays full-height so a collision in ANY zone still floors the pull. */
    const bodyLo = xhPx ? Math.round(0.10 * xhPx) : -Infinity;
    const bodyHi = xhPx ? Math.round(0.92 * xhPx) : Infinity;
    /* the descender zone (below the baseline): where two stacked descender loops
       (gg, gy, gj) crowd and weld. Tracked separately so the kern can hold a real
       CLEARANCE between adjacent loops, not merely a non-overlap. */
    const descHi = xhPx ? Math.round(-0.05 * xhPx) : -Infinity;
    let bodyWeighted = 0;
    let bodyWeight = 0;
    let bodyMin = Infinity;
    let descMin = Infinity;
    for (let a = aLo; a <= aHi; a++) {
      const r = sL.right[baseL - a];
      const l = sR.left[baseR - a];
      if (!isFinite(r) || !isFinite(l)) continue;
      const gap = advanceL + l - r;
      const w = 1 / (1 + Math.max(0, gap) * 0.05);
      weightedSum += gap * w;
      weightSum += w;
      if (a >= bodyLo && a <= bodyHi) { bodyWeighted += gap * w; bodyWeight += w; if (gap < bodyMin) bodyMin = gap; }
      if (a <= descHi && gap < descMin) descMin = gap;
      if (gap < minGap) minGap = gap;
    }
    if (weightSum === 0) return null;
    /* avg drives the perceptual close-up; min is the tightest scanline,
       used downstream as a collision floor so an open lower profile
       (F/P/T arms, P/b bowls) can't average away a protruding band.
       bodyMin is the x-height-strip tightest point — the one that maps to the
       structural-fusion metric, so the body floor can prevent a real x-height
       weld (which the full-height min, dominated by a descender row, misses). */
    const avg = weightedSum / weightSum;
    return { avg, min: minGap, bodyAvg: bodyWeight > 0 ? bodyWeighted / bodyWeight : avg, bodyMin: isFinite(bodyMin) ? bodyMin : minGap, descMin: isFinite(descMin) ? descMin : null };
  }

  function computeTargetGap(glyphs) {
    const sidebearings = [];
    for (const g of glyphs) {
      const sil = silhouetteForGlyph(g);
      if (!sil) continue;
      let maxRight = -Infinity;
      for (let y = sil.inkY0; y <= sil.inkY1; y++) {
        if (sil.right[y] > maxRight) maxRight = sil.right[y];
      }
      if (!isFinite(maxRight)) continue;
      sidebearings.push(g.cellW - maxRight);
    }
    if (sidebearings.length === 0) return 0;
    sidebearings.sort((a, b) => a - b);
    const median = sidebearings[Math.floor(sidebearings.length / 2)];
    return median * 2;
  }

  function buildCandidatePairs(glyphs) {
    const present = new Set(glyphs.map(g => g.char));
    const seen = new Set();
    const pairs = [];
    function add(l, r) {
      if (!present.has(l) || !present.has(r)) return;
      const k = l + '\0' + r;
      if (seen.has(k)) return;
      seen.add(k); pairs.push([l, r]);
    }
    for (const [l, r] of CANDIDATE_BASE_PAIRS) add(l, r);
    const expand = (rightChars, leftChars) => {
      for (const r of rightChars) for (const l of leftChars) add(r, l);
    };
    expand(CLASS_RIGHT.openCap,   CLASS_LEFT.roundCap);
    expand(CLASS_RIGHT.openCap,   CLASS_LEFT.openLow);
    expand(CLASS_RIGHT.openCap,   CLASS_LEFT.roundLow);
    expand(CLASS_RIGHT.diagCap,   CLASS_LEFT.openLow);
    expand(CLASS_RIGHT.diagCap,   CLASS_LEFT.roundLow);
    expand(CLASS_RIGHT.roundCap,  CLASS_LEFT.diagCap);
    expand(CLASS_RIGHT.openLow,   CLASS_LEFT.openLow);
    expand(CLASS_RIGHT.openLow,   CLASS_LEFT.roundLow);
    return pairs;
  }

  /* A .jnNN seam alternate (ADR 0048) is a warped COPY appended after its
     base. Left in the analysis it shadows the base in last-wins char indexing
     and double-weights the gap statistics, so the kern gets fitted to warped
     exits while rendering mostly bases (corpus catch: cc-3 structural nn 167).
     Both analyzers excise them up front; the alternates inherit the base kern
     via expandVariantKern. Variation .cvNN glyphs keep the historical
     behavior their calibration bakes in. */
  function withoutSeamAlts(glyphs) {
    return glyphs.filter(function (g) { return !(g.variantSuffix && g.variantSuffix.indexOf('.jn') === 0); });
  }

  function analyzeAutoKern(glyphsIn, scale, strength) {
    const glyphs = withoutSeamAlts(glyphsIn);
    const byChar = new Map();
    for (const g of glyphs) byChar.set(g.char, g);

    const targetGapPx = computeTargetGap(glyphs);
    if (!isFinite(targetGapPx) || targetGapPx <= 0) return [];


    const pairs = buildCandidatePairs(glyphs);
    const out = [];
    const MIN_VALUE = 4;        /* font units; smaller is invisible */
    const MAX_UNITS = 250;      /* cap any single pair's pull */
    const MAX_PULL_PX = MAX_UNITS / scale;
    for (const [l, r] of pairs) {
      const L = byChar.get(l);
      const R = byChar.get(r);
      if (!L || !R) continue;
      const gap = measurePairGap(L, R);
      if (gap === null) continue;
      const excess = gap.avg - targetGapPx;
      if (excess <= 0) continue;
      /* Apply strength BEFORE the cap so strength > 1 doesn't bypass
         the MAX_UNITS ceiling (bug found in audit). */
      let pullPx = Math.min(excess * strength, MAX_PULL_PX);
      /* Collision guard (2026-06-23, field bug): the pull above is driven
         by the proximity-weighted AVERAGE gap. A glyph that's open below
         but protrudes at one band (F/P/T arms, P/b bowls, r/t/f) inflates
         that average, so the average says there's room while the tightest
         scanline is already snug. Never close the MINIMUM gap past the
         target spacing, or the protrusion welds into the next glyph (the
         "Fi"/"Pa" weld on LaunchSans). min <= avg always, so this only
         ever shrinks a pull, never invents one; tuck pairs with genuine
         room (T+a, T+o) still kern, landing at the target gap. */
      const minSlack = gap.min - targetGapPx;
      if (minSlack < pullPx) pullPx = Math.max(0, minSlack);
      const valueUnits = -Math.round(pullPx * scale);
      if (Math.abs(valueUnits) < MIN_VALUE) continue;
      out.push({ leftChar: l, rightChar: r, value: valueUnits });
    }
    return out;
  }

  /* ----------------------------------------------------------------
   * analyzeConnectKern — kerning for CONNECTED cursive.
   * Unlike analyzeAutoKern (which only TIGHTENS a tight-pair canon to a
   * loose target), connect mode needs every adjacent pair pulled to ONE
   * even gap: close the severs that open after round letters, even the
   * rhythm, and push apart the descender-loop collisions that weld
   * clusters (juggling, foggy, voyage) into blobs. The body-edge placement
   * already sets the advances; this lands a GPOS correction on top so the
   * realized color is uniform.
   *
   *   analyzeConnectKern(glyphs, scale, opts) -> [{leftChar,rightChar,value}]
   *   opts: { collisionFloorPx, deadzonePx, maxUnits, bridgedPlacement }
   *   bridgedPlacement: the caller's placement already joins the lowercase with
   *   even body gaps and DELIBERATE deep connector bridges (the maker's
   *   entry-reach normalization, ADR 0043). Skip the per-pair rhythm evening
   *   AND, for lowercase-lowercase pairs, the collision/body floors — a bridged
   *   pair's full-height min is the connector crossing, not a crash, and the
   *   bodies cannot collide (the placement separates them by construction).
   *   Keeps the descender clearance (loops hang below the placed bodies), every
   *   cap-pair floor (caps do not bridge), and the word-space evening.
   * -------------------------------------------------------------- */
  function analyzeConnectKern(glyphsIn, scale, opts) {
    opts = opts || {};
    const glyphs = withoutSeamAlts(glyphsIn); /* ADR 0048: fit the kern to the BASE outlines */
    const byChar = new Map();
    for (const g of glyphs) byChar.set(g.char, g);
    const LOWER = 'abcdefghijklmnopqrstuvwxyz';
    const UPPER = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

    /* x-height in px (above baseline) anchors the floor/deadzone so the
       thresholds scale with the face. */
    let xhPx = 0;
    const xg = byChar.get('x') || byChar.get('o') || byChar.get('n');
    if (xg) {
      const s = silhouetteForGlyph(xg);
      if (s) {
        const base = Math.round(isFinite(xg.baselineYInCell) ? xg.baselineYInCell : s.inkY1);
        xhPx = Math.max(1, base - s.inkY0);
      }
    }
    const collisionFloorPx = opts.collisionFloorPx != null ? opts.collisionFloorPx : -0.08 * xhPx;
    const deadzonePx = opts.deadzonePx != null ? opts.deadzonePx : 0.04 * xhPx;
    const MAX_UNITS = opts.maxUnits || 650;
    /* adjacent descender loops must hold a positive CLEARANCE, not merely avoid
       overlap, or gg/gy/gj read as a congested knot. */
    const descClearPx = opts.descClearPx != null ? opts.descClearPx : 0.14 * xhPx;
    const DESC = 'gjpqyz';
    /* x-height BODY overlap floor: the tightest point in the connecting zone may
       slightly overlap (strokes cross) but must not WELD or PINCH — this is the
       floor the structural-fusion metric measures, which the full-height min
       misses. Held near the connected median so the tail stops crashing inward. */
    const bodyFloorPx = opts.bodyFloorPx != null ? opts.bodyFloorPx : -0.06 * xhPx;

    /* Measure every present pair. Lower-lower is the connecting body of the
       text; cap-lower closes the cap orphan. */
    const measured = [];
    const measure = (l, r) => {
      const L = byChar.get(l), R = byChar.get(r);
      if (!L || !R) return;
      const g = measurePairGap(L, R, xhPx);
      if (g) measured.push({ l, r, bodyAvg: g.bodyAvg, min: g.min, bodyMin: g.bodyMin, descMin: g.descMin, ll: LOWER.indexOf(l) >= 0 && LOWER.indexOf(r) >= 0 });
    };
    for (const l of LOWER) for (const r of LOWER) measure(l, r);
    for (const l of UPPER) for (const r of LOWER) measure(l, r);
    if (!measured.length) return [];

    /* Target = median BODY gap of the lower-lower pairs: the face's own even
       rhythm at the connecting (x-height) zone, robust to the loose severs and
       tight collisions in the set, and not skewed by ascenders/dots. */
    const llAvgs = measured.filter((m) => m.ll).map((m) => m.bodyAvg).sort((a, b) => a - b);
    if (!llAvgs.length) return [];
    /* Target the face's own median body gap, but CAP it at a tight connected
       ceiling: a loose hand (short connecting strokes) whose median is wide would
       otherwise even to a loose-but-uniform color that still reads disconnected.
       Tightening to the ceiling pulls those faces into a real connected band. */
    const median = llAvgs[Math.floor(llAvgs.length / 2)];
    const targetGap = Math.min(median, 0.08 * xhPx);

    const out = [];
    for (const m of measured) {
      /* even the BODY gap toward target (so ascenders/dots don't make a tight
         pair read loose and get over-tightened into a fuse) ... bridgedPlacement
         starts from zero so only the protections below emit. */
      const bridged = !!opts.bridgedPlacement;
      let deltaPx = bridged ? 0 : targetGap - m.bodyAvg;
      /* A swash/display CAP (Q-tail, etc.) leaves an orphan gap because the
         flourish blocks the lowercase and the normal floor won't let the letter
         tuck in. For cap->lowercase pairs, relax the floors so the lowercase
         tucks UNDER the cap flourish (the decorative connection), pulling the cap
         into its word instead of stranding it. */
      const isCap = UPPER.indexOf(m.l) >= 0;
      /* For a cap, relax only the FULL-height collision floor so the lowercase can
         tuck under the cap's thin swash/tail (which lives outside the x-height
         body). Keep the x-height BODY floor at normal so the lowercase never welds
         into the cap's body (the Gh/Ke weld when both were relaxed). */
      const cFloor = isCap ? -0.30 * xhPx : collisionFloorPx;
      const bFloor = bodyFloorPx;
      /* ... then guarantee the tightest scanline (ANY zone: body fuse, descender
         loop, cap weld) never sits below the collision floor. only ever ADDS
         space, never invents a tighten. Skipped for a bridged lowercase pair:
         its min IS the deliberate connector crossing (bodies are separated by
         the placement itself), so the floor would shove the join apart. */
      const skipFloors = bridged && m.ll;
      if (!skipFloors) {
        const minAfter = m.min + deltaPx;
        if (minAfter < cFloor) deltaPx += cFloor - minAfter;
        /* x-height body must not weld or pinch (the structural-fusion zone). */
        if (m.bodyMin != null) {
          const bodyAfter = m.bodyMin + deltaPx;
          if (bodyAfter < bFloor) deltaPx += bFloor - bodyAfter;
        }
      }
      /* two stacked descender loops (gg, gy, gj, yg ...) must hold a positive
         clearance so the cluster reads as separate strokes, not a knot. */
      if (DESC.indexOf(m.l) >= 0 && DESC.indexOf(m.r) >= 0 && m.descMin != null) {
        const descAfter = m.descMin + deltaPx;
        if (descAfter < descClearPx) deltaPx += descClearPx - descAfter;
      }
      if (Math.abs(deltaPx) <= deadzonePx) continue;
      let valueUnits = Math.round(deltaPx * scale);
      if (valueUnits > MAX_UNITS) valueUnits = MAX_UNITS;
      if (valueUnits < -MAX_UNITS) valueUnits = -MAX_UNITS;
      if (Math.abs(valueUnits) < 4) continue;
      out.push({ leftChar: m.l, rightChar: m.r, value: valueUnits });
    }

    /* Word-space evening: the visible word gap is (last letter's trailing) +
       space advance + (next letter's leading), and those bearings vary per
       letter — so "fox jumps" yawns while "lazy dog" jams. Normalize each
       letter's trailing (before a space) and leading (after a space) to one
       target via letter-space / space-letter kerns, making every word gap equal
       regardless of which letters bracket it. The space glyph is synthesised by
       the builder AFTER this analyzer runs, so it is not in byChar here — but the
       pairs reference ' ' by char and buildGposKern resolves it from the final
       font's index, so we emit them unconditionally. */
    {
      const inkOf = (g) => {
        const s = silhouetteForGlyph(g);
        if (!s) return null;
        let lo = Infinity, hi = -Infinity;
        for (let y = s.inkY0; y <= s.inkY1; y++) {
          if (isFinite(s.left[y]) && s.left[y] < lo) lo = s.left[y];
          if (isFinite(s.right[y]) && s.right[y] > hi) hi = s.right[y];
        }
        return isFinite(lo) ? { trail: g.cellW - hi, lead: lo } : null;
      };
      const info = new Map();
      const trails = [], leads = [];
      for (const ch of LOWER + UPPER) {
        const g = byChar.get(ch);
        if (!g) continue;
        const i = inkOf(g);
        if (i) { info.set(ch, i); trails.push(i.trail); leads.push(i.lead); }
      }
      if (trails.length) {
        trails.sort((a, b) => a - b); leads.sort((a, b) => a - b);
        const tgtTrail = trails[Math.floor(trails.length / 2)];
        const tgtLead = leads[Math.floor(leads.length / 2)];
        const clamp = (v) => Math.max(-MAX_UNITS, Math.min(MAX_UNITS, v));
        for (const [ch, i] of info) {
          const kt = Math.round((tgtTrail - i.trail) * scale);
          if (Math.abs(kt) >= 4) out.push({ leftChar: ch, rightChar: ' ', value: clamp(kt) });
          const kl = Math.round((tgtLead - i.lead) * scale);
          if (Math.abs(kl) >= 4) out.push({ leftChar: ' ', rightChar: ch, value: clamp(kl) });
        }
      }
    }
    return out;
  }

  global.analyzeAutoKern = analyzeAutoKern;
  global.analyzeConnectKern = analyzeConnectKern;
})(typeof self !== 'undefined' ? self : this);
