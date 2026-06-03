// fonthead.dev — maker orchestration (client-only).
//
// Drives the vendored font engine: traces an alphabet-sheet image into glyph
// paths on the main thread (TracerCore + Potrace), then hands the glyphs to the
// classic Web Worker that builds OTF / TTF / WOFF / WOFF2. The engine modules
// are served verbatim from /assets and expose window globals; this module is
// the thin, typed bridge to them. It only ever runs in the browser.

/* eslint-disable @typescript-eslint/no-explicit-any */
const w = () => window as any;

export interface TraceOpts {
  threshold: number;
  invert: boolean;
  weight: number;
  turdsize: number;
  alphamax: number;
  opttolerance: number;
  optcurve: boolean;
}

export const DEFAULT_TRACE: TraceOpts = {
  threshold: 128,
  invert: false,
  weight: 0,
  turdsize: 2,
  alphamax: 1.0,
  opttolerance: 0.15,
  optcurve: true,
};

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

// Standard three-row sheet: A-Z, a-z, 0-9, top to bottom.
export const ROW_CHARS = [
  'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
  'abcdefghijklmnopqrstuvwxyz',
  '0123456789',
];

const ENGINE_VERSION = '0.8.59';

/** Resolve once the vendored engine globals are present on window. */
export function waitForEngine(timeoutMs = 15000): Promise<void> {
  return new Promise((resolve, reject) => {
    const ready = () =>
      w().TracerCore && w().buildFontForStyle && w().estimateBBox && w().Potrace;
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

function pickRanges(
  data: Uint8ClampedArray,
  W: number,
  y0: number,
  y1: number,
  expected: number,
  chars: string,
): { ranges: number[][]; ownerFn: any } {
  const TC = w().TracerCore;
  const symbols = /[^A-Za-z0-9 ]/.test(chars);
  if (symbols) {
    const comp = TC.sliceRowByComponents(data, W, y0, y1, expected, DEFAULT_TRACE.turdsize);
    if (comp.ranges.length === expected) return comp;
    const owned = TC.sliceRowByAnchoredWithOwnership(data, W, y0, y1, expected, DEFAULT_TRACE.turdsize);
    if (owned.ranges.length === expected) return owned;
    return { ranges: TC.sliceRowByAnchoredMinima(data, W, y0, y1, expected), ownerFn: null };
  }
  const ws = TC.sliceRowByWhitespace(data, W, y0, y1);
  if (ws.length === expected) return { ranges: ws, ownerFn: null };
  return { ranges: TC.sliceRowByAnchoredMinima(data, W, y0, y1, expected), ownerFn: null };
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

async function rowToGlyphs(
  data: Uint8ClampedArray,
  W: number,
  H: number,
  y0: number,
  y1: number,
  chars: string,
  opts: TraceOpts,
): Promise<Glyph[]> {
  const TC = w().TracerCore;
  const expected = chars.length;
  const { ranges, ownerFn } = pickRanges(data, W, y0, y1, expected, chars);
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
    const cell = TC.extractCellBinary(data, W, cx0, cx1, cy0, cy1, ownerFn, i);
    const map = TC.mapCellToGlyph(cx0, cy0, cx1, cy1, baselineAbs);
    const svg = await TC.traceCellBitmap(cell, opts.turdsize, opts.optcurve, opts.alphamax, opts.opttolerance);
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
  return glyphs;
}

/** Trace a loaded image (alphabet sheet) into glyph objects. */
export async function traceSheet(
  img: HTMLImageElement | ImageBitmap,
  rowChars: string[],
  opts: TraceOpts,
  onProgress?: Progress,
): Promise<Glyph[]> {
  const TC = w().TracerCore;
  const iw = (img as HTMLImageElement).naturalWidth ?? (img as ImageBitmap).width;
  const ih = (img as HTMLImageElement).naturalHeight ?? (img as ImageBitmap).height;
  onProgress?.('binarize', 'threshold · otsu adaptive');
  const bin = TC.binarizeFull(img, iw, ih, opts.threshold, opts.invert, opts.weight);
  onProgress?.('slice', 'detecting rows + cells');
  const rows = TC.detectRowsInBinary(bin.data, bin.w, bin.h);
  let glyphs: Glyph[] = [];
  const n = Math.min(rows.length, rowChars.length);
  for (let i = 0; i < n; i++) {
    onProgress?.('trace', `row ${i + 1}/${n} · contours`);
    const g = await rowToGlyphs(bin.data, bin.w, bin.h, rows[i][0], rows[i][1], rowChars[i], opts);
    glyphs = glyphs.concat(g);
  }
  return glyphs;
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

/** Build font files from traced glyphs via the worker. */
export function buildFont(glyphs: Glyph[], opts: BuildOpts, onProgress?: Progress): Promise<FontResult> {
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
  return new Promise((resolve, reject) => {
    const wk = getWorker();
    const id = ++_next;
    _reqs.set(id, { resolve, reject, progress: onProgress });
    wk.postMessage({ id, type: 'generate', payload });
  });
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
export function makeSampleSheet(font = '700 130px Anton, system-ui, sans-serif'): HTMLCanvasElement {
  const W = 1600;
  const rowH = 240;
  const H = rowH * ROW_CHARS.length + 80;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = '#000000';
  ctx.font = font;
  ctx.textBaseline = 'alphabetic';
  ROW_CHARS.forEach((row, r) => {
    const y = 60 + r * rowH + rowH * 0.62;
    const n = row.length;
    const cellW = W / n;
    for (let i = 0; i < n; i++) {
      const ch = row[i];
      const cx = i * cellW + cellW / 2;
      ctx.textAlign = 'center';
      ctx.fillText(ch, cx, y);
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

// ---- colour fonts (COLR/CPAL, built on the main thread) -------------------

export type ColorMode = 'flat' | 'gradient';

export interface ColorResult {
  otf: Uint8Array;
  woff2?: Uint8Array;
  mode: ColorMode;
  colrStatus: string;
  charCount: number;
}

/** Resolve once the colour engine + main-thread wawoff2 are present. */
export function waitForColorEngine(timeoutMs = 20000): Promise<void> {
  return new Promise((resolve, reject) => {
    const ready = () =>
      w().ColorMaker && w().buildColorFont && w().buildGradientFont && w().ColorCore && w().wrapAsWoff2;
    if (ready()) return resolve();
    const t0 = Date.now();
    const iv = setInterval(() => {
      if (ready()) {
        clearInterval(iv);
        resolve();
      } else if (Date.now() - t0 > timeoutMs) {
        clearInterval(iv);
        reject(new Error('colour engine did not load'));
      }
    }, 50);
  });
}

/** Build a COLR/CPAL colour font from a sheet. Runs on the main thread; woff2
 *  is compressed via the main-thread wawoff2. Returns OTF + WOFF2 (no TTF). */
export async function buildColorFontFromImage(
  img: HTMLImageElement | ImageBitmap,
  mode: ColorMode,
  family: string,
  onProgress?: Progress,
): Promise<ColorResult> {
  onProgress?.('separate', mode === 'gradient' ? 'palette + gradient sampling' : 'palette + colour separation');
  const res = await w().ColorMaker.buildColorFromImage(img, {
    mode,
    familyName: family || 'Color Font',
    charLines: ROW_CHARS,
  });
  onProgress?.('build', `COLR ${res.colrStatus} · packing`);
  let woff2: Uint8Array | undefined;
  try {
    woff2 = await w().wrapAsWoff2(res.otf);
  } catch {
    /* woff2 is optional; the otf is the source of truth */
  }
  return {
    otf: res.otf as Uint8Array,
    woff2,
    mode,
    colrStatus: res.colrStatus,
    charCount: res.charCount ?? 0,
  };
}

/** A colour sample sheet: the alphabet filled with a vertical flame gradient
 *  per row, so both gradient (smooth COLRv1) and flat (posterised COLRv0) modes
 *  have real colour to separate. */
export function makeColorSampleSheet(font = '700 130px Anton, system-ui, sans-serif'): HTMLCanvasElement {
  const W = 1600;
  const rowH = 240;
  const H = rowH * ROW_CHARS.length + 80;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, W, H);
  ctx.font = font;
  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = 'center';
  ROW_CHARS.forEach((row, r) => {
    const top = 60 + r * rowH;
    const baseY = top + rowH * 0.62;
    // flame: deep red at the foot, gold at the top of the row band
    const grad = ctx.createLinearGradient(0, baseY, 0, top + rowH * 0.05);
    grad.addColorStop(0, '#c41608');
    grad.addColorStop(0.45, '#e64a0c');
    grad.addColorStop(0.8, '#f7a01e');
    grad.addColorStop(1, '#ffde5a');
    ctx.fillStyle = grad;
    const n = row.length;
    const cellW = W / n;
    for (let i = 0; i < n; i++) ctx.fillText(row[i], i * cellW + cellW / 2, baseY);
  });
  return c;
}

export function fileToImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      resolve(img);
    };
    img.onerror = () => reject(new Error('could not read that image'));
    img.src = url;
  });
}
