import type { Glyph, synthesizeConnector, translatePathX } from './maker';

type Point = { x: number; y: number };
export type Terminal = { points: Point[]; width: number; tangent: Point };
type Terminals = { left: Terminal; right: Terminal };

const median = (values: number[]) => values.slice().sort((a, b) => a - b)[Math.floor(values.length / 2)];

/** Follow an actual open stroke from its endpoint. Stop before a branch: bowls,
 * loops and crossed strokes belong to the letter, not to its connector. */
export function walkTerminal(mask: Uint8Array, width: number, height: number, start: number, reach: number): Point[] {
  const neighbors = (i: number) => {
    const x = i % width, y = Math.floor(i / width);
    const found: number[] = [];
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      if ((!dx && !dy) || x + dx < 0 || x + dx >= width || y + dy < 0 || y + dy >= height) continue;
      const j = i + dy * width + dx;
      if (mask[j]) found.push(j);
    }
    return found;
  };
  if (!mask[start] || neighbors(start).length !== 1) return [];
  const points: Point[] = [];
  const seen = new Set<number>();
  let current = start, previous = -1, length = 0;
  while (points.length < width + height) {
    const p = { x: current % width, y: Math.floor(current / width) };
    points.push(p);
    seen.add(current);
    if (length >= reach) break;
    const candidates = neighbors(current).filter(j => !seen.has(j));
    if (!candidates.length) break;
    // Count disjoint branches around the pixel, not its raw degree. Diagonal
    // staircases have three neighbors without being a three-way junction.
    const ring = [[0, -1], [1, -1], [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1]];
    const occupied = ring.map(([dx, dy]) => p.x + dx >= 0 && p.x + dx < width && p.y + dy >= 0 && p.y + dy < height ? mask[current + dy * width + dx] : 0);
    const branches = occupied.reduce((n, value, i) => n + (!value && occupied[(i + 1) % 8] ? 1 : 0), 0);
    if (branches >= 3) break;
    const dx = previous < 0 ? 0 : p.x - previous % width;
    const dy = previous < 0 ? 0 : p.y - Math.floor(previous / width);
    const score = (j: number) => dx * (j % width - p.x) + dy * (Math.floor(j / width) - p.y);
    candidates.sort((a, b) => score(b) - score(a));
    const next = candidates[0];
    length += Math.hypot(next % width - p.x, Math.floor(next / width) - p.y);
    previous = current;
    current = next;
  }
  return points;
}

function measureTerminals(g: Glyph, xh: number, exitOnly = false): Terminals | null {
  const core = (window as any).SingleLineCore;
  const scale = Math.min(3, 120 / xh);
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(g.cellW * scale);
  canvas.height = Math.ceil(g.cellH * scale);
  if (canvas.width * canvas.height > 1_000_000) return null;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;
  ctx.scale(scale, scale);
  g.paths.forEach(d => ctx.fill(new Path2D(d)));
  const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
  const mask = new Uint8Array(canvas.width * canvas.height);
  for (let i = 0; i < mask.length; i++) mask[i] = pixels[i * 4 + 3] > 127 ? 1 : 0;
  const skeleton: Uint8Array = core.zhangSuenThin(mask, canvas.width, canvas.height);
  const distance: Float32Array = core.distanceTransform(mask, canvas.width, canvas.height);
  const endpoints: number[] = [];
  for (let y = 1; y < canvas.height - 1; y++) {
    if (y / scale < g.baselineYInCell - 0.85 * xh || y / scale > g.baselineYInCell + 0.1 * xh) continue;
    for (let x = 1; x < canvas.width - 1; x++) {
      const i = y * canvas.width + x;
      if (!skeleton[i]) continue;
      let degree = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (dx || dy) degree += skeleton[i + dy * canvas.width + dx];
      if (degree === 1) endpoints.push(i);
    }
  }
  endpoints.sort((a, b) => a % canvas.width - b % canvas.width);
  if (endpoints.length < (exitOnly ? 1 : 2)) return null;
  const read = (start: number, side: 'left' | 'right'): Terminal | null => {
    const raw = walkTerminal(skeleton, canvas.width, canvas.height, start, 0.38 * xh * scale);
    if (raw.length < 5) return null;
    const points = raw.map(p => ({ x: p.x / scale, y: p.y / scale }));
    const tip = points[0], attach = points[points.length - 1];
    const span = side === 'left' ? attach.x - tip.x : tip.x - attach.x;
    if (span < 0.16 * xh) return null;
    const widths = raw.slice(2, -1).map(p => 2 * distance[p.y * canvas.width + p.x] / scale);
    const width = median(widths);
    if (!(width > 0.035 * xh && width < 0.22 * xh)) return null;
    const nearby = points[Math.max(0, points.length - 1 - Math.round(0.12 * xh * scale))];
    const length = Math.hypot(nearby.x - attach.x, nearby.y - attach.y);
    if (length < 1 / scale) return null;
    const tangent = { x: (nearby.x - attach.x) / length, y: (nearby.y - attach.y) / length };
    if ((side === 'left' ? -1 : 1) * tangent.x < 0.35) return null;
    return { points, width, tangent };
  };
  const right = read(endpoints[endpoints.length - 1], 'right');
  const left = exitOnly ? right : read(endpoints[0], 'left');
  if (exitOnly && right) {
    const inkRight = Math.max(...g.paths.map(d => (window as any).estimateBBox(d)?.maxX ?? 0));
    // A capital's low endpoint can be the beginning of a stem inside a wide
    // bowl. It is an exit only when it actually reaches the right edge.
    if (inkRight - right.points[0].x > 0.25 * xh) return null;
  }
  return left && right ? { left, right } : null;
}

