// fonthead.dev — maker orchestration (client-only).
//
// Drives the vendored font engine: traces an alphabet-sheet image into glyph
// paths on the main thread (TracerCore + Potrace), then hands the glyphs to the
// classic Web Worker that builds OTF / TTF / WOFF / WOFF2. The engine modules
// are served verbatim from /assets and expose window globals; this module is
// the thin, typed bridge to them. It only ever runs in the browser.

/* eslint-disable @typescript-eslint/no-explicit-any */
import { fixSfntChecksums } from './sfnt';

const w = () => window as any;

/** Hard gate: run the engine's own validateFont; throw (drop the font) if it
 *  fails. Mirrors the source tool, which never ships a font that fails. */
async function assertValid(bytes?: Uint8Array): Promise<void> {
  if (!bytes) throw new Error('no font was produced');
  const vf = w().validateFont;
  if (!vf) return; // validator not loaded — skip rather than block
  const r = await vf(bytes);
  if (r && r.ok === false) {
    const msg = (r.errors || []).map((e: any) => e.message || e.code).join('; ');
    throw new Error('font failed validation: ' + (msg || 'unknown'));
  }
}

export interface TraceOpts {
  threshold: number;
  invert: boolean;
  weight: number;
  turdsize: number;
  alphamax: number;
  opttolerance: number;
  optcurve: boolean;
  // opt-in: resample each glyph from the source at higher resolution before
  // the threshold, so serifs and sharp corners survive. Off by default.
  fineDetail: boolean;
}

export const DEFAULT_TRACE: TraceOpts = {
  threshold: 128,
  invert: false,
  weight: 0,
  turdsize: 2,
  alphamax: 1.0,
  opttolerance: 0.15,
  optcurve: true,
  fineDetail: false,
};

// Mono trace presets (mirrors the source tracer's glyph / logo / sketch).
export const TRACE_PRESETS: Record<string, TraceOpts> = {
  glyph: { ...DEFAULT_TRACE, opttolerance: 0.15, turdsize: 2, alphamax: 1.0 },
  logo: { ...DEFAULT_TRACE, opttolerance: 0.2, turdsize: 4, alphamax: 1.0 },
  sketch: { ...DEFAULT_TRACE, opttolerance: 0.4, turdsize: 8, alphamax: 1.2 },
};

// Sheet-level color knobs passed to the color build (re-run analysis).
export interface ColorOpts {
  K?: number;
  stops?: number;
  bgDist?: number;
  outline?: boolean;
  gloss?: boolean;
  fineDetail?: boolean;
}
export const DEFAULT_COLOR_OPTS: ColorOpts = { K: 3, stops: 5, bgDist: 20, outline: false, gloss: false, fineDetail: false };

export interface Glyph {
  char: string;
  italic: boolean;
  paths: string[];
  cellW: number;
  cellH: number;
  baselineYInCell: number;
}

export interface FontResult {
  otf?: Uint8Array;
  ttf?: Uint8Array;
  woff?: Uint8Array;
  woff2?: Uint8Array;
  _hinting?: any;
}

export type Progress = (step: string, message: string) => void;

// What the built-in sample sheet contains (3 clean rows). The sample button
// sets the charset to match this exactly.
export const SAMPLE_CHAR_LINES = [
  'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
  'abcdefghijklmnopqrstuvwxyz',
  '0123456789',
];

// The editable default for an uploaded sheet — includes a punctuation row.
// The user corrects this to match whatever their sheet actually has.
export const DEFAULT_CHAR_LINES = [
  'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
  'abcdefghijklmnopqrstuvwxyz',
  '0123456789',
  ".,!?:;'-&@#",
];

// Back-compat alias (the sample generators render this).
export const ROW_CHARS = SAMPLE_CHAR_LINES;

/** Parse a charset textarea (one row per line) into non-empty rows. */
export function parseCharset(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((l) => l.trimEnd())
    .filter((l) => l.length > 0);
}

const ENGINE_VERSION = '0.8.59';

/** Resolve once the vendored engine globals are present on window. */
export function waitForEngine(timeoutMs = 15000): Promise<void> {
  return new Promise((resolve, reject) => {
    const ready = () =>
      w().TracerCore && w().buildFontForStyle && w().estimateBBox && w().Potrace && w().wrapAsWoff2 && w().validateFont;
    if (ready()) return resolve();
    const t0 = Date.now();
    const iv = setInterval(() => {
      if (ready()) {
        clearInterval(iv);
        resolve();
      } else if (Date.now() - t0 > timeoutMs) {
        clearInterval(iv);
        reject(new Error('font engine did not load'));
      }
    }, 50);
  });
}

// ---- main-thread tracing ---------------------------------------------------

// The cell slicers the mono path can use on a row. 'auto' is the default
// cascade; the others force one slicer so a user can rescue a mis-cut row.
export type SlicerKind = 'auto' | 'whitespace' | 'anchored' | 'components' | 'ownership';
type PickedSlicer = Exclude<SlicerKind, 'auto'>;

