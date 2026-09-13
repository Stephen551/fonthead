import type { Glyph } from './maker';

export interface BaselineBounds {
  top: number;
  bottom: number;
  /** Top of the wide body, excluding narrow ears (g) and flourishes. */
  bodyTop: number;
}

export interface BaselineAdjustment {
  char: string;
  variantSuffix?: string;
  /** Positive raises the rendered glyph; negative lowers it. Source pixels. */
  shift: number;
}

const FLAT_CAPS = new Set('BEFHIKLMNPTXYZ');
const FLAT_LOWER = new Set('mnrxz');
const ROUND = new Set('CGOSUaceosuvw0235689');
const DESCENDERS = new Set('gpqy');

function median(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = values.slice().sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** Per-letter placement for separate-letter monochrome builds. Changes only
 * baseline metadata: source outlines, dots, counters and cell sizes survive.
 * Heights are measured from ink, never from the drifting row baseline. */
export function alignGlyphBaselines(
  glyphs: Glyph[],
  measure: (glyph: Glyph) => BaselineBounds | null,
): { glyphs: Glyph[]; adjustments: BaselineAdjustment[] } {
  const bounds = glyphs.map((g) => {
    const b = measure(g);
    return b && [b.top, b.bottom, b.bodyTop, g.baselineYInCell].every(Number.isFinite)
      && b.bottom > b.top && b.bodyTop >= b.top && b.bodyTop < b.bottom ? b : null;
  });
  const adjustments: BaselineAdjustment[] = [];
  // Each variation sheet has its own pixel scale. Its variants must not vote
  // several times in the base sheet's height estimate, or inherit its pixels.
  const groups = new Map<string, number[]>();
  glyphs.forEach((g, i) => {
    const key = g.variantSuffix ?? '';
    const indices = groups.get(key) ?? [];
    indices.push(i);
    groups.set(key, indices);
  });
  const out = glyphs.slice();
  for (const indices of groups.values()) {
    const samples = (chars: ReadonlySet<string>, value: (b: BaselineBounds) => number) =>
      indices.filter((i) => bounds[i] && chars.has(glyphs[i].char)).map((i) => value(bounds[i]!));
    const height = (b: BaselineBounds) => b.bottom - b.top;
    const capSamples = samples(FLAT_CAPS, height);
    const lowerSamples = samples(FLAT_LOWER, height);
    const capHeight = capSamples.length >= 3 ? median(capSamples) : null;
    const xHeight = lowerSamples.length >= 3 ? median(lowerSamples) : null;
    const scale = xHeight ?? capHeight;
    if (!scale || scale < 4) continue;

    const bodySamples = samples(new Set('acenosuvwxz'), (b) => b.bottom - b.bodyTop);
    const bodyHeight = bodySamples.length >= 3 ? median(bodySamples) : null;
    const ascSamples = samples(new Set('bdhkl'), height);
    const ascHeight = ascSamples.length >= 3 ? median(ascSamples) : null;
    const iHeight = median(samples(new Set('i'), height));
    // Preserve small optical overshoots rather than flattening curved letters.
    // The cap prevents a differently drawn/oversized round from setting a deep
    // false baseline for every round letter in the face.
    const overshoot = (chars: string, flat: number | null) => {
      const roundHeight = median(samples(new Set(chars), height));
      return flat && roundHeight ? Math.max(0, Math.min(scale * 0.025, (roundHeight - flat) / 2)) : 0;
    };
    const capOver = overshoot('CGOSU', capHeight);
    const lowerOver = overshoot('aceosuvw', xHeight);

    for (const i of indices) {
      const g = glyphs[i];
      const b = bounds[i];
      if (!b || !/^[A-Za-z0-9]$/.test(g.char)) continue;
      let baseline: number;
      if (DESCENDERS.has(g.char)) {
        if (!bodyHeight || !xHeight) continue;
        // Only g needs the ear exclusion. A swashy g may not become wide
        // until deep inside its bowl; that is not a reliable top anchor.
        baseline = g.char === 'g' && b.bodyTop - b.top <= xHeight * 0.2
          ? b.bodyTop + bodyHeight - lowerOver
          : b.top + xHeight - lowerOver;
      } else if (g.char === 'j') {
        // Match the dot to i; snapping the lowest ink would erase the descent.
        if (!iHeight) continue;
        baseline = b.top + iHeight;
      } else if (g.char === 'f') {
        // An upright f sits on the baseline. A substantially taller italic f
        // may descend, so align that form's top with the other ascenders.
        if (!ascHeight) continue;
        baseline = height(b) <= ascHeight * 1.15 ? b.bottom : b.top + ascHeight;
      } else if ('JQR'.includes(g.char) || (/[A-Z]/.test(g.char) && capHeight && height(b) > capHeight * 1.15)) {
        // Q's tail, R's extended leg and unusually tall capital swashes are
        // not baseline anchors. Keep the cap body at the shared height.
        if (!capHeight) continue;
        baseline = b.top + capHeight + (g.char === 'Q' ? capOver : 0);
      } else {
        baseline = b.bottom - (ROUND.has(g.char) ? (/[A-Z0-9]/.test(g.char) ? capOver : lowerOver) : 0);
      }
      const shift = baseline - g.baselineYInCell;
      // Ignore subpixel/optical noise and implausibly large moves, which more
      // likely mean a mis-cut cell or an intentionally decorated letter.
      if (Math.abs(shift) <= Math.max(0.5, scale * 0.02) || Math.abs(shift) > scale * 0.5) continue;
      out[i] = { ...g, baselineYInCell: baseline };
      adjustments.push({ char: g.char, variantSuffix: g.variantSuffix, shift });
    }
  }
  return { glyphs: adjustments.length ? out : glyphs, adjustments };
}
