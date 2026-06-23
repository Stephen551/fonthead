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
    let canvas;
    try {
      canvas = new OffscreenCanvas(w + pad * 2, h);
    } catch (e) {
      return null;
    }
    const ctx = canvas.getContext('2d');
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

    const pw = w + pad * 2;
    const img = ctx.getImageData(0, 0, pw, h);
    const data = img.data;
    const left = new Float64Array(h);
    const right = new Float64Array(h);
    let inkY0 = h, inkY1 = 0;
    for (let y = 0; y < h; y++) {
      left[y] = Infinity;
      right[y] = -Infinity;
      let hasInk = false;
      const rowOff = y * pw * 4 + 3;
      for (let x = 0; x < pw; x++) {
        if (data[rowOff + x * 4] > 128) {
          const ax = x - pad; /* back to advance coordinates */
          if (ax < left[y]) left[y] = ax;
          if (ax > right[y]) right[y] = ax;
          hasInk = true;
        }
      }
      if (hasInk) {
        if (y < inkY0) inkY0 = y;
        if (y > inkY1) inkY1 = y;
      }
    }
    if (inkY1 < inkY0) { inkY0 = 0; inkY1 = h - 1; }
    const sil = { left, right, w, h, inkY0, inkY1 };
    g._silhouette = sil;
    return sil;
  }

  function measurePairGap(L, R) {
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
    for (let a = aLo; a <= aHi; a++) {
      const r = sL.right[baseL - a];
      const l = sR.left[baseR - a];
      if (!isFinite(r) || !isFinite(l)) continue;
      const gap = advanceL + l - r;
      const w = 1 / (1 + Math.max(0, gap) * 0.05);
      weightedSum += gap * w;
      weightSum += w;
      if (gap < minGap) minGap = gap;
    }
    if (weightSum === 0) return null;
    /* avg drives the perceptual close-up; min is the tightest scanline,
       used downstream as a collision floor so an open lower profile
       (F/P/T arms, P/b bowls) can't average away a protruding band. */
    return { avg: weightedSum / weightSum, min: minGap };
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

  function analyzeAutoKern(glyphs, scale, strength) {
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

  global.analyzeAutoKern = analyzeAutoKern;
})(typeof self !== 'undefined' ? self : this);