function pickRanges(
  data: Uint8ClampedArray,
  W: number,
  y0: number,
  y1: number,
  expected: number,
  chars: string,
  override: SlicerKind = 'auto',
): { ranges: number[][]; ownerFn: any; slicer: PickedSlicer; forced: boolean } {
  const TC = w().TracerCore;
  // explicit override: run exactly that slicer, no cascade
  if (override === 'whitespace')
    return { ranges: TC.sliceRowByWhitespace(data, W, y0, y1), ownerFn: null, slicer: 'whitespace', forced: false };
  if (override === 'anchored')
    return { ranges: TC.sliceRowByAnchoredMinima(data, W, y0, y1, expected), ownerFn: null, slicer: 'anchored', forced: false };
  if (override === 'components') {
    const comp = TC.sliceRowByComponents(data, W, y0, y1, expected, DEFAULT_TRACE.turdsize);
    return { ranges: comp.ranges, ownerFn: comp.ownerFn, slicer: 'components', forced: false };
  }
  if (override === 'ownership') {
    const owned = TC.sliceRowByAnchoredWithOwnership(data, W, y0, y1, expected, DEFAULT_TRACE.turdsize);
    return { ranges: owned.ranges, ownerFn: owned.ownerFn, slicer: 'ownership', forced: false };
  }
  // auto cascade: prefer the natural cut, fall back to a count-forced one
  const symbols = /[^A-Za-z0-9 ]/.test(chars);
  if (symbols) {
    const comp = TC.sliceRowByComponents(data, W, y0, y1, expected, DEFAULT_TRACE.turdsize);
    if (comp.ranges.length === expected) return { ranges: comp.ranges, ownerFn: comp.ownerFn, slicer: 'components', forced: false };
    const owned = TC.sliceRowByAnchoredWithOwnership(data, W, y0, y1, expected, DEFAULT_TRACE.turdsize);
    if (owned.ranges.length === expected) return { ranges: owned.ranges, ownerFn: owned.ownerFn, slicer: 'ownership', forced: false };
    return { ranges: TC.sliceRowByAnchoredMinima(data, W, y0, y1, expected), ownerFn: null, slicer: 'anchored', forced: true };
  }
  const ws = TC.sliceRowByWhitespace(data, W, y0, y1);
  if (ws.length === expected) return { ranges: ws, ownerFn: null, slicer: 'whitespace', forced: false };
  return { ranges: TC.sliceRowByAnchoredMinima(data, W, y0, y1, expected), ownerFn: null, slicer: 'anchored', forced: true };
}

function filterFilledGlyphPaths(paths: string[], rowH: number, cellBaselineLocal: number) {
  const estimateBBox = w().estimateBBox;
  const minArea = rowH * rowH * 0.02;
  const scored = paths
    .map((p) => {
      const bb = estimateBBox(p);
      if (!bb) return null;
      return { d: p, bb, area: (bb.maxX - bb.minX) * (bb.maxY - bb.minY) };
    })
    .filter(Boolean) as Array<{ d: string; bb: any; area: number }>;
  let keep = scored.filter((p) => p.area >= minArea || p.bb.maxY < cellBaselineLocal * 0.65);
  if (keep.length === 0 && scored.length > 0) {
    const maxA = Math.max(...scored.map((p) => p.area));
    keep = scored.filter((p) => p.area >= maxA * 0.05);
  }
  return keep;
}

// Fine-detail supersample for the mono path. The mono cell is already 1-bit, so
// (unlike color) we must resample the cell region from the ORIGINAL source
// image, then threshold at the higher resolution, mirroring binarizeFull's hard
// threshold + invert and re-applying the slicer's ownership mask so a touching
// neighbour's ink stays out of the cell.
export function detailScale(cellH: number): number {
  const TARGET = 320,
    CAP = 3;
  return Math.max(1, Math.min(CAP, Math.ceil(TARGET / Math.max(1, cellH))));
}

function supersampleMonoCell(
  img: HTMLImageElement | ImageBitmap,
  cx0: number,
  cy0: number,
  cx1: number,
  cy1: number,
  scale: number,
  threshold: number,
  invert: boolean,
  ownerFn: ((x: number, y: number) => number) | null,
  cellIdx: number,
): { data: Uint8ClampedArray; w: number; h: number } {
  const cw = cx1 - cx0,
    ch = cy1 - cy0;
  const ow = cw * scale,
    oh = ch * scale;
  const c = document.createElement('canvas');
  c.width = ow;
  c.height = oh;
  const ctx = c.getContext('2d') as CanvasRenderingContext2D;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, ow, oh);
  ctx.drawImage(img as CanvasImageSource, cx0, cy0, cw, ch, 0, 0, ow, oh);
  const id = ctx.getImageData(0, 0, ow, oh);
  const d = id.data;
  for (let p = 0; p < d.length; p += 4) {
    let lum = 0.299 * d[p] + 0.587 * d[p + 1] + 0.114 * d[p + 2];
    if (invert) lum = 255 - lum;
    let v = lum < threshold ? 0 : 255;
    if (v === 0 && ownerFn) {
      const px = (p >> 2) % ow;
      const py = ((p >> 2) / ow) | 0;
      const owner = ownerFn(cx0 + Math.floor(px / scale), cy0 + Math.floor(py / scale));
      if (owner !== -1 && owner !== cellIdx) v = 255;
    }
    d[p] = d[p + 1] = d[p + 2] = v;
    d[p + 3] = 255;
  }
  return { data: d, w: ow, h: oh };
}

