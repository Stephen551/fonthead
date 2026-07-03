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
  /** Letter spacing, percent of UPM per side. 0/unset keeps the engine default. */
  spacingPct?: number;
}
export const DEFAULT_COLOR_OPTS: ColorOpts = { K: 3, stops: 5, bgDist: 20, outline: false, gloss: false, fineDetail: false };

export interface Glyph {
  char: string;
  italic: boolean;
  paths: string[];
  cellW: number;
  cellH: number;
  baselineYInCell: number;
  /**
   * Optional OpenType-style variant tag (`.cv01`, `.cv02`, ...) for the natural
   * variation build. Bases carry none; variant sheets are merged in carrying one.
   * Variant glyphs are appended unicode-less so the cmap and base GIDs stay stable.
   */
  variantSuffix?: string;
}

/**
 * Merge a natural-variation palette (the same hand drawn N times, differing only
 * in the exit flick) into one glyph list for a single build.
 *
 * `sheets[0]` is the base (carried through with no suffix). Each later sheet `i`
 * contributes `.cv0i` variants, but only for chars that exist in the base — an
 * orphan variant (no matching base letter) is dropped, and a base letter missing
 * from a variant sheet simply gets fewer variants. A single sheet is returned
 * unchanged, so the default one-sheet build never grows a variant. Pure: never
 * mutates the input glyphs.
 */
export function mergeVariantSheets(sheets: Glyph[][]): Glyph[] {
  if (sheets.length === 0) return [];
  const base = sheets[0];
  if (sheets.length === 1) return base;

  const baseChars = new Set(base.map((g) => g.char));
  const out: Glyph[] = [...base];
  for (let i = 1; i < sheets.length; i++) {
    const suffix = '.cv' + String(i).padStart(2, '0');
    for (const g of sheets[i]) {
      if (baseChars.has(g.char)) out.push({ ...g, variantSuffix: suffix });
    }
  }
  return out;
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

// Cache-buster for the vendored engine: the content hash injected at build
// (astro.config.mjs engineVersion(), same token the make.astro <script> tags use),
// so any engine edit busts the worker too. The worker reads this ?v off its own URL
// and propagates it to every importScripts — never hand-bump a version again.
declare const __ENGINE_V__: string;
const ENGINE_VERSION = typeof __ENGINE_V__ === 'string' ? __ENGINE_V__ : '0.8.59';

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
): { ranges: number[][]; ownerFn: any; slicer: PickedSlicer; forced: boolean; naturalCount: number } {
  const TC = w().TracerCore;
  // naturalCount = how many cells the NATURAL (non-forced) slicers found. When a
  // row's letters run together (a connected cursive drawn as one line) this is
  // far below expected even though the forced cut still returns `expected` cells
  // sliced at arbitrary minima — the signal that the letters are fused.
  // explicit override: run exactly that slicer, no cascade
  if (override === 'whitespace') {
    const r = TC.sliceRowByWhitespace(data, W, y0, y1);
    return { ranges: r, ownerFn: null, slicer: 'whitespace', forced: false, naturalCount: r.length };
  }
  if (override === 'anchored')
    return { ranges: TC.sliceRowByAnchoredMinima(data, W, y0, y1, expected), ownerFn: null, slicer: 'anchored', forced: false, naturalCount: expected };
  if (override === 'components') {
    const comp = TC.sliceRowByComponents(data, W, y0, y1, expected, DEFAULT_TRACE.turdsize);
    return { ranges: comp.ranges, ownerFn: comp.ownerFn, slicer: 'components', forced: false, naturalCount: comp.ranges.length };
  }
  if (override === 'ownership') {
    const owned = TC.sliceRowByAnchoredWithOwnership(data, W, y0, y1, expected, DEFAULT_TRACE.turdsize);
    return { ranges: owned.ranges, ownerFn: owned.ownerFn, slicer: 'ownership', forced: false, naturalCount: owned.ranges.length };
  }
  // auto cascade: prefer the natural cut, fall back to a count-forced one
  const symbols = /[^A-Za-z0-9 ]/.test(chars);
  if (symbols) {
    const comp = TC.sliceRowByComponents(data, W, y0, y1, expected, DEFAULT_TRACE.turdsize);
    if (comp.ranges.length === expected) return { ranges: comp.ranges, ownerFn: comp.ownerFn, slicer: 'components', forced: false, naturalCount: comp.ranges.length };
    const owned = TC.sliceRowByAnchoredWithOwnership(data, W, y0, y1, expected, DEFAULT_TRACE.turdsize);
    if (owned.ranges.length === expected) return { ranges: owned.ranges, ownerFn: owned.ownerFn, slicer: 'ownership', forced: false, naturalCount: owned.ranges.length };
    return { ranges: TC.sliceRowByAnchoredMinima(data, W, y0, y1, expected), ownerFn: null, slicer: 'anchored', forced: true, naturalCount: Math.max(comp.ranges.length, owned.ranges.length) };
  }
  const ws = TC.sliceRowByWhitespace(data, W, y0, y1);
  if (ws.length === expected) return { ranges: ws, ownerFn: null, slicer: 'whitespace', forced: false, naturalCount: ws.length };
  return { ranges: TC.sliceRowByAnchoredMinima(data, W, y0, y1, expected), ownerFn: null, slicer: 'anchored', forced: true, naturalCount: ws.length };
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

// ·px — a sheet whose MEDIAN row height is under this is under-resolved (a GPT
// image tops out ~1024-1536px, so a 7-row sheet leaves ~80-160px cells whose
// Potrace outlines come out lumpy). The maker auto-enables the fine-detail
// supersample below this; the advanced toggle stays the off switch. Sheets at
// or above ~320px cells are a detailScale no-op by construction.
export const AUTO_FINE_ROWH = 200;

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

/** Cull a neighbour row's descender tip from a cell: the valley split of a
 *  tightly-leaded sheet cuts where rows interleave, so the row above's g/j/y
 *  tails can land as small stray marks at a cell's TOP edge (the breve-like
 *  tick judged above m and u). The mono twin of color-core separateGlyph's
 *  edge-strip cull. A foreign tip is DISCONNECTED, touches the top edge, stays
 *  in the top zone, and is a small share of the ink; an i/j dot is detached but
 *  never touches the top, an ascender runs deep, a counter (hole contour) sits
 *  inside its parent's box, and a glyph that IS a small high mark (a quote)
 *  keeps itself because it is most of its own ink. */
function cullForeignTopTails<T extends { d: string; bb: { minX: number; maxX: number; minY: number; maxY: number }; area: number }>(
  paths: T[],
  cellH: number,
): T[] {
  const estimateBBox = w().estimateBBox;
  if (!estimateBBox) return paths;
  // Potrace emits ONE compound path per cell (several M subpaths in one d), so
  // the foreign tail hides inside the letter's own path entry. Explode to
  // subpaths, judge each, reassemble.
  type Sub = { ei: number; d: string; bb: { minX: number; maxX: number; minY: number; maxY: number } | null; area: number };
  const subs: Sub[] = [];
  paths.forEach((p, ei) => {
    for (const sd of p.d.split(/(?=M)/).map((s) => s.trim()).filter(Boolean)) {
      const bb = estimateBBox(sd);
      subs.push({ ei, d: sd, bb, area: bb ? Math.max(0, bb.maxX - bb.minX) * Math.max(0, bb.maxY - bb.minY) : 0 });
    }
  });
  if (subs.length < 2) return paths;
  const total = subs.reduce((s, x) => s + x.area, 0);
  if (total <= 0) return paths;
  const keptSubs = subs.filter((p, i) => {
    const b = p.bb;
    if (!b) return true;
    const inside = subs.some(
      (o, j) =>
        j !== i && !!o.bb && b.minX >= o.bb.minX - 1 && b.maxX <= o.bb.maxX + 1 && b.minY >= o.bb.minY - 1 && b.maxY <= o.bb.maxY + 1,
    );
    if (inside) return true; // a counter, never foreign
    const small = p.area / total < 0.2;
    // The tail's tip starts near (not exactly at) the band cut, so test the top
    // ZONE: begins within the top 6% of the cell and stays within the top 30%.
    // An i/j dot begins ~a third down its ascender-tall cell and is untouched.
    const nearTop = b.minY <= cellH * 0.06;
    const shallowTop = b.maxY <= cellH * 0.3;
    if (nearTop && shallowTop && small) return false;
    // and the mirror: the row BELOW's ascender tip crossing UP through the
    // band bottom (the dash judged under a cap B). A comma or period IS its
    // whole glyph (never small); a descender's own tail is connected ink.
    const nearBottom = b.maxY >= cellH * 0.94;
    const shallowBottom = b.minY >= cellH * 0.7;
    if (nearBottom && shallowBottom && small) return false;
    return true;
  });
  if (keptSubs.length === subs.length) return paths;
  if (!keptSubs.length) return paths;
  const out: T[] = [];
  paths.forEach((p, ei) => {
    const mine = keptSubs.filter((s) => s.ei === ei);
    if (mine.length) out.push({ ...p, d: mine.map((s) => s.d).join(' ') });
  });
  return out.length ? out : paths;
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
): Promise<{ glyphs: Glyph[]; slicer: PickedSlicer; forced: boolean; cellCount: number; naturalCount: number }> {
  const TC = w().TracerCore;
  const expected = chars.length;
  const { ranges, ownerFn, slicer, forced, naturalCount } = pickRanges(data, W, y0, y1, expected, chars, override);
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
      // Threshold compensation: the smoothing interpolation spreads a stroke's
      // dark core outward before the cutoff, fattening a 3px hairline ~1.5x
      // (measured: sheet stroke/xh 0.070 -> built 0.106, the judged "went over
      // my hairline with a heavier pen"). A stricter cutoff pulls the edge back
      // to the drawn line; floor at 40 so faint pencil ink cannot vanish.
      // -24 is the measured-safe compensation (stroke 9->8px on the light
      // probe, corpus green); -40 pulled the edge back further (7px) but thinned
      // the connectors past reach and the joins broke (joinGap median 127).
      const ssThreshold = Math.max(40, opts.threshold - 24);
      const ssCell = supersampleMonoCell(sourceImg, cx0, cy0, cx1, cy1, scale, ssThreshold, opts.invert, ownerFn, i);
      // turdsize is an AREA in trace pixels; at scale x the same physical speck
      // covers scale^2 more pixels, so an unscaled threshold stops culling the
      // flecks it culls at native resolution (judged: stray dots at seams).
      // alphamax rises toward the sketch preset's curve bias: a hairline loop
      // apex spans few pixels even supersampled, and the default corner
      // threshold leaves visible straight facets there (judged at hero size).
      svg = await TC.traceCellBitmap(
        ssCell,
        opts.turdsize * scale * scale,
        opts.optcurve,
        Math.max(opts.alphamax, 1.15),
        opts.opttolerance,
        1 / scale,
      );
    } else {
      const cell = TC.extractCellBinary(data, W, cx0, cx1, cy0, cy1, ownerFn, i);
      svg = await TC.traceCellBitmap(cell, opts.turdsize, opts.optcurve, opts.alphamax, opts.opttolerance);
    }
    const paths = TC.extractPathDFromSvg(svg);
    let keep = filterFilledGlyphPaths(paths, rowH, map.baselineYInCell);
    keep = cullForeignTopTails(keep, cy1 - cy0);
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
  return { glyphs, slicer, forced, cellCount, naturalCount };
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
  let bands =
    forceRows >= 2
      ? evenBands(bin.data, bin.w, bin.h, forceRows)
      : (TC.detectRowsInBinary(bin.data, bin.w, bin.h) as number[][]);
  // Shadow-robust row pass for the mono probe (mirrors traceSheet): a soft
  // generator shadow bridges row gaps at the standard cutoff and the charset
  // guess then maps a 7-row sheet onto 4 lines. The dark-core read wins
  // whenever it separates more rows.
  if (!isColor && forceRows < 2) {
    const strict = TC.binarizeFull(img, iw, ih, SHADOW_ROW_THRESHOLD, DEFAULT_TRACE.invert, DEFAULT_TRACE.weight);
    const strictBands = TC.detectRowsInBinary(strict.data, strict.w, strict.h) as number[][];
    if (strictBands.length > bands.length) bands = strictBands;
    bands = splitBandsAtValleys(inkRowProfile(strict.data, strict.w, strict.h), bands);
  }
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
// FIDELITY DOCTRINE (field failure 2026-07-01): the floor exists to rescue
// DISINTEGRATING ink, never to restyle a hand. Its old gate (0.05) caught every
// intentionally thin script and, because dilation comes in whole +2px steps, a
// low-res sheet's 3px stroke gained +4px — 2.3x the drawn weight ("someone
// turned a script bold"). A delicate hand is the design; weight is the user's
// call (the stroke-weight knob when it lands). Only ink too broken to trace
// (strokes ~2px and crumbling) trips the floor now, and it takes ONE step.
// Luminance cutoff for the shadow-robust ROW pass: keeps a pen's dark core
// (and any genuinely gray pencil down to charcoal) while dropping the soft
// shadow gradient a generator paints under strokes (measured: 1.3% of a Nano
// Banana sheet's pixels sit at 16-127 as shadow, enough to bridge row gaps).
const SHADOW_ROW_THRESHOLD = 64;
// Valley split: a tightly-leaded sheet interleaves descenders into the next
// row's ascenders, so NO scanline between the rows is empty and the gap-based
// row detector fuses them (a Nano Banana sheet fused rows 1-4 into one band).
// A true row boundary still reads as a deep VALLEY in the per-scanline ink
// profile — the color path splits rows this way already; this is the mono twin.
// A valley this far under the SMALLER flanking peak is a row boundary. 0.2, not
// lower: a row with six descenders rains ~40px of ink through a sparse digit
// row's line (nano-v2: valley 39 vs digit peak 222, ratio 0.176), while a real
// in-row minimum measures 0.4+ of its flanks — the classes are far apart.
const VALLEY_FRAC = 0.2;
const VALLEY_MIN_ROW = 40; // px — never produce a band shorter than this
const VALLEY_EVEN_RATIO = 2.6; // guard: accept a split only if band heights stay plausibly even

/** Pure: split fused row bands at prominent ink-profile valleys. `inkRows` is
 *  the per-scanline ink pixel count for the whole image; bands are [y0,y1]. */
export function splitBandsAtValleys(inkRows: number[], bands: number[][]): number[][] {
  const smooth = (a: number[]) => a.map((_, i) => {
    let s = 0, n = 0;
    for (let k = -2; k <= 2; k++) {
      const j = i + k;
      if (j >= 0 && j < a.length) { s += a[j]; n++; }
    }
    return s / n;
  });
  const split = (y0: number, y1: number, out: number[][]) => {
    const h = y1 - y0 + 1;
    if (h < 2 * VALLEY_MIN_ROW) { out.push([y0, y1]); return; }
    const prof = smooth(inkRows.slice(y0, y1 + 1));
    const peak = Math.max(...prof);
    if (peak <= 0) { out.push([y0, y1]); return; }
    // deepest interior valley with real peaks on BOTH sides
    let best = -1, bestVal = Infinity;
    for (let i = VALLEY_MIN_ROW; i <= h - VALLEY_MIN_ROW; i++) {
      if (prof[i] < bestVal) {
        const peakL = Math.max(...prof.slice(0, i));
        const peakR = Math.max(...prof.slice(i + 1));
        if (prof[i] <= VALLEY_FRAC * Math.min(peakL, peakR)) { best = i; bestVal = prof[i]; }
      }
    }
    if (best < 0) { out.push([y0, y1]); return; }
    split(y0, y0 + best - 1, out);
    split(y0 + best + 1, y1, out);
  };
  const out: number[][] = [];
  for (const [y0, y1] of bands) split(y0, y1, out);
  if (out.length <= bands.length) return bands;
  // even-spacing guard: a real alphabet sheet's rows are roughly even; a wild
  // height spread means the valleys cut through sparse glyph rows, not gaps.
  const hs = out.map(([a, b]) => b - a + 1);
  if (Math.max(...hs) / Math.max(1, Math.min(...hs)) > VALLEY_EVEN_RATIO) return bands;
  return out;
}

/** Per-scanline ink counts from a binarized RGBA raster (0 = ink). */
function inkRowProfile(data: Uint8ClampedArray | Uint8Array, w: number, h: number): number[] {
  const rows = new Array<number>(h).fill(0);
  for (let y = 0; y < h; y++) {
    const base = y * w;
    for (let x = 0; x < w; x++) if (data[(base + x) * 4] === 0) rows[y]++;
  }
  return rows;
}
const STROKE_FLOOR_GATE = 0.025; // ·rowH — genuinely disintegrating ink only; every intentional thin hand (light 0.038, engrosser 0.057) is spared
const STROKE_FLOOR_TARGET = 0.04; // ·rowH — when it trips, nudge toward barely-solid, not restyled
const STROKE_FLOOR_MAX_WEIGHT = 1; // one dilation step (+2px) — the minimal rescue; two steps restyled low-res hands

/** Detect a too-thin hand and return the binarize WEIGHT (dilation iterations) that
 *  thickens it to a readable floor; returns baseWeight unchanged for a normal or
 *  bold hand, so the gate never touches a hand that is already solid. Stroke width
 *  is the median horizontal ink-run across the inked scanlines, measured against the
 *  median row height; a run longer than a row is a stroke LENGTH (a horizontal bar),
 *  not a width, so it is ignored. */
export function strokeWeightFloor(data: Uint8ClampedArray | Uint8Array, w: number, h: number, bands: number[][], baseWeight: number): number {
  if (!bands.length) return baseWeight;
  const heights = bands.map((b) => b[1] - b[0]).sort((a, b) => a - b);
  const rowH = heights[Math.floor(heights.length / 2)];
  if (rowH < 6) return baseWeight;
  const cap = rowH;
  const runs: number[] = [];
  for (const [y0, y1] of bands) {
    for (let y = Math.max(0, y0); y <= Math.min(h - 1, y1); y++) {
      let run = 0;
      const base = y * w;
      for (let x = 0; x < w; x++) {
        if (data[(base + x) * 4] === 0) run++;
        else {
          if (run > 0 && run <= cap) runs.push(run);
          run = 0;
        }
      }
      if (run > 0 && run <= cap) runs.push(run);
    }
  }
  if (runs.length < 20) return baseWeight;
  runs.sort((a, b) => a - b);
  const strokePx = runs[Math.floor(runs.length / 2)];
  const strokeFrac = strokePx / rowH;
  let weight = baseWeight;
  if (strokeFrac < STROKE_FLOOR_GATE) {
    const need = Math.ceil((STROKE_FLOOR_TARGET * rowH - strokePx) / 2);
    weight = Math.max(baseWeight, Math.min(STROKE_FLOOR_MAX_WEIGHT, need));
  }
  (globalThis as unknown as { __lastWeightFloor?: object }).__lastWeightFloor = { rowH, strokePx, strokeFrac: +strokeFrac.toFixed(3), weight };
  return weight;
}

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
  let bin = TC.binarizeFull(img, iw, ih, opts.threshold, opts.invert, opts.weight);
  onProgress?.('slice', 'detecting rows + cells');
  let bands = TC.detectRowsInBinary(bin.data, bin.w, bin.h) as number[][];
  // Shadow-robust row detection (the mono twin of detectColorGeometry's
  // shadow-awareness): a generator's soft emboss shadow binarizes as ink at the
  // standard cutoff and bridges the row gaps (a Nano Banana sheet merged 7 rows
  // into 4, garbling the whole charset). Rows detected on the DARK CORE alone
  // (strict cutoff) cannot be shadow-bridged, and shadow merging only ever
  // REDUCES the row count, so the pass that finds more rows is the true read.
  // Cells still slice on the standard binarize (the fringe hugs strokes and the
  // inter-letter gaps stay white).
  if (!opts.invert && opts.threshold > SHADOW_ROW_THRESHOLD) {
    const strict = TC.binarizeFull(img, iw, ih, SHADOW_ROW_THRESHOLD, opts.invert, opts.weight);
    const strictBands = TC.detectRowsInBinary(strict.data, strict.w, strict.h) as number[][];
    if (strictBands.length > bands.length) bands = strictBands;
    // and split any still-fused bands at profile valleys (tight leading leaves
    // no empty scanline between rows; the dark-core profile keeps the valleys
    // deep even where descenders interleave)
    bands = splitBandsAtValleys(inkRowProfile(strict.data, strict.w, strict.h), bands);
  }
  {
    const hs = bands.map((b) => b[1] - b[0]).sort((a, b) => a - b);
    (globalThis as unknown as { __lastFine?: object }).__lastFine = {
      fine: !!opts.fineDetail,
      rowH: hs.length ? hs[Math.floor(hs.length / 2)] : 0,
    };
  }
  // Stroke-weight floor: a faint or thin-pen sheet traces to wispy strokes that
  // break and fade at text size. If the hand reads too thin, re-binarize with a
  // bounded dilation (the engine's existing weight knob) so the strokes come out
  // solid. Gated, so a normal or bold hand never trips it and is left untouched.
  const wFloor = strokeWeightFloor(bin.data, bin.w, bin.h, bands, opts.weight);
  if (wFloor > opts.weight) {
    bin = TC.binarizeFull(img, iw, ih, opts.threshold, opts.invert, wFloor);
    bands = TC.detectRowsInBinary(bin.data, bin.w, bin.h) as number[][];
  }
  const lines = rowChars.filter((r) => r.length > 0);
  const rowWarning =
    bands.length !== lines.length
      ? `detected ${bands.length} rows but your charset has ${lines.length} lines. Glyphs are probably misaligned; edit the charset to match your sheet.`
      : '';
  const n = Math.min(bands.length, lines.length);
  const rowGlyphs: Glyph[][] = [];
  const rowInfo: MonoRowInfo[] = [];
  const fusedRows: number[] = [];
  for (let i = 0; i < n; i++) {
    onProgress?.('trace', `row ${i + 1}/${n} · contours`);
    const r = await rowToGlyphs(bin.data, bin.w, bin.h, bands[i][0], bands[i][1], lines[i], opts, 'auto', img);
    rowGlyphs.push(r.glyphs);
    rowInfo.push({ index: i, chars: lines[i], slicer: r.slicer, forced: r.forced, cellCount: r.cellCount, expected: lines[i].length, glyphCount: r.glyphs.length });
    // Connected-letters guard: a row whose letters run together (a cursive drawn
    // as one unbroken line) has no whitespace for the slicer to cut on, so the
    // NATURAL count collapses far below the charset even though the forced cut
    // still returns `expected` cells sliced at arbitrary minima (garbled). The
    // maker joins SEPARATE letters; it cannot split a fused row.
    if (lines[i].length >= 4 && r.naturalCount <= Math.max(1, Math.ceil(lines[i].length * 0.4))) fusedRows.push(i + 1);
  }
  const glyphs = rowGlyphs.flat();
  const connectedWarning = fusedRows.length
    ? `row ${fusedRows.join(', ')} ${fusedRows.length > 1 ? 'look' : 'looks'} drawn as one joined line (the letters run together, so they cannot be told apart). Cursive letters need a small gap between them — the maker joins them back up on its own. Redraw or regenerate that row with the letters apart.`
    : '';
  const report = reportForGlyphs(glyphs);
  _monoSession = { data: bin.data, W: bin.w, H: bin.h, bands, lines, opts, rowGlyphs, rowInfo, sourceImg: img };
  return { glyphs, rowWarning: connectedWarning || rowWarning, detectedRows: bands.length, report, rows: rowInfo };
}

