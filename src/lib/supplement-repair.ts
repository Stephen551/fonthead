import type { Glyph } from './maker';
import { latinAccent, isExpectedAccentMark } from './accents';

export interface OutlineBounds { minX: number; minY: number; maxX: number; maxY: number }
type Measure = (paths: string[]) => OutlineBounds | null;
interface Evidence { coverage: number; donorComponents: number; targetComponents: number }
type Compare = (donor: string[], target: string[], box: OutlineBounds, cut: number, xHeight: number) => Evidence;

// Tracer output is absolute M/L/C/Q/Z. Reject other commands before translating.
function translated(d: string, dx: number, dy: number): string | null {
  if (/[a-df-z]/.test(d) || /[AHSTV]/.test(d)) return null;
  let x = true;
  return d.replace(/[-+]?\d*\.?\d+(?:e[-+]?\d+)?|[MLCQZ]/gi, token => {
    if (/^[MLCQZ]$/.test(token)) { x = true; return token; }
    const value = Number(token) + (x ? dx : dy); x = !x;
    return String(Math.round(value * 10000) / 10000);
  });
}

/** Pixel agreement above the cut, with a two-pixel allowance for tracing noise.
 * Connectivity is measured over the full bodies, never the separate accents. */
function compareBodies(donor: string[], target: string[], box: OutlineBounds, cut: number, xHeight: number): Evidence {
  const scale = 96 / xHeight, pad = 3;
  const width = Math.ceil((box.maxX - box.minX) * scale) + pad * 2;
  const height = Math.ceil((box.maxY - box.minY) * scale) + pad * 2;
  const empty = { coverage: 0, donorComponents: 0, targetComponents: 0 };
  if (width > 512 || height > 512 || width < 1 || height < 1) return empty;
  const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return empty;
  const raster = (paths: string[]) => {
    ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, width, height);
    ctx.setTransform(scale, 0, 0, scale, pad - box.minX * scale, pad - box.minY * scale);
    ctx.fill(new Path2D(paths.join(' ')), 'evenodd');
    const pixels = ctx.getImageData(0, 0, width, height).data;
    return Uint8Array.from({ length: width * height }, (_, i) => pixels[i * 4 + 3] >= 64 ? 1 : 0);
  };
  const a = raster(donor), b = raster(target);
  const coverage = (from: Uint8Array, to: Uint8Array) => {
    let total = 0, matched = 0;
    const end = Math.min(height, Math.floor(pad + (cut - box.minY) * scale) - 2);
    for (let y = 0; y < end; y++) for (let x = 0; x < width; x++) {
      if (!from[y * width + x]) continue;
      total++; let found = false;
      for (let dy = -2; dy <= 2 && !found; dy++) for (let dx = -2; dx <= 2; dx++) {
        const xx = x + dx, yy = y + dy;
        if (xx >= 0 && xx < width && yy >= 0 && yy < end && to[yy * width + xx]) { found = true; break; }
      }
      if (found) matched++;
    }
    return total ? matched / total : 0;
  };
  const components = (ink: Uint8Array) => {
    const seen = new Uint8Array(ink.length), sizes: number[] = [];
    for (let i = 0; i < ink.length; i++) {
      if (!ink[i] || seen[i]) continue;
      const queue = [i]; seen[i] = 1;
      for (let j = 0; j < queue.length; j++) {
        const x = queue[j] % width, y = Math.floor(queue[j] / width);
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx, yy = y + dy, k = yy * width + xx;
          if (xx < 0 || xx >= width || yy < 0 || yy >= height || !ink[k] || seen[k]) continue;
          seen[k] = 1; queue.push(k);
        }
      }
      sizes.push(queue.length);
    }
    const minimum = Math.max(4, sizes.reduce((sum, n) => sum + n, 0) * 0.005);
    return sizes.filter(n => n >= minimum).length;
  };
  return { coverage: Math.min(coverage(a, b), coverage(b, a)), donorComponents: components(a), targetComponents: components(b) };
}

/** Restore a clipped accented descender only from a matching intact base glyph.
 * A shared cut across two body pieces, missing depth and close pixel agreement
 * are all required. Healthy, different and ambiguous drawings remain intact. */
export function repairSupplementDescenders(base: Glyph[], supplement: Glyph[], measure: Measure, compare: Compare = compareBodies) {
  const repairs: { char: string; base: string; coverage: number }[] = [];
  const glyphs = supplement.map(g => {
    const accent = latinAccent(g.char);
    if (!accent?.above || accent.below || !/^[gpqy]$/.test(accent.base)) return g;
    const donor = base.find(b => b.char === accent.base && !b.variantSuffix);
    if (!donor) return g;
    const parts = g.paths.flatMap(d => d.split(/(?=M)/)).filter(d => d.trim()).map(d => ({ d, b: measure([d]) }));
    if (parts.some(p => !p.b)) return g;
    const main = parts.reduce((a, p) => (p.b!.maxX - p.b!.minX) * (p.b!.maxY - p.b!.minY)
      > (a.b!.maxX - a.b!.minX) * (a.b!.maxY - a.b!.minY) ? p : a, parts[0]);
    if (!main) return g;
    const marks = parts.filter(p => isExpectedAccentMark(g.char, p.b!, main.b!));
    if (!marks.length) return g;
    const body = parts.filter(p => !marks.includes(p));
    const target = measure(body.map(p => p.d)), source = measure(donor.paths);
    if (!target || !source) return g;
    const xHeight = donor.baselineYInCell - source.minY;
    if (xHeight < 4 || source.maxY - donor.baselineYInCell < xHeight * 0.15) return g;
    const dy = g.baselineYInCell - donor.baselineYInCell;
    const missing = source.maxY + dy - target.maxY;
    if (missing < xHeight * 0.06 || missing > xHeight * 0.5
      || Math.abs(target.minY - source.minY - dy) > xHeight * 0.06
      || Math.abs((target.maxX - target.minX) / (source.maxX - source.minX) - 1) > 0.15) return g;
    const tolerance = Math.max(0.5, xHeight * 0.015);
    // The outer stem and a separate lower terminal end on the same cut plane.
    const cutTail = body.some(p => p !== main && p.b!.minY > g.baselineYInCell
      && Math.abs(p.b!.maxY - main.b!.maxY) <= tolerance
      && (p.b!.minX < main.b!.minX - 0.5 || p.b!.maxX > main.b!.maxX + 0.5));
    if (!cutTail) return g;
    const dx = (target.minX + target.maxX - source.minX - source.maxX) / 2;
    const restored = donor.paths.map(d => translated(d, dx, dy));
    if (restored.some(d => d === null)) return g;
    const donorPaths = restored as string[];
    const box = { minX: Math.min(target.minX, source.minX + dx), minY: Math.min(target.minY, source.minY + dy),
      maxX: Math.max(target.maxX, source.maxX + dx), maxY: source.maxY + dy };
    const evidence = compare(donorPaths, body.map(p => p.d), box, target.maxY, xHeight);
    if (evidence.coverage < 0.94 || evidence.donorComponents !== 1 || evidence.targetComponents !== 2) return g;
    repairs.push({ char: g.char, base: donor.char, coverage: evidence.coverage });
    return { ...g, paths: [...donorPaths, ...marks.map(p => p.d)], cellH: Math.max(g.cellH, Math.ceil(box.maxY + 2)) };
  });
  return { glyphs, repairs };
}