async function rowToGlyphs(
  data: Uint8ClampedArray,
  W: number,
  H: number,
  y0: number,
  y1: number,
  chars: string,
  opts: TraceOpts,
  override: SlicerKind = 'auto',
  sourceImg?: HTMLImageElement | ImageBitmap | null,
): Promise<{ glyphs: Glyph[]; slicer: PickedSlicer; forced: boolean; cellCount: number }> {
  const TC = w().TracerCore;
  const expected = chars.length;
  const { ranges, ownerFn, slicer, forced } = pickRanges(data, W, y0, y1, expected, chars, override);
  const cellCount = ranges.length;
  const baselineAbs = TC.detectBaselineInRow(data, W, y0, y1);
  const rowH = y1 - y0;
  const pad = 2;

  const use = ranges.slice(0, expected);
  while (use.length < expected) use.push([0, 0]);

  const glyphs: Glyph[] = [];
  for (let i = 0; i < expected; i++) {
    const ch = chars[i];
    const [x0, x1] = use[i];
    if (x1 <= x0) continue;
    const cx0 = Math.max(0, x0 - pad);
    const cx1 = Math.min(W, x1 + pad);
    const cy0 = Math.max(0, y0 - pad);
    const cy1 = Math.min(H, y1 + pad);
    const map = TC.mapCellToGlyph(cx0, cy0, cx1, cy1, baselineAbs);
    const scale = opts.fineDetail && sourceImg ? detailScale(cy1 - cy0) : 1;
    let svg: string;
    if (scale > 1 && sourceImg) {
      const ssCell = supersampleMonoCell(sourceImg, cx0, cy0, cx1, cy1, scale, opts.threshold, opts.invert, ownerFn, i);
      svg = await TC.traceCellBitmap(ssCell, opts.turdsize, opts.optcurve, opts.alphamax, opts.opttolerance, 1 / scale);
    } else {
      const cell = TC.extractCellBinary(data, W, cx0, cx1, cy0, cy1, ownerFn, i);
      svg = await TC.traceCellBitmap(cell, opts.turdsize, opts.optcurve, opts.alphamax, opts.opttolerance);
    }
    const paths = TC.extractPathDFromSvg(svg);
    const keep = filterFilledGlyphPaths(paths, rowH, map.baselineYInCell);
    if (keep.length === 0) continue;
    glyphs.push({
      char: ch,
      italic: false,
      paths: keep.map((p) => p.d),
      cellW: map.cellW,
      cellH: map.cellH,
      baselineYInCell: map.baselineYInCell,
    });
  }
  return { glyphs, slicer, forced, cellCount };
}

export interface GlyphReport {
  char: string;
  status: string; // 'ok' | 'empty' | 'excluded'
  flags: string[]; // 'wide' | 'narrow' | 'filled' | 'empty'
}

// Per-row trace diagnostics for the mono path, so a mis-cut row can be rescued
// with a different slicer without rebuilding the whole sheet from scratch.
export interface MonoRowInfo {
  index: number;
  chars: string;
  slicer: PickedSlicer; // which slicer produced the cells
  forced: boolean; // true when the natural cut missed the count and a forced cut was used
  cellCount: number; // cells the slicer found
  expected: number; // characters the charset row expects
  glyphCount: number; // glyphs that survived tracing
}

export interface TraceResult {
  glyphs: Glyph[];
  rowWarning: string;
  detectedRows: number;
  report: GlyphReport[];
  rows: MonoRowInfo[];
}

/** Width-outlier health flags for a flat glyph list, vs the median cell width.
 *  Shared by the full trace and a single-row re-slice so both report the same. */
function reportForGlyphs(glyphs: Glyph[]): GlyphReport[] {
  const widths = glyphs.map((g) => g.cellW).filter((x) => x > 0).sort((a, b) => a - b);
  const med = widths.length ? widths[widths.length >> 1] : 0;
  return glyphs.map((g) => {
    const flags: string[] = [];
    if (med) {
      if (g.cellW > med * 1.9) flags.push('wide');
      else if (g.cellW < med * 0.34) flags.push('narrow');
    }
    return { char: g.char, status: 'ok', flags };
  });
}

/** Quick layout probe on drop: how many rows, and roughly how many cells in the
 *  top row. Used to auto-guess the charset template (mirrors the source tool,
 *  which guesses the template from the detected layout). */
export function detectLayout(img: HTMLImageElement | ImageBitmap): { rows: number; cells0: number } {
  const TC = w().TracerCore;
  const iw = (img as HTMLImageElement).naturalWidth ?? (img as ImageBitmap).width;
  const ih = (img as HTMLImageElement).naturalHeight ?? (img as ImageBitmap).height;
  const bin = TC.binarizeFull(img, iw, ih, DEFAULT_TRACE.threshold, DEFAULT_TRACE.invert, DEFAULT_TRACE.weight);
  const rows = TC.detectRowsInBinary(bin.data, bin.w, bin.h) as number[][];
  let cells0 = 0;
  if (rows.length) {
    try {
      cells0 = TC.sliceRowByWhitespace(bin.data, bin.w, rows[0][0], rows[0][1]).length;
    } catch {
      cells0 = 0;
    }
  }
  return { rows: rows.length, cells0 };
}

