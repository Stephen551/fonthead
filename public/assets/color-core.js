/* ============================================================
 * color-core.js  (palette detection + per-glyph colour separation)
 * ------------------------------------------------------------
 * The one genuinely-new piece of the colour-font builder
 * (color-font-builder-build-spec section 5). Generalises the
 * tracer's 2-class colour split to N colours:
 *
 *   detectPalette()  border-flood background -> k-means in CIELAB
 *                    on sampled non-bg pixels -> K cluster centres,
 *                    counted + averaged over the full image, sorted
 *                    largest-area-first (index 0 = back layer).
 *   separateGlyph()  per cell: assign each non-bg pixel to its
 *                    nearest palette colour, build one binary mask
 *                    per colour (dilated ~1px so adjacent layers
 *                    overlap and hairline seams disappear), plus a
 *                    union mask for the fallback base outline.
 *
 * Masks are emitted as RGBA (ink = black, ground = white) so they
 * feed straight into TracerCore.traceCellBitmap / Potrace.
 *
 * No dependencies. Exposes window.ColorCore.
 * ============================================================ */
(function (global) {
  'use strict';

  // --- sRGB -> CIELAB (D65) ---------------------------------------------
  // Cluster in Lab, not raw RGB, so perceptually-similar colours group.
  function srgbToLinear(c) {
    c /= 255;
    return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  }
  function rgbToLab(r, g, b) {
    const R = srgbToLinear(r), G = srgbToLinear(g), B = srgbToLinear(b);
    // linear RGB -> XYZ (D65)
    let x = (R * 0.4124564 + G * 0.3575761 + B * 0.1804375) / 0.95047;
    let y = (R * 0.2126729 + G * 0.7151522 + B * 0.0721750) / 1.00000;
    let z = (R * 0.0193339 + G * 0.1191920 + B * 0.9503041) / 1.08883;
    const f = t => t > 0.008856 ? Math.cbrt(t) : (7.787 * t + 16 / 116);
    const fx = f(x), fy = f(y), fz = f(z);
    return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
  }
  function labDist2(a, b) {
    const dl = a[0] - b[0], da = a[1] - b[1], db = a[2] - b[2];
    return dl * dl + da * da + db * db;
  }
  function chroma(lab) { return Math.sqrt(lab[1] * lab[1] + lab[2] * lab[2]); }

  // --- background detection (border flood) ------------------------------
  // The paper colour dominates the sheet border. Histogram the border
  // pixels (coarsely quantised), take the modal bucket, average the real
  // pixels in it -> a clean background colour even with paper texture.
  function detectBackground(data, w, h) {
    const buckets = new Map();
    const add = (i) => {
      const r = data[i], g = data[i + 1], b = data[i + 2];
      const key = (r >> 4) << 8 | (g >> 4) << 4 | (b >> 4);
      let e = buckets.get(key);
      if (!e) { e = { n: 0, r: 0, g: 0, b: 0 }; buckets.set(key, e); }
      e.n++; e.r += r; e.g += g; e.b += b;
    };
    for (let x = 0; x < w; x++) { add((x) * 4); add(((h - 1) * w + x) * 4); }
    for (let y = 0; y < h; y++) { add((y * w) * 4); add((y * w + (w - 1)) * 4); }
    let best = null;
    for (const e of buckets.values()) if (!best || e.n > best.n) best = e;
    if (!best) return { r: 255, g: 255, b: 255 };
    return { r: Math.round(best.r / best.n), g: Math.round(best.g / best.n), b: Math.round(best.b / best.n) };
  }

  // --- k-means in Lab on a sampled subset -------------------------------
  function kmeans(samples, K, iters) {
    const n = samples.length;
    if (n === 0) return [];
    K = Math.max(1, Math.min(K, n));
    // k-means++ style seeding for stable, spread centres (deterministic:
    // first seed = sample 0, then farthest-point seeding).
    const centers = [samples[0].slice()];
    while (centers.length < K) {
      let far = null, farD = -1;
      for (let i = 0; i < n; i++) {
        let dmin = Infinity;
        for (const c of centers) { const d = labDist2(samples[i], c); if (d < dmin) dmin = d; }
        if (dmin > farD) { farD = dmin; far = samples[i]; }
      }
      if (!far) break;
      centers.push(far.slice());
    }
    const assign = new Int32Array(n);
    for (let it = 0; it < iters; it++) {
      let moved = false;
      for (let i = 0; i < n; i++) {
        let best = 0, bd = Infinity;
        for (let c = 0; c < centers.length; c++) { const d = labDist2(samples[i], centers[c]); if (d < bd) { bd = d; best = c; } }
        if (assign[i] !== best) { assign[i] = best; moved = true; }
      }
      const sum = centers.map(() => [0, 0, 0, 0]);
      for (let i = 0; i < n; i++) { const a = assign[i], s = sum[a]; s[0] += samples[i][0]; s[1] += samples[i][1]; s[2] += samples[i][2]; s[3]++; }
      for (let c = 0; c < centers.length; c++) { if (sum[c][3] > 0) { centers[c] = [sum[c][0] / sum[c][3], sum[c][1] / sum[c][3], sum[c][2] / sum[c][3]]; } }
      if (!moved && it > 0) break;
    }
    return centers;
  }

  /* detectPalette(data, w, h, K, opts) ->
   *   { colors: [{ r, g, b, lab, count }], bg: {r,g,b}, bgDist, mono }
   * colors sorted by count descending (index 0 = largest area = back). */
  function detectPalette(data, w, h, K, opts) {
    opts = opts || {};
    const bgDist = opts.bgDist || 20;
    const bgD2 = bgDist * bgDist;
    const bg = detectBackground(data, w, h);
    const bgLab = rgbToLab(bg.r, bg.g, bg.b);

    // Sample non-background pixels for the clustering pass (cap for speed).
    const total = w * h;
    const CAP = 6000;
    const stride = Math.max(1, Math.floor(total / CAP));
    const samples = [];
    for (let p = 0; p < total; p += stride) {
      const i = p * 4;
      if (data[i + 3] < 128) continue;
      const lab = rgbToLab(data[i], data[i + 1], data[i + 2]);
      if (labDist2(lab, bgLab) <= bgD2) continue;        // background
      if (chroma(lab) < 6 && labDist2(lab, bgLab) < bgD2 * 4) continue; // halo gate
      samples.push(lab);
    }
    if (samples.length === 0) {
      return { colors: [], bg, bgDist, mono: true };
    }

    let centers = kmeans(samples, K, 16);

    // Merge centres that ended up perceptually identical (a monochrome or
    // near-monochrome sheet collapses K clusters into one) — spec section 9.
    const MERGE2 = 100; // ~10 Lab units
    const merged = [];
    for (const c of centers) {
      const near = merged.find(m => labDist2(m, c) < MERGE2);
      if (!near) merged.push(c.slice());
    }
    centers = merged;

    // Final pass over ALL non-bg pixels: true counts + true RGB averages.
    const acc = centers.map(() => ({ n: 0, r: 0, g: 0, b: 0 }));
    for (let p = 0; p < total; p++) {
      const i = p * 4;
      if (data[i + 3] < 128) continue;
      const lab = rgbToLab(data[i], data[i + 1], data[i + 2]);
      if (labDist2(lab, bgLab) <= bgD2) continue;
      if (chroma(lab) < 6 && labDist2(lab, bgLab) < bgD2 * 4) continue;
      let best = 0, bd = Infinity;
      for (let c = 0; c < centers.length; c++) { const d = labDist2(lab, centers[c]); if (d < bd) { bd = d; best = c; } }
      const a = acc[best]; a.n++; a.r += data[i]; a.g += data[i + 1]; a.b += data[i + 2];
    }

    let colors = acc
      .map((a, idx) => a.n === 0 ? null : {
        r: Math.round(a.r / a.n), g: Math.round(a.g / a.n), b: Math.round(a.b / a.n),
        count: a.n, lab: centers[idx],
      })
      .filter(Boolean)
      .sort((x, y) => y.count - x.count);

    // Recompute lab from the averaged RGB so it matches the swatch shown.
    colors.forEach(c => { c.lab = rgbToLab(c.r, c.g, c.b); });

    return { colors, bg, bgDist, mono: colors.length <= 1 };
  }

  /* detectShadowMask(data, w, h, palette) -> Uint8 (1 = drop-shadow pixel) | null
   *
   * A drop shadow is a dark, low-chroma OFFSET DUPLICATE of the letters: the
   * same shapes, copied a few pixels down-and-right, sitting behind the ink. The
   * offset is what tells a shadow apart from a font that legitimately uses a dark
   * colour (e.g. charcoal letters): a real dark letter sits at its OWN position,
   * not as a shifted copy of the bright ink.
   *
   * Method: pick the darkest low-chroma palette colour as the shadow candidate,
   * split non-bg pixels into that (dark) vs the rest (bright), then search small
   * down-right offsets for the shift that makes the bright mask land on the dark
   * mask. If one offset explains most of the dark pixels, it's a shadow -> return
   * its full-res mask to strip. Otherwise null (the dark colour is real ink). */
  function detectShadowMask(data, w, h, palette, opts) {
    opts = opts || {};
    const dbg = (frac, why) => opts.debug ? { mask: null, frac: frac, why: why } : null;
    const colors = (palette && palette.colors) || [];
    if (colors.length < 2) return dbg(0, 'need>=2 colors');            // need a shadow AND ink
    const bg = palette.bg;
    let candIdx = -1, candL = Infinity;
    colors.forEach((c, idx) => {
      const L = c.lab[0], ch = chroma(c.lab);
      if (L < 58 && ch < 26 && L < candL) { candL = L; candIdx = idx; }
    });
    if (candIdx < 0) return dbg(0, 'no dark low-chroma colour');                   // no dark low-chroma colour

    const bgLab = rgbToLab(bg.r, bg.g, bg.b), bgD2 = (palette.bgDist || 20) * (palette.bgDist || 20);
    const dark = new Uint8Array(w * h), bright = new Uint8Array(w * h);
    let darkN = 0, brightN = 0;
    for (let p = 0; p < w * h; p++) {
      const i = p * 4;
      if (data[i + 3] < 128) continue;
      const lab = rgbToLab(data[i], data[i + 1], data[i + 2]);
      if (labDist2(lab, bgLab) <= bgD2) continue;
      let best = 0, bd = Infinity;
      for (let c = 0; c < colors.length; c++) { const d = labDist2(lab, colors[c].lab); if (d < bd) { bd = d; best = c; } }
      if (best === candIdx) { dark[p] = 1; darkN++; } else { bright[p] = 1; brightN++; }
    }
    if (darkN < 50 || brightN < 50) return dbg(0, 'too few dark/bright px');

    // Component-pairing test. Flood-fill the union (bright|dark) into connected
    // components and, per component, take the offset vector from the bright
    // centroid to the dark centroid. A drop shadow fuses each letter to its own
    // copy in ONE component, and every letter is shadowed the SAME way — so the
    // offsets share a CONSISTENT direction and a SMALL magnitude (a fraction of
    // the glyph width). Real dark ink fails this: alternating dark letters form
    // pure-dark components (no bright pair); a dark OUTLINE is concentric (offset
    // ~0, below minMag); and two different touching letters pair with an offset
    // ~a full glyph width (above maxMag). The shared-direction + bounded-magnitude
    // test catches a shadow in ANY direction (down-right, down-left, straight
    // down) while staying clear of those false positives.
    const seen = new Uint8Array(w * h), stack = new Int32Array(w * h);
    const comps = [];
    for (let s = 0; s < w * h; s++) {
      if (seen[s] || (!dark[s] && !bright[s])) continue;
      let sp = 0; stack[sp++] = s; seen[s] = 1;
      let bx = 0, by = 0, bc = 0, dx = 0, dy = 0, dc = 0, cx0 = (s % w), cx1 = (s % w);
      while (sp) {
        const p = stack[--sp], y = (p / w) | 0, x = p - y * w;
        if (bright[p]) { bx += x; by += y; bc++; } if (dark[p]) { dx += x; dy += y; dc++; }
        if (x < cx0) cx0 = x; if (x > cx1) cx1 = x;
        for (let ny = y - 1; ny <= y + 1; ny++) {
          if (ny < 0 || ny >= h) continue;
          for (let nx = x - 1; nx <= x + 1; nx++) {
            if (nx < 0 || nx >= w) continue;
            const q = ny * w + nx;
            if (!seen[q] && (dark[q] || bright[q])) { seen[q] = 1; stack[sp++] = q; }
          }
        }
      }
      if (bc >= 20 && dc >= 20) comps.push({ ox: dx / dc - bx / bc, oy: dy / dc - by / bc, dc: dc, wd: cx1 - cx0 + 1 });
    }
    // Offsets that are shadow-scaled: at least minMag (excludes concentric
    // outlines) and at most 0.4x the component width (excludes whole-letter gaps
    // between two different touching letters). Find their dominant direction...
    const minMag = Math.max(2, 0.006 * Math.max(w, h));
    let sumX = 0, sumY = 0, wsum = 0;
    for (const c of comps) { const m = Math.hypot(c.ox, c.oy); if (m >= minMag && m <= 0.4 * c.wd) { sumX += c.ox * c.dc; sumY += c.oy * c.dc; wsum += c.dc; } }
    let shadowDark = 0, paired = 0;
    if (wsum > 0) {
      const dirX = sumX / wsum, dirY = sumY / wsum, dirM = Math.hypot(dirX, dirY) || 1;
      for (const c of comps) {
        const m = Math.hypot(c.ox, c.oy); if (m < minMag || m > 0.4 * c.wd) continue;
        if ((c.ox * dirX + c.oy * dirY) / (m * dirM) >= 0.7) { paired++; shadowDark += c.dc; } // within ~45° of dominant
      }
    }
    const sScore = darkN ? shadowDark / darkN : 0;
    if (opts.debug) return { mask: (sScore >= SHADOW_SCORE && paired >= 3) ? dark : null, frac: sScore, paired: paired, darkN: darkN, brightN: brightN, why: 'measured' };
    if (sScore < SHADOW_SCORE || paired < 3) return null;   // not an offset-duplicate shadow
    return dark;
  }
  const SHADOW_SCORE = 0.5;

  // --- 1px dilation of an ink mask (Uint8 0/1, ink = 1) -----------------
  function dilate1(mask, w, h) {
    const out = new Uint8Array(mask.length);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const p = y * w + x;
        if (mask[p]) { out[p] = 1; continue; }
        let hit = 0;
        for (let dy = -1; dy <= 1 && !hit; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const nx = x + dx, ny = y + dy;
            if (nx < 0 || nx >= w || ny < 0 || ny >= h) continue;
            if (mask[ny * w + nx]) { hit = 1; break; }
          }
        }
        out[p] = hit;
      }
    }
    return out;
  }

  // Erode an ink mask (Uint8 0/1) by `iters` px — the dual of dilate1. A pixel
  // survives only if it and all 8 neighbours are ink (image edge counts as
  // ground, so the boundary erodes inward). Used to build the gradient-fill
  // INSET for the outline mode: erode the silhouette, fill the inset with the
  // gradient, and the un-eroded base shows around it as the outline ring.
  function erode1(mask, w, h) {
    const out = new Uint8Array(mask.length);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const p = y * w + x;
      if (!mask[p]) { out[p] = 0; continue; }
      let keep = 1;
      for (let dy = -1; dy <= 1 && keep; dy++) for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || nx >= w || ny < 0 || ny >= h) { keep = 0; break; }
        if (!mask[ny * w + nx]) { keep = 0; break; }
      }
      out[p] = keep;
    }
    return out;
  }
  function erode(mask, w, h, iters) { let m = mask; for (let i = 0; i < (iters | 0); i++) m = erode1(m, w, h); return m; }

  // Uint8 0/1 ink mask -> RGBA (ink = black, ground = white) for Potrace.
  function toRGBA(mask, w, h) {
    const out = new Uint8ClampedArray(w * h * 4);
    for (let p = 0; p < w * h; p++) {
      const v = mask[p] ? 0 : 255, i = p * 4;
      out[i] = out[i + 1] = out[i + 2] = v; out[i + 3] = 255;
    }
    return out;
  }

  /* bodyBoundsX(mask, w, h) -> { minX, maxX }
   * Horizontal extent of the letter's main connected blob (the body plus every
   * flame physically attached to it). A flood fill finds all components and
   * returns the x-range of the LARGEST — so disconnected specks (drop-shadow
   * bits, stray slicing fragments) that would otherwise blow out a letter's
   * advance are dropped, while the whole real letter is kept intact (no risk of
   * clipping a thin stroke). This is the safe spacing input: same as the full
   * ink bbox on clean glyphs, tighter only when junk is floating nearby.
   * NOTE: an earlier per-column-ink-threshold version was tried and reverted —
   * it found inconsistent "body" widths per letter and made spacing WORSE. */
  /* keepLargeComponents(mask, w, h, opts) -> Uint8 keep-mask (0/1)
   * Flood-fills the ink, then keeps every component whose area is at least
   * max(absMin, frac * largest-component-area). Drops tiny disconnected
   * crumbs (noise, slicing fragments, disconnected shadow bits) while keeping
   * the letter AND its real detached parts (i/j dots, ; : etc.) — those are a
   * solid fraction of the body, crumbs are not. */
  function keepLargeComponents(mask, w, h, opts) {
    opts = opts || {};
    const frac = opts.frac != null ? opts.frac : 0.03;
    const absMin = opts.absMin != null ? opts.absMin : 12;
    const N = w * h, lab = new Int32Array(N).fill(-1), area = [], stack = [];
    let nl = 0;
    for (let s = 0; s < N; s++) {
      if (!mask[s] || lab[s] >= 0) continue;
      const id = nl++; lab[s] = id; stack.length = 0; stack.push(s); let size = 0;
      while (stack.length) {
        const p = stack.pop(); size++;
        const x = p % w, y = (p / w) | 0;
        if (x > 0 && mask[p - 1] && lab[p - 1] < 0) { lab[p - 1] = id; stack.push(p - 1); }
        if (x < w - 1 && mask[p + 1] && lab[p + 1] < 0) { lab[p + 1] = id; stack.push(p + 1); }
        if (y > 0 && mask[p - w] && lab[p - w] < 0) { lab[p - w] = id; stack.push(p - w); }
        if (y < h - 1 && mask[p + w] && lab[p + w] < 0) { lab[p + w] = id; stack.push(p + w); }
      }
      area[id] = size;
    }
    let maxA = 0; for (const a of area) if (a > maxA) maxA = a;
    const thr = Math.max(absMin, maxA * frac);
    const keep = new Uint8Array(N);
    for (let p = 0; p < N; p++) if (mask[p] && area[lab[p]] >= thr) keep[p] = 1;
    return keep;
  }

  function bodyBoundsX(mask, w, h) {
    const N = w * h, seen = new Uint8Array(N), stack = [], comps = [];
    for (let s = 0; s < N; s++) {
      if (!mask[s] || seen[s]) continue;
      seen[s] = 1; stack.length = 0; stack.push(s);
      let size = 0, minX = w, maxX = -1;
      while (stack.length) {
        const p = stack.pop(); size++;
        const x = p % w, y = (p / w) | 0;
        if (x < minX) minX = x; if (x > maxX) maxX = x;
        if (x > 0 && mask[p - 1] && !seen[p - 1]) { seen[p - 1] = 1; stack.push(p - 1); }
        if (x < w - 1 && mask[p + 1] && !seen[p + 1]) { seen[p + 1] = 1; stack.push(p + 1); }
        if (y > 0 && mask[p - w] && !seen[p - w]) { seen[p - w] = 1; stack.push(p - w); }
        if (y < h - 1 && mask[p + w] && !seen[p + w]) { seen[p + w] = 1; stack.push(p + w); }
      }
      comps.push({ size, minX, maxX: maxX + 1 });
    }
    if (!comps.length) return { minX: 0, maxX: w };
    // Start from the largest component (the letter body), then merge in any other
    // component whose x-range OVERLAPS it. That folds in vertically-stacked parts
    // a bubble/heavy face splits off — a g/j/y descender, an i/j dot, a tail the
    // gloss highlight detached — which belong in the advance, while still dropping
    // a neighbour-bleed fragment that sits BESIDE the body (no x-overlap). Without
    // this, a detached descender is excluded and the glyph gets a negative/lopsided
    // side bearing and overlaps its neighbours.
    let big = comps[0]; for (const c of comps) if (c.size > big.size) big = c;
    let minX = big.minX, maxX = big.maxX, changed = true;
    while (changed) {
      changed = false;
      for (const c of comps) {
        if (c.merged) continue;
        if (c === big || (c.maxX > minX && c.minX < maxX)) {
          if (c.minX < minX) { minX = c.minX; changed = true; }
          if (c.maxX > maxX) { maxX = c.maxX; changed = true; }
          c.merged = true;
        }
      }
    }
    return { minX, maxX };
  }

  /* Glyphs that legitimately split into more than one ink blob: dotted letters
   * and stacked punctuation. The stray-island cull below is SKIPPED for these so
   * an i/j dot, the two marks of a colon, the dot over a "!" etc. are never
   * mistaken for neighbour-row bleed. Everything else is normally one connected
   * shape, so a second disconnected blob there is junk. */
  const MULTI_PART = new Set(['i', 'j', '!', '?', ':', ';', '"', '=', '%']);

  /* separateGlyph(data, w, h, palette, char) ->
   *   { totalInk, union, layers: [{ paletteIndex, mask }], strayDropped }
   * union + each layer mask are RGBA (ink = black). Each non-bg pixel is
   * assigned to its nearest palette colour; a colour with no ink in this
   * glyph emits no layer (a 2-colour glyph on a 3-colour sheet -> 2 layers,
   * no empties). Per-colour masks are dilated 1px so back-to-front
   * compositing leaves no hairline seam. The union is the tight (un-dilated)
   * outline of all ink -> the cmap-mapped fallback base glyph.
   * `char` (optional) enables the single-shape stray-island cull. */
  function separateGlyph(data, w, h, palette, char) {
    const bg = palette.bg || { r: 255, g: 255, b: 255 };
    const bgLab = rgbToLab(bg.r, bg.g, bg.b);
    const bgD2 = (palette.bgDist || 20) * (palette.bgDist || 20);
    const labs = palette.colors.map(c => c.lab || rgbToLab(c.r, c.g, c.b));
    const K = labs.length;
    const N = w * h;

    const union = new Uint8Array(N);
    const perColor = [];
    for (let k = 0; k < K; k++) perColor.push(new Uint8Array(N));
    const counts = new Int32Array(K);
    let totalInk = 0;

    for (let p = 0; p < N; p++) {
      const i = p * 4;
      if (data[i + 3] < 128) continue;
      const lab = rgbToLab(data[i], data[i + 1], data[i + 2]);
      if (labDist2(lab, bgLab) <= bgD2) continue;                       // background
      if (chroma(lab) < 6 && labDist2(lab, bgLab) < bgD2 * 4) continue; // halo gate
      let best = 0, bd = Infinity;
      for (let k = 0; k < K; k++) { const d = labDist2(lab, labs[k]); if (d < bd) { bd = d; best = k; } }
      // Excluded colour (a drop shadow, stray tint, etc. the user toggled off):
      // treat as background — out of the silhouette, out of every layer.
      if (palette.colors[best] && palette.colors[best].ignore) continue;
      union[p] = 1; totalInk++;
      perColor[best][p] = 1; counts[best]++;
    }

    // Despeckle: drop tiny disconnected components (noise, slicing crumbs,
    // disconnected drop-shadow bits) from the silhouette AND the colour layers,
    // keeping every component that's a real share of the largest — so i/j dots
    // and punctuation survive. Cleans the trace without touching the letter.
    const keep = keepLargeComponents(union, w, h);
    for (let p = 0; p < N; p++) {
      if (!union[p] || keep[p]) continue;
      union[p] = 0; totalInk--;
      for (let k = 0; k < K; k++) if (perColor[k][p]) { perColor[k][p] = 0; counts[k]--; }
    }

    // Stray-island cull. keepLargeComponents above keeps any blob that's a real
    // fraction of the body (so i/j dots and punctuation survive), but a piece of
    // a neighbouring row caught by a slightly tall row band is a real fraction
    // too, and it traces as a phantom island floating off the letter (the classic
    // case: the 9's cell grabbing a descender tail from the row above). For a
    // glyph that is normally a single connected shape, drop a clearly-minor
    // disconnected blob (< half the body). Skipped for MULTI_PART glyphs, and it
    // never fires when the glyph split into two big halves — that is a mis-slice
    // to flag, not bleed to silently delete.
    let strayDropped = false;
    if (char && !MULTI_PART.has(char)) {
      const lab = new Int32Array(N).fill(-1), area = [], st = [];
      let nl = 0;
      for (let s = 0; s < N; s++) {
        if (!union[s] || lab[s] >= 0) continue;
        const id = nl++; lab[s] = id; st.length = 0; st.push(s); let sz = 0;
        while (st.length) {
          const p = st.pop(); sz++;
          const x = p % w, y = (p / w) | 0;
          if (x > 0 && union[p - 1] && lab[p - 1] < 0) { lab[p - 1] = id; st.push(p - 1); }
          if (x < w - 1 && union[p + 1] && lab[p + 1] < 0) { lab[p + 1] = id; st.push(p + 1); }
          if (y > 0 && union[p - w] && lab[p - w] < 0) { lab[p - w] = id; st.push(p - w); }
          if (y < h - 1 && union[p + w] && lab[p + w] < 0) { lab[p + w] = id; st.push(p + w); }
        }
        area[id] = sz;
      }
      if (nl > 1) {
        let big = 0, bigA = -1; for (let id = 0; id < nl; id++) if (area[id] > bigA) { bigA = area[id]; big = id; }
        for (let p = 0; p < N; p++) {
          if (!union[p]) continue;
          const id = lab[p];
          if (id !== big && area[id] < 0.5 * bigA) {
            union[p] = 0; totalInk--; strayDropped = true;
            for (let k = 0; k < K; k++) if (perColor[k][p]) { perColor[k][p] = 0; counts[k]--; }
          }
        }
      }
    }

    const layers = [];
    for (let k = 0; k < K; k++) {
      if (counts[k] === 0) continue;                 // skip colours with no ink here
      const dil = dilate1(perColor[k], w, h);
      layers.push({ paletteIndex: k, mask: toRGBA(dil, w, h) });
    }

    // Robust horizontal BODY extent for spacing. The full ink bbox includes
    // thin flame wisps and shadow specks that flick out sideways and inflate a
    // letter's width unevenly. A column only counts toward the body if it holds
    // a real share of the tallest column's ink — so thin wisp tips and isolated
    // specks (low per-column ink) are trimmed, leaving the solid letter body.
    // The font advance is built from this (the engine lets the flames overhang
    // the margins), giving an even BODY rhythm instead of a wisp-driven one.
    const bb = bodyBoundsX(union, w, h);

    return { totalInk, union: toRGBA(union, w, h), layers, bodyMinX: bb.minX, bodyMaxX: bb.maxX, strayDropped };
  }

  /* sampleFireGradient(data, w, h, rows, opts) ->
   *   { stops: [{ offset, r, g, b }], bg }
   * Samples a single vertical colour gradient from the sheet for the
   * COLRv1 path (gradient / painterly art that flat layers would
   * posterise). Each non-background pixel's vertical position is
   * normalised WITHIN ITS ROW (0 = top of the letters, 1 = baseline),
   * so a 4-row sheet yields one letter-relative gradient, not a
   * sheet-relative one. Bins are averaged, empty bins filled from the
   * nearest neighbour, then resampled to `stops` evenly-spaced stops.
   *
   * Output stop offset runs 0 -> 1 along the FONT gradient axis
   * p0(glyph bottom) -> p1(glyph top): offset 0 = the letters' baseline
   * colour (deep red on a flame sheet), offset 1 = the tips (yellow).
   * Image-top (t=0) maps to offset 1, so stop colour at offset o is the
   * binned colour at image-t = 1 - o. */
  function sampleFireGradient(data, w, h, rows, opts) {
    opts = opts || {};
    const bgDist = opts.bgDist || 20;
    const bgD2 = bgDist * bgDist;
    const nStops = Math.max(2, Math.min(8, opts.stops || 5));
    // Chroma gate: the GRADIENT samples colour, so a black outline and a
    // gray drop shadow (both near-zero chroma) must be excluded or they drag
    // every stop toward muddy brown. Keep only saturated fill pixels. (The
    // silhouette/union still includes the outline — only colour sampling is
    // gated here.) Set minChroma:0 to sample every non-bg pixel.
    const minChroma = opts.minChroma == null ? 18 : opts.minChroma;
    const NB = 24;                                   // sampling bins (by image-t)
    const bg = opts.bg || detectBackground(data, w, h);
    const bgLab = rgbToLab(bg.r, bg.g, bg.b);

    // Resolve rows: if none given, treat the whole sheet's ink as one row.
    let bands = rows && rows.length ? rows : null;

    const acc = []; for (let i = 0; i < NB; i++) acc.push({ n: 0, r: 0, g: 0, b: 0 });
    // If no rows, derive ink y-extent so a single-letter sheet still works.
    let gy0 = 0, gy1 = h;
    if (!bands) {
      let top = h, bot = -1;
      for (let p = 0; p < w * h; p++) {
        const i = p * 4; if (data[i + 3] < 128) continue;
        if (labDist2(rgbToLab(data[i], data[i + 1], data[i + 2]), bgLab) <= bgD2) continue;
        const y = (p / w) | 0; if (y < top) top = y; if (y > bot) bot = y;
      }
      if (bot < top) return { stops: [], bg };
      gy0 = top; gy1 = bot + 1;
      bands = [[gy0, gy1]];
    }

    // Index rows by y for fast lookup.
    const rowOf = (y) => {
      for (let r = 0; r < bands.length; r++) if (y >= bands[r][0] && y < bands[r][1]) return bands[r];
      return null;
    };

    for (let p = 0; p < w * h; p++) {
      const i = p * 4; if (data[i + 3] < 128) continue;
      const lab = rgbToLab(data[i], data[i + 1], data[i + 2]);
      if (labDist2(lab, bgLab) <= bgD2) continue;
      if (chroma(lab) < minChroma) continue;         // drop outline (black) + shadow (gray)
      const y = (p / w) | 0;
      const band = rowOf(y); if (!band) continue;
      const rh = band[1] - band[0]; if (rh <= 0) continue;
      let t = (y - band[0]) / rh; if (t < 0) t = 0; else if (t > 0.99999) t = 0.99999;
      const b = acc[(t * NB) | 0];
      b.n++; b.r += data[i]; b.g += data[i + 1]; b.b += data[i + 2];
    }

    // Average + fill empty bins from the nearest populated neighbour.
    const bin = acc.map(a => a.n ? { r: a.r / a.n, g: a.g / a.n, b: a.b / a.n } : null);
    for (let i = 0; i < NB; i++) {
      if (bin[i]) continue;
      let lo = i, hi = i;
      while (lo >= 0 && !bin[lo]) lo--;
      while (hi < NB && !bin[hi]) hi++;
      const src = bin[lo >= 0 ? lo : hi] || bin[hi < NB ? hi : lo];
      bin[i] = src || { r: 128, g: 128, b: 128 };
    }

    // Trim to the DENSE band. The tallest flame wisps make the top 1-2 bins
    // sparse and noisy (a handful of anti-aliased pixels), which would make
    // the tip stop muddy. Restrict sampling to bins holding >= 8% of the
    // peak bin's pixels, so stops span the reliable letter body.
    let peak = 0; for (const a of acc) if (a.n > peak) peak = a.n;
    const thresh = peak * 0.08;
    let loB = 0, hiB = NB - 1;
    while (loB < NB - 1 && acc[loB].n < thresh) loB++;
    while (hiB > loB && acc[hiB].n < thresh) hiB--;
    const tTop = loB / NB, tBot = (hiB + 1) / NB;     // image-t bounds of dense band

    // Resample to nStops along the FONT axis: offset 0 = base (bottom, image-t
    // tBot), offset 1 = tip (top, image-t tTop).
    const stops = [];
    for (let s = 0; s < nStops; s++) {
      const offset = s / (nStops - 1);
      const t = tBot - offset * (tBot - tTop);
      const c = bin[Math.max(0, Math.min(NB - 1, (t * NB) | 0))];
      stops.push({ offset, r: Math.round(c.r), g: Math.round(c.g), b: Math.round(c.b) });
    }
    return { stops, bg };
  }

  global.ColorCore = {
    rgbToLab, labDist2, chroma,
    detectBackground, kmeans, detectPalette, detectShadowMask,
    dilate1, erode1, erode, separateGlyph, sampleFireGradient, bodyBoundsX, keepLargeComponents,
  };
})(typeof self !== 'undefined' ? self : this);
