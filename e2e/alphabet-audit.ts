import type { Page } from '@playwright/test';

/** Measure exported outlines and shaped advances independently of the maker's
 * source-space trim/kerning code. All 52 × 52 letter pairs, with GPOS applied. */
export async function auditAlphabet(page: Page, font: any) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
  const glyphs = [...chars].map(c => {
    const g = font.glyphForCodePoint(c.codePointAt(0));
    return { c, path: g.path.toSVG(), advance: g.advanceWidth, bbox: g.bbox };
  });
  const pairs = [...chars].flatMap(l => [...chars].map(r => {
    const run = font.layout(l + r, ['kern']);
    return { pair: l + r, offset: run.positions[0].xAdvance + run.positions[1].xOffset - run.positions[0].xOffset };
  }));
  return page.evaluate(({ glyphs, pairs }) => {
    const S = 0.5, yTop = 1000, H = 750, pad = 4;
    const profiles = new Map<string, { left: number[]; right: number[] }>();
    const bodyTops: Record<string, number> = {};
    for (const g of glyphs) {
      const W = Math.ceil((g.bbox.maxX - g.bbox.minX) * S) + pad * 2;
      const cv = new OffscreenCanvas(W, H), ctx = cv.getContext('2d')!;
      ctx.translate(pad - g.bbox.minX * S, yTop * S);
      ctx.scale(S, -S);
      ctx.fill(new Path2D(g.path));
      const data = ctx.getImageData(0, 0, W, H).data;
      const left: number[] = [], right: number[] = [];
      for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) if (data[(y * W + x) * 4 + 3] > 128) {
          if (left[y] === undefined) left[y] = (x - pad) / S + g.bbox.minX;
          right[y] = (x + 1 - pad) / S + g.bbox.minX;
        }
        if (bodyTops[g.c] === undefined && right[y] - left[y] >= (g.bbox.maxX - g.bbox.minX) * 0.5) bodyTops[g.c] = yTop - (y + 0.5) / S;
      }
      profiles.set(g.c, { left, right });
    }
    const measured = pairs.map(p => {
      const L = profiles.get(p.pair[0])!, R = profiles.get(p.pair[1])!;
      let clearance = Infinity;
      for (let y = 0; y < H; y++) {
        if (L.right[y] === undefined || R.left[y] === undefined) continue;
        clearance = Math.min(clearance, p.offset + R.left[y] - L.right[y]);
      }
      return { pair: p.pair, clearance };
    });
    return { letters: glyphs.map(g => ({ char: g.c, bottom: g.bbox.minY, top: g.bbox.maxY, advance: g.advance })), bodyTops, pairs: measured };
  }, { glyphs, pairs });
}