export interface SheetGeometry {
  w: number;
  h: number;
  rows: { y0: number; y1: number; cells: [number, number][] }[];
}

/** Merge adjacent ink runs separated by a gap that is a strong OUTLIER below the
 *  row's typical gap. A glyph with an internal vertical gap (a split double-quote,
 *  a %, a bracket) leaves a gap far smaller than the spacing between glyphs, so it
 *  over-reads a row's cell count; this rejoins it. Measuring against the median
 *  GAP (not glyph width) adapts to each row's spacing: even rows, tight rows, and
 *  wide rows all keep their real separators while only the outlier intra-glyph
 *  gaps collapse. Used for the per-row count that drives the charset guess; the
 *  trace recovers via the anchored-minima fallback once the count is right. */
export function mergeNarrowRuns(runs: number[][], frac = 0.35): number[][] {
  // need at least three runs (two gaps) for a meaningful median; otherwise the
  // gap could be intra- or inter-glyph and merging is a guess, so leave it.
  if (runs.length < 3) return runs.map((r) => r.slice());
  const gaps: number[] = [];
  for (let i = 1; i < runs.length; i++) gaps.push(runs[i][0] - runs[i - 1][1]);
  const medGap = [...gaps].sort((a, b) => a - b)[gaps.length >> 1] || 1;
  const minGap = medGap * frac;
  const out: number[][] = [runs[0].slice()];
  for (let i = 1; i < runs.length; i++) {
    const prev = out[out.length - 1];
    if (runs[i][0] - prev[1] < minGap) prev[1] = runs[i][1];
    else out.push(runs[i].slice());
  }
  return out;
}

/** Full layout geometry for the source overlay: every detected row band and the
 *  cell cuts within it, in the image's own pixel coordinates. Lets the UI draw
 *  the rows and cells the maker found, so the user can confirm the cut before
 *  trusting the build. Same probe the trace uses, run once over the whole sheet.
 *  Cell counts go through mergeNarrowRuns so an ornate glyph's internal gap does
 *  not over-read the row. */
// A color sheet's letters are colored (yellow is luminance ~200), so the mono
// cutoff (128) reads them as background and they vanish, which breaks the row
// detection on color sheets (yellow letters drop out, rows go uncounted). For a
// color sheet, treat anything that is not near-white as ink, so yellow, pink, and
// black all count as a letter and every row is found. The color build's own pass
// is already background-aware (bgDist); this only fixes the geometry probe that
// feeds the layout overlay and the charset row count.
const COLOR_GEOM_THRESHOLD = 240;

// Split the ink's vertical extent into n even horizontal bands. Used when the row
// count is known (a generated preset) but drop shadows bridge the rows and defeat
// the gap-based detector, so it would otherwise under-count them.
function evenBands(data: ArrayLike<number>, w: number, h: number, n: number): number[][] {
  let top = -1;
  let bot = -1;
  for (let y = 0; y < h; y++) {
    let has = false;
    for (let x = 0; x < w; x++)
      if (data[y * w + x] === 0) {
        has = true;
        break;
      }
    if (has) {
      if (top < 0) top = y;
      bot = y;
    }
  }
  if (top < 0) return [];
  const bandH = (bot - top + 1) / n;
  const out: number[][] = [];
  for (let r = 0; r < n; r++) out.push([Math.round(top + r * bandH), Math.round(top + (r + 1) * bandH)]);
  return out;
}

export function detectGeometry(
  img: HTMLImageElement | ImageBitmap,
  isColor = false,
  forceRows = 0,
): SheetGeometry {
  const TC = w().TracerCore;
  const iw = (img as HTMLImageElement).naturalWidth ?? (img as ImageBitmap).width;
  const ih = (img as HTMLImageElement).naturalHeight ?? (img as ImageBitmap).height;
  // A color sheet with no known row count: detect rows on the shadow-stripped
  // image via the color engine's own pass (palette + drop-shadow strip +
  // color-distance union), so pink drop shadows can't bridge the rows into one
  // blob. The mono luminance probe below can't strip a color shadow, so without
  // this the row count collapses and the charset guess maps the whole alphabet
  // onto a single A-M row (only A-M builds). Falls back to the mono probe if the
  // engine isn't loaded or can't read the sheet.
  if (isColor && forceRows < 2) {
    const CM = (w() as { ColorMaker?: { detectColorGeometry?: (i: unknown) => SheetGeometry } }).ColorMaker;
    if (CM && typeof CM.detectColorGeometry === 'function') {
      try {
        const g = CM.detectColorGeometry(img);
        if (g && g.rows && g.rows.length) {
          // Use the engine's whitespace cells as-is. mergeNarrowRuns is for the
          // mono probe, where an ornate glyph's internal gap over-reads a row; on
          // the color union the offset shadow makes inter-letter gaps uneven, so
          // merging there under-counts a row and the charset guess then mislabels
          // it (a letter half read as the digit row). The engine's per-row cell
          // count is already the right granularity for a color sheet.
          return {
            w: g.w,
            h: g.h,
            rows: g.rows.map((r) => ({ y0: r.y0, y1: r.y1, cells: r.cells as [number, number][] })),
          };
        }
      } catch {
        /* fall through to the mono luminance probe */
      }
    }
  }
  const threshold = isColor ? COLOR_GEOM_THRESHOLD : DEFAULT_TRACE.threshold;
  const bin = TC.binarizeFull(img, iw, ih, threshold, DEFAULT_TRACE.invert, DEFAULT_TRACE.weight);
  const bands =
    forceRows >= 2
      ? evenBands(bin.data, bin.w, bin.h, forceRows)
      : (TC.detectRowsInBinary(bin.data, bin.w, bin.h) as number[][]);
  const rows = bands.map(([y0, y1]) => {
    let cells: [number, number][] = [];
    try {
      cells = mergeNarrowRuns(TC.sliceRowByWhitespace(bin.data, bin.w, y0, y1)) as [number, number][];
    } catch {
      cells = [];
    }
    return { y0, y1, cells };
  });
  return { w: iw, h: ih, rows };
}