type Helpers = {
  xhPx: number;
  fallback: Glyph[];
  translatePathX: typeof translatePathX;
  synthesizeConnector: typeof synthesizeConnector;
};

/** An opt-in terminal model for thin scripts with two identifiable open tails.
 * Advances and both endpoint tangents are solved together. Applying the old
 * overlap kerning afterwards would undo this geometry and reopen the seams. */
export async function smoothCursiveGlyphs(glyphs: Glyph[], helpers: Helpers): Promise<{
  glyphs: Glyph[]; rights: string[]; lefts: string[]; width: number; joinFrac: number;
}> {
  if (!(window as any).SingleLineCore) throw new Error('smooth joins engine did not load. Reload and try again.');
  if (glyphs.some(g => g.variantSuffix)) throw new Error('smooth joins needs one alphabet sheet. Turn off natural variation.');
  const xh = helpers.xhPx;
  const lowercase = glyphs.filter(g => /^[a-z]$/.test(g.char));
  if (lowercase.length < 4 || !(xh > 0)) throw new Error('smooth joins needs at least four lowercase letters with open connecting tails.');
  const measured = new Map<string, Terminals>();
  for (const g of lowercase) {
    const terminals = measureTerminals(g, xh);
    if (!terminals) throw new Error(`could not safely identify both connecting tails on ${g.char}. Turn off smooth joins for this sheet.`);
    measured.set(g.char, terminals);
  }
  const widths = [...measured.values()].flatMap(t => [t.left.width, t.right.width]);
  const width = median(widths);
  if (widths.some(w => w < width * 0.55 || w > width * 1.65)) throw new Error('smooth joins needs a fairly even pen width. Turn off smooth joins for this sheet.');
  const tips = lowercase.flatMap(g => {
    const pair = measured.get(g.char)!;
    return [pair.left, pair.right].map(terminal => {
      const tip = terminal.points[0];
      const near = terminal.points[Math.min(terminal.points.length - 1, Math.max(2, Math.round(terminal.points.length / 3)))];
      return { height: (g.baselineYInCell - tip.y) / xh, slope: (near.y - tip.y) / (near.x - tip.x) };
    });
  });
  const joinFrac = median(tips.map(t => t.height));
  const slope = median(tips.map(t => t.slope).filter(Number.isFinite));
  const output: Glyph[] = [];
  const rights = lowercase.map(g => g.char);
  const lefts = [...rights];
  const fallback = new Map(helpers.fallback.map(g => [g.char, g]));

  for (const g of glyphs) {
    let terminals = measured.get(g.char);
    const isLower = /^[a-z]$/.test(g.char);
    // Capitals may supply an exit but never lose their opening stroke. A
    // capital without a clear right-hand exit keeps its complete ink width.
    if (!terminals && /^[A-Z]$/.test(g.char)) terminals = measureTerminals(g, xh, true) ?? undefined;
    if (!terminals) {
      if (/^[A-Z]$/.test(g.char)) {
        const bounds = g.paths.map(d => (window as any).estimateBBox(d)).filter(Boolean);
        if (bounds.length) {
          const min = Math.min(...bounds.map(b => b.minX));
          const max = Math.max(...bounds.map(b => b.maxX));
          const pad = 0.06 * xh;
          // This mode has fixed joins and no collision kerning. Unconnected
          // capitals must contain their swashes instead of relying on GPOS.
          output.push({ ...g, cellW: max - min + 2 * pad, paths: g.paths.map(d => helpers.translatePathX(d, pad - min)) });
          continue;
        }
      }
      output.push(fallback.get(g.char) ?? g);
      continue;
    }
    if (!isLower) lefts.push(g.char);
    const inset = width * 0.45;
    const entryX = terminals.left.points[0].x + inset;
    const exitX = terminals.right.points[0].x - inset;
    const origin = isLower ? entryX : Math.min(...g.paths.map(d => (window as any).estimateBBox(d)?.minX ?? 0)) - 1;
    const base = { ...g, cellW: exitX - origin, paths: g.paths.map(d => helpers.translatePathX(d, -origin)) };
    if (!(base.cellW > xh * 0.2)) throw new Error(`connecting tails on ${g.char} are too close. Turn off smooth joins for this sheet.`);
    output.push(base);
    for (const suffix of isLower ? ['.jn01', '.jn02', '.jn03'] : ['.jn01']) {
      const canvas = document.createElement('canvas');
      const scale = Math.min(6, 180 / xh);
      canvas.width = Math.ceil(g.cellW * scale);
      canvas.height = Math.ceil(g.cellH * scale);
      const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
      ctx.scale(scale, scale);
      ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, g.cellW, g.cellH);
      ctx.fillStyle = '#000'; g.paths.forEach(d => ctx.fill(new Path2D(d)));
      const replacements: string[] = [];
      for (const side of ['left', 'right'] as const) {
        if ((side === 'left' && suffix === '.jn01') || (side === 'right' && suffix === '.jn02')) continue;
        const terminal = terminals[side], pts = terminal.points;
        const attach = pts[pts.length - 1], direction = side === 'left' ? -1 : 1;
        const y0 = Math.min(...pts.map(p => p.y)) - terminal.width;
        const y1 = Math.max(...pts.map(p => p.y)) + terminal.width;
        ctx.fillStyle = '#fff';
        if (side === 'left') ctx.fillRect(0, y0, attach.x, y1 - y0);
        else ctx.fillRect(attach.x, y0, g.cellW - attach.x, y1 - y0);
        const connector = helpers.synthesizeConnector(
          attach, { dx: terminal.tangent.x, dy: terminal.tangent.y },
          { x: side === 'left' ? entryX : exitX, y: g.baselineYInCell - joinFrac * xh },
          { dx: direction, dy: slope * direction }, width, width * 0.2,
        );
        if (!connector) throw new Error(`could not reconstruct the ${side} tail on ${g.char}. Turn off smooth joins for this sheet.`);
        replacements.push(connector.d);
      }
      ctx.fillStyle = '#000'; replacements.forEach(d => ctx.fill(new Path2D(d)));
      const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
      for (let i = 0; i < data.length; i += 4) {
        const v = data[i] < 128 ? 0 : 255;
        data[i] = data[i + 1] = data[i + 2] = v; data[i + 3] = 255;
      }
      // Trace the union, not overlapping contours: opposite contour winding
      // or a narrow overlap must never punch a white seam through the join.
      const tracer = (window as any).TracerCore;
      const svg = await tracer.traceCellBitmap({ data, w: canvas.width, h: canvas.height }, 0, true, 1, 0.1, 1 / scale);
      const paths: string[] = tracer.extractPathDFromSvg(svg);
      if (!paths.length) throw new Error(`smooth joins lost the outline of ${g.char}.`);
      output.push({ ...base, variantSuffix: suffix, paths: paths.map(d => helpers.translatePathX(d, -origin)) });
    }
  }
  return { glyphs: output, rights, lefts, width, joinFrac };
}