/** Re-slice one mono row with a chosen slicer (and the current trace opts, so a
 *  threshold change takes effect), then rebuild the font. Rolls the row back if
 *  the rebuild fails, so the session stays usable. */
export async function editMonoRow(
  rowIndex: number,
  slicer: SlicerKind,
  family: string,
  opts: TraceOpts,
  spacingPct?: number,
  trimFlourishes?: boolean,
  connect?: boolean,
  connectOverlapPct?: number,
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
    const result = await buildFont(
      glyphs,
      { family: family.trim() || 'Handmade', formats: ['otf', 'ttf', 'woff2'], spacingPct, trimFlourishes, connect, connectOverlapPct },
      onProgress,
    );
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
  /** Letter spacing. 0/unset keeps the sheet's drawn pitch (cell-width
   *  advance, the historical default); 1-12 switches to tight advance with
   *  that percent of UPM as the side bearing, which evens out a loosely or
   *  unevenly drawn sheet. */
  spacingPct?: number;
  /** Measure each glyph's advance from its dense ink body and let thin
   *  flourish tails overhang the neighboring letters (negative side
   *  bearings), the way a real italic is fit. For script faces whose swashes
   *  otherwise ride inside the advance as dead air. */
  trimFlourishes?: boolean;
  /** Connected-cursive mode: place each glyph by its connection plugs so the
   *  letters join. Mutually exclusive with trimFlourishes (connect wins) and
   *  forces an upright Regular style (the worker slants on the style name, and a
   *  slant voids the joins). */
  connect?: boolean;
  /** Seamless overlap as a fraction of x-height. 0 (default) is the consistent
   *  touch floor; a small positive value merges the strokes. */
  connectOverlapPct?: number;
  /** Natural variation: build from a merged same-hand palette (bases plus
   *  .cv01/.cv02 variant glyphs, see mergeVariantSheets) and emit a GSUB `calt`
   *  table so a repeated letter cycles through its variants. Mutually exclusive
   *  with connect/trimFlourishes (a plain mono build with cycling variants). */
  naturalVariation?: boolean;
  /** Seam alternates (ADR 0048, PARKED — connect only, default OFF): a
   *  measured high exit gains a .jn01 alternate substituted by calt before a
   *  low-entry follower. Both warp geometries failed the judge panel (eyelets
   *  lowering through the entry; needle whiskers truncating at the seam), so
   *  nothing sets this except the e2e test hook; the machinery stays banked
   *  for the stroke-model rework (ADR 0049). */
  seamAlternates?: boolean;
}

// ---- flourish trim: body advances with overhang -----------------------------

/** Pure: find the dense body of an ink column-area histogram. Only columns
 *  THIN relative to the letter's peak density (< thinFrac * peak) are ever
 *  trimmable, so a stem, bar, or thick serif always stops the walk; the area
 *  budget (areaFrac of total) and maxTrimFrac then bound how much tail can
 *  go, and a side only trims at all when the tail covers a real extent
 *  (>= minExtentFrac of the ink span). */
export function bodyBoundsFromColumns(
  cols: number[],
  opts: { areaFrac?: number; minExtentFrac?: number; maxTrimFrac?: number; thinFrac?: number; maxSpanFrac?: number } = {},
  spans?: number[],
): { min: number; max: number } | null {
  const areaFrac = opts.areaFrac ?? 0.08;
  const minExtentFrac = opts.minExtentFrac ?? 0.04;
  const maxTrimFrac = opts.maxTrimFrac ?? 0.3;
  const thinFrac = opts.thinFrac ?? 0.5;
  // a tail column's ink is vertically compact (one stroke crossing); a column
  // in a letter's aperture (the mouth of a c, the eye-and-arm side of an e)
  // has ink at top AND bottom and spans most of the glyph's height. Spans
  // above this fraction are structure, never tail.
  const maxSpanFrac = opts.maxSpanFrac ?? 0.55;
  let first = -1,
    last = -1,
    total = 0,
    peak = 0;
  for (let i = 0; i < cols.length; i++) {
    if (cols[i] > 0) {
      if (first < 0) first = i;
      last = i;
      total += cols[i];
      if (cols[i] > peak) peak = cols[i];
    }
  }
  if (first < 0 || total <= 0) return null;
  const inkW = last - first + 1;
  const thin = peak * thinFrac;
  const budget = total * areaFrac;
  const maxTrim = Math.floor(inkW * maxTrimFrac);
  const minExtent = Math.max(2, Math.round(inkW * minExtentFrac));
  const tailish = (i: number) => cols[i] < thin && (!spans || spans[i] <= maxSpanFrac);

  let lo = first;
  let spent = 0;
  while (lo < last && tailish(lo) && spent + cols[lo] <= budget && lo - first < maxTrim) {
    spent += cols[lo];
    lo++;
  }
  if (lo - first < minExtent) lo = first;

  let hi = last;
  spent = 0;
  while (hi > lo && tailish(hi) && spent + cols[hi] <= budget && last - hi < maxTrim) {
    spent += cols[hi];
    hi--;
  }
  if (last - hi < minExtent) hi = last;

  return { min: lo, max: hi };
}

/** Translate a Potrace path d-string (absolute M/L/C/Q commands) along x. */
export function translatePathX(d: string, dx: number): string {
  if (!dx) return d;
  let xNext = true;
  return d.replace(/[-+]?\d*\.?\d+(?:e[-+]?\d+)?|[A-Za-z]/g, (tok) => {
    if (/[A-Za-z]/.test(tok)) {
      xNext = true; // every supported command starts its args on an x
      return tok;
    }
    const isX = xNext;
    xNext = !xNext;
    return isX ? String(Math.round((parseFloat(tok) + dx) * 1000) / 1000) : tok;
  });
}

/** Scale + translate a Potrace path d-string along x only (x -> x*sx + tx); y is
 *  untouched. Used to register a natural-variation variant's body onto its base's
 *  body so the variant fills the base metric box (the palette sheets are not
 *  perfectly aligned). */
export function scaleTranslatePathX(d: string, sx: number, tx: number): string {
  if (sx === 1 && !tx) return d;
  let xNext = true;
  return d.replace(/[-+]?\d*\.?\d+(?:e[-+]?\d+)?|[A-Za-z]/g, (tok) => {
    if (/[A-Za-z]/.test(tok)) {
      xNext = true;
      return tok;
    }
    const isX = xNext;
    xNext = !xNext;
    return isX ? String(Math.round((parseFloat(tok) * sx + tx) * 1000) / 1000) : tok;
  });
}

/** Compress a connecting tail horizontally toward the body edge: for x on the tail
 *  side of `edge`, x -> edge + (x - edge) * scale (0<scale<1 shortens it); the body
 *  side and y are untouched. side 'left' compresses the entry tail (x < edge).
 *  Used by compressConnectorTails to shorten a flashy hand's over-long entry sweeps
 *  so the letter places tight. Absolute M/L/C/Q only, the translatePathX walker. */
export function warpTailX(d: string, edge: number, scale: number, side: 'left' | 'right'): string {
  if (scale === 1) return d;
  let xNext = true;
  return d.replace(/[-+]?\d*\.?\d+(?:e[-+]?\d+)?|[A-Za-z]/g, (tok) => {
    if (/[A-Za-z]/.test(tok)) {
      xNext = true;
      return tok;
    }
    if (!xNext) {
      xNext = true;
      return tok; // y untouched
    }
    xNext = false;
    const x = parseFloat(tok);
    const onTail = side === 'left' ? x < edge : x > edge;
    return onTail ? String(Math.round((edge + (x - edge) * scale) * 1000) / 1000) : tok;
  });
}

/** Shift a Potrace path's y along the tail beyond `edge` by a ramped delta: 0 at
 *  the body edge, full `dy` at the connector `tip`. `side` 'right' warps the exit
 *  tail (x > edge, tip > edge), 'left' the entry tail (x < edge, tip < edge). Used
 *  to lower a high connecting stub onto a shared low join line so a seam meets flush
 *  instead of the exit of one letter crossing the entry of the next at a different
 *  height. x is never touched, so the connector keeps its horizontal reach. */
export function warpTailY(d: string, edge: number, tip: number, dy: number, side: 'left' | 'right'): string {
  const span = tip - edge;
  if (!dy || span === 0) return d;
  let xNext = true;
  let ramp = 0;
  return d.replace(/[-+]?\d*\.?\d+(?:e[-+]?\d+)?|[A-Za-z]/g, (tok) => {
    if (/[A-Za-z]/.test(tok)) {
      xNext = true;
      return tok;
    }
    if (xNext) {
      xNext = false;
      const x = parseFloat(tok);
      const onTail = side === 'right' ? x > edge : x < edge;
      let t = onTail ? (x - edge) / span : 0;
      if (t < 0) t = 0;
      if (t > 1) t = 1;
      ramp = t;
      return tok; // x untouched
    }
    xNext = true;
    return ramp ? String(Math.round((parseFloat(tok) + ramp * dy) * 1000) / 1000) : tok;
  });
}

/** Rasterize a glyph's paths (one Path2D, evenodd so counters subtract) and
 *  measure each x column (filled pixel count + the column's ink y-span as a
 *  fraction of the glyph's full ink height — the tail-vs-aperture signal),
 *  plus each pixel ROW's leftmost/rightmost ink x for the pairwise
 *  fusion check. */
function glyphColumnAreas(g: Glyph): {
  cols: number[];
  spans: number[];
  rowLeft: number[];
  rowRight: number[];
  /** per-column ink y-extents — the terminal stroke model reads its
   *  cross-sections here (per-row extents smear a sloped tail, ADR 0049) */
  colTop: number[];
  colBot: number[];
  inkTopRow: number;
} | null {
  const cw = Math.max(1, Math.ceil(g.cellW));
  const ch = Math.max(1, Math.ceil(g.cellH));
  const c = document.createElement('canvas');
  c.width = cw;
  c.height = ch;
  const ctx = c.getContext('2d');
  if (!ctx) return null;
  ctx.fillStyle = '#000';
  try {
    ctx.fill(new Path2D(g.paths.join(' ')), 'evenodd');
  } catch {
    return null;
  }
  const img = ctx.getImageData(0, 0, cw, ch).data;
  const cols = new Array<number>(cw).fill(0);
  const minY = new Array<number>(cw).fill(Infinity);
  const maxY = new Array<number>(cw).fill(-1);
  const rowLeft = new Array<number>(ch).fill(Infinity);
  const rowRight = new Array<number>(ch).fill(-Infinity);
  let gMin = Infinity,
    gMax = -1;
  for (let p = 0; p < img.length; p += 4) {
    if (img[p + 3] > 127) {
      const i = (p >> 2) % cw;
      const y = ((p >> 2) / cw) | 0;
      cols[i]++;
      if (y < minY[i]) minY[i] = y;
      if (y > maxY[i]) maxY[i] = y;
      if (i < rowLeft[y]) rowLeft[y] = i;
      if (i > rowRight[y]) rowRight[y] = i;
      if (y < gMin) gMin = y;
      if (y > gMax) gMax = y;
    }
  }
  const inkH = Math.max(1, gMax - gMin + 1);
  const spans = cols.map((n, i) => (n > 0 ? (maxY[i] - minY[i] + 1) / inkH : 0));
  return { cols, spans, rowLeft, rowRight, colTop: minY, colBot: maxY, inkTopRow: gMin === Infinity ? 0 : gMin };
}

