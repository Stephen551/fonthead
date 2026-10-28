import { charsetCharacters, isExpectedAccentMark, latinAccent } from './accents';

export interface AccentRowPlan { band: number[]; chars: string; ranges: number[][] }
interface Bounds { minX: number; maxX: number; minY: number; maxY: number }
interface Component extends Bounds { area: number }
interface Cell { char: string; row: number; index: number; body: number }
export interface AccentCellExtent {
  x0: number; x1: number; top: number; bottom: number;
  owner: ((x: number, y: number) => number) | null;
}
export interface AccentOwnership {
  extend(row: number, cell: number, extent: AccentCellExtent): AccentCellExtent;
}

/** Assign detached marks to declared characters, independently of whitespace
 * row cuts. Whole connected letter bodies are never candidates for reassignment.
 * One component has one owner, so borrowing a mark also removes it from the
 * neighboring row whose band happened to contain it. */
export function assignAccentMarks(
  data: Uint8ClampedArray, width: number, height: number, rows: AccentRowPlan[],
): AccentOwnership | null {
  if (!rows.some(r => charsetCharacters(r.chars).some(c => latinAccent(c)))) return null;
  if (rows.some(r => r.ranges.length !== charsetCharacters(r.chars).length)) return null;
  const labels = new Int32Array(width * height);
  const queue = new Int32Array(labels.length);
  const components: Component[] = [{ minX: 0, maxX: 0, minY: 0, maxY: 0, area: 0 }];
  for (let start = 0; start < labels.length; start++) {
    if (labels[start] || data[start * 4] !== 0) continue;
    const id = components.length;
    let head = 0, tail = 1;
    queue[0] = start; labels[start] = id;
    const b: Component = { minX: width, maxX: 0, minY: height, maxY: 0, area: 0 };
    while (head < tail) {
      const p = queue[head++], x = p % width, y = Math.floor(p / width);
      b.minX = Math.min(b.minX, x); b.maxX = Math.max(b.maxX, x + 1);
      b.minY = Math.min(b.minY, y); b.maxY = Math.max(b.maxY, y + 1);
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx, ny = y + dy, n = ny * width + nx;
        if (nx < 0 || nx >= width || ny < 0 || ny >= height || labels[n] || data[n * 4] !== 0) continue;
        labels[n] = id; queue[tail++] = n;
      }
    }
    b.area = tail; components.push(b);
  }
  const cells: Cell[] = [], keys: number[][] = [];
  rows.forEach((row, ri) => {
    keys[ri] = [];
    charsetCharacters(row.chars).forEach((char, ci) => {
      const [x0, x1] = row.ranges[ci], [y0, y1] = row.band;
      const counts = new Map<number, number>();
      for (let y = Math.max(0, y0); y < Math.min(height, y1); y++) {
        for (let x = Math.max(0, x0); x < Math.min(width, x1); x++) {
          const id = labels[y * width + x];
          if (id) counts.set(id, (counts.get(id) ?? 0) + 1);
        }
      }
      let body = 0, largest = 0;
      for (const [id, count] of counts) if (count > largest) { body = id; largest = count; }
      keys[ri][ci] = cells.length;
      cells.push({ char, row: ri, index: ci, body });
    });
  });
  const bodies = new Set(cells.map(c => c.body));
  const baselines = rows.map((_, ri) => {
    const bottoms = cells.filter(c => c.row === ri && c.body && /^\p{L}$/u.test(c.char)
      && !latinAccent(c.char)?.below && !/[gjpqy]/.test(latinAccent(c.char)?.base ?? c.char))
      .map(c => components[c.body].maxY).sort((a, b) => a - b);
    return bottoms.length ? bottoms[bottoms.length >> 1] : null;
  });
  const owners = new Int32Array(components.length).fill(-1);
  const marks: Component[][] = cells.map(() => []);
  for (let id = 1; id < components.length; id++) {
    if (bodies.has(id)) continue;
    const mark = components[id];
    if (mark.area < 2) continue;
    // A hairline can leave a serif detached from the main component. Ink
    // inside another letter's body height is still that letter, not an accent
    // for the next row (the separated lower arm of È above Õ on the field sheet).
    if (cells.some(cell => {
      if (!cell.body) return false;
      const body = components[cell.body], h = body.maxY - body.minY;
      const gap = Math.max(0, body.minX - mark.maxX, mark.minX - body.maxX);
      return mark.minY >= body.minY && mark.maxY <= body.maxY && gap <= Math.max(2, h * .12)
        && !isExpectedAccentMark(cell.char, mark, body);
    })) continue;
    let best = -1, bestScore = Infinity;
    cells.forEach((cell, key) => {
      const accent = latinAccent(cell.char);
      if (!accent || !cell.body) return;
      const body = components[cell.body], h = body.maxY - body.minY;
      if (mark.maxY - mark.minY > h * .55 || mark.maxX - mark.minX > h * .9 || mark.area > body.area * .75) return;
      if (!isExpectedAccentMark(cell.char, mark, body)) return;
      // A connected cedilla/ogonek already reaching below the row baseline
      // cannot claim the next row's dots as another below-base mark.
      const baseline = baselines[cell.row];
      if (mark.minY >= body.maxY && baseline !== null && body.maxY > baseline + Math.max(2, h * .05)) return;
      const dy = Math.max(0, body.minY - mark.maxY, mark.minY - body.maxY);
      const dx = Math.abs((mark.minX + mark.maxX - body.minX - body.maxX) / 2);
      const score = dy / h + .25 * dx / Math.max(body.maxX - body.minX, h * .5);
      if (score < bestScore) { best = key; bestScore = score; }
    });
    if (best >= 0) { owners[id] = best; marks[best].push(mark); }
  }
  if (!marks.some(m => m.length)) return null;
  const ownerAt = (x: number, y: number) => {
    if (x < 0 || x >= width || y < 0 || y >= height) return -1;
    const label = labels[y * width + x];
    if (label) return owners[label];
    // Retain the source antialias fringe when the trace supersamples it.
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
      const owner = owners[labels[ny * width + nx]];
      if (owner >= 0) return owner;
    }
    return -1;
  };
  return {
    extend(row, cell, extent) {
      const key = keys[row]?.[cell];
      if (key === undefined) return extent;
      const own = marks[key];
      return {
        x0: Math.max(0, Math.min(extent.x0, ...own.map(b => b.minX - 2))),
        x1: Math.min(width, Math.max(extent.x1, ...own.map(b => b.maxX + 2))),
        top: Math.max(0, Math.min(extent.top, ...own.map(b => b.minY - 2))),
        bottom: Math.min(height, Math.max(extent.bottom, ...own.map(b => b.maxY + 2))),
        owner: (x, y) => {
          const assigned = ownerAt(x, y);
          if (assigned >= 0) return assigned === key ? cell : cell + 1;
          if (x >= extent.x0 && x < extent.x1 && y >= extent.top && y < extent.bottom) return extent.owner?.(x, y) ?? -1;
          return cell + 1;
        },
      };
    },
  };
}