/** Pick a charset template from the detected layout. Common alphabet-sheet
 *  shapes: 13-per-row A-M/N-Z splits (most AI/hand sheets, like the fire sheet),
 *  or full 26-per-row rows. The user can always correct the charset box. */
export function guessCharset(rows: number, cells0: number): string[] {
  const AM = 'ABCDEFGHIJKLM',
    NZ = 'NOPQRSTUVWXYZ',
    am = 'abcdefghijklm',
    nz = 'nopqrstuvwxyz',
    AZ = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
    az = 'abcdefghijklmnopqrstuvwxyz',
    digits = '0123456789',
    punct = ".,!?:;'-&@#";
  const split13 = cells0 > 0 && cells0 <= 16; // ~13 cells per row -> the split layout
  switch (rows) {
    case 1:
      return [AZ];
    case 2:
      return [AZ, az];
    case 3:
      return [AZ, az, digits];
    case 4:
      return split13 ? [AM, NZ, am, nz] : [AZ, az, digits, punct];
    case 5:
      // non-split has no clean 5-row template — fall back so the row-mismatch
      // warning fires instead of guessing duplicate/colliding rows.
      return split13 ? [AM, NZ, am, nz, digits] : DEFAULT_CHAR_LINES;
    case 6:
      return split13 ? [AM, NZ, am, nz, digits, punct] : DEFAULT_CHAR_LINES;
    default:
      return DEFAULT_CHAR_LINES;
  }
}

// A standard punctuation bank in a common keyboard order. Punctuation rows are
// filled from here in sequence. The exact symbols vary from sheet to sheet and
// the slicer over-counts ornate glyphs, so a punctuation row is a best guess to
// confirm in the charset box, unlike the letters and digits which are exact.
const PUNCT_BANK = "!?@#$%^&*()-_+=[]{};:'\",.<>/\\|~`";

/** Build the charset from the per-row cell counts (from detectGeometry), which is
 *  far more accurate than the row-count template guess: it pins the A-M/N-Z/a-m/n-z
 *  split (or full A-Z/a-z), the digits row (~10 cells), and one charset line per
 *  detected row, so the row count always matches and letters/digits land exactly.
 *  Punctuation rows are sized to their detected cell count from the bank above. */
export function guessCharsetFromRows(cellsPerRow: number[]): string[] {
  const HALVES = ['ABCDEFGHIJKLM', 'NOPQRSTUVWXYZ', 'abcdefghijklm', 'nopqrstuvwxyz'];
  const FULLS = ['ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz'];
  const DIGITS = '0123456789';
  const n = cellsPerRow.length;
  if (n === 0) return DEFAULT_CHAR_LINES;

  const lines: string[] = [];
  let i = 0;
  const split = cellsPerRow[0] <= 16; // ~13 cells per row is the split alphabet
  // Place the alphabet and digit rows by POSITION, not by matching each row's
  // exact cell count. A colored drop shadow or a touching glyph pair makes the
  // trace over- or under-read a row by a glyph or two, and on a real sheet the
  // digit row (~10) overlaps the letter/punctuation rows (~12-13) in count, so a
  // hard count window mislabels the digit row as punctuation and the digits never
  // build. Every generate prompt and preset uses this fixed layout; a
  // non-standard sheet stays correctable in the charset box.
  if (split) {
    for (let h = 0; h < 4 && i < n; h++, i++) lines.push(HALVES[h]);
  } else {
    for (let h = 0; h < 2 && i < n; h++, i++) lines.push(FULLS[h]);
  }
  // the row right after the alphabet is the digit row, unless it is clearly a
  // large punctuation row (a sheet with no digits is rare and box-correctable)
  if (i < n && cellsPerRow[i] <= 15) {
    lines.push(DIGITS);
    i++;
  }
  // the remaining rows are punctuation, sized to each row's cell count and
  // advancing through the bank so two punctuation rows do not collide
  let p = 0;
  for (; i < n; i++) {
    const take = Math.min(Math.max(cellsPerRow[i], 1), PUNCT_BANK.length - p);
    lines.push(take > 0 ? PUNCT_BANK.slice(p, p + take) : PUNCT_BANK.slice(0, Math.max(1, cellsPerRow[i])));
    p += Math.max(take, 0);
  }
  while (lines.length < n) lines.push(PUNCT_BANK.slice(0, 8));
  return lines.slice(0, n);
}

