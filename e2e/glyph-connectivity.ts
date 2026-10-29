import type { Page } from '@playwright/test';

/** Count substantial connected ink components below the accent zone in an
 * exported glyph. Holes do not count as components; detached tail curls do. */
export async function bodyComponents(page: Page, font: any, char: string, base: string) {
  const glyph = font.glyphForCodePoint(char.codePointAt(0));
  const reference = font.glyphForCodePoint(base.codePointAt(0));
  return page.evaluate(({ path, width, top, bottom }) => {
    const scale = 2, pad = 10;
    const canvas = new OffscreenCanvas(Math.ceil(width * scale) + pad * 2, Math.ceil((top - bottom) * scale));
    const ctx = canvas.getContext('2d')!;
    ctx.translate(pad, top * scale); ctx.scale(scale, -scale);
    ctx.fill(new Path2D(path));
    const { width: w, height: h } = canvas;
    const pixels = ctx.getImageData(0, 0, w, h).data, seen = new Uint8Array(w * h);
    let count = 0;
    for (let i = 0; i < seen.length; i++) {
      if (seen[i] || pixels[i * 4 + 3] < 64) continue;
      const queue = [i]; seen[i] = 1;
      for (let j = 0; j < queue.length; j++) {
        const x = queue[j] % w, y = Math.floor(queue[j] / w);
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx, yy = y + dy, k = yy * w + xx;
          if (xx < 0 || xx >= w || yy < 0 || yy >= h || seen[k] || pixels[k * 4 + 3] < 64) continue;
          seen[k] = 1; queue.push(k);
        }
      }
      if (queue.length >= 20) count++;
    }
    return count;
  }, { path: glyph.path.toSVG(), width: glyph.advanceWidth,
    top: reference.bbox.maxY + 8, bottom: Math.min(reference.bbox.minY, glyph.bbox.minY) - 8 });
}
