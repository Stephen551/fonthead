/** Follow a row's connected ink past a horizontal valley cut. Other rows can
 * overlap vertically without touching this letter (for example y above 0–9).
 * Only components reaching the middle half of the cell may extend it. Detached
 * marks inside the original band remain governed by the existing slicer. */
export function recoverRowExtent(
  data: Uint8ClampedArray, width: number, height: number,
  x0: number, x1: number, y0: number, y1: number,
  owner: ((x: number, y: number) => number) | null, cell: number,
): { top: number; bottom: number; owner: ((x: number, y: number) => number) | null } {
  const ink = (x: number, y: number) => y >= 0 && y < height && data[(y * width + x) * 4] === 0;
  const original = { top: y0, bottom: y1, owner };
  // Most rows end in whitespace. Avoid allocating a component map for them.
  let crosses = false;
  for (let x = x0; x < x1; x++) {
    const adjacent = (y: number) => [x - 1, x, x + 1].some(xx => xx >= x0 && xx < x1 && ink(xx, y));
    if ((ink(x, y0) && adjacent(y0 - 1)) || (ink(x, y1 - 1) && adjacent(y1))) { crosses = true; break; }
  }
  if (!crosses) return original;
  const rowH = y1 - y0, reach = Math.ceil(rowH * 0.4);
  const top = Math.max(0, y0 - reach), bottom = Math.min(height, y1 + reach);
  const w = x1 - x0;
  const marked = new Uint8Array(w * (bottom - top));
  const queue: number[] = [];
  const allowed = (x: number, y: number) => {
    const assigned = owner?.(x, y) ?? -1;
    return assigned === -1 || assigned === cell;
  };
  const add = (x: number, y: number) => {
    if (x < x0 || x >= x1 || y < top || y >= bottom) return;
    const i = (y - top) * w + x - x0;
    if (marked[i] || !ink(x, y) || !allowed(x, y)) return;
    marked[i] = 1; queue.push(i);
  };
  for (let y = Math.ceil(y0 + rowH * 0.25); y < y0 + rowH * 0.75; y++) {
    for (let x = x0; x < x1; x++) add(x, y);
  }
  let min = y0, max = y1 - 1;
  for (let head = 0; head < queue.length; head++) {
    const i = queue[head], x = x0 + i % w, y = top + Math.floor(i / w);
    min = Math.min(min, y); max = Math.max(max, y);
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (dx || dy) add(x + dx, y + dy);
  }
  if (min === y0 && max === y1 - 1) return original;
  return {
    top: min, bottom: max + 1,
    owner: (x, y) => {
      if (y >= y0 && y < y1) return owner?.(x, y) ?? -1;
      // Include a one-pixel fringe for source-image supersampling. This retains
      // antialiasing without admitting a disconnected neighboring glyph.
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const xx = x + dx, yy = y + dy;
        if (xx >= x0 && xx < x1 && yy >= top && yy < bottom && marked[(yy - top) * w + xx - x0]) return cell;
      }
      return cell + 1;
    },
  };
}