/** Stage A of connector reconstruction (ADR 0049): recover a terminal tail as
 *  a STROKE — centerline, slope-corrected width, attachment point + tangent
 *  at the body edge, and the tip — from the per-column extents. Walks outward
 *  from the body edge while columns carry ink; null when the tail is absent
 *  or too short to carry a tangent. A curled tail's cross-section reads as
 *  the union of its passes (over-wide); the median width damps it. */
export function traceTerminalStroke(
  prof: { cols: number[]; colTop: number[]; colBot: number[] },
  body: { min: number; max: number },
  _baseY: number,
  _xhPx: number,
  side: 'left' | 'right',
): {
  points: Array<{ x: number; y: number }>;
  width: number;
  /** stroke weight at the attachment end (median of the first columns) — a
   *  drawn tail thins toward its tip, so the whole-tail median understates
   *  the width a reconstructed connector must carry (Stage D panel finding) */
  rootWidth: number;
  /** per-column slope-corrected widths, attach → tip (diagnostics) */
  widths: number[];
  attach: { x: number; y: number };
  tip: { x: number; y: number };
  tangent: { dx: number; dy: number };
} | null {
  const step = side === 'right' ? 1 : -1;
  const start = side === 'right' ? body.max + 1 : body.min - 1;
  const points: Array<{ x: number; y: number }> = [];
  const thicks: number[] = [];
  for (let x = start; x >= 0 && x < prof.cols.length; x += step) {
    const top = prof.colTop[x];
    const bot = prof.colBot[x];
    if (!isFinite(top) || bot < top || prof.cols[x] <= 0) break;
    points.push({ x, y: (top + bot) / 2 });
    thicks.push(bot - top + 1);
  }
  if (points.length < 3) return null;
  // per-column width = vertical thickness corrected by the local slope (a
  // diagonal stroke's vertical cut overstates its true width)
  const widths = points.map((p, i) => {
    const a = points[Math.max(0, i - 1)];
    const b = points[Math.min(points.length - 1, i + 1)];
    const slope = (b.y - a.y) / Math.max(1, Math.abs(b.x - a.x));
    return thicks[i] / Math.sqrt(1 + slope * slope);
  });
  const ws = widths.slice().sort((a, b) => a - b);
  const width = ws[Math.floor(ws.length / 2)];
  // root width (diagnostic): the attachment-half stroke weight. The first
  // columns past the body carry bowl/crossover UNIONS (far over the median)
  // and a separation PINCH (far under it) — measured on the smooth hand:
  // o reads [68,60,51,45,27, 9,4.6,4.4, 12,13,...] — so the read is the
  // median of the first half's uncontaminated columns.
  const firstHalf = widths.slice(0, Math.ceil(widths.length / 2));
  const cleanRoot = firstHalf.filter((w) => w <= 2.5 * width);
  const rws = (cleanRoot.length ? cleanRoot : firstHalf).slice().sort((a, b) => a - b);
  const rootWidth = rws[Math.floor(rws.length / 2)];
  const attach = points[0];
  const tip = points[points.length - 1];
  const k = Math.min(3, points.length - 1);
  const dxr = points[k].x - points[0].x;
  const dyr = points[k].y - points[0].y;
  const len = Math.max(1e-6, Math.hypot(dxr, dyr));
  return { points, width, rootWidth, widths, attach, tip, tangent: { dx: dxr / len, dy: dyr / len } };
}

/** Stage B of connector reconstruction (ADR 0049): the face's STANDARD JOIN,
 *  reduced from the per-glyph entry terminals (Stage A output) — median reach
 *  (how far the entry tip sits from the body edge, px), median tip height
 *  (·xh above baseline), median approach tangent (component-wise, renormalized).
 *  Null under the joiner minimum, same bar as the other median-driven passes. */
export function standardJoinFromEntries(
  entries: Array<{ reach: number; tipFrac: number; tangent: { dx: number; dy: number } }>,
): { reach: number; tipFrac: number; tangent: { dx: number; dy: number } } | null {
  if (entries.length < TAIL_MIN_JOINERS) return null;
  const med = (vals: number[]) => {
    const s = vals.slice().sort((a, b) => a - b);
    return s[Math.floor(s.length / 2)];
  };
  const dx = med(entries.map((e) => e.tangent.dx));
  const dy = med(entries.map((e) => e.tangent.dy));
  const len = Math.max(1e-6, Math.hypot(dx, dy));
  return {
    reach: med(entries.map((e) => e.reach)),
    tipFrac: med(entries.map((e) => e.tipFrac)),
    tangent: { dx: dx / len, dy: dy / len },
  };
}

// The synthesized stroke's tip tapers to this fraction of the measured width:
// enough thinning to bury shallowly in the follower's entry corridor, never a
// needle (the panel's word for a starved terminal). The taper lives INSIDE
// the overlap — full width through the join point — after the Stage D panel
// measured waists just above the junction where a whole-stroke taper had
// already starved the connector before it reached the follower's ink.
const CONNECTOR_TIP_TAPER = 0.35;
const CONNECTOR_TAPER_FLOOR = 0.6; // earliest t the taper may start (very long overlaps)
const CONNECTOR_SAMPLES = 24;

/** Stage B of connector reconstruction (ADR 0049): DRAW the connecting stroke
 *  from measured parameters. One cubic centerline tangent-matched at the
 *  attachment (inside the body ink), ending past the standard join point by
 *  `overlapLen` along the standard tangent; stroked at ±width/2 along the
 *  normals with the half-width clamped under the local radius of curvature
 *  (the inner offset of a tight bend would loop back and self-intersect);
 *  round start cap buried behind the attachment, tapered tip. Returns one
 *  closed absolute M/L path in cell coordinates, plus the sampled centerline
 *  and the tip for diagnostics. Null when a tangent is degenerate or the span
 *  is too short to carry a stroke. */
export function synthesizeConnector(
  attach: { x: number; y: number },
  tangentIn: { dx: number; dy: number },
  joinPoint: { x: number; y: number },
  tangentOut: { dx: number; dy: number },
  width: number,
  overlapLen?: number,
): { d: string; centerline: Array<{ x: number; y: number }>; tip: { x: number; y: number } } | null {
  const lIn = Math.hypot(tangentIn.dx, tangentIn.dy);
  const lOut = Math.hypot(tangentOut.dx, tangentOut.dy);
  if (lIn < 1e-6 || lOut < 1e-6 || !(width > 0)) return null;
  const tIn = { dx: tangentIn.dx / lIn, dy: tangentIn.dy / lIn };
  const tOut = { dx: tangentOut.dx / lOut, dy: tangentOut.dy / lOut };
  const over = overlapLen ?? 2 * width;
  const tip = { x: joinPoint.x + over * tOut.dx, y: joinPoint.y + over * tOut.dy };
  const span = Math.hypot(tip.x - attach.x, tip.y - attach.y);
  if (span < Math.max(2, width)) return null;

  // cubic centerline: control arms at a third of the span along each tangent
  const c = span / 3;
  const p0 = attach;
  const p1 = { x: attach.x + c * tIn.dx, y: attach.y + c * tIn.dy };
  const p2 = { x: tip.x - c * tOut.dx, y: tip.y - c * tOut.dy };
  const p3 = tip;
  const centerline: Array<{ x: number; y: number }> = [];
  const derivs: Array<{ dx: number; dy: number }> = [];
  const curvs: number[] = []; // SIGNED curvature: >0 = centre on the +normal side
  for (let i = 0; i <= CONNECTOR_SAMPLES; i++) {
    const t = i / CONNECTOR_SAMPLES;
    const u = 1 - t;
    centerline.push({
      x: u * u * u * p0.x + 3 * u * u * t * p1.x + 3 * u * t * t * p2.x + t * t * t * p3.x,
      y: u * u * u * p0.y + 3 * u * u * t * p1.y + 3 * u * t * t * p2.y + t * t * t * p3.y,
    });
    const dx = 3 * u * u * (p1.x - p0.x) + 6 * u * t * (p2.x - p1.x) + 3 * t * t * (p3.x - p2.x);
    const dy = 3 * u * u * (p1.y - p0.y) + 6 * u * t * (p2.y - p1.y) + 3 * t * t * (p3.y - p2.y);
    const ddx = 6 * u * (p2.x - 2 * p1.x + p0.x) + 6 * t * (p3.x - 2 * p2.x + p1.x);
    const ddy = 6 * u * (p2.y - 2 * p1.y + p0.y) + 6 * t * (p3.y - 2 * p2.y + p1.y);
    const speed = Math.max(1e-6, Math.hypot(dx, dy));
    derivs.push({ dx: dx / speed, dy: dy / speed });
    curvs.push((dx * ddy - dy * ddx) / (speed * speed * speed));
  }

  // taper start from arc length: full width THROUGH the join point AND
  // through most of the overlap, thinning only across the overlap's final
  // quarter — a taper spanning the whole overlap ran naked in the pair's
  // kern gap and read as a waist before the follower's stem (Stage D)
  let arcLen = 0;
  for (let i = 1; i < centerline.length; i++)
    arcLen += Math.hypot(centerline[i].x - centerline[i - 1].x, centerline[i].y - centerline[i - 1].y);
  const taperStart = Math.max(CONNECTOR_TAPER_FLOOR, 1 - 0.25 * (over / Math.max(1e-6, arcLen)));

  // half-width profile: full width until the taper start, then linear to the tip
  const half = (t: number) => {
    const base = width / 2;
    const f = t <= taperStart ? 1 : 1 - (1 - CONNECTOR_TIP_TAPER) * ((t - taperStart) / (1 - taperStart));
    return base * f;
  };

  const left: Array<{ x: number; y: number }> = [];
  const right: Array<{ x: number; y: number }> = [];
  for (let i = 0; i <= CONNECTOR_SAMPLES; i++) {
    const t = i / CONNECTOR_SAMPLES;
    // WIDTH-PRESERVING curvature guard: only the INNER rail (facing the
    // curvature centre) yields to the local radius — that is where the offset
    // loops back — and the outer rail swells by the remainder, like a brush
    // on an under-turn. Clamping both rails starved the trough (the Stage D
    // panel's needle-tendency waist).
    const hw = half(t);
    const k = curvs[i];
    const rad = Math.abs(k) > 1e-6 ? 1 / Math.abs(k) : Infinity;
    const hwIn = Math.min(hw, 0.85 * rad);
    const hwOut = hw + (hw - hwIn);
    const hwLeft = k > 0 ? hwIn : hwOut; // centre on +normal (left) when k > 0
    const hwRight = k > 0 ? hwOut : hwIn;
    const n = { dx: -derivs[i].dy, dy: derivs[i].dx };
    left.push({ x: centerline[i].x + n.dx * hwLeft, y: centerline[i].y + n.dy * hwLeft });
    right.push({ x: centerline[i].x - n.dx * hwRight, y: centerline[i].y - n.dy * hwRight });
  }

  // round start cap: semicircle behind the attachment (buried in body ink),
  // sweeping from the right rail around -tangentIn to the left rail
  const cap: Array<{ x: number; y: number }> = [];
  const hw0 = half(0);
  const n0 = { dx: -tIn.dy, dy: tIn.dx };
  for (let i = 1; i < 8; i++) {
    const a = (i / 8) * Math.PI;
    // rotate the -normal toward -tangent and on to +normal
    const cx = -Math.cos(a);
    const sx = Math.sin(a);
    cap.push({
      x: attach.x + hw0 * (cx * n0.dx - sx * tIn.dx),
      y: attach.y + hw0 * (cx * n0.dy - sx * tIn.dy),
    });
  }

  const fmt = (v: number) => String(Math.round(v * 1000) / 1000);
  const ring = [...left, ...right.slice().reverse(), ...cap];
  let d = `M ${fmt(ring[0].x)} ${fmt(ring[0].y)}`;
  for (let i = 1; i < ring.length; i++) d += ` L ${fmt(ring[i].x)} ${fmt(ring[i].y)}`;
  d += ' Z';
  return { d, centerline, tip };
}

/** Pure: dense-body edges from a column ink-count histogram — the leftmost and
 *  rightmost columns whose ink exceeds the threshold (the eye-body criterion). */
export function eyeBodyFromCols(cols: number[], th: number): { min: number; max: number } | null {
  let lo = -1,
    hi = -1;
  for (let i = 0; i < cols.length; i++)
    if (cols[i] > th) {
      if (lo < 0) lo = i;
      hi = i;
    }
  return lo < 0 ? null : { min: lo, max: hi };
}

/** Per-column ink pixel counts within a row band [yTop, yBot] of the glyph's
 *  cell — the join-zone view of a glyph's density, so a descender loop below
 *  the baseline never reads as body. Returns null without canvas (jsdom). */
function glyphBandColumnInk(g: Glyph, yTop: number, yBot: number): number[] | null {
  const cw = Math.max(1, Math.ceil(g.cellW));
  const ch = Math.max(1, Math.ceil(g.cellH));
  const c = document.createElement('canvas');
  c.width = cw;
  c.height = ch;
  const ctx = c.getContext('2d');
  if (!ctx) return null;
  ctx.fillStyle = '#000';
  try {
    ctx.fill(new Path2D(g.paths.join(' ')), 'evenodd');
  } catch {
    return null;
  }
  const y0 = Math.max(0, Math.min(ch - 1, yTop));
  const y1 = Math.max(0, Math.min(ch - 1, yBot));
  if (y1 < y0) return null;
  const img = ctx.getImageData(0, y0, cw, y1 - y0 + 1).data;
  const cols = new Array<number>(cw).fill(0);
  for (let p = 0; p < img.length; p += 4) if (img[p + 3] > 127) cols[(p >> 2) % cw]++;
  return cols;
}

/** The pad each glyph body gets per side, in cell pixels, sized so it lands
 *  as ~pct% of UPM after the engine's scale (scale = 0.8 * upm / maxAscPx). */
function bodyPadPx(glyphs: Glyph[], pct: number): number {
  const estimateBBox = w().estimateBBox;
  let maxAsc = 1;
  for (const g of glyphs) {
    for (const d of g.paths) {
      const bb = estimateBBox(d);
      if (bb) maxAsc = Math.max(maxAsc, g.baselineYInCell - bb.minY);
    }
  }
  return Math.max(1, Math.round((pct / 100) * (maxAsc / 0.8)));
}

/** Re-fit glyphs on their dense ink body: the advance becomes body + 2*pad,
 *  the body is translated to start at pad, and any trimmed tail keeps its
 *  shape but overhangs the advance (negative left bearing or ink past the
 *  advance). Used with cell-width advance (shiftX = 0).
 *
 *  padAll=false (spacing auto): glyphs with no real tail pass through
 *  untouched, keeping the sheet's drawn pitch — an upright face is a no-op.
 *  padAll=true (the spacing knob is set): EVERY glyph re-anchors on its body
 *  with the knob as the pad, which is tight-advance rhythm with overhang. */
/** The aggressive fit for script faces: the area budget falls away (the thin
 *  gate and the cap still protect bodies) and tails may trim deeper. A skinny
 *  chancery l whose loop is a third of its own area needs this; an upright
 *  face must never get it, or a T's crossbar over-tucks. */
const SCRIPT_TRIM = { areaFrac: 1, maxTrimFrac: 0.45, thinFrac: 0.65 };
/** Letters whose right side may never trim: the projection there is the
 *  letterform, not a flourish, and overhanging it redraws the next pair.
 *  r: arm + a following stem fuses into an n. C and G: the top terminal
 *  overshoots the bottom arm (the aperture gate only protects columns where
 *  both arms stack), and overhung it fuses with a following ascender —
 *  Chelsea read as a C-h ligature. Real fonts fit all three wide. */
const NO_TRIM_RIGHT = new Set(['r', 'C', 'G']);
/** Misread-risk pairs verified AFTER trimming (the pairwise feedback pass):
 *  deep interpenetration inside the x-height strip on any of these redraws
 *  the pair, in any face. Mirrors the corpus lint's structural list. */
const FUSION_CHECK_PAIRS: Array<[string, string]> = [
  ['r', 'i'], ['r', 'n'], ['r', 'm'], ['r', 'u'], ['r', 'h'], ['r', 'l'], ['r', 'b'], ['r', 'k'],
  ['C', 'h'], ['C', 'l'], ['C', 'k'], ['C', 'b'], ['C', 'd'], ['G', 'h'], ['G', 'l'], ['G', 'n'],
  ['o', 'i'], ['o', 'l'], ['n', 'n'], ['l', 'l'], ['t', 't'], ['h', 'i'], ['m', 'i'], ['u', 'i'],
  // f is a legitimate swash crosser, but a marker face's f-bar lands flush on
  // the t-bar and welds; the body-strip scan tells the two apart (a chancery
  // flag crosses above the strip and stays untouched)
  ['f', 't'],
];
/** A face is script when at least this share of its glyphs carry a DEEP tail
 *  under the conservative rules. Only tails at least SCRIPT_TAIL_DEPTH of the
 *  glyph's ink width count: a chancery's sweeps run 10-40% deep, while rough
 *  casual faces (markers, prints) carry many shallow edge-tails that must not
 *  push them into the aggressive script fit (that is how Ink Free ended up
 *  welding its t crossbars together). */
const SCRIPT_TAIL_SHARE = 0.4;
const SCRIPT_TAIL_DEPTH = 0.08;

