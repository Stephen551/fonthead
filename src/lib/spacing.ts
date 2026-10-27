export interface StemProfile {
  char: string;
  baseline: number;
  left: number[];
  right: number[];
}

export interface SpacingSample {
  char: string;
  width: number;
  counter: number;
}

/** Balance outside whitespace against the counters of H/O/n/o/u, rather than
 * the upload's arbitrary grid pitch. One bearing gets 16% of the typical
 * counter, so a straight pair's gap is about a third of that interior space.
 * Sparse or decorated alphabets use body proportions; neither path can
 * collapse spacing or turn a malformed sample into an enormous advance. */
export function chooseAutoSpacing(samples: SpacingSample[], emPx: number): {
  pct: number; source: 'counters' | 'proportions' | 'fallback'; samples: number;
} {
  const unique = [...new Map(samples.filter(s => 'HOnou'.includes(s.char) && s.char.length === 1 &&
    Number.isFinite(s.width) && s.width > 0).map(s => [s.char, s])).values()];
  if (!Number.isFinite(emPx) || emPx <= 0 || unique.length < 3) return { pct: 3.5, source: 'fallback', samples: unique.length };
  const median = (values: number[]) => {
    const sorted = values.slice().sort((a, b) => a - b), mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  };
  const counters = unique.filter(s => Number.isFinite(s.counter) && s.counter > 0 && s.counter < s.width);
  const enough = counters.length >= 3;
  const pad = enough ? median(counters.map(s => s.counter)) * 0.16 : median(unique.map(s => s.width)) * 0.065;
  return { pct: Math.round(Math.max(2.5, Math.min(7, pad / emPx * 100)) * 10) / 10,
    source: enough ? 'counters' : 'proportions', samples: enough ? counters.length : unique.length };
}

/** Serifs and diagonal wedges can look like thin script tails to a column
 * histogram. Several straight, upright stems are independent evidence that
 * the face needs ordinary side bearings instead of script overhangs. */
export function hasStraightUprightStems(profiles: StemProfile[], xHeight: number, required: 2 | 3 = 3): boolean {
  if (!Number.isFinite(xHeight) || xHeight < 8) return false;
  const votes = new Set<string>();
  for (const p of profiles) {
    if (!'HIil'.includes(p.char) || p.char.length !== 1) continue;
    const points: Array<[number, number]> = [];
    for (let y = Math.ceil(p.baseline - xHeight * 0.7); y <= Math.floor(p.baseline - xHeight * 0.2); y++) {
      if (Number.isFinite(p.left[y]) && Number.isFinite(p.right[y])) points.push([y, (p.left[y] + p.right[y]) / 2]);
    }
    if (points.length < Math.max(4, xHeight * 0.35)) continue;
    const meanY = points.reduce((s, p) => s + p[0], 0) / points.length;
    const meanX = points.reduce((s, p) => s + p[1], 0) / points.length;
    const variance = points.reduce((s, p) => s + (p[0] - meanY) ** 2, 0);
    const slope = points.reduce((s, p) => s + (p[0] - meanY) * (p[1] - meanX), 0) / variance;
    const residual = Math.sqrt(points.reduce((s, p) => s + (p[1] - meanX - slope * (p[0] - meanY)) ** 2, 0) / points.length);
    if (Math.abs(slope) <= 0.08 && residual <= xHeight * 0.04) votes.add(p.char);
  }
  return votes.size >= required;
}
