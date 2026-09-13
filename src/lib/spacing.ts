export interface StemProfile {
  char: string;
  baseline: number;
  left: number[];
  right: number[];
}

/** Serifs and diagonal wedges can look like thin script tails to a column
 * histogram. Several straight, upright stems are independent evidence that
 * the face needs ordinary side bearings instead of script overhangs. */
export function hasStraightUprightStems(profiles: StemProfile[], xHeight: number): boolean {
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
  return votes.size >= 3;
}