export function trimGlyphOverhangs(
  glyphs: Glyph[],
  padPx: number,
  opts: { padAll?: boolean; skipPairFeedback?: boolean } = {},
): { glyphs: Glyph[]; trimmed: number; script: boolean } {
  // pass 1: profiles + conservative bounds, and let the sheet declare itself
  const profiles = glyphs.map((g) => glyphColumnAreas(g));
  const ink = profiles.map((prof) => {
    if (!prof) return null;
    let first = -1,
      last = -1;
    for (let i = 0; i < prof.cols.length; i++) {
      if (prof.cols[i] > 0) {
        if (first < 0) first = i;
        last = i;
      }
    }
    return first < 0 ? null : { first, last };
  });
  const conservative = profiles.map((prof, i) =>
    prof && ink[i] ? bodyBoundsFromColumns(prof.cols, {}, prof.spans) : null,
  );
  let withInk = 0,
    deepTails = 0;
  for (let i = 0; i < glyphs.length; i++) {
    if (!ink[i]) continue;
    withInk++;
    const b = conservative[i];
    if (!b) continue;
    const inkW = ink[i]!.last - ink[i]!.first + 1;
    const trim = Math.max(b.min - ink[i]!.first, ink[i]!.last - b.max);
    if (trim >= inkW * SCRIPT_TAIL_DEPTH) deepTails++;
  }
  const script = withInk > 0 && deepTails / withInk >= SCRIPT_TAIL_SHARE;

  // pass 2: decide bounds, re-measuring with the script rules when the face
  // earned them (applied after the pairwise feedback below)
  let trimmed = 0;
  const decisions = glyphs.map((g, i) => {
    const prof = profiles[i];
    const span = ink[i];
    if (!prof || !span) return null;
    const body = script ? bodyBoundsFromColumns(prof.cols, SCRIPT_TRIM, prof.spans) : conservative[i];
    const hasTail = !!body && !(body.min === span.first && body.max === span.last);
    if (!hasTail && !opts.padAll) return null;
    if (hasTail) trimmed++;
    let min = hasTail ? body!.min : span.first;
    let max = hasTail ? body!.max : span.last;
    // Letter knowledge the geometry cannot supply: r's arm IS the letter, not
    // a flourish. Trimmed and overhung, r + a following stem fuses into an n.
    // Real fonts always keep the arm inside r's advance, so its right side
    // never trims. (The same arm shape on t is a crossbar and overhangs fine.)
    if (NO_TRIM_RIGHT.has(g.char)) max = span.last;
    return { min, max };
  });

  // pass 3: pairwise feedback. No per-glyph rule can know where an overhang
  // LANDS on each neighbor (Ink Free welds its t crossbars, chancery sweeps
  // read beautifully — same geometry, different neighbors), so verify the
  // trimmed result against the misread-risk pairs and back the trims off
  // exactly where a pair interpenetrates the x-height body strip too deeply.
  // Restores only ever grow advances, so a sequential sweep is stable.
  if (!opts.skipPairFeedback) {
    const byChar = new Map<string, number>();
    glyphs.forEach((g, i) => {
      if (decisions[i] || (profiles[i] && ink[i])) {
        if (!byChar.has(g.char)) byChar.set(g.char, i);
      }
    });
    let maxAsc = 1;
    let xAsc = 0;
    const xHeights: number[] = [];
    glyphs.forEach((g, i) => {
      const prof = profiles[i];
      if (!prof || !ink[i]) return;
      const asc = g.baselineYInCell - prof.inkTopRow;
      if (asc > maxAsc) maxAsc = asc;
      if (g.char === 'x') xAsc = asc;
      if ('xvwzonu'.includes(g.char)) xHeights.push(asc);
    });
    xHeights.sort((a, b) => a - b);
    const xh = xAsc || (xHeights.length ? xHeights[Math.floor(xHeights.length / 2)] : maxAsc * 0.5);
    // restore with margin: the corpus lint gates at 55/1000 of UPM, and its
    // band quantization differs slightly from this raster, so target ~18
    const maxPenPx = Math.max(3, Math.round((0.018 * maxAsc) / 0.8));

    // a re-anchored glyph's geometry shifts to pad-relative coordinates; an
    // untrimmed glyph keeps its original cell (and cell-width advance)
    const geom = (i: number) => {
      const d = decisions[i];
      if (d) return { adv: d.max - d.min + 1 + padPx * 2, off: padPx - d.min };
      return { adv: Math.max(1, Math.ceil(glyphs[i].cellW)), off: 0 };
    };
    for (const [lc, rc] of FUSION_CHECK_PAIRS) {
      const li = byChar.get(lc);
      const ri = byChar.get(rc);
      if (li === undefined || ri === undefined) continue;
      const Lp = profiles[li];
      const Rp = profiles[ri];
      if (!Lp || !Rp || !ink[li] || !ink[ri]) continue;
      const gL = glyphs[li];
      const gR = glyphs[ri];
      const GL = geom(li);
      const GR = geom(ri);
      let minGap = Infinity;
      for (let s = 0; s <= 32; s++) {
        const y = xh * 0.15 + ((xh * 0.95) * s) / 32; // the body strip
        const rowL = Math.round(gL.baselineYInCell - y);
        const rowR = Math.round(gR.baselineYInCell - y);
        if (rowL < 0 || rowL >= Lp.rowRight.length || rowR < 0 || rowR >= Rp.rowLeft.length) continue;
        if (!isFinite(Lp.rowRight[rowL]) || !isFinite(Rp.rowLeft[rowR])) continue;
        const rightL = Lp.rowRight[rowL] + GL.off;
        const leftR = Rp.rowLeft[rowR] + GR.off;
        const gap = GL.adv + leftR - rightL;
        if (gap < minGap) minGap = gap;
      }
      if (!isFinite(minGap) || minGap >= -maxPenPx) continue;
      let deficit = -minGap - maxPenPx;
      // restore the left glyph's right side first (the usual offender), then
      // the right glyph's left side
      if (decisions[li]) {
        const room = ink[li]!.last - decisions[li]!.max;
        const restore = Math.min(deficit, Math.max(0, room));
        decisions[li]!.max += restore;
        deficit -= restore;
      }
      if (deficit > 0 && decisions[ri]) {
        const room = decisions[ri]!.min - ink[ri]!.first;
        const restore = Math.min(deficit, Math.max(0, room));
        decisions[ri]!.min -= restore;
      }
    }
  }

  // pass 4: apply
  const out = glyphs.map((g, i) => {
    const d = decisions[i];
    if (!d) return g;
    const dx = padPx - d.min;
    return {
      ...g,
      paths: g.paths.map((p) => translatePathX(p, dx)),
      cellW: d.max - d.min + 1 + padPx * 2,
    };
  });
  return { glyphs: out, trimmed, script };
}

// ---- connected-cursive mode: join letters by their connection plugs ----------

/** Letters whose connecting EXIT rides above the baseline connector band, so
 *  the advance must be measured to the high plug or the high arm/terminal
 *  overhangs and welds the next letter. r is here (its arm sits above the band
 *  and IS the cursive lead-in, proven on the field sheet); f and t are NOT
 *  (their crossbars overhang by design above any band and would over-extend the
 *  advance — mirrors the trim path's f/t handling). Lowercase only; caps stand
 *  alone in v1. */
const HIGH_EXIT = new Set(['o', 'v', 'w', 'b', 'd', 's', 'u', 'r']);
/** Letters whose only outbound stroke is the descender below the baseline, out
 *  of every connector band. They join on the LEFT but break on the RIGHT (the
 *  next letter starts clean) rather than fake a step off the x-height body. */
const DESC_EXIT = new Set(['g', 'j', 'q', 'y', 'z']);
const UPPER = /[A-Z]/;
const LETTER = /[A-Za-z]/;

export type JoinClass = {
  kind: 'join' | 'break' | 'space';
  joinsLeft: boolean;
  joinsRight: boolean;
  highExit: boolean;
};

/** Classify a character for connected-cursive joining. Position-INDEPENDENT: a
 *  glyph's metrics must work in any context, so the class is a property of the
 *  character alone, never its sheet neighbors. Lowercase joins both sides;
 *  descender-exit lowercase (g j q y z) joins left but breaks right (its only
 *  exit is the descender, below every band); caps, digits, punctuation, and
 *  symbols stand alone (body advance, both sides); space is the word break.
 *  (Cap-into-lowercase joining is deferred to a v2 — caps reading as upright
 *  word-openers matched the approved prototype and avoids a tight cap advance
 *  welding the next letter.) */
export function joinClass(char: string): JoinClass {
  if (char === ' ') return { kind: 'space', joinsLeft: false, joinsRight: false, highExit: false };
  if (!LETTER.test(char)) return { kind: 'break', joinsLeft: false, joinsRight: false, highExit: false };
  // Caps open a word: a clean start on the left, but they JOIN RIGHT into the
  // following lowercase (body-edge advance + the connect kern even the gap) so a
  // capital no longer orphans with a wide space before its word.
  if (UPPER.test(char)) return { kind: 'join', joinsLeft: false, joinsRight: true, highExit: false };
  // Descender letters (g j q y z) JOIN RIGHT too: under the body-edge model the
  // x-height body carries the join while the loop hangs below, and the connect
  // kern's descender clearance keeps adjacent loops apart — so the through-line no
  // longer drops after a descender (the old break-right was for the band model).
  if (DESC_EXIT.has(char)) return { kind: 'join', joinsLeft: true, joinsRight: true, highExit: false };
  return { kind: 'join', joinsLeft: true, joinsRight: true, highExit: HIGH_EXIT.has(char) };
}

/** The single anchor/advance rule (the load-bearing geometry). Anchor and
 *  advance share one origin so consecutive plugs meet AND a round letter whose
 *  bowl bulges left of its entry never goes negative-x.
 *
 *  joinLeft  — the cursor arrives on this glyph's left plug, so anchor there:
 *              anchorOrigin = min(leftPlug, inkLeft); dx = -anchorOrigin. In
 *              connectGlyphs leftPlug (band ink) is always >= inkLeft (all ink),
 *              so this resolves to inkLeft and the leftmost ink lands at x=0; the
 *              min stays as a guard for any caller that passes a plug left of the
 *              ink. When false (a word-opener like a cap), give a left bearing.
 *  joinRight — advance to the right plug, less the overlap, so the next glyph
 *              meets it. When false (descender-exit), advance past the plug by a
 *              pad so the next glyph starts clean. */
export function anchorAdvance(p: {
  leftPlug: number;
  rightPlug: number;
  inkLeft: number;
  overlapPx: number;
  minAdvPx: number;
  leftPadPx: number;
  joinLeft: boolean;
  joinRight: boolean;
}): { dx: number; cellW: number } {
  const leftAnchor = p.joinLeft ? Math.min(p.leftPlug, p.inkLeft) : p.inkLeft - p.leftPadPx;
  const rightEnd = p.joinRight ? p.rightPlug - p.overlapPx : p.rightPlug + p.leftPadPx;
  return { dx: -leftAnchor, cellW: Math.max(p.minAdvPx, rightEnd - leftAnchor) };
}

// connect-mode constants (calibrated on the field cursive sheets in prototyping).
// The CONNECTION BAND: the horizontal strip from just above the baseline up to
// ~0.6 x-height, where a cursive's entry/exit join strokes ride. The leftmost
// ink in this band is the entry POINT, the rightmost is the exit POINT, and the
// glyph is placed so its exit meets the next glyph's entry. One band, one rule
// for both sides of every seam — the source of even, continuous joins.
const CONNECT_BAND_LO = 0.02; // ·xhPx — band bottom, just above the baseline (no-band gate)
const CONNECT_BAND_HI = 0.6; // ·xhPx — band top (no-band gate)
const BAND_MIN_ROWS = 2; // one finite row is raster noise; two = a real crossing
const BAND_MIN_AREA = 0.005; // band's share of the glyph's horizontal extent
// Body-edge connection: trim the thin entry/exit connecting strokes off each
// side aggressively (they are thin and vertically compact, so the thin/span
// gates still protect a real stem or arm), leaving the dense body whose edges
// carry tall ink — the consistent seam the join butts against.
const BODY_CONNECT_OPTS = { areaFrac: 0.25, minExtentFrac: 0.02, maxTrimFrac: 0.5, thinFrac: 0.6 };
const CONNECT_GAP_PCT = 0.16; // ·xhPx — gap between dense bodies; the real connecting strokes bridge it
const MIN_ADV_PCT = 0.18; // ·xhPx — narrow-letter advance floor (i l j)
const OVERLAP_PCT = 0.0; // ·xhPx — shipping default, the consistent-touch floor
const OVERLAP_SEAMLESS = 0.015; // ·xhPx — opt-in seamless overlap
const LEFT_PAD_FLOOR = 1; // px — break-class + post-break side bearing
// ·maxRowWidth — a row counts as the dense BODY (not a thin connector dip or a
// narrow descender stroke) when its ink is at least this share of the glyph's
// widest row. The body's bottom row is the true baseline; re-deriving it per
// glyph fixes the per-row baseline drift that left caps sitting above lowercase.
const BODY_BASE_FRAC = 0.35;
// ·xhPx — the largest DOWNWARD baseline correction the re-derivation may apply.
// The cap-float drift is moderate (~0.35 x-height); a descender drags the dense
// bottom far further (~0.8+), so this ceiling keeps descenders on the traced line.
const BASE_DOWN_TOL = 0.5;
// ·xhPx — the largest UPWARD correction: a letter drawn HIGH (its body floats above
// the line) is lifted onto its body bottom, but only by a moderate amount so a true
// above-line form is never yanked down.
const BASE_UP_TOL = 0.22;
// ·xhPx — a letter is a NORMAL sit (safe to lift) only when its lowest ink is within
// this of its dense body bottom; a top-heavy stem or a descender loop reaches further
// below and must keep the traced line.
const BASE_NORMAL_TOL = 0.12;

export interface FaceMetrics {
  xhPx: number;
  maxAscRaster: number;
  maxAscBBox: number;
  capHpx: number;
}

/** Face-wide measurements, computed once. Two ascent values are kept separate
 *  on purpose: the RASTER ascent (from the rendered glyph rows) drives band
 *  geometry, which lives in cell-pixel space; the estimateBBox ascent matches
 *  the engine's own scale (0.80*upm/maxAscBBox) and drives px<->UPM conversions.
 *  Mixing them drifts the realized overlap/penetration off its intended size. */
export function faceMetrics(glyphs: Glyph[], profiles?: (ReturnType<typeof glyphColumnAreas>)[]): FaceMetrics {
  const estimateBBox = w().estimateBBox;
  let maxAscBBox = 1;
  if (estimateBBox) {
    for (const g of glyphs)
      for (const d of g.paths) {
        const bb = estimateBBox(d);
        if (bb) maxAscBBox = Math.max(maxAscBBox, g.baselineYInCell - bb.minY);
      }
  }
  let maxAscRaster = 1,
    xAsc = 0;
  const xHeights: number[] = [];
  const capAsc: number[] = [];
  glyphs.forEach((g, i) => {
    const prof = profiles ? profiles[i] : glyphColumnAreas(g);
    if (!prof) return;
    const asc = g.baselineYInCell - prof.inkTopRow;
    if (asc > maxAscRaster) maxAscRaster = asc;
    if (g.char === 'x') xAsc = asc;
    if ('xvwzonu'.includes(g.char)) xHeights.push(asc);
    if ('HBEINPRT'.includes(g.char)) capAsc.push(asc);
  });
  xHeights.sort((a, b) => a - b);
  const xhPx = xAsc || (xHeights.length ? xHeights[Math.floor(xHeights.length / 2)] : maxAscRaster * 0.5);
  capAsc.sort((a, b) => a - b);
  const capHpx = capAsc.length ? capAsc[Math.floor(capAsc.length / 2)] : xhPx / 0.7;
  return { xhPx, maxAscRaster, maxAscBBox, capHpx };
}

// ·xh — entry-reach placement normalization gate (ADR 0043). The advance model
// makes per-pair body daylight = the connector gap + the RIGHT letter's
// entry-tail reach, so a hand whose reaches SCATTER carries that scatter
// straight into the rendered rhythm (the thin-hand field failure). When the
// spread of the face's entry reaches exceeds this, the face places by its
// EYE-BODY (dense columns) on both edges; a consistent hand stays
// byte-identical. Calibration (probe, 11 connect faces): FIRE handmade 0.242 /
// cc-4 0.270 / light 0.212; SKIP signature 0.171 / cc-3 0.165 / copperplate
// 0.146 / cc-7 0.127 / cc-5 0.121 / cc-6 0.112. A long-sweep hand (flashy
// 1.00, cc-2 0.62) is exempted by the median test (TAIL_GATE_FRAC): its deep
// reaches are intentional flourish (ADR 0040), not scatter.
const ENTRY_REACH_SD_GATE = 0.19;
// ·xh — the eye-body column criterion (the corpus probe's own body definition,
// applied at full cell resolution): a column belongs to the dense body the eye
// reads when its ink pixel count spans at least this share of the x-height.
const EYE_BODY_FRAC = 0.45;
// ·xh — the exit-overhang lap allowance on a normalized (bridged) face. The
// next glyph's stem sits exactly at the advance, so ink overhanging the advance
// laps that stem by the same amount. A lead-in arm (r) or exit flick may lap
// this far onto the stem — the join — and any deeper ride-through grows the
// advance by the excess. Per-glyph and constant, so within-letter rhythm stays
// even; this REPLACES the row-min weld on bridged faces (whose formula reads
// the deliberate bridge as a crash: ADR 0043, structural 269 on rl).
const ARM_LAP_FRAC = 0.12;

