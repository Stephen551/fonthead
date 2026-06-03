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
    let canvas;
    try {
      canvas = new OffscreenCanvas(w, h);
    } catch (e) {
      return null;
    }
    const ctx = canvas.getContext('2d');
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

    const img = ctx.getImageData(0, 0, w, h);
    const data = img.data;
    const left = new Float64Array(h);
    const right = new Float64Array(h);
    let inkY0 = h, inkY1 = 0;
    for (let y = 0; y < h; y++) {
      left[y] = Infinity;
      right[y] = -Infinity;
      let hasInk = false;
      const rowOff = y * w * 4 + 3;
      for (let x = 0; x < w; x++) {
        if (data[rowOff + x * 4] > 128) {
          if (x < left[y]) left[y] = x;
          if (x > right[y]) right[y] = x;
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
    const y0 = Math.max(sL.inkY0, sR.inkY0);
    const y1 = Math.min(sL.inkY1, sR.inkY1);
    if (y1 <= y0) return null;
    const advanceL = L.cellW;
    let weightedSum = 0;
    let weightSum = 0;
    for (let y = y0; y <= y1; y++) {
      const r = sL.right[y];
      const l = sR.left[y];
      if (!isFinite(r) || !isFinite(l)) continue;
      const gap = advanceL + l - r;
      const w = 1 / (1 + Math.max(0, gap) * 0.05);
      weightedSum += gap * w;
      weightSum += w;
    }
    if (weightSum === 0) return null;
    return weightedSum / weightSum;
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
      const weightedGap = measurePairGap(L, R);
      if (weightedGap === null) continue;
      const excess = weightedGap - targetGapPx;
      if (excess <= 0) continue;
      /* Apply strength BEFORE the cap so strength > 1 doesn't bypass
         the MAX_UNITS ceiling (bug found in audit). */
      const pullPx = Math.min(excess * strength, MAX_PULL_PX);
      const valueUnits = -Math.round(pullPx * scale);
      if (Math.abs(valueUnits) < MIN_VALUE) continue;
      out.push({ leftChar: l, rightChar: r, value: valueUnits });
    }
    return out;
  }

  global.analyzeAutoKern = analyzeAutoKern;
})(typeof self !== 'undefined' ? self : this);