// Live mono build session: the binarized sheet plus per-row glyphs, kept so a
// single row can be re-sliced and the font rebuilt without re-reading the image.
interface MonoSession {
  data: Uint8ClampedArray;
  W: number;
  H: number;
  bands: number[][]; // detected row y-bands [y0, y1]
  lines: string[]; // charset chars per row
  opts: TraceOpts;
  rowGlyphs: Glyph[][]; // traced glyphs, per row
  rowInfo: MonoRowInfo[];
  sourceImg: HTMLImageElement | ImageBitmap; // kept for fine-detail re-slices
}
let _monoSession: MonoSession | null = null;

/** Trace a loaded image (alphabet sheet) into glyph objects, and report a
 *  row-mismatch warning when the detected row count differs from the charset
 *  (the loudest "this is misaligned" signal, mirroring the source tool).
 *  Keeps a per-row session so a mis-cut row can be re-sliced afterward. */
export async function traceSheet(
  img: HTMLImageElement | ImageBitmap,
  rowChars: string[],
  opts: TraceOpts,
  onProgress?: Progress,
): Promise<TraceResult> {
  const TC = w().TracerCore;
  const iw = (img as HTMLImageElement).naturalWidth ?? (img as ImageBitmap).width;
  const ih = (img as HTMLImageElement).naturalHeight ?? (img as ImageBitmap).height;
  onProgress?.('binarize', 'threshold · otsu adaptive');
  const bin = TC.binarizeFull(img, iw, ih, opts.threshold, opts.invert, opts.weight);
  onProgress?.('slice', 'detecting rows + cells');
  const bands = TC.detectRowsInBinary(bin.data, bin.w, bin.h) as number[][];
  const lines = rowChars.filter((r) => r.length > 0);
  const rowWarning =
    bands.length !== lines.length
      ? `detected ${bands.length} rows but your charset has ${lines.length} lines. Glyphs are probably misaligned; edit the charset to match your sheet.`
      : '';
  const n = Math.min(bands.length, lines.length);
  const rowGlyphs: Glyph[][] = [];
  const rowInfo: MonoRowInfo[] = [];
  for (let i = 0; i < n; i++) {
    onProgress?.('trace', `row ${i + 1}/${n} · contours`);
    const r = await rowToGlyphs(bin.data, bin.w, bin.h, bands[i][0], bands[i][1], lines[i], opts, 'auto', img);
    rowGlyphs.push(r.glyphs);
    rowInfo.push({ index: i, chars: lines[i], slicer: r.slicer, forced: r.forced, cellCount: r.cellCount, expected: lines[i].length, glyphCount: r.glyphs.length });
  }
  const glyphs = rowGlyphs.flat();
  const report = reportForGlyphs(glyphs);
  _monoSession = { data: bin.data, W: bin.w, H: bin.h, bands, lines, opts, rowGlyphs, rowInfo, sourceImg: img };
  return { glyphs, rowWarning, detectedRows: bands.length, report, rows: rowInfo };
}

/** Re-slice one mono row with a chosen slicer (and the current trace opts, so a
 *  threshold change takes effect), then rebuild the font. Rolls the row back if
 *  the rebuild fails, so the session stays usable. */
export async function editMonoRow(
  rowIndex: number,
  slicer: SlicerKind,
  family: string,
  opts: TraceOpts,
  onProgress?: Progress,
): Promise<{ result: FontResult; glyphCount: number; report: GlyphReport[]; rows: MonoRowInfo[] }> {
  const s = _monoSession;
  if (!s) throw new Error('no mono build session — build a font first');
  if (rowIndex < 0 || rowIndex >= s.rowGlyphs.length) throw new Error('bad row index ' + rowIndex);
  const prevGlyphs = s.rowGlyphs[rowIndex];
  const prevInfo = s.rowInfo[rowIndex];
  const prevOpts = s.opts;
  try {
    const band = s.bands[rowIndex];
    const chars = s.lines[rowIndex];
    const r = await rowToGlyphs(s.data, s.W, s.H, band[0], band[1], chars, opts, slicer, s.sourceImg);
    s.rowGlyphs[rowIndex] = r.glyphs;
    s.opts = opts;
    s.rowInfo[rowIndex] = { index: rowIndex, chars, slicer: r.slicer, forced: r.forced, cellCount: r.cellCount, expected: chars.length, glyphCount: r.glyphs.length };
    const glyphs = s.rowGlyphs.flat();
    if (!glyphs.length) throw new Error('no glyphs left after re-slicing this row');
    const result = await buildFont(glyphs, { family: family.trim() || 'Handmade', formats: ['otf', 'ttf', 'woff2'] }, onProgress);
    return { result, glyphCount: glyphs.length, report: reportForGlyphs(glyphs), rows: s.rowInfo.slice() };
  } catch (e) {
    s.rowGlyphs[rowIndex] = prevGlyphs;
    s.rowInfo[rowIndex] = prevInfo;
    s.opts = prevOpts;
    throw e;
  }
}

// ---- worker font build -----------------------------------------------------

let _worker: Worker | null = null;
let _next = 0;
const _reqs = new Map<number, { resolve: (v: FontResult) => void; reject: (e: Error) => void; progress?: Progress }>();