const TAIL_GATE_FRAC = 0.6; // ·xhPx — a hand whose MEDIAN entry tail exceeds this is a long-sweep hand
const TAIL_MAX_FRAC = 1.1; // ·xhPx — compress an over-long entry sweep down to this length; the contextual kern then fine-tunes each pair
const TAIL_MIN_JOINERS = 4; // too few joiners to trust a median
const ROUND_BODY_ANCHOR = new Set('oce'); // round letters whose small bowl floats in a sweep-inflated advance
const BODY_ANCHOR_MIN_TAIL = 0.5; // ·xhPx — body-anchor a round letter only when its entry tail is this long (a tight hand keeps the sweep anchor)

/** Connect pre-pass for a long-sweep hand. A flashy script draws entry connectors
 *  reaching 2-3 x-heights left of the body; anchorAdvance anchors on the leftmost
 *  ink (to protect a structural lead-in), so the whole sweep folds into the advance
 *  and the letter floats (the round-letter "o-float"). This compresses each
 *  over-long ENTRY tail horizontally toward the body so the letter places tight,
 *  leaving the body and the flashy EXIT swash untouched. GATED on the hand's median
 *  entry tail: a short-entry hand (a tidy copperplate measures ~0.24xh, and its long
 *  strokes are exit swashes that already ride the seam) is skipped whole, so only a
 *  genuinely long-entry hand is touched. Mutates paths via warpTailX only;
 *  char/cellW/cellH/baselineYInCell untouched. Caller gates to variation builds. */
export function compressConnectorTails(
  glyphs: Glyph[],
  profilesIn?: (ReturnType<typeof glyphColumnAreas>)[],
): { glyphs: Glyph[]; compressed: number; medianEntry: number } {
  const profiles = profilesIn ?? glyphs.map((g) => glyphColumnAreas(g));
  const fm = faceMetrics(glyphs, profiles);
  const xhPx = Math.max(1, fm.xhPx);
  type M = { i: number; bodyMin: number; entry: number };
  const meas: M[] = [];
  const entries: number[] = [];
  glyphs.forEach((g, i) => {
    const prof = profiles[i];
    if (!prof) return;
    const cls = joinClass(g.char);
    if (cls.kind !== 'join' || !cls.joinsLeft) return; // left-joiners only (caps connect right-only)
    const body = bodyBoundsFromColumns(prof.cols, BODY_CONNECT_OPTS, prof.spans);
    if (!body) return;
    let first = -1;
    for (let c = 0; c < prof.cols.length; c++)
      if (prof.cols[c] > 0) {
        first = c;
        break;
      }
    if (first < 0) return;
    const entry = (body.min - first) / xhPx;
    meas.push({ i, bodyMin: body.min, entry });
    entries.push(entry);
  });
  if (entries.length < TAIL_MIN_JOINERS) return { glyphs, compressed: 0, medianEntry: 0 };
  entries.sort((a, b) => a - b);
  const medianEntry = entries[Math.floor(entries.length / 2)];
  if (medianEntry <= TAIL_GATE_FRAC) return { glyphs, compressed: 0, medianEntry }; // short-entry hand, leave it whole

  const out = glyphs.map((g) => ({ ...g, paths: g.paths.slice() }));
  let compressed = 0;
  for (const m of meas) {
    if (m.entry <= TAIL_MAX_FRAC) continue;
    const scale = TAIL_MAX_FRAC / m.entry;
    out[m.i].paths = out[m.i].paths.map((d) => warpTailX(d, m.bodyMin, scale, 'left'));
    compressed++;
  }
  return { glyphs: out, compressed, medianEntry };
}

// Connector-height snap. A hand can draw its EXIT connectors riding high above its
// ENTRY connectors (an AI signature hand flicks every letter upward on the way out),
// so the high exit of one letter crosses the low entry of the next without merging —
// the visible dot at every seam — and the long high exit rides over the next letter.
// Pull each abnormally-high exit (and any high entry) down onto a shared low join line
// where the entries already sit, so each seam meets flush. Only the plain low-exit
// letters are lowered: o/v/w/b/d/s/u/r (HIGH_EXIT) and g/j/q/y/z (DESC_EXIT) exit high
// or via a descender by nature and keep their drawn stub. Gated on the hand's median
// low-exit-vs-entry mismatch: a copperplate whose exits already meet its entries
// (mismatch near zero) is skipped untouched, byte-for-byte.
const SNAP_MISMATCH_GATE = 0.2; // ·xh — median plain-letter exit must ride this far above median entry to snap
// ·xh — entry-height VARIANCE gate (ADR 0042's recorded discriminator, now live):
// a hand whose terminal heights SCATTER (sd above this) has exits crossing
// entries at mismatched heights — the seam-crossing welds the judges read as
// sealed cups, false in-bowls, and fi knots. Calibration (ADR 0042): FIRE
// handmade 0.171 / cc-5 0.167 / cc-7 0.16; SKIP flashy 0.073 / cc-2 0.07 /
// cc-3 0.053. On a variance-fired hand the snap works BOTH ways (lower high
// terminals, raise low ones a bounded step) so exit and entry COINCIDE and the
// strokes merge tangentially instead of crossing.
const SNAP_VAR_GATE = 0.12;
const SNAP_JOIN_LO = 0.08; // ·xh — clamp the join line to a low band, just above the baseline...
const SNAP_JOIN_HI = 0.3; // ...and never above mid-x-height
const SNAP_MAX = 0.5; // ·xh — cap one connector's downward move
const SNAP_RAISE_MAX = 0.25; // ·xh — cap an upward move tighter (a raised lead-in distorts faster than a lowered flick)
const SNAP_MIN_JOINERS = 4;

export function snapConnectorHeights(
  glyphs: Glyph[],
  profilesIn?: (ReturnType<typeof glyphColumnAreas>)[],
): { glyphs: Glyph[]; snapped: number; mismatch: number } {
  const profiles = profilesIn ?? glyphs.map((g) => glyphColumnAreas(g));
  const fm = faceMetrics(glyphs, profiles);
  const xhPx = Math.max(1, fm.xhPx);
  type M = {
    i: number;
    bodyMin: number;
    bodyMax: number;
    first: number;
    last: number;
    baseY: number;
    lY: number;
    rY: number;
    snapExit: boolean;
  };
  const meas: M[] = [];
  const entryFracs: number[] = [];
  const lowExitFracs: number[] = [];
  glyphs.forEach((g, i) => {
    const prof = profiles[i];
    if (!prof) return;
    const cls = joinClass(g.char);
    if (cls.kind !== 'join' || !cls.joinsLeft || !cls.joinsRight) return;
    const body = bodyBoundsFromColumns(prof.cols, BODY_CONNECT_OPTS, prof.spans);
    if (!body) return;
    let first = -1,
      last = -1;
    for (let c = 0; c < prof.cols.length; c++)
      if (prof.cols[c] > 0) {
        if (first < 0) first = c;
        last = c;
      }
    if (first < 0) return;
    const baseY = g.baselineYInCell;
    const botY = Math.min(g.cellH - 1, Math.max(0, Math.round(baseY - xhPx * CONNECT_BAND_LO)));
    const topY = Math.min(g.cellH - 1, Math.max(0, Math.round(baseY - xhPx * CONNECT_BAND_HI)));
    let left = Infinity,
      right = -Infinity,
      lY = -1,
      rY = -1;
    for (let y = topY; y <= botY; y++) {
      if (!isFinite(prof.rowLeft[y]) || !isFinite(prof.rowRight[y])) continue;
      if (prof.rowLeft[y] < left) {
        left = prof.rowLeft[y];
        lY = y;
      }
      if (prof.rowRight[y] > right) {
        right = prof.rowRight[y];
        rY = y;
      }
    }
    if (lY < 0 || rY < 0) return;
    // Exit-snap class is decided AFTER the gates (a scattered hand overrides
    // the HIGH_EXIT exemption); record the class here.
    const snapExit = !cls.highExit && !DESC_EXIT.has(g.char);
    meas.push({ i, bodyMin: body.min, bodyMax: body.max, first, last, baseY, lY, rY, snapExit });
    entryFracs.push((baseY - lY) / xhPx);
    if (snapExit) lowExitFracs.push((baseY - rY) / xhPx);
  });
  if (meas.length < SNAP_MIN_JOINERS || lowExitFracs.length < 2) return { glyphs, snapped: 0, mismatch: 0 };
  const med = (a: number[]) => {
    const s = a.slice().sort((x, y) => x - y);
    return s[Math.floor(s.length / 2)];
  };
  const medEntry = med(entryFracs);
  const mismatch = med(lowExitFracs) - medEntry;
  // Scattered-terminal gate (ADR 0042): entry heights that vary widely cross
  // the neighbours' exits at the seams even when the MEDIANS agree.
  const meanEntry = entryFracs.reduce((a, x) => a + x, 0) / entryFracs.length;
  const heightSd = Math.sqrt(entryFracs.reduce((a, x) => a + (x - meanEntry) * (x - meanEntry), 0) / entryFracs.length);
  const scattered = heightSd > SNAP_VAR_GATE;
  if (mismatch <= SNAP_MISMATCH_GATE && !scattered) return { glyphs, snapped: 0, mismatch }; // terminals already meet (copperplate)
  const joinFrac = Math.min(SNAP_JOIN_HI, Math.max(SNAP_JOIN_LO, medEntry));
  const cap = SNAP_MAX * xhPx;
  const raiseCap = SNAP_RAISE_MAX * xhPx;
  const out = glyphs.map((g) => ({ ...g, paths: g.paths.slice() }));
  let snapped = 0;
  for (const m of meas) {
    const joinY = m.baseY - joinFrac * xhPx;
    let did = false;
    // move a mismatched exit onto the join line: lowering is the shipped move
    // (the signature flick); raising is bounded and only on a scattered hand,
    // so exit and entry coincide and merge instead of crossing.
    // On a SCATTERED hand the HIGH_EXIT exemption lifts (kept for DESC_EXIT):
    // its high flicks are noise, and an exempted d exits high and short while
    // the next e enters low — the strokes pass at different heights without
    // meeting (the floating e). A mismatch-fired hand (the signature, whose
    // flick is the design) keeps the exemption.
    const doExit = m.snapExit || (scattered && !DESC_EXIT.has(glyphs[m.i].char));
    if (doExit && m.last > m.bodyMax) {
      const raw = joinY - m.rY;
      const dy = raw >= 0 ? Math.min(cap, raw) : scattered ? Math.max(-raiseCap, raw) : 0;
      if (Math.abs(dy) >= 1) {
        out[m.i].paths = out[m.i].paths.map((d) => warpTailY(d, m.bodyMax, m.last, dy, 'right'));
        did = true;
      }
    }
    // and the entry onto the same line so the previous letter's exit meets it
    if (m.first < m.bodyMin) {
      const raw = joinY - m.lY;
      const dy = raw >= 0 ? Math.min(cap, raw) : scattered ? Math.max(-raiseCap, raw) : 0;
      if (Math.abs(dy) >= 1) {
        out[m.i].paths = out[m.i].paths.map((d) => warpTailY(d, m.bodyMin, m.first, dy, 'left'));
        did = true;
      }
    }
    if (did) snapped++;
  }
  return { glyphs: out, snapped, mismatch };
}

// Contextual seam alternates (ADR 0048). A knot forms where a HIGH exit stroke
// crosses the next letter's LOW entry hook at an angle: the two strokes pool
// ink into a small loop at the seam (fo, on, ve on the smooth-script hand).
// The snap cannot fix these: its scan stops at the connection band's 0.6·xh
// ceiling so a stub riding at 0.8·xh is never measured, and lowering the BASE
// glyph's exit is the reverted stub-snap that flattened the copperplate swash
// (ADR 0038 exempts HIGH_EXIT by design). So the base glyph keeps its drawn
// flick, and a COPY (.jn01, appended unicode-less exactly like a .cvNN
// variant) carries a RECONSTRUCTED exit (ADR 0049: the drawn tail collapsed
// onto the body-edge clip line, one stroke drawn from measured parameters to
// the standard join point — both outline warps failed the judge panel); a
// GSUB calt lookahead rule substitutes it only when a low-entry letter
// follows. Word-final and before-high-entry positions keep the drawn exit.
// ·xh above the join line — an exit tip this high crosses a low entry. Live
// calibration on the smooth-script hand: the gentle crossings the eye still
// reads as knots (o .21, b .18, w .21, v .245 over the line) sit under the
// first-cut 0.28; the clean class (a/e/h/u/k at ~0) sits far below 0.15.
const SEAM_EXIT_GATE = 0.15;
const SEAM_ENTRY_TOL = 0.15; // ·xh — a follower's entry tip within this of the line reads low
// Exit-tip scan ceiling sits just above the x-height: the o/s/v exit stubs
// live at 0.6-1.0·xh, while an ascender loop's right side (l, d) and a cap
// swash read as huge fake "tails" at any higher ceiling — the first live
// calibration flagged A/D/O/S/T and l/d at the 1.3 ceiling while missing the
// real knots. Above-the-ceiling ink is structure, not a connector.
const SEAM_ZONE_HI = 1.05;
// Structure check band: right-of-body ink WELL above the exit ceiling is an
// ascender loop or a swash (the l false positive), never a connector — a real
// exit stub ends inside the zone. The band starts above optical-overshoot
// territory: a pointed letter's stroke top (v, w) pokes to ~1.1·xh and must
// not read as structure.
const SEAM_LOOP_CHECK_LO = 1.15; // ·xh
const SEAM_LOOP_CHECK_HI = 1.4; // ·xh
// ·xh — the deepest drop an alternate may take. The judge panel failed the
// first cut's full lowering: a steep descent reads as a wire cliff with a
// thorn cusp, and the s/x class (0.6·xh drops) produced the worst of them.
// Past the cap the drawn flick is better texture; that class waits for the
// assembled pass.
const SEAM_DY_MAX = 0.35;
const SEAM_CROSSBAR = new Set(['f', 't']); // crossbars overhang high by design; never offenders
const SEAM_ALT_SUFFIX = '.jn01';
// Lowercase joiners only: a cap's right side swashes by design (the corpus
// exempts script caps from the overhang metric for the same reason), and the
// field knots are all lowercase seams.
const SEAM_LOWERCASE = /^[a-z]$/;

// The seam-tail collapse (ADR 0049 Stage C): a point past the body-edge clip
// line whose y sits in the join band moves ONTO the line (x' = min(x, clipX),
// y untouched) — the drawn tail degenerates to a zero-area sliver hidden
// under the synthesized stroke's ink. Ink outside the band never moves — an
// ascender loop leaning right of a narrow body (the b) must not shear (the
// un-banded warp first cut drifted b.jn01's ascender by 8 units). Two passes
// so the x decision can see its own y.
function collapseSeamTail(d: string, clipX: number, yLo: number, yHi: number): string {
  const NUM_OR_LETTER = /[-+]?\d*\.?\d+(?:e[-+]?\d+)?|[A-Za-z]/g;
  const xs: number[] = [];
  const ys: number[] = [];
  let isX = true;
  d.replace(NUM_OR_LETTER, (tok) => {
    if (/[A-Za-z]/.test(tok)) {
      isX = true;
      return tok;
    }
    if (isX) {
      xs.push(parseFloat(tok));
      isX = false;
    } else {
      ys.push(parseFloat(tok));
      isX = true;
    }
    return tok;
  });
  const fmt = (n: number) => String(Math.round(n * 1000) / 1000);
  let i = 0;
  isX = true;
  return d.replace(NUM_OR_LETTER, (tok) => {
    if (/[A-Za-z]/.test(tok)) {
      isX = true;
      return tok;
    }
    if (isX) {
      isX = false;
      const y = ys[i];
      return y !== undefined && xs[i] > clipX && y >= yLo && y <= yHi ? fmt(clipX) : tok;
    }
    isX = true;
    i++;
    return tok;
  });
}

// Orientation sign of a path's first subpath (shoelace over the coordinate
// pairs; curve control points approximate fine — Potrace contours are
// strongly signed). The synthesized connector must match the base outline's
// winding or the cap's overlap with body ink cancels under nonzero fill.
function pathAreaSign(d: string): number {
  const m0 = d.indexOf('M');
  const m1 = m0 < 0 ? -1 : d.indexOf('M', m0 + 1);
  const first = m0 < 0 ? d : d.slice(m0, m1 < 0 ? undefined : m1);
  const nums = first.match(/[-+]?\d*\.?\d+(?:e[-+]?\d+)?/g);
  if (!nums || nums.length < 6) return 0;
  let a = 0;
  const n = nums.length - (nums.length % 2);
  for (let i = 0; i < n; i += 2) {
    const x0 = parseFloat(nums[i]);
    const y0 = parseFloat(nums[i + 1]);
    const x1 = parseFloat(nums[(i + 2) % n]);
    const y1 = parseFloat(nums[(i + 3) % n]);
    a += x0 * y1 - x1 * y0;
  }
  return Math.sign(a);
}

