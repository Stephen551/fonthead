// Plain-language advice for an uploaded sheet that is unlikely to trace well
// (ADR 0084). It never blocks a build: the maker shows these lines beside the
// sheet so a visitor knows why the result looks off and what to try instead.

/** Below this longer side (in pixels) letters are too small to trace cleanly. */
export const SMALL_SHEET_PX = 800;

/** Image-level signals measured once when a sheet is loaded. */
export interface SheetSignals {
  /** Original image size, before any downscaling for the overlay. */
  width: number;
  height: number;
  /** Share of image rows (0 to 1) that sit inside flat gray UI bands. */
  flatBandShare: number;
}

// A row is "flat" when every pixel across the full width is the same shade.
// Paper in a photo or scan always varies a little across the page (lighting,
// grain, JPEG noise survive downscaling as a gradient), while an app's toolbar
// or status bar is one exact color edge to edge.
const FLAT_ROW_STD = 1;
// White page background and solid black are left out: a generated sheet's
// white margin is flat too, and that is fine to trace.
const FLAT_ROW_MIN = 20;
const FLAT_ROW_MAX = 235;
// A band must be at least this share of the height to count as UI chrome,
// so a stray ruled line or a one-pixel border does not.
const MIN_BAND_SHARE = 0.02;
// Flat rows this close to the page's own shade are background, not chrome.
const PAGE_SHADE_TOL = 6;
// Total gray band share that makes a sheet read as a screenshot.
const SCREENSHOT_BAND_SHARE = 0.05;

/** Share of rows in a grayscale image (0 to 255, row-major) that belong to
 *  full-width flat gray bands at least MIN_BAND_SHARE of the height tall.
 *  The sheet's own background is never a band: the most common flat shade is
 *  the page (white paper, or a plain gray or cream generated background), and
 *  only flat rows of a different shade count as app chrome. */
export function flatBandShare(gray: ArrayLike<number>, w: number, h: number): number {
  if (w < 1 || h < 1) return 0;
  const means: number[] = [];
  const flat: boolean[] = [];
  const shadeCounts = new Map<number, number>();
  for (let y = 0; y < h; y++) {
    let sum = 0;
    let sq = 0;
    for (let x = 0; x < w; x++) {
      const v = gray[y * w + x];
      sum += v;
      sq += v * v;
    }
    const mean = sum / w;
    const isFlat = Math.sqrt(Math.max(0, sq / w - mean * mean)) < FLAT_ROW_STD;
    means.push(mean);
    flat.push(isFlat);
    if (isFlat) {
      const bucket = Math.round(mean / 4);
      shadeCounts.set(bucket, (shadeCounts.get(bucket) ?? 0) + 1);
    }
  }
  let pageBucket = -1;
  let best = 0;
  for (const [bucket, n] of shadeCounts) if (n > best) [pageBucket, best] = [bucket, n];
  const pageShade = pageBucket * 4;
  const minRun = Math.max(2, Math.ceil(h * MIN_BAND_SHARE));
  let counted = 0;
  let run = 0;
  let runMean = -1;
  const closeRun = () => {
    if (run >= minRun) counted += run;
    run = 0;
    runMean = -1;
  };
  for (let y = 0; y < h; y++) {
    const mean = means[y];
    const chrome = flat[y] && mean >= FLAT_ROW_MIN && mean <= FLAT_ROW_MAX && Math.abs(mean - pageShade) > PAGE_SHADE_TOL;
    // a band is one shade top to bottom; a new shade starts a new band
    if (chrome && (run === 0 || Math.abs(mean - runMean) < 2)) {
      if (run === 0) runMean = mean;
      run++;
    } else {
      closeRun();
      if (chrome) {
        runMean = mean;
        run = 1;
      }
    }
  }
  closeRun();
  return counted / h;
}

/** Grayscale (Rec. 601 luma) from RGBA canvas pixels. */
export function rgbaToGray(rgba: ArrayLike<number>, w: number, h: number): Uint8Array {
  const out = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) {
    out[i] = Math.round(0.299 * rgba[i * 4] + 0.587 * rgba[i * 4 + 1] + 0.114 * rgba[i * 4 + 2]);
  }
  return out;
}

export function looksLikeScreenshot(s: SheetSignals): boolean {
  return s.flatBandShare >= SCREENSHOT_BAND_SHARE;
}

export function isSmallSheet(s: SheetSignals): boolean {
  return Math.max(s.width, s.height) < SMALL_SHEET_PX;
}

/** Rows (1-based) where the charset lists at least 3 characters but the maker
 *  found half as many shapes or fewer: the letters most likely touch and were
 *  read as one shape. Only compared when the row counts agree; a different row
 *  count has its own check. */
export function crowdedRows(cellsPerRow: number[], charLines: string[]): { row: number; chars: number; shapes: number }[] {
  if (!cellsPerRow.length || cellsPerRow.length !== charLines.length) return [];
  const out: { row: number; chars: number; shapes: number }[] = [];
  cellsPerRow.forEach((shapes, i) => {
    const chars = [...charLines[i]].length;
    if (chars >= 3 && shapes <= Math.floor(chars / 2)) out.push({ row: i + 1, chars, shapes });
  });
  return out;
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

function joinRows(rows: number[]): string {
  if (rows.length === 1) return `Row ${rows[0]}`;
  return `Rows ${rows.slice(0, -1).join(', ')} and ${rows[rows.length - 1]}`;
}

export interface AdviceInput {
  signals: SheetSignals | null;
  cellsPerRow: number[];
  charLines: string[];
  /** The row-shape prompt (ADR 0083) is already offering a charset, so the
   *  shape count is its job and is not repeated here. */
  layoutSuggested: boolean;
}

/** The advice lines for a loaded sheet, most useful first. Empty when the
 *  sheet looks like what the maker is built for. */
export function uploadAdvice({ signals, cellsPerRow, charLines, layoutSuggested }: AdviceInput): string[] {
  const out: string[] = [];
  if (signals && looksLikeScreenshot(signals)) {
    out.push('This looks like a screenshot. The gray bars from the app get read as part of your sheet. Crop down to just the letters, or type them on a plain white page and export that.');
  }
  if (signals && isSmallSheet(signals)) {
    out.push(`This image is only ${signals.width} × ${signals.height} pixels, so the letters can blur into each other. Export it at a larger size, or zoom in before you take the screenshot.`);
  }
  const crowded = layoutSuggested ? [] : crowdedRows(cellsPerRow, charLines);
  if (crowded.length === 1) {
    const { row, chars, shapes } = crowded[0];
    out.push(`Row ${row} has ${plural(chars, 'character', 'characters')} in the charset, but the maker only found ${plural(shapes, 'shape', 'shapes')} there. Letters that touch get read as one shape, so add some space between them. Turning up the letter spacing in your editor does it.`);
  } else if (crowded.length > 1) {
    out.push(`${joinRows(crowded.map(c => c.row))} have far fewer shapes than characters in the charset. Letters that touch get read as one shape, so add some space between them. Turning up the letter spacing in your editor does it.`);
  }
  return out;
}