function getWorker(): Worker {
  if (_worker) return _worker;
  _worker = new Worker(`/assets/vendor/font-engine-worker.js?v=${ENGINE_VERSION}`);
  _worker.addEventListener('message', (e: MessageEvent) => {
    const { id, type, payload } = e.data || {};
    const req = _reqs.get(id);
    if (!req) return;
    if (type === 'progress') req.progress?.(payload?.step ?? 'build', payload?.message ?? '');
    else if (type === 'result') {
      _reqs.delete(id);
      req.resolve(payload);
    } else if (type === 'error') {
      _reqs.delete(id);
      req.reject(new Error(payload?.message || 'worker failed'));
    }
  });
  _worker.addEventListener('error', (e) => {
    for (const [id, req] of _reqs) {
      req.reject(new Error('worker crashed: ' + (e.message || 'unknown')));
      _reqs.delete(id);
    }
    _worker = null;
  });
  return _worker;
}

export interface BuildOpts {
  family: string;
  style?: string;
  upm?: number;
  formats?: Array<'otf' | 'ttf' | 'woff' | 'woff2'>;
}

function rawWorkerBuild(payload: unknown, onProgress?: Progress): Promise<FontResult> {
  return new Promise((resolve, reject) => {
    const wk = getWorker();
    const id = ++_next;
    _reqs.set(id, { resolve, reject, progress: onProgress });
    wk.postMessage({ id, type: 'generate', payload });
  });
}

/** Build font files from traced glyphs via the worker, then correct table
 *  checksums (the worker's woff2 wrapped the uncorrected otf, so re-wrap from
 *  the fixed otf) and validate. Throws if the font fails validation. */
export async function buildFont(glyphs: Glyph[], opts: BuildOpts, onProgress?: Progress): Promise<FontResult> {
  const payload = {
    glyphs: glyphs.map((g) => ({
      char: g.char,
      italic: !!g.italic,
      paths: g.paths,
      cellW: g.cellW,
      cellH: g.cellH,
      baselineYInCell: g.baselineYInCell,
    })),
    family: opts.family,
    style: opts.style ?? 'Regular',
    upm: opts.upm ?? 1000,
    useCellWidth: true,
    tightAdvance: false,
    sideBearingPct: 0.05,
    formats: opts.formats ?? ['otf', 'ttf', 'woff2'],
    features: null,
    embedHints: false,
    embedTTHints: false,
    opticalSidebearings: false,
  };
  const raw = await rawWorkerBuild(payload, onProgress);
  const otf = raw.otf ? fixSfntChecksums(raw.otf) : undefined;
  const ttf = raw.ttf ? fixSfntChecksums(raw.ttf) : undefined;
  let woff2 = raw.woff2;
  if (otf && w().wrapAsWoff2) {
    try {
      await w().wawoff2Ready;
      woff2 = await w().wrapAsWoff2(otf);
    } catch {
      /* fall back to the worker's woff2 */
    }
  }
  await assertValid(otf);
  return { otf, ttf, woff2, _hinting: raw._hinting };
}

// ---- sample sheet + download ----------------------------------------------

const MIME: Record<string, string> = {
  otf: 'font/otf',
  ttf: 'font/ttf',
  woff: 'font/woff',
  woff2: 'font/woff2',
};