// Reverse a closed M/L polyline path (the synthesized connector's own format).
function reverseClosedPath(d: string): string {
  const nums = d.match(/[-+]?\d*\.?\d+(?:e[-+]?\d+)?/g)!;
  const pts: string[] = [];
  for (let i = 0; i + 1 < nums.length; i += 2) pts.push(`${nums[i]} ${nums[i + 1]}`);
  pts.reverse();
  return `M ${pts[0]}${pts
    .slice(1)
    .map((p) => ` L ${p}`)
    .join('')} Z`;
}

export function makeSeamAlternates(
  glyphs: Glyph[],
  profilesIn?: (ReturnType<typeof glyphColumnAreas>)[],
): {
  alternates: Glyph[];
  rights: string[];
  offenders: Array<{ char: string; exitFrac: number; width: number; widthProfile: number[] }>;
  joinFrac: number;
  terminals: Array<{ char: string; entryFrac: number | null; exitFrac: number | null }>;
  join: { tipOffsetX: number; tipFrac: number; tangent: { dx: number; dy: number } } | null;
  skipped: string[];
} {
  const profiles = profilesIn ?? glyphs.map((g) => glyphColumnAreas(g));
  const fm = faceMetrics(glyphs, profiles);
  const xhPx = Math.max(1, fm.xhPx);
  type M = { i: number; char: string; joinsLeft: boolean; joinsRight: boolean; bodyMin: number; bodyMax: number; last: number; loopAbove: boolean; entryFrac: number | null; exitFrac: number | null; exitTipY: number };
  const meas: M[] = [];
  // Stage A entry-terminal strokes, reduced to the STANDARD JOIN (ADR 0049
  // Stage C): the synthesized connector terminates at the median entry tip
  // position (its x-offset from the glyph origin — the leftmost ink, where
  // connect placement anchors the advance) and approaches along the median
  // entry-tip tangent. The join HEIGHT stays the banked rowLeft-based
  // joinFrac below, so the offender gate and the landing line agree.
  const entryStrokes: Array<{ reach: number; tipFrac: number; tangent: { dx: number; dy: number } }> = [];
  glyphs.forEach((g, i) => {
    const prof = profiles[i];
    if (!prof) return;
    const cls = joinClass(g.char);
    if (cls.kind !== 'join') return;
    const body = bodyBoundsFromColumns(prof.cols, BODY_CONNECT_OPTS, prof.spans);
    if (!body) return;
    let last = -1;
    for (let c = prof.cols.length - 1; c >= 0; c--)
      if (prof.cols[c] > 0) {
        last = c;
        break;
      }
    if (last < 0) return;
    const baseY = g.baselineYInCell;
    const topY = Math.max(0, Math.round(baseY - SEAM_ZONE_HI * xhPx));
    const botY = Math.min(g.cellH - 1, Math.round(baseY - CONNECT_BAND_LO * xhPx));
    // Entry hooks live in the low CONNECT band by definition; scanning higher
    // let an arch shoulder (m, n) occlude the low tick and read the entry at
    // shoulder height, dropping real followers from the lookahead set.
    const entryTopY = Math.max(0, Math.round(baseY - CONNECT_BAND_HI * xhPx));
    // tail tips, measured only on ink OUTSIDE the dense body: the y of the
    // furthest reach is the terminal's height. A bare stem topping the zone
    // has no tail and never registers.
    let entryReach = Infinity,
      entryY = -1,
      exitReach = -Infinity,
      exitY = -1;
    for (let y = topY; y <= botY; y++) {
      const l = prof.rowLeft[y];
      const r = prof.rowRight[y];
      if (y >= entryTopY && isFinite(l) && l < body.min - 1 && l < entryReach) {
        entryReach = l;
        entryY = y;
      }
      if (isFinite(r) && r > body.max + 1 && r > exitReach) {
        exitReach = r;
        exitY = y;
      }
    }
    // structure check: right-of-body ink continuing well above the exit ceiling
    let loopAbove = false;
    const loopTopY = Math.max(0, Math.round(baseY - SEAM_LOOP_CHECK_HI * xhPx));
    const loopBotY = Math.min(g.cellH - 1, Math.round(baseY - SEAM_LOOP_CHECK_LO * xhPx));
    for (let y = loopTopY; y <= loopBotY; y++) {
      const r = prof.rowRight[y];
      if (isFinite(r) && r > body.max + 1) {
        loopAbove = true;
        break;
      }
    }
    // entry-terminal stroke (Stage A model) for the standard-join median: the
    // tip's offset from the leftmost ink (where placement anchors the origin)
    // and the tangent AT THE TIP — the direction the connector must arrive
    // along. Band-filtered so an ascender leaning left of a narrow body (a
    // full-column cross-section reads mid-air there) never pollutes the median.
    if (cls.joinsLeft) {
      const es = traceTerminalStroke(prof, body, baseY, xhPx, 'left');
      if (es) {
        const tf = (baseY - es.tip.y) / xhPx;
        if (tf > -0.2 && tf < 0.8) {
          let firstInk = -1;
          for (let c = 0; c < prof.cols.length; c++)
            if (prof.cols[c] > 0) {
              firstInk = c;
              break;
            }
          const k = Math.min(3, es.points.length - 1);
          const a = es.points[es.points.length - 1 - k];
          const t = es.points[es.points.length - 1];
          const dl = Math.max(1e-6, Math.hypot(a.x - t.x, a.y - t.y));
          entryStrokes.push({
            reach: es.tip.x - (firstInk < 0 ? es.tip.x : firstInk),
            tipFrac: tf,
            tangent: { dx: (a.x - t.x) / dl, dy: (a.y - t.y) / dl },
          });
        }
      }
    }
    meas.push({
      i,
      char: g.char,
      joinsLeft: cls.joinsLeft,
      joinsRight: cls.joinsRight,
      bodyMin: body.min,
      bodyMax: body.max,
      last,
      loopAbove,
      entryFrac: entryY >= 0 ? (baseY - entryY) / xhPx : null,
      exitFrac: exitY >= 0 ? (baseY - exitY) / xhPx : null,
      exitTipY: exitY,
    });
  });

  const terminals = meas.map((m) => ({ char: m.char, entryFrac: m.entryFrac, exitFrac: m.exitFrac }));
  const entries = meas.filter((m) => m.joinsLeft && m.entryFrac !== null).map((m) => m.entryFrac as number);
  if (entries.length < TAIL_MIN_JOINERS) return { alternates: [], rights: [], offenders: [], joinFrac: 0, terminals, join: null, skipped: [] };
  const sorted = entries.slice().sort((a, b) => a - b);
  // The hand's OWN entry line, unclamped: a copperplate-class hand joins at
  // mid-height (entries and exits both ~0.45·xh, already meeting) and clamping
  // to the snap's 0.3 ceiling read every one of its exits as high — 18 needless
  // alternates on cc-3, caught by the corpus. The snap's clamp protects ITS
  // warp target; measurement compares exits against where the entries really
  // are. Floor at the baseline band only.
  const joinFrac = Math.max(SNAP_JOIN_LO, sorted[Math.floor(sorted.length / 2)]);

  // Followers whose entry the lowered exit can land on: a low entry hook, or a
  // hook-less letter whose body edge carries ink across the join line anyway.
  const rights = Array.from(
    new Set(meas.filter((m) => m.joinsLeft && (m.entryFrac === null || m.entryFrac <= joinFrac + SEAM_ENTRY_TOL)).map((m) => m.char)),
  );

  // The standard join (ADR 0049): median entry tip x-offset, height, tangent.
  // Without enough traceable entry strokes there is nothing measured to draw
  // the connector FROM — bail whole (reconstruction is measured-parameter
  // only; the doctrine bans invented geometry).
  const stdJoin = standardJoinFromEntries(entryStrokes);
  if (!stdJoin) return { alternates: [], rights, offenders: [], joinFrac, terminals, join: null, skipped: [] };

  const offenders: Array<{ char: string; exitFrac: number; width: number; widthProfile: number[] }> = [];
  const alternates: Glyph[] = [];
  const skipped: string[] = [];
  const gapPx = Math.round(CONNECT_GAP_PCT * xhPx);
  for (const m of meas) {
    if (!m.joinsRight || m.exitFrac === null || m.loopAbove) continue;
    if (!SEAM_LOWERCASE.test(m.char)) continue;
    if (SEAM_CROSSBAR.has(m.char) || DESC_EXIT.has(m.char)) continue;
    if (m.exitFrac - joinFrac <= SEAM_EXIT_GATE) continue;
    const g = glyphs[m.i];
    const joinY = g.baselineYInCell - joinFrac * xhPx;
    const dy = joinY - m.exitTipY;
    if (dy < 1 || dy > SEAM_DY_MAX * xhPx) continue;
    // Reconstruct, don't warp (ADR 0049, both warp geometries failed the
    // panel): read the drawn exit tail as a stroke, DRAW one tangent-blended
    // connector from the body attachment to just past the standard join point
    // (body edge + connector gap + the median entry tip offset — where the
    // follower's entry tip sits at assembly, since placement anchors each
    // glyph's origin at its leftmost ink), then collapse the drawn tail onto
    // the body-edge clip line so the synthesized stroke owns the span. The
    // collapse is y-banded to the join zone so ascender ink leaning right of
    // a narrow body (the b loop) never moves. An offender whose tail cannot
    // be traced (or whose span degenerates) is skipped whole — never an
    // amputated letter without its bridge.
    const es = traceTerminalStroke(profiles[m.i]!, { min: m.bodyMin, max: m.bodyMax }, g.baselineYInCell, xhPx, 'right');
    // Width: the whole-tail median (measured on the smooth hand it tracks
    // the true stroke run; the root columns are bowl-union/pinch noise).
    // Reach: the pair kern is fitted to the BASE outline's long flick, so
    // the follower sits near where the drawn flick ENDED — the synthesized
    // stroke spans to the flick's own reach (m.last, the hand's measured
    // span) or the bare join model plus overlap, whichever is longer, and
    // its taper hides in the final quarter of that overlap instead of
    // running naked in the kern gap (the Stage D waist-before-the-stem).
    let synth: ReturnType<typeof synthesizeConnector> = null;
    if (es) {
      const joinX = m.bodyMax + gapPx + stdJoin.reach;
      // capped at the flick's own span: a tip pushed past it overshot the
      // c's entry and poked a spur through the stroke's far edge (the round-3
      // sev-3); the kern was fitted to m.last, so the follower's ink is there
      const targetX = Math.min(Math.max(joinX + 1.5 * es.width, m.last - 0.5 * es.width), Math.max(joinX + es.width, m.last + 0.5 * es.width));
      const overlap = (targetX - joinX) / Math.max(0.3, Math.abs(stdJoin.tangent.dx));
      synth = synthesizeConnector(es.attach, es.tangent, { x: joinX, y: joinY }, stdJoin.tangent, es.width, overlap);
    }
    if (!es || !synth) {
      skipped.push(m.char);
      continue;
    }
    offenders.push({ char: m.char, exitFrac: m.exitFrac, width: es.width, widthProfile: es.widths.map((w) => Math.round(w * 10) / 10) });
    const yLo = g.baselineYInCell - SEAM_ZONE_HI * xhPx;
    const yHi = g.baselineYInCell + 0.2 * xhPx;
    const collapsed = g.paths.map((d) => collapseSeamTail(d, m.bodyMax, yLo, yHi));
    const baseSign = pathAreaSign(g.paths[0] ?? '');
    const ringD = baseSign !== 0 && pathAreaSign(synth.d) !== baseSign ? reverseClosedPath(synth.d) : synth.d;
    alternates.push({
      ...g,
      variantSuffix: SEAM_ALT_SUFFIX,
      paths: [...collapsed, ringD],
    });
  }
  return {
    alternates,
    rights,
    offenders,
    joinFrac,
    terminals,
    join: { tipOffsetX: stdJoin.reach, tipFrac: stdJoin.tipFrac, tangent: stdJoin.tangent },
    skipped,
  };
}

/** Connected-cursive fit: place each glyph by its connection plugs so the exit
 *  of one letter meets the entry of the next, instead of trimming tails. A
 *  sibling of trimGlyphOverhangs (never a wrapper). Mutates paths via
 *  translatePathX and cellW only; char/italic/cellH/baselineYInCell untouched.
 *  See docs/superpowers/specs/2026-06-28-connected-cursive-design.md. */
