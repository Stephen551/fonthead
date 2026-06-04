/* ============================================================
 * tracer-core.js  (shared image-to-paths pipeline)
 * ------------------------------------------------------------
 * Phase 0 extraction (color-font-builder-build-spec section 3):
 * the binarize / row-detect / slice / extract / trace pipeline,
 * lifted VERBATIM out of tracer.html so both the glyph tracer and
 * the color-font builder run on one spine. Functions that used to
 * read the tracer's closure 'state' now take those values as
 * explicit parameters (binarizeFull, sliceRowByComponents,
 * sliceRowByAnchoredWithOwnership, traceCellBitmap); every other
 * body is byte-identical to v0.8.48 tracer.html, so tracer output
 * is unchanged (acceptance gate 0).
 *
 * Globals required at load time: Potrace (potrace.js), document.
 * Exposes window.TracerCore.
 * ============================================================ */
(function (global) {
  'use strict';

  function morphologyStep(srcData, w, h, isErode) {
    const dst = new Uint8ClampedArray(srcData.length);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4;
        let result;
        if (isErode) {
          let allBlack = srcData[i] === 0;
          for (let dy = -1; dy <= 1 && allBlack; dy++) {
            for (let dx = -1; dx <= 1 && allBlack; dx++) {
              if (dx === 0 && dy === 0) continue;
              const nx = x + dx, ny = y + dy;
              if (nx < 0 || nx >= w || ny < 0 || ny >= h) { allBlack = false; break; }
              if (srcData[(ny * w + nx) * 4] !== 0) { allBlack = false; break; }
            }
          }
          result = allBlack ? 0 : 255;
        } else {
          let anyBlack = srcData[i] === 0;
          for (let dy = -1; dy <= 1 && !anyBlack; dy++) {
            for (let dx = -1; dx <= 1 && !anyBlack; dx++) {
              if (dx === 0 && dy === 0) continue;
              const nx = x + dx, ny = y + dy;
              if (nx < 0 || nx >= w || ny < 0 || ny >= h) continue;
              if (srcData[(ny * w + nx) * 4] === 0) { anyBlack = true; break; }
            }
          }
          result = anyBlack ? 0 : 255;
        }
        dst[i] = dst[i+1] = dst[i+2] = result;
        dst[i+3] = 255;
      }
    }
    return dst;
  }

  function applyWeight(data, w, h, amount) {
    if (amount === 0) return data;
    const isErode = amount < 0;
    const iterations = Math.abs(amount);
    let current = data;
    for (let i = 0; i < iterations; i++) {
      current = morphologyStep(current, w, h, isErode);
    }
    return current;
  }

  function binarizeFull(sourceImg, sourceWidth, sourceHeight, threshold, invert, weight) {
    const canvas = document.createElement('canvas');
    canvas.width = sourceWidth;
    canvas.height = sourceHeight;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(sourceImg, 0, 0);
    const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const d = imgData.data;
    const t = threshold;
    for (let i = 0; i < d.length; i += 4) {
      if (d[i + 3] < 128) {
        d[i] = d[i + 1] = d[i + 2] = 255;
        d[i + 3] = 255;
        continue;
      }
      let lum = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
      if (invert) lum = 255 - lum;
      const v = lum < t ? 0 : 255;
      d[i] = d[i + 1] = d[i + 2] = v;
      d[i + 3] = 255;
    }
    if (weight !== 0) {
      const adjusted = applyWeight(d, canvas.width, canvas.height, weight);
      for (let i = 0; i < d.length; i++) d[i] = adjusted[i];
    }
    ctx.putImageData(imgData, 0, 0);
    return { dataUrl: canvas.toDataURL('image/png'), data: d, w: canvas.width, h: canvas.height };
  }

  function detectRowsInBinary(binaryData, w, h) {
    const rowInk = new Uint32Array(h);
    for (let y = 0; y < h; y++) {
      let count = 0;
      const base = y * w * 4;
      for (let x = 0; x < w; x++) if (binaryData[base + x * 4] === 0) count++;
      rowInk[y] = count;
    }
    const runs = [];
    let inText = false, start = 0;
    for (let y = 0; y < h; y++) {
      const empty = rowInk[y] === 0;
      if (!empty && !inText) { inText = true; start = y; }
      else if (empty && inText) { inText = false; runs.push([start, y]); }
    }
    if (inText) runs.push([start, h]);
    return runs;
  }

  function detectBaselineInRow(binaryData, w, y0, y1) {
    const rowH = y1 - y0;
    if (rowH <= 0) return y1 - 1;
    const counts = new Int32Array(rowH);
    const lasts = [];
    for (let x = 0; x < w; x++) {
      let lastInk = -1;
      for (let y = y0; y < y1; y++) {
        if (binaryData[(y * w + x) * 4] === 0) lastInk = y;
      }
      if (lastInk >= y0) {
        const rel = lastInk - y0;
        counts[rel]++;
        lasts.push(rel);
      }
    }
    if (lasts.length === 0) return y1 - 1;
    let maxCount = 0, maxIdx = rowH - 1;
    for (let i = 0; i < rowH; i++) {
      if (counts[i] > maxCount) { maxCount = counts[i]; maxIdx = i; }
    }
    if (maxCount >= lasts.length * 0.12) return y0 + maxIdx;
    lasts.sort((a, b) => a - b);
    return y0 + lasts[Math.floor(lasts.length * 0.70)];
  }

  function sliceRowByWhitespace(binaryData, w, y0, y1) {
    const colInk = new Uint32Array(w);
    for (let x = 0; x < w; x++) {
      let count = 0;
      for (let y = y0; y < y1; y++) if (binaryData[(y * w + x) * 4] === 0) count++;
      colInk[x] = count;
    }
    const runs = [];
    let inText = false, start = 0;
    for (let x = 0; x < w; x++) {
      const empty = colInk[x] === 0;
      if (!empty && !inText) { inText = true; start = x; }
      else if (empty && inText) { inText = false; runs.push([start, x]); }
    }
    if (inText) runs.push([start, w]);
    return runs;
  }

  function sliceRowByAnchoredMinima(binaryData, w, y0, y1, expectedCount) {
    const colInk = new Uint32Array(w);
    for (let x = 0; x < w; x++) {
      let count = 0;
      for (let y = y0; y < y1; y++) if (binaryData[(y * w + x) * 4] === 0) count++;
      colInk[x] = count;
    }
    let xStart = 0, xEnd = w;
    for (let x = 0; x < w; x++) if (colInk[x] > 0) { xStart = x; break; }
    for (let x = w - 1; x >= 0; x--) if (colInk[x] > 0) { xEnd = x + 1; break; }
    const span = xEnd - xStart;
    const pitch = span / expectedCount;
    const cuts = [xStart];
    for (let k = 1; k < expectedCount; k++) {
      const expectedX = Math.round(xStart + k * pitch);
      const winLo = Math.max(xStart, Math.round(expectedX - 0.35 * pitch));
      const winHi = Math.min(xEnd, Math.round(expectedX + 0.35 * pitch));
      let minVal = Infinity, minX = expectedX;
      for (let x = winLo; x < winHi; x++) {
        if (colInk[x] < minVal) { minVal = colInk[x]; minX = x; }
      }
      cuts.push(minX);
    }
    cuts.push(xEnd);
    const ranges = [];
    for (let i = 0; i < cuts.length - 1; i++) ranges.push([cuts[i], cuts[i + 1]]);
    return ranges;
  }

  function sliceRowByComponents(binaryData, w, y0, y1, expectedCount, turdsize) {
    const rowH = y1 - y0;
    if (rowH <= 0 || expectedCount <= 0) return { ranges: [], ownerFn: null };

    const N = w * rowH;
    const labels = new Int32Array(N);
    for (let i = 0; i < N; i++) labels[i] = -1;

    const minArea = Math.max(2, turdsize | 0);
    const components = [];
    const stack = [];
    let nextLabel = 0;

    for (let y = 0; y < rowH; y++) {
      const yOff = y * w;
      for (let x = 0; x < w; x++) {
        const idx = yOff + x;
        if (labels[idx] !== -1) continue;
        if (binaryData[((y0 + y) * w + x) * 4] !== 0) continue;
        const myLabel = nextLabel++;
        let cx0 = x, cx1 = x, cy0 = y, cy1 = y, area = 0, sumX = 0;
        stack.length = 0;
        stack.push(idx);
        labels[idx] = myLabel;
        while (stack.length) {
          const p = stack.pop();
          const px = p % w;
          const py = (p - px) / w;
          area++;
          sumX += px;
          if (px < cx0) cx0 = px;
          if (px > cx1) cx1 = px;
          if (py < cy0) cy0 = py;
          if (py > cy1) cy1 = py;
          if (px > 0) {
            const np = p - 1;
            if (labels[np] === -1 && binaryData[((y0 + py) * w + (px - 1)) * 4] === 0) {
              labels[np] = myLabel; stack.push(np);
            }
          }
          if (px < w - 1) {
            const np = p + 1;
            if (labels[np] === -1 && binaryData[((y0 + py) * w + (px + 1)) * 4] === 0) {
              labels[np] = myLabel; stack.push(np);
            }
          }
          if (py > 0) {
            const np = p - w;
            if (labels[np] === -1 && binaryData[((y0 + py - 1) * w + px) * 4] === 0) {
              labels[np] = myLabel; stack.push(np);
            }
          }
          if (py < rowH - 1) {
            const np = p + w;
            if (labels[np] === -1 && binaryData[((y0 + py + 1) * w + px) * 4] === 0) {
              labels[np] = myLabel; stack.push(np);
            }
          }
        }
        if (area >= minArea) components.push({ label: myLabel, x0: cx0, x1: cx1 + 1, y0: cy0, y1: cy1 + 1, area, centroidX: sumX / area });
        /* Components below minArea keep their pixel labels but aren't
           tracked. labelToCell[that label] stays -1, so ownerFn returns
           -1 for noise pixels — extractCellBinary keeps them (matches
           the legacy slicers' behavior of letting downstream path
           filtering reject specks). */
      }
    }

    if (components.length === 0) return { ranges: [], ownerFn: null };
    components.sort((a, b) => a.x0 - b.x0);

    const labelToCell = new Int32Array(nextLabel);
    for (let i = 0; i < nextLabel; i++) labelToCell[i] = -1;

    const makeOwnerFn = () => (absX, absY) => {
      const localY = absY - y0;
      if (localY < 0 || localY >= rowH) return -1;
      if (absX < 0 || absX >= w) return -1;
      const label = labels[localY * w + absX];
      return label === -1 ? -1 : labelToCell[label];
    };

    /* If we have fewer (or equal) components than expected glyphs, we can't
       reliably split — return each component as its own cell. The caller
       (processRow) pads short range arrays with empty [0,0] entries and
       warns, matching the existing slicers' behavior. */
    if (components.length <= expectedCount) {
      components.forEach((c, i) => { labelToCell[c.label] = i; });
      return {
        ranges: components.map(c => [c.x0, c.x1]),
        ownerFn: makeOwnerFn(),
      };
    }

    /* Boundary selection — letter-pair-mandatory + proximity-forbidden.
       Letter classification protects italic descender pairs (f-g) from
       being merged. The proximity-forbidden rule protects multi-stroke
       SYMBOLS (%, #, K-italic, etc) from being SPLIT — when their
       sub-components have very close centroids, they're parts of the
       same glyph and we never put a cell boundary between them, even
       if some of those sub-components are full-height "letters" by
       height classification (italic K's vertical stroke + diagonals
       are all full-height but all one symbol).

       Pitch estimate: total inked span / expectedCount. A centroid
       distance below 40% of pitch is "same symbol." */
    const LETTER_HEIGHT = rowH * 0.4;
    for (const c of components) c._isLetter = (c.y1 - c.y0) >= LETTER_HEIGHT;

    components.sort((a, b) => a.centroidX - b.centroidX);

    let inkXMin = Infinity, inkXMax = -Infinity;
    for (const c of components) {
      if (c.x0 < inkXMin) inkXMin = c.x0;
      if (c.x1 > inkXMax) inkXMax = c.x1;
    }
    const pitchEst = (inkXMax - inkXMin) / Math.max(1, expectedCount);
    const PROXIMITY_THRESHOLD = pitchEst * 0.4;

    const candidates = [];
    for (let i = 0; i < components.length - 1; i++) {
      const gap = components[i + 1].x0 - components[i].x1;
      const centroidGap = components[i + 1].centroidX - components[i].centroidX;
      const bothLetters = components[i]._isLetter && components[i + 1]._isLetter;
      /* Forbidden = same-symbol. Sub-strokes of `%` (slash + 2 circles),
         italic K (vertical + 2 diagonals), `#` if multi-stroke — all
         have centroids within ~40% of pitch and shouldn't be split.
         Even letter-letter pairs are forbidden when too close, because
         italic letters drawn at correct spacing are >40% apart anyway. */
      const forbidden = centroidGap < PROXIMITY_THRESHOLD;
      const mandatory = bothLetters && !forbidden;
      candidates.push({ idx: i, gap, mandatory, forbidden });
    }
    const slots = expectedCount - 1;
    const mandatoryCands = candidates.filter(c => c.mandatory);
    const optionalCands = candidates.filter(c => !c.mandatory && !c.forbidden);
    const boundaryIndices = new Set();

    if (mandatoryCands.length <= slots) {
      /* Take all mandatory + fill remaining slots with the largest
         non-forbidden optional gaps. Common path for a clean row. */
      for (const c of mandatoryCands) boundaryIndices.add(c.idx);
      optionalCands.sort((a, b) => b.gap - a.gap);
      const remaining = slots - mandatoryCands.length;
      for (let k = 0; k < remaining && k < optionalCands.length; k++) {
        boundaryIndices.add(optionalCands[k].idx);
      }
    } else {
      /* More mandatory boundaries than slots — user's char count is
         lower than the number of letter-pair seams. Keep the largest
         mandatory gaps, drop the smallest. */
      mandatoryCands.sort((a, b) => b.gap - a.gap);
      for (let k = 0; k < slots; k++) boundaryIndices.add(mandatoryCands[k].idx);
    }

    const cells = [];
    let current = [components[0]];
    for (let i = 0; i < components.length - 1; i++) {
      if (boundaryIndices.has(i)) {
        cells.push(current);
        current = [];
      }
      current.push(components[i + 1]);
    }
    cells.push(current);

    cells.forEach((cell, cellIdx) => {
      for (const c of cell) labelToCell[c.label] = cellIdx;
    });

    /* Each cell's extraction range is its OWNED components' bbox.
       Ranges may overlap horizontally (italic descender from cell A
       extends into cell B's left side) — that's fine. Ownership
       masking inside extractCellBinary keeps each cell's extract
       limited to its own components' ink and erases the neighbor's
       overhang.

       An earlier version trimmed overlapping ranges to the midpoint
       between them. That made sense without ownership masking (so
       both cells didn't double-extract the shared region), but with
       masking it CLIPS A's descender tail past the midpoint — A
       never sees pixels past midpoint at all, so the tail is lost
       entirely. Removing the trim restores the tail. */
    const ranges = cells.map(cell => {
      let minX = Infinity, maxX = -Infinity;
      for (const c of cell) {
        if (c.x0 < minX) minX = c.x0;
        if (c.x1 > maxX) maxX = c.x1;
      }
      return [minX, maxX];
    });
    return { ranges, ownerFn: makeOwnerFn() };
  }

  function sliceRowByAnchoredWithOwnership(binaryData, w, y0, y1, expectedCount, turdsize) {
    const rowH = y1 - y0;
    if (rowH <= 0 || expectedCount <= 0) return { ranges: [], ownerFn: null };

    const ranges = sliceRowByAnchoredMinima(binaryData, w, y0, y1, expectedCount);
    if (ranges.length === 0) return { ranges: [], ownerFn: null };

    const N = w * rowH;
    const labels = new Int32Array(N);
    for (let i = 0; i < N; i++) labels[i] = -1;

    const minArea = Math.max(2, turdsize | 0);
    const components = [];
    const stack = [];
    let nextLabel = 0;

    for (let y = 0; y < rowH; y++) {
      const yOff = y * w;
      for (let x = 0; x < w; x++) {
        const idx = yOff + x;
        if (labels[idx] !== -1) continue;
        if (binaryData[((y0 + y) * w + x) * 4] !== 0) continue;
        const myLabel = nextLabel++;
        let cx0 = x, cx1 = x, area = 0, sumX = 0;
        stack.length = 0;
        stack.push(idx);
        labels[idx] = myLabel;
        while (stack.length) {
          const p = stack.pop();
          const px = p % w;
          const py = (p - px) / w;
          area++;
          sumX += px;
          if (px < cx0) cx0 = px;
          if (px > cx1) cx1 = px;
          if (px > 0) {
            const np = p - 1;
            if (labels[np] === -1 && binaryData[((y0 + py) * w + (px - 1)) * 4] === 0) {
              labels[np] = myLabel; stack.push(np);
            }
          }
          if (px < w - 1) {
            const np = p + 1;
            if (labels[np] === -1 && binaryData[((y0 + py) * w + (px + 1)) * 4] === 0) {
              labels[np] = myLabel; stack.push(np);
            }
          }
          if (py > 0) {
            const np = p - w;
            if (labels[np] === -1 && binaryData[((y0 + py - 1) * w + px) * 4] === 0) {
              labels[np] = myLabel; stack.push(np);
            }
          }
          if (py < rowH - 1) {
            const np = p + w;
            if (labels[np] === -1 && binaryData[((y0 + py + 1) * w + px) * 4] === 0) {
              labels[np] = myLabel; stack.push(np);
            }
          }
        }
        if (area >= minArea) components.push({ label: myLabel, x0: cx0, x1: cx1 + 1, centroidX: sumX / area });
      }
    }

    const labelToCell = new Int32Array(nextLabel);
    for (let i = 0; i < nextLabel; i++) labelToCell[i] = -1;
    const cellComponents = Array.from({ length: ranges.length }, () => []);
    for (const c of components) {
      for (let i = 0; i < ranges.length; i++) {
        const [rxs, rxe] = ranges[i];
        if (c.centroidX >= rxs && c.centroidX < rxe) {
          labelToCell[c.label] = i;
          cellComponents[i].push(c);
          break;
        }
      }
    }

    /* Redistribute components from overfull cells to empty neighbors.
       Anchored equal-pitch cuts assume the user drew symbols at
       uniform intervals. For freehand drawing where one gap is wider
       than another (Stephen's punctuation sheet), an off-position
       symbol's centroid lands in the wrong cell window — `#` (which
       might be 4 disconnected strokes) ends up grouped with `$` in
       cell 4, and cell 3 (#'s expected slot) is empty.

       Steal an entire GROUP of close-together components, not just
       one. A "group" is a run of components with internal gaps
       smaller than threshold (= cell pitch * 0.25). If the overfull
       cell contains more than one group, the leftmost (or rightmost)
       group is a complete symbol that belongs in the empty neighbor.
       Single-group cells stay intact, so tight multi-component
       symbols (`;` tail+dot, `:` two dots, `"` two marks, multi-
       stroke `#`/`%`) don't get split apart. */
    function findFirstGroupEnd(cell, gapThreshold) {
      let end = 0;
      for (let j = 1; j < cell.length; j++) {
        if (cell[j].centroidX - cell[j - 1].centroidX > gapThreshold) break;
        end = j;
      }
      return end;
    }
    function findLastGroupStart(cell, gapThreshold) {
      let start = cell.length - 1;
      for (let j = cell.length - 2; j >= 0; j--) {
        if (cell[j + 1].centroidX - cell[j].centroidX > gapThreshold) break;
        start = j;
      }
      return start;
    }
    let changed = true;
    let safety = 100;
    while (changed && safety-- > 0) {
      changed = false;
      for (let i = 0; i < cellComponents.length; i++) {
        if (cellComponents[i].length > 0) continue;
        if (i < cellComponents.length - 1 && cellComponents[i + 1].length >= 2) {
          cellComponents[i + 1].sort((a, b) => a.centroidX - b.centroidX);
          const pitch = ranges[i + 1][1] - ranges[i + 1][0];
          const groupEnd = findFirstGroupEnd(cellComponents[i + 1], pitch * 0.25);
          if (groupEnd < cellComponents[i + 1].length - 1) {
            const stolen = cellComponents[i + 1].splice(0, groupEnd + 1);
            for (const c of stolen) {
              cellComponents[i].push(c);
              labelToCell[c.label] = i;
            }
            changed = true;
            continue;
          }
        }
        if (i > 0 && cellComponents[i - 1].length >= 2) {
          cellComponents[i - 1].sort((a, b) => a.centroidX - b.centroidX);
          const pitch = ranges[i - 1][1] - ranges[i - 1][0];
          const groupStart = findLastGroupStart(cellComponents[i - 1], pitch * 0.25);
          if (groupStart > 0) {
            const stolen = cellComponents[i - 1].splice(groupStart);
            for (const c of stolen) {
              cellComponents[i].push(c);
              labelToCell[c.label] = i;
            }
            changed = true;
          }
        }
      }
    }

    /* Replace anchored-pitch ranges with bbox of each cell's owned
       components. Anchored cuts decide cell ASSIGNMENT (by centroid);
       we want the EXTRACTION rect to cover each cell's full ink so a
       wide symbol like # whose bbox extends past its equal-pitch slot
       isn't clipped at the boundary (and erased by the neighbor's
       ownership mask, losing it entirely). Cells with no assigned
       components keep the anchored fallback. */
    const extractionRanges = [];
    for (let i = 0; i < ranges.length; i++) {
      const cellComps = cellComponents[i];
      if (cellComps.length === 0) {
        extractionRanges.push(ranges[i]);
      } else {
        let minX = Infinity, maxX = -Infinity;
        for (const c of cellComps) {
          if (c.x0 < minX) minX = c.x0;
          if (c.x1 > maxX) maxX = c.x1;
        }
        extractionRanges.push([minX, maxX]);
      }
    }

    const ownerFn = (absX, absY) => {
      const localY = absY - y0;
      if (localY < 0 || localY >= rowH) return -1;
      if (absX < 0 || absX >= w) return -1;
      const label = labels[localY * w + absX];
      return label === -1 ? -1 : labelToCell[label];
    };

    return { ranges: extractionRanges, ownerFn };
  }

  function extractCellBinary(binaryData, fullW, x0, x1, y0, y1, ownerFn, cellIdx) {
    const w = x1 - x0;
    const h = y1 - y0;
    const cell = new Uint8ClampedArray(w * h * 4);
    for (let y = 0; y < h; y++) {
      const srcBase = ((y0 + y) * fullW + x0) * 4;
      const dstBase = y * w * 4;
      for (let x = 0; x < w; x++) {
        let sv = binaryData[srcBase + x * 4];
        if (ownerFn && sv === 0) {
          const owner = ownerFn(x0 + x, y0 + y);
          if (owner !== -1 && owner !== cellIdx) sv = 255;
        }
        cell[dstBase + x * 4] = sv;
        cell[dstBase + x * 4 + 1] = sv;
        cell[dstBase + x * 4 + 2] = sv;
        cell[dstBase + x * 4 + 3] = 255;
      }
    }
    return { data: cell, w, h };
  }

  // outScale (default 1) multiplies the emitted path coordinates. Tracing a
  // supersampled cell at scale S and passing outScale = 1/S brings the extra
  // detail back into the cell's native coordinate space. Default keeps 1:1.
  function traceCellBitmap(cell, turdsize, optcurve, alphamax, opttolerance, outScale) {
    const cv = document.createElement('canvas');
    cv.width = cell.w; cv.height = cell.h;
    const cx = cv.getContext('2d');
    const id = cx.createImageData(cell.w, cell.h);
    id.data.set(cell.data);
    cx.putImageData(id, 0, 0);
    const tracer = new Potrace(window);
    tracer.setParameter({
      turnpolicy: 'minority',
      turdsize: turdsize,
      optcurve: optcurve,
      alphamax: alphamax,
      opttolerance: opttolerance,
    });
    const s = outScale || 1;
    return new Promise(resolve => {
      tracer.loadImageFromUrl(cv.toDataURL('image/png'));
      tracer.process(() => {
        const svgStr = tracer.getSVG(s);
        resolve(svgStr);
      });
    });
  }

  function extractPathDFromSvg(svgStr) {
    const matches = [...svgStr.matchAll(/<path\s+d="([^"]+)"/g)];
    return matches.map(m => m[1]);
  }

  function deskewRowBitmap(binaryData, w, y0, y1, tan) {
    const rowH = y1 - y0;
    const maxShift = Math.ceil(rowH * Math.abs(tan));
    const newW = w + maxShift;
    const out = new Uint8ClampedArray(newW * rowH * 4);
    /* Fill with white background — any pixel not copied from source
       stays as a non-ink white pixel (255), preserving the convention
       that 0 = ink and !=0 = background for the slicer. */
    for (let i = 0; i < out.length; i += 4) {
      out[i] = 255; out[i + 1] = 255; out[i + 2] = 255; out[i + 3] = 255;
    }
    for (let y = 0; y < rowH; y++) {
      const shift = Math.round(y * tan);
      const srcBase = (y0 + y) * w * 4;
      const dstBase = y * newW * 4;
      for (let x = 0; x < w; x++) {
        const newX = x + shift;
        if (newX < 0 || newX >= newW) continue;
        const sv = binaryData[srcBase + x * 4];
        const dstIdx = dstBase + newX * 4;
        out[dstIdx] = sv;
        out[dstIdx + 1] = sv;
        out[dstIdx + 2] = sv;
        out[dstIdx + 3] = 255;
      }
    }
    return { data: out, w: newW, h: rowH };
  }

  /* mapCellToGlyph — pure coordinate mapping from an absolute cell rect +
     absolute baseline to cell-local glyph metrics. New in the shared core
     (both tracer + color builder consume it). */
  function mapCellToGlyph(x0, y0, x1, y1, baselineAbs) {
    return { cellW: x1 - x0, cellH: y1 - y0, baselineYInCell: baselineAbs - y0 };
  }


  global.TracerCore = {
    morphologyStep, applyWeight, binarizeFull, detectRowsInBinary, detectBaselineInRow, sliceRowByWhitespace, sliceRowByAnchoredMinima, sliceRowByComponents, sliceRowByAnchoredWithOwnership, extractCellBinary, traceCellBitmap, extractPathDFromSvg, deskewRowBitmap, mapCellToGlyph,
  };
})(typeof self !== 'undefined' ? self : this);