export function downloadFont(bytes: Uint8Array, family: string, fmt: string) {
  const blob = new Blob([bytes as BlobPart], { type: MIME[fmt] || 'application/octet-stream' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${family.replace(/\s+/g, '')}.${fmt}`;
  a.click();
  URL.revokeObjectURL(url);
}

/** Render a clean three-row sample alphabet sheet so the maker can be tried
 *  without an upload. Renders in a heavy face for crisp tracing. */
export function makeSampleSheet(family = 'Anton, system-ui, sans-serif'): HTMLCanvasElement {
  const W = 2000;
  const rowH = 240;
  const H = rowH * ROW_CHARS.length + 80;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = '#000000';
  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = 'center';
  ROW_CHARS.forEach((row, r) => {
    const y = 60 + r * rowH + rowH * 0.62;
    const n = row.length;
    const cellW = W / n;
    // Size the row so even its widest glyph leaves a clear gap inside its cell:
    // a condensed face (Anton) at full size touches its neighbours, and the
    // whitespace slicer needs an empty column between every pair to read them
    // as separate cells. Measure the widest letter and scale to fit.
    let size = 130;
    ctx.font = `700 ${size}px ${family}`;
    const widest = Math.max(...[...row].map((ch) => ctx.measureText(ch).width)) || 1;
    const maxGlyphW = cellW * 0.7;
    if (widest > maxGlyphW) {
      size = Math.max(48, Math.floor((size * maxGlyphW) / widest));
      ctx.font = `700 ${size}px ${family}`;
    }
    for (let i = 0; i < n; i++) {
      ctx.fillText(row[i], i * cellW + cellW / 2, y);
    }
  });
  return c;
}

export function canvasToImage(c: HTMLCanvasElement): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('sample sheet render failed'));
    img.src = c.toDataURL('image/png');
  });
}

// ---- color fonts (COLR/CPAL, built on the main thread) -------------------

export type ColorMode = 'flat' | 'gradient';

export interface ColorResult {
  otf: Uint8Array;
  woff2?: Uint8Array;
  mode: ColorMode;
  colrStatus: string;
  charCount: number;
  rowWarning?: string;
  glowWarning?: boolean;
  report?: GlyphReport[];
}

/** Resolve once the color engine + main-thread wawoff2 are present. */
export function waitForColorEngine(timeoutMs = 20000): Promise<void> {
  return new Promise((resolve, reject) => {
    const ready = () =>
      w().ColorMaker && w().buildColorFont && w().buildGradientFont && w().ColorCore && w().wrapAsWoff2 && w().validateFont;
    if (ready()) return resolve();
    const t0 = Date.now();
    const iv = setInterval(() => {
      if (ready()) {
        clearInterval(iv);
        resolve();
      } else if (Date.now() - t0 > timeoutMs) {
        clearInterval(iv);
        reject(new Error('color engine did not load'));
      }
    }, 50);
  });
}

/** Build a COLR/CPAL color font from a sheet. Runs on the main thread; woff2
 *  is compressed via the main-thread wawoff2. Returns OTF + WOFF2 (no TTF). */
export async function buildColorFontFromImage(
  img: HTMLImageElement | ImageBitmap,
  mode: ColorMode,
  family: string,
  charLines: string[],
  colorOpts: ColorOpts,
  onProgress?: Progress,
): Promise<ColorResult> {
  onProgress?.('separate', mode === 'gradient' ? 'palette + gradient sampling' : 'palette + color separation');
  const res = await w().ColorMaker.buildColorFromImage(img, {
    mode,
    familyName: family || 'Color Font',
    charLines: charLines.filter((l) => l.length > 0),
    K: colorOpts.K,
    stops: colorOpts.stops,
    bgDist: colorOpts.bgDist,
    outline: colorOpts.outline,
    gloss: colorOpts.gloss,
    fineDetail: !!colorOpts.fineDetail,
  });
  onProgress?.('build', `COLR ${res.colrStatus} · packing`);
  // correct table checksums BEFORE wrapping woff2 (so the woff2 wraps valid otf)
  const otf = fixSfntChecksums(res.otf as Uint8Array);
  let woff2: Uint8Array | undefined;
  try {
    woff2 = await w().wrapAsWoff2(otf);
  } catch {
    /* woff2 is optional; the otf is the source of truth */
  }
  await assertValid(otf);
  return {
    otf,
    woff2,
    mode,
    colrStatus: res.colrStatus,
    charCount: res.charCount ?? 0,
    rowWarning: res.rowWarning || '',
    glowWarning: !!res.glowWarning,
    report: res.report || [],
  };
}

export type EditAction = 'retrace' | 'reslice' | 'exclude';
export interface EditParams {
  turd?: number;
  left?: number;
  right?: number;
  excluded?: boolean;
}

/** Edit one glyph in the live color session (re-trace / re-slice / exclude) and
 *  re-assemble. Re-runs only that record + the records->font step, never the
 *  image pipeline. Returns the rebuilt font + the refreshed per-glyph report. */
export async function editColorGlyph(action: EditAction, idx: number, params: EditParams): Promise<ColorResult> {
  const res = await w().ColorMaker.editGlyph(action, idx, params);
  const otf = fixSfntChecksums(res.otf as Uint8Array);
  let woff2: Uint8Array | undefined;
  try {
    woff2 = await w().wrapAsWoff2(otf);
  } catch {
    /* woff2 optional */
  }
  await assertValid(otf);
  return {
    otf,
    woff2,
    mode: (res.mode as ColorMode) ?? 'gradient',
    colrStatus: res.colrStatus,
    charCount: res.charCount ?? 0,
    report: res.report || [],
  };
}

/** A color sample sheet: the alphabet filled with a vertical flame gradient
 *  per row, so both gradient (smooth COLRv1) and flat (posterised COLRv0) modes
 *  have real color to separate. */
export function makeColorSampleSheet(family = 'Anton, system-ui, sans-serif'): HTMLCanvasElement {
  const W = 2000;
  const rowH = 240;
  const H = rowH * ROW_CHARS.length + 80;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, W, H);
  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = 'center';
  ROW_CHARS.forEach((row, r) => {
    const top = 60 + r * rowH;
    const baseY = top + rowH * 0.62;
    const n = row.length;
    const cellW = W / n;
    // size the row so its widest glyph leaves a clear gap inside its cell (see
    // makeSampleSheet) so the slicer reads every letter as its own cell
    let size = 130;
    ctx.font = `700 ${size}px ${family}`;
    const widest = Math.max(...[...row].map((ch) => ctx.measureText(ch).width)) || 1;
    const maxGlyphW = cellW * 0.7;
    if (widest > maxGlyphW) {
      size = Math.max(48, Math.floor((size * maxGlyphW) / widest));
      ctx.font = `700 ${size}px ${family}`;
    }
    // flame: deep red at the foot, gold at the top of the row band
    const grad = ctx.createLinearGradient(0, baseY, 0, top + rowH * 0.05);
    grad.addColorStop(0, '#c41608');
    grad.addColorStop(0.45, '#e64a0c');
    grad.addColorStop(0.8, '#f7a01e');
    grad.addColorStop(1, '#ffde5a');
    ctx.fillStyle = grad;
    for (let i = 0; i < n; i++) ctx.fillText(row[i], i * cellW + cellW / 2, baseY);
  });
  return c;
}

export function fileToImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('could not read that image'));
    };
    img.src = url;
  });
}