export function connectGlyphs(
  glyphs: Glyph[],
  opts: { overlapPct?: number; minAdvPct?: number; seamless?: boolean } = {},
  profilesIn?: (ReturnType<typeof glyphColumnAreas>)[],
): {
  glyphs: Glyph[];
  joined: number;
  broke: number;
  breaks: Array<{ char: string; reason: string }>;
  entrySd: number;
  entryMed: number;
  entryNorm: boolean;
} {
  // profilesIn lets tests inject column rasters (jsdom has no canvas, so
  // glyphColumnAreas returns null there); production always computes them.
  const profiles = profilesIn ?? glyphs.map((g) => glyphColumnAreas(g));
  const fm = faceMetrics(glyphs, profiles);
  const xhPx = Math.max(1, fm.xhPx);
  const overlapPx = Math.round((opts.overlapPct ?? (opts.seamless ? OVERLAP_SEAMLESS : OVERLAP_PCT)) * xhPx);
  const minAdvPx = Math.max(1, Math.round((opts.minAdvPct ?? MIN_ADV_PCT) * xhPx));
  // Natural-variation builds carry the .cvNN palette glyphs. A varied face is
  // often a lighter, more upright hand whose thin connecting strokes ride high
  // and fade at text size, so the body gap is tightened for variation builds: the
  // dense bodies carry the join (solid ink) and the thin strokes ride over it,
  // instead of relying on the hairlines to bridge the wider default gap. Scoped
  // to variation so the corpus (non-variation) keeps its calibrated 0.16 gap.
  // .cv-scoped on purpose: a .jnNN seam alternate (ADR 0048) is a same-sheet
  // copy and must not flip a plain build onto the variation gap.
  const hasVariants = glyphs.some((g) => !!g.variantSuffix && g.variantSuffix.startsWith('.cv'));
  const connectGapPx = Math.round((hasVariants ? 0.05 : CONNECT_GAP_PCT) * xhPx);
  const leftPadPx = Math.max(LEFT_PAD_FLOOR, Math.round((0.1 / 100) * (fm.maxAscBBox / 0.8)));
  const maxPenPx = Math.max(3, Math.round((0.018 * fm.maxAscBBox) / 0.8));

  const ink = profiles.map((prof) => {
    if (!prof) return null;
    let first = -1,
      last = -1;
    for (let i = 0; i < prof.cols.length; i++)
      if (prof.cols[i] > 0) {
        if (first < 0) first = i;
        last = i;
      }
    return first < 0 ? null : { first, last };
  });

  // Per-glyph baseline, re-derived to the dense BODY bottom so every glyph shares
  // one baseline. detectBaselineInRow runs per row and drifts between the caps
  // rows and the lowercase rows (lowercase came out ~14px high, so caps floated
  // above lowercase). The body bottom — the lowest row at least BODY_BASE_FRAC of
  // the glyph's widest row — is the true sit line: it ignores the thin connector
  // dip below the baseline and the narrow descender stroke. Falls back to the
  // traced baseline when there is no profile (jsdom) or no dense row.
  const baseY = glyphs.map((g, i) => {
    const prof = profiles[i];
    if (!prof) return g.baselineYInCell;
    let maxW = 0;
    const w = new Array<number>(prof.rowLeft.length).fill(0);
    for (let y = 0; y < prof.rowLeft.length; y++) {
      if (isFinite(prof.rowLeft[y]) && isFinite(prof.rowRight[y])) {
        w[y] = prof.rowRight[y] - prof.rowLeft[y] + 1;
        if (w[y] > maxW) maxW = w[y];
      }
    }
    if (maxW <= 0) return g.baselineYInCell;
    const need = BODY_BASE_FRAC * maxW;
    let denseBottom = -1;
    for (let y = w.length - 1; y >= 0; y--)
      if (w[y] >= need) {
        denseBottom = y;
        break;
      }
    const traced = g.baselineYInCell;
    // Only override the traced baseline when the dense body bottom is a MODERATE
    // DOWNWARD correction (the per-row cap-float drift: lowercase came out ~14px
    // high, denseBottom sits just below it and pulls them down to sit). Two shapes
    // break the dense-bottom heuristic and must keep the traced line: a TOP-HEAVY
    // letter (r's wide arm rides high while its narrow stem reaches the true
    // baseline, so denseBottom lands ABOVE traced) and a DESCENDER (f g j y, whose
    // loop is wide enough to count as body, so denseBottom lands FAR below traced).
    if (denseBottom >= traced && denseBottom - traced <= BASE_DOWN_TOL * xhPx) return denseBottom;
    // UP correction (drawn-high): a NORMAL letter whose dense bottom IS its ink bottom
    // (nothing narrow reaches below it, unlike a top-heavy stem or a descender loop)
    // is lifted onto its body bottom so it sits on the line instead of floating above
    // it. This levels the residual baseline wobble of a hand drawn unevenly.
    let inkBottom = -1;
    for (let y = prof.rowLeft.length - 1; y >= 0; y--)
      if (isFinite(prof.rowLeft[y])) {
        inkBottom = y;
        break;
      }
    const normalSit = inkBottom >= 0 && inkBottom - denseBottom <= BASE_NORMAL_TOL * xhPx;
    if (denseBottom < traced && traced - denseBottom <= BASE_UP_TOL * xhPx && normalSit) return denseBottom;
    return traced;
  });

  // plugs in a horizontal band: leftmost/rightmost ink across the band's rows,
  // plus how many band rows carry ink and the band's share of the glyph's total
  // horizontal EXTENT (sum of per-row left-to-right spans, not a pixel count) —
  // the no-band promotion signal. Extent, not ink, is fine here: the dominant
  // gate is BAND_MIN_ROWS and the area threshold is tiny.
  const bandPlugs = (i: number, lo: number, hi: number, hBase: number) => {
    const prof = profiles[i]!;
    const g = glyphs[i];
    const botY = Math.min(g.cellH - 1, Math.max(0, Math.round(baseY[i] - hBase * lo)));
    const topY = Math.min(g.cellH - 1, Math.max(0, Math.round(baseY[i] - hBase * hi)));
    let left = Infinity,
      right = -Infinity,
      rows = 0,
      bandInk = 0,
      totalInk = 0,
      lY = -1,
      rY = -1;
    for (let y = 0; y < prof.rowLeft.length; y++) if (isFinite(prof.rowLeft[y])) totalInk += prof.rowRight[y] - prof.rowLeft[y] + 1;
    for (let y = topY; y <= botY; y++) {
      if (!isFinite(prof.rowLeft[y]) || !isFinite(prof.rowRight[y])) continue;
      rows++;
      bandInk += prof.rowRight[y] - prof.rowLeft[y] + 1;
      if (prof.rowLeft[y] < left) {
        left = prof.rowLeft[y];
        lY = y;
      }
      if (prof.rowRight[y] > right) {
        right = prof.rowRight[y];
        rY = y;
      }
    }
    return { left, right, rows, area: totalInk > 0 ? bandInk / totalInk : 0, lY, rY };
  };

  // Entry-reach scatter gate (ADR 0043): measure every left-joiner's entry-tail
  // reach (dense-body left edge minus leftmost ink); when the face's reaches
  // scatter, place by the eye-body instead. Also surfaced via __lastConnect and
  // the corpus line as a permanent diagnostic. Variants are skipped (they
  // inherit base metrics).
  const entryFracs: number[] = [];
  const exitFracs: number[] = [];
  glyphs.forEach((g, i) => {
    if (g.variantSuffix) return;
    const prof = profiles[i];
    const sp = ink[i];
    if (!prof || !sp) return;
    const cls = joinClass(g.char);
    if (cls.kind !== 'join' || !cls.joinsLeft) return;
    const body = bodyBoundsFromColumns(prof.cols, BODY_CONNECT_OPTS, prof.spans);
    if (!body) return;
    entryFracs.push((body.min - sp.first) / xhPx);
    exitFracs.push(Math.max(0, sp.last - body.max) / xhPx);
  });
  let entrySd = 0;
  let entryMed = 0;
  let exitMed = 0;
  if (entryFracs.length >= TAIL_MIN_JOINERS) {
    const m = entryFracs.reduce((a, x) => a + x, 0) / entryFracs.length;
    entrySd = Math.sqrt(entryFracs.reduce((a, x) => a + (x - m) * (x - m), 0) / entryFracs.length);
    const sorted = entryFracs.slice().sort((a, b) => a - b);
    entryMed = sorted[Math.floor(sorted.length / 2)];
    const sortedX = exitFracs.slice().sort((a, b) => a - b);
    exitMed = sortedX.length ? sortedX[Math.floor(sortedX.length / 2)] : 0;
  }
  // Long-sweep exemption: a hand whose MEDIAN entry reach marks it a long-entry
  // hand keeps the ink anchor — its reaches are drawn deep on purpose, its
  // connectors are drawn to span its own pitch, and the classic body-edge path
  // builds it well (the nano hand judged 80 there). The exemption sits at 0.5,
  // WIDER than compressConnectorTails' 0.6: the nano hand's three sheets
  // measured 0.574/0.593/0.614 and the 0.6 boundary sliced through them, so
  // two of the three entered the bridged path, where a HIGH_EXIT letter's
  // short high flick over a low entry left every e floating off its word.
  const NORM_SWEEP_EXEMPT = 0.5;
  const normalizeEntry = entrySd > ENTRY_REACH_SD_GATE && entryMed <= NORM_SWEEP_EXEMPT;
  // On a firing face, place by the EYE-CONSISTENT dense body: the columns whose
  // ink pixel count spans most of the x-height (EYE_BODY_FRAC, the corpus
  // probe's own criterion, at full cell resolution). The thin-trim body
  // under-reads a tall exit stroke (an r arm) that the eye — and the next
  // letter — runs into, so normalizing only the entry side moves the scatter
  // into weld growths instead of removing it (ADR 0043 Stage A). Dense columns
  // on BOTH edges put the arm inside the advance.
  //
  // The columns are BAND-LIMITED to the join zone (baseline up to 1.25·xh):
  // counting a glyph's whole column let a descender loop (y g p q j) read as
  // body, dragging the anchor onto the loop's leftmost swing — the judged
  // "Quietl y" / "s poken" / "d o g" word fractures. jsdom (unit tests) has no
  // canvas, so the band raster falls back to the full-column profile.
  const eyeBody = (i: number): { body: { min: number; max: number } | null; bandFirst: number } => {
    const prof = profiles[i]!;
    const cols = glyphBandColumnInk(glyphs[i], Math.round(baseY[i] - 1.25 * xhPx), baseY[i]) ?? prof.cols;
    // bandFirst: the leftmost ink IN THE JOIN BAND — the true start of the
    // entry stroke. Measuring the tail from the glyph's global leftmost ink let
    // a descender loop (y) read as a long tail, zeroing its deficit and putting
    // it a full median gap from a hook that cannot span it (the ly re-break).
    let bandFirst = -1;
    for (let c = 0; c < cols.length; c++)
      if (cols[c] > 0) {
        bandFirst = c;
        break;
      }
    return { body: eyeBodyFromCols(cols, EYE_BODY_FRAC * xhPx), bandFirst };
  };
  // The daylight LEVEL between eye-bodies is the hand's own NATURAL pitch: the
  // connector gap plus the face's MEDIAN entry reach — the median pair as the
  // hand drew it. Evening at the bare connector gap (the first cut) crushed the
  // letters into each other (judged: welded i/n/m clusters, i-dots on seams,
  // "minimum" illegible); the hand's connectors are drawn to span its own
  // pitch, so they meet at this level by construction.
  const bridgedGapPx = Math.round((CONNECT_GAP_PCT + entryMed) * xhPx);

  const decisions: ({ dx: number; cellW: number } | null)[] = glyphs.map(() => null);
  let joined = 0,
    broke = 0;
  const breaks: Array<{ char: string; reason: string }> = [];

  const breakGlyph = (i: number, reason: string) => {
    breaks.push({ char: glyphs[i].char, reason });
    const sp = ink[i];
    if (!sp) {
      decisions[i] = { dx: 0, cellW: Math.max(minAdvPx, Math.ceil(glyphs[i].cellW)) };
    } else {
      // break-class glyphs (caps, digits, punctuation) take their FULL ink width
      // plus a pad each side, never a trimmed body. A swashy cap must contain its
      // own swash inside its advance, or the trimmed tail overhangs and welds the
      // next letter (the field-chancery G+n / cap-overhang failures).
      decisions[i] = { dx: leftPadPx - sp.first, cellW: sp.last - sp.first + 1 + 2 * leftPadPx };
    }
    broke++;
  };

  for (let i = 0; i < glyphs.length; i++) {
    const g = glyphs[i];
    const prof = profiles[i];
    const sp = ink[i];
    const cls = joinClass(g.char);
    if (cls.kind === 'space') {
      decisions[i] = null; // the worker gives the space its own advance (spaceAdvance)
      continue;
    }
    if (cls.kind === 'break' || !prof || !sp) {
      breakGlyph(i, cls.kind === 'break' ? 'class' : 'no-ink');
      continue;
    }
    // Connection-POINT placement. Find the entry point (furthest-left reach) and
    // exit point (furthest-right reach) in the connection band, place the glyph so
    // its entry sits at the origin and the advance runs to its exit. The next
    // glyph's entry then lands exactly on this glyph's exit — the seam meets by
    // construction, measured the same way on both sides, so the rhythm is even and
    // the line is continuous. This replaces the old bounding-box plug + body-clamp,
    // whose per-letter body bounds caused the uneven joins and jagged baseline.
    const cp = bandPlugs(i, CONNECT_BAND_LO, CONNECT_BAND_HI, xhPx);
    if (cp.rows < BAND_MIN_ROWS || cp.area < BAND_MIN_AREA) {
      breakGlyph(i, `no-band(rows=${cp.rows},area=${cp.area.toFixed(3)})`);
      continue;
    }
    // Connect on the DENSE BODY edge, not the connecting-stroke tip. Real
    // handwriting (and an AI sheet) draws the entry/exit strokes at inconsistent
    // heights and lengths; matching tip-to-tip then leaves the seam gapping
    // whenever the two strokes ride at different heights. The body's left and
    // right edges, by contrast, carry ink across most of the x-height, so when
    // one body's right edge butts the next body's left edge they overlap across
    // a tall shared range and connect at every height — and each letter's real
    // thin strokes still ride out over the seam, keeping the cursive texture.
    const body = bodyBoundsFromColumns(prof.cols, BODY_CONNECT_OPTS, prof.spans);
    const entryX = body ? body.min : isFinite(cp.left) ? cp.left : sp.first;
    const exitX = body ? body.max : isFinite(cp.right) ? cp.right : sp.last;
    // Bodies sit a small CONNECTOR GAP apart (a negative overlap): butting them
    // edge-to-edge fuses the thin strokes deep into the neighbour; the gap leaves
    // room for the real connecting stroke to ride across the seam without the
    // bodies themselves colliding.
    // A round letter (o c e) with a long entry sweep FLOATS: anchoring its advance
    // on the leftmost ink folds the whole sweep into the advance, so the small bowl
    // sits off-centre with air around it. When the sweep is long, anchor the advance
    // on the BODY instead: the bowl centres in a tight advance and the (already
    // compressed) entry sweep rides left into the seam to meet the previous letter.
    // A tight round letter (a copperplate, a contained hand) keeps the leftmost-ink
    // anchor untouched, so only genuinely floating bowls move.
    const roundFloat = !!body && ROUND_BODY_ANCHOR.has(g.char) && body.min - sp.first > BODY_ANCHOR_MIN_TAIL * xhPx;
    // normalizeEntry (scattered-reach hand): place this glyph by its eye-body on
    // BOTH edges and anchor there, so per-pair daylight evens by construction and
    // the entry/exit strokes ride over the seams as bearings (ADR 0043), at the
    // hand's natural pitch (bridgedGapPx). The eye read is UNIONED with the
    // thin-trim body: a curved letterform (the u cup, the o bowl) never stacks
    // 0.45·xh of ink in one column, so the eye read alone truncates it to its
    // most vertical stroke — measured on handmade's u as a 161-unit advance
    // against 401 units of ink, the letter buried under both neighbours.
    const eyeRead = normalizeEntry ? eyeBody(i) : null;
    const eyeRaw = eyeRead ? eyeRead.body : null;
    const eye = normalizeEntry ? (eyeRaw && body ? { min: Math.min(eyeRaw.min, body.min), max: Math.max(eyeRaw.max, body.max) } : (eyeRaw ?? body)) : null;
    // Entry deficit per glyph: pull a letter closer only by the span the PAIR's
    // connectors cannot cover. The natural daylight (bridgedGapPx) is bridged
    // from BOTH sides — the previous letter's exit (the face median reach) plus
    // this letter's own entry tail — so the deficit is what remains after both,
    // plus a small merge margin. A first cut that ignored the exit side pulled
    // every short-tail letter to its hook length, crowding the i onto its
    // neighbour's seam (judged: the dot over the u-i join). The deficit folds
    // into the LEFT BEARING (anchor moves right), so the glyph's own advance to
    // its next letter is untouched.
    const tailPx = eye ? Math.max(0, eye.min - (eyeRead && eyeRead.bandFirst >= 0 ? eyeRead.bandFirst : sp.first)) : 0;
    // The exit side is trusted at HALF the median: the median overstates what a
    // specific previous letter's exit covers, and on a long-entry hand whose
    // sheets straddle the exemption boundary (the nano hand: medians 0.57-0.61)
    // 0.75 trust left every e floating off its word — d and s reach nowhere
    // near the median. Half the median is what the SHORT half of the exit
    // distribution can actually span.
    // Capped so daylight never drops below the base connector gap — the old
    // half-body cap bound NARROW letters first (the e: a small loop that needed
    // a deep pull and was allowed a shallow one, so it floated off its word).
    const deficitPx =
      eye && cls.joinsLeft
        ? Math.min(Math.max(0, bridgedGapPx - Math.round(0.5 * exitMed * xhPx) - tailPx + 2), Math.max(0, bridgedGapPx - connectGapPx))
        : 0;
    const anchorX = eye ? eye.min + deficitPx : 0;
    decisions[i] = anchorAdvance({
      leftPlug: eye ? anchorX : entryX,
      rightPlug: eye ? eye.max : exitX,
      inkLeft: eye && cls.joinsLeft ? anchorX : roundFloat ? body!.min : sp.first, // float: anchor on the body so the bowl centres; else the true left ink so a lead-in (f, t) is never clipped
      overlapPx: -(eye ? bridgedGapPx : connectGapPx),
      minAdvPx,
      leftPadPx,
      joinLeft: cls.joinsLeft,
      joinRight: cls.joinsRight,
    });
    joined++;
  }

  // Exit-overhang cap (bridged faces only): the placement-aware weld guard.
  // The next glyph's stem sits at the advance by construction, so a glyph whose
  // strip ink overhangs its advance beyond the lap allowance rides THROUGH the
  // following letter (the r arm slicing the stem on rl/rb, corpus structural
  // 269/298/207). Grow the advance so the overhang ends at the allowance; the
  // arm still laps the stem — the join — and the growth is per-glyph constant,
  // so the letter's own pairs stay even.
  if (normalizeEntry) {
    const armLapPx = Math.round(ARM_LAP_FRAC * xhPx);
    for (let i = 0; i < glyphs.length; i++) {
      const d = decisions[i];
      const prof = profiles[i];
      if (!d || !prof || glyphs[i].variantSuffix) continue;
      const cls = joinClass(glyphs[i].char);
      if (cls.kind !== 'join' || !cls.joinsRight) continue;
      // Scan past the weld strip to 1.25·xh: a lead-in arm (r) rides AT and
      // ABOVE the x-height, so a 1.1·xh ceiling misses its tip (run B: the cap
      // grabbed 70 units and structural still read 198 on rl). f and t stay
      // excluded above the strip — their crossbars overhang by design and
      // capping them would over-extend the advance (the old trim lesson).
      const scanTop = 'ft'.includes(glyphs[i].char) ? 1.1 : 1.25;
      let maxOver = -Infinity;
      for (let s = 0; s <= 36; s++) {
        const y = xhPx * 0.15 + xhPx * (scanTop - 0.15) * (s / 36);
        const row = Math.round(baseY[i] - y);
        if (row < 0 || row >= prof.rowRight.length) continue;
        if (!isFinite(prof.rowRight[row])) continue;
        const over = prof.rowRight[row] + d.dx - d.cellW;
        if (over > maxOver) maxOver = over;
      }
      if (isFinite(maxOver) && maxOver > armLapPx) d.cellW += maxOver - armLapPx;
    }
  }

  // loosen-only weld pass: grow a left glyph's advance where a misread-risk pair
  // penetrates the x-height body strip too deep. Mirrors trimGlyphOverhangs's
  // pairwise feedback; restores only ever grow advances, so one sweep is stable.
  // On a bridged face the overhang cap above is the weld guard (this formula
  // reads the deliberate bridge as a crash); the probe still measures.
  const byChar = new Map<string, number>();
  glyphs.forEach((g, i) => {
    if (profiles[i] && ink[i] && !byChar.has(g.char)) byChar.set(g.char, i);
  });
  const weldProbe: Array<{ pair: string; minGap: number; deepRows: number; rows: number; grew: number }> = [];
  for (const [lc, rc] of FUSION_CHECK_PAIRS) {
    const li = byChar.get(lc);
    const ri = byChar.get(rc);
    if (li === undefined || ri === undefined) continue;
    const Lp = profiles[li];
    const Rp = profiles[ri];
    if (!Lp || !Rp) continue;
    const dL = decisions[li];
    const dR = decisions[ri];
    const GLadv = dL ? dL.cellW : Math.max(1, Math.ceil(glyphs[li].cellW));
    const GLoff = dL ? dL.dx : 0;
    const GRoff = dR ? dR.dx : 0;
    let minGap = Infinity;
    let rows = 0,
      deepRows = 0;
    for (let s = 0; s <= 32; s++) {
      const y = xhPx * 0.15 + xhPx * 0.95 * (s / 32);
      const rowL = Math.round(baseY[li] - y);
      const rowR = Math.round(baseY[ri] - y);
      if (rowL < 0 || rowL >= Lp.rowRight.length || rowR < 0 || rowR >= Rp.rowLeft.length) continue;
      if (!isFinite(Lp.rowRight[rowL]) || !isFinite(Rp.rowLeft[rowR])) continue;
      rows++;
      const gap = GLadv + (Rp.rowLeft[rowR] + GRoff) - (Lp.rowRight[rowL] + GLoff);
      if (gap < -maxPenPx) deepRows++;
      if (gap < minGap) minGap = gap;
    }
    const exempt = normalizeEntry; // bridged face: the overhang cap is the guard
    let grew = 0;
    if (isFinite(minGap) && minGap < -maxPenPx && dL && !exempt) {
      grew = -minGap - maxPenPx;
      dL.cellW += grew;
    }
    if (isFinite(minGap)) weldProbe.push({ pair: lc + rc, minGap: Math.round(minGap), deepRows, rows, grew: Math.round(grew) });
  }
  (globalThis as unknown as { __lastWeld?: object }).__lastWeld = { pairs: weldProbe, maxPenPx };

  // Natural variation: a variant glyph (.cvNN) INHERITS its base letter's
  // horizontal connection metrics — the shift and the advance — so a calt
  // substitution is metrically TRANSPARENT. The body then connects exactly like
  // the proven no-variation build (which is clean and even), and only the outline
  // (the exit flick) varies. Without this each variant computes its own slightly-
  // different advance and entry, so the calt swap jolts the spacing mid-word and
  // drops or blobs letters. NOTE: baseY is NOT inherited — it lives in each
  // glyph's own cell coordinates, so the variant keeps its own corrected baseline
  // (copying the base's value would misplace the variant's ink vertically).
  const baseIdxByChar = new Map<string, number>();
  glyphs.forEach((g, i) => {
    if (!g.variantSuffix && !baseIdxByChar.has(g.char)) baseIdxByChar.set(g.char, i);
  });
  // Registered (body-aligned) paths, only for variant glyphs.
  const regPaths: (string[] | null)[] = glyphs.map(() => null);
  glyphs.forEach((g, i) => {
    if (!g.variantSuffix) return;
    const bi = baseIdxByChar.get(g.char);
    if (bi === undefined) return;
    decisions[i] = decisions[bi]; // base advance + shift = metrically transparent calt swap
    // REGISTER the variant's BODY onto the base's body (map the variant's body
    // x-range onto the base's), so the variant fills the base metric box. The 3
    // palette sheets are not perfectly aligned in scale/position, so a variant
    // traced a touch narrow or shifted would gap (its body ends before the base
    // advance) or overlap. Clamped so a mis-traced variant can't distort wildly;
    // for a well-matched variant (subtle variation) this is ~identity.
    const pb = profiles[bi] ? bodyBoundsFromColumns(profiles[bi]!.cols, BODY_CONNECT_OPTS, profiles[bi]!.spans) : null;
    const pv = profiles[i] ? bodyBoundsFromColumns(profiles[i]!.cols, BODY_CONNECT_OPTS, profiles[i]!.spans) : null;
    if (pb && pv && pv.max > pv.min && pb.max > pb.min) {
      const sx = Math.max(0.7, Math.min(1.4, (pb.max - pb.min) / (pv.max - pv.min)));
      const tx = pb.min - pv.min * sx;
      regPaths[i] = g.paths.map((p) => scaleTranslatePathX(p, sx, tx));
    }
  });

  // Apply the corrected baseline to every glyph so caps and lowercase share one
  // sit line, then the x placement on the joining glyphs.
  const out = glyphs.map((g, i) => {
    const base = baseY[i] !== g.baselineYInCell ? { baselineYInCell: baseY[i] } : null;
    const src = regPaths[i] ?? g.paths;
    const d = decisions[i];
    if (!d) return base || regPaths[i] ? { ...g, ...base, paths: src } : g;
    return { ...g, ...base, paths: src.map((p) => translatePathX(p, d.dx)), cellW: d.cellW };
  });
  return { glyphs: out, joined, broke, breaks, entrySd, entryMed, entryNorm: normalizeEntry };
}

/** Does the face read as a connected/script hand? Mirrors trimGlyphOverhangs's
 *  pass-1 self-classification (the share of glyphs carrying a deep tail), so the
 *  maker can auto-enable connect mode for a cursive sheet on the first build. */
export function isScriptFace(glyphs: Glyph[]): boolean {
  let withInk = 0,
    deepTails = 0;
  for (const g of glyphs) {
    const prof = glyphColumnAreas(g);
    if (!prof) continue;
    let first = -1,
      last = -1;
    for (let i = 0; i < prof.cols.length; i++)
      if (prof.cols[i] > 0) {
        if (first < 0) first = i;
        last = i;
      }
    if (first < 0) continue;
    withInk++;
    const b = bodyBoundsFromColumns(prof.cols, {}, prof.spans);
    if (!b) continue;
    const inkW = last - first + 1;
    const trim = Math.max(b.min - first, last - b.max);
    if (trim >= inkW * SCRIPT_TAIL_DEPTH) deepTails++;
  }
  return withInk > 0 && deepTails / withInk >= SCRIPT_TAIL_SHARE;
}

/** Map the spacing knob to the engine's advance flags. The engine only reads
 *  sideBearingPct on the tight-advance path; under cell-width advance the
 *  sheet's own pitch wins, so auto (0) keeps the historical behavior bit for
 *  bit. Out-of-range values clamp to the slider's 1-12. */
export function spacingToBuildFlags(spacingPct?: number): {
  useCellWidth: boolean;
  tightAdvance: boolean;
  sideBearingPct: number;
} {
  const tight = typeof spacingPct === 'number' && Number.isFinite(spacingPct) && spacingPct > 0;
  return {
    useCellWidth: !tight,
    tightAdvance: tight,
    sideBearingPct: tight ? Math.min(Math.max(spacingPct, 1), 12) / 100 : 0.05,
  };
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
  const flags = spacingToBuildFlags(opts.spacingPct);
  let glyphsIn = glyphs;
  let spaceAdvance: number | undefined;
  let styleOut = opts.style ?? 'Regular';
  // Set when connectGlyphs fires the entry-reach normalization: the placement
  // already carries the rhythm (even body gaps, deliberate connector bridges),
  // so the worker connect-kern must DEFER (ADR 0043). bridgedPlacement drops
  // the per-pair rhythm evening (its silhouette body measure disagrees with the
  // eye on tall-exit letters: handmade sdNoKern 26 re-scattered to sdKern 79)
  // and the lowercase collision/body floors (they read the bridge as a crash
  // and shoved 27/29 joins apart), keeping descender clearance, cap floors,
  // and the word-space evening.
  let connectBridged = false;
  let seamAltRights: string[] | undefined;
  if (opts.connect) {
    // Connected cursive. COMPOSES with natural variation: connectGlyphs runs on
    // the MERGED palette (it preserves variantSuffix), so the .cv01/.cv02 variant
    // glyphs get the same per-glyph connection advances as their bases and join
    // too; the calt feature then cycles them. A cursive hand joins AND varies.
    // cellW carries the plug-to-plug advance verbatim (useCellWidth, shiftX=0), so
    // tight advance must stay off or the worker re-measures the bbox and adds a
    // side bearing, voiding the join.
    flags.useCellWidth = true;
    flags.tightAdvance = false;
    onProgress?.('connect', opts.naturalVariation ? 'connected cursive · joining + cycling letters' : 'connected cursive · joining letters');
    // A long-sweep hand (a flashy script) draws entry connectors so long they fold
    // into the advance and the round letters float. Compress those over-long entry
    // sweeps toward the body first, so the letters place tight. Gated to variation
    // builds and self-gated on the hand's median entry tail, so a short-entry hand
    // (and the calibrated non-variation corpus) is untouched.
    // Compress over-long entry sweeps on ANY connect build (self-gated inside on the
    // hand's median entry tail, so a short-entry hand is skipped whole). Broadened
    // from variation-only so a single-sheet flashy upload is hardened too.
    const comp = compressConnectorTails(glyphs);
    (globalThis as unknown as { __lastCompress?: object | null }).__lastCompress = {
      compressed: comp.compressed,
      medianEntry: comp.medianEntry,
    };
    // Lower abnormally-high exit flicks onto the entries' join line so each seam meets
    // flush (self-gated inside on the hand's exit-vs-entry mismatch, so a copperplate
    // whose exits already meet its entries is skipped byte-for-byte).
    const snap = snapConnectorHeights(comp.glyphs);
    (globalThis as unknown as { __lastSnap?: object | null }).__lastSnap = {
      snapped: snap.snapped,
      mismatch: snap.mismatch,
    };
    // Seam alternates (ADR 0048, PARKED): explicit opt-in only — the warp
    // failed the judge panel twice and the feature has no user surface. The
    // path stays live under the e2e test hook so the banked machinery
    // (measurement, GSUB lookahead, kern hygiene) remains gated until the
    // stroke-model rework (ADR 0049) replaces the warp.
    let toFit = snap.glyphs;
    if (!opts.naturalVariation && opts.seamAlternates === true) {
      const sa = makeSeamAlternates(snap.glyphs);
      if (sa.alternates.length) {
        toFit = [...snap.glyphs, ...sa.alternates];
        seamAltRights = sa.rights;
      }
      (globalThis as unknown as { __lastSeamAlts?: object | null }).__lastSeamAlts = {
        count: sa.alternates.length,
        offenders: sa.offenders,
        joinFrac: sa.joinFrac,
        rights: sa.rights,
        terminals: sa.terminals,
        join: sa.join,
        skipped: sa.skipped,
      };
    } else {
      (globalThis as unknown as { __lastSeamAlts?: object | null }).__lastSeamAlts = null;
    }
    const fit = connectGlyphs(toFit, { overlapPct: opts.connectOverlapPct });
    glyphsIn = fit.glyphs;
    connectBridged = fit.entryNorm;
    // A bridged face's letter daylight sits at the hand's natural pitch (wider
    // than the bare connector gap), so the word break must widen with it or
    // words run together visually (judged: uneven, undersized word gaps).
    if (fit.entryNorm) spaceAdvance = 0.38;
    // connected runs read denser than upright; a touch more than the 0.28em
    // default keeps word breaks visible without gapping the join rhythm
    spaceAdvance = 0.3;
    // the worker slants on the STYLE NAME; a slant adds span to every advance
    // and shears every glyph, un-meeting the joins, so force upright here
    styleOut = 'Regular';
    (globalThis as unknown as { __lastConnect?: object }).__lastConnect = {
      joined: fit.joined,
      broke: fit.broke,
      breaks: fit.breaks,
      entrySd: fit.entrySd,
      entryMed: fit.entryMed,
      entryNorm: fit.entryNorm,
    };
  } else if (opts.naturalVariation) {
    // Natural variation WITHOUT connect (an upright hand): a plain build that
    // carries the .cv01/.cv02 palette; calt cycles the repeated letters.
    onProgress?.('variation', 'natural variation · cycling letter variants');
  } else if (opts.trimFlourishes) {
    // body advances need cell-width mode: the trimmed cell IS the advance and
    // the tail rides outside it; tight advance would re-measure the full bbox
    // and put the tail back into the advance. When the spacing knob is set it
    // becomes the pad and every glyph re-anchors (tight rhythm + overhang);
    // at auto only tailed glyphs re-fit, so the sheet's pitch survives.
    flags.useCellWidth = true;
    flags.tightAdvance = false;
    const knob = !!opts.spacingPct && opts.spacingPct > 0;
    const pct = knob ? Math.min(Math.max(opts.spacingPct!, 1), 12) : 3.5;
    onProgress?.('trim', 'flourish overhang · body advances');
    const fit = trimGlyphOverhangs(glyphs, bodyPadPx(glyphs, pct), { padAll: knob });
    glyphsIn = fit.glyphs;
    // script overhangs sweep into the word space; widen it so word breaks
    // survive (the engine default is 0.28em)
    if (fit.script) spaceAdvance = 0.38;
    // diagnostics hook (harmless), mirrors __lastBuild
    (globalThis as unknown as { __lastTrim?: object }).__lastTrim = { script: fit.script, trimmed: fit.trimmed };
  }
  const payload = {
    glyphs: glyphsIn.map((g) => ({
      char: g.char,
      italic: opts.connect ? false : !!g.italic,
      paths: g.paths,
      cellW: g.cellW,
      cellH: g.cellH,
      baselineYInCell: g.baselineYInCell,
      // carried so the builder can append it unicode-less; undefined on a base
      variantSuffix: g.variantSuffix,
    })),
    family: opts.family,
    style: styleOut,
    upm: opts.upm ?? 1000,
    ...flags,
    spaceAdvance,
    formats: opts.formats ?? ['otf', 'ttf', 'woff2'],
    // Auto-kern: the worker's silhouette analyzer measures the classic pair
    // set on the real (post-trim) glyphs and the GPOS PairPos writer lands a
    // real kerning table in the bytes — the path every modern text stack
    // honors (the legacy `kern` table stays off; it was Safari-only and
    // shipped broken once, see font-engine-features.js). Connect mode runs a
    // CONNECT-specific kern (analyzeConnectKern): it evens every pair to one gap
    // and breaks descender-loop collisions, refining the body-edge placement
    // rather than fighting it.
    features: {
      kerning: true,
      connectKern: opts.connect ? (connectBridged ? { bridgedPlacement: true } : {}) : undefined,
      naturalVariation: opts.naturalVariation ? true : undefined,
      joinAltRights: seamAltRights,
    },
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

// The exact rows guessCharset assumes for a 6-row split sheet, so a sheet
// drawn into the printed grid auto-fills the charset box with no edits.
const TEMPLATE_CHAR_LINES = [
  'ABCDEFGHIJKLM',
  'NOPQRSTUVWXYZ',
  'abcdefghijklm',
  'nopqrstuvwxyz',
  '0123456789',
  ".,!?:;'-&@#",
];

/** Render a blank, printable alphabet grid in US-letter landscape proportions.
 *  Every guide (cell walls, baselines, hint letters, instructions) is a light
 *  gray that sits far above the tracer's hard 128 luminance threshold, so on
 *  the photographed sheet only the pen ink survives binarization. The 6x13
 *  split layout matches guessCharset's 6-row template. */
export function makeTemplateSheet(): HTMLCanvasElement {
  const W = 2200;
  const H = 1700; // 11in x 8.5in
  const top = 70;
  const rowH = 265;
  const GUIDE = '#c9c9c9';
  const HINT = '#d4d4d4';
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, W, H);

  // instructions live in the margins, in the same vanishing gray
  ctx.fillStyle = GUIDE;
  ctx.font = '600 26px system-ui, sans-serif';
  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = 'left';
  ctx.fillText('fonthead.dev · draw one character per box with a dark pen', 40, 46);
  ctx.textAlign = 'right';
  ctx.fillText('photograph the sheet flat · the gray guides disappear when traced', W - 40, H - 24);
  ctx.textAlign = 'left';
  ctx.fillText('for a joined cursive: give each letter a short entry and exit stroke on the dotted line, but keep a gap between letters', 40, H - 24);

  TEMPLATE_CHAR_LINES.forEach((row, r) => {
    const y0 = top + r * rowH;
    const baseline = y0 + rowH * 0.62;
    const n = row.length;
    const cellW = W / n;

    ctx.strokeStyle = GUIDE;
    ctx.lineWidth = 2;
    // the row band
    ctx.strokeRect(1, y0 + 4, W - 2, rowH - 8);
    // cell walls
    for (let i = 1; i < n; i++) {
      const x = Math.round(i * cellW);
      ctx.beginPath();
      ctx.moveTo(x, y0 + 4);
      ctx.lineTo(x, y0 + rowH - 4);
      ctx.stroke();
    }
    // the baseline, dashed; descenders hang below it
    ctx.setLineDash([10, 8]);
    ctx.beginPath();
    ctx.moveTo(1, baseline);
    ctx.lineTo(W - 1, baseline);
    ctx.stroke();
    ctx.setLineDash([]);

    // the connector line: a fainter dotted guide just above the baseline where a
    // connected cursive's join strokes ride. A joined hand runs every letter
    // through this one height so the maker's connect mode links them; an upright
    // hand can ignore it (it sits above the trace threshold and never traces).
    ctx.setLineDash([3, 7]);
    ctx.beginPath();
    ctx.moveTo(1, baseline - rowH * 0.08);
    ctx.lineTo(W - 1, baseline - rowH * 0.08);
    ctx.stroke();
    ctx.setLineDash([]);

    // a small hint letter in each cell's top-left corner
    ctx.fillStyle = HINT;
    ctx.font = '600 30px system-ui, sans-serif';
    ctx.textAlign = 'left';
    for (let i = 0; i < n; i++) {
      ctx.fillText(row[i], i * cellW + 12, y0 + 42);
    }
  });
  return c;
}

/** Bucket a build error into a funnel failure class, so field failures count
 *  by kind without ever storing a message. */
export function classifyBuildError(message: string): string {
  const m = message.toLowerCase();
  if (m.includes('engine did not load')) return 'engine_load';
  if (m.includes('no glyphs')) return 'no_glyphs';
  if (m.includes('rows but your charset')) return 'rows_mismatch';
  if (m.includes('no character rows')) return 'no_rows';
  if (m.includes('charset')) return 'charset';
  if (m.includes('worker')) return 'worker';
  return 'other';
}

/** Trigger a PNG download of a rendered canvas. */
export function downloadCanvasPng(c: HTMLCanvasElement, filename: string) {
  c.toBlob((blob) => {
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }, 'image/png');
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
    // the orchestrator takes an absolute side bearing in UPM units (its
    // default is 50, i.e. 5% of 1000); the knob speaks percent
    ...(colorOpts.spacingPct && colorOpts.spacingPct > 0
      ? { sideBearing: Math.round(Math.min(Math.max(colorOpts.spacingPct, 1), 12) * 10) }
      : {}),
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
