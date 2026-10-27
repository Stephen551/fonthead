import type { Glyph } from './maker';
import { latinAccent } from './accents';

export interface BaselineBounds {
  top: number;
  bottom: number;
  /** Top of the wide body, excluding narrow ears (g) and flourishes. */
  bodyTop: number;
  /** Bottom of R/k's left stem, excluding its potentially descending leg. */
  stemBottom?: number;
  /** Exact extrema of the main vertical ink band, excluding detached marks. */
  baseTop?: number;
  baseBottom?: number;
}

export interface BaselineAdjustment {
  char: string;
  variantSuffix?: string;
  /** Positive raises the rendered glyph; negative lowers it. Source pixels. */
  shift: number;
}

const FLAT_CAPS = new Set('BEFHIKLMNPTXYZ');
const FLAT_LOWER = new Set('mnrxz');
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
  opts: { accentsOnly?: boolean } = {},
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
    const reference = (i: number): BaselineBounds | null => {
      const b = bounds[i], accent = latinAccent(glyphs[i].char);
      if (!b || accent?.below) return null;
      return accent ? { ...b, top: b.baseTop ?? b.bodyTop, bottom: b.baseBottom ?? b.bottom, bodyTop: b.baseTop ?? b.bodyTop } : b;
    };
    const samples = (chars: ReadonlySet<string>, value: (b: BaselineBounds) => number) =>
      indices.filter((i) => reference(i) && chars.has(latinAccent(glyphs[i].char)?.base ?? glyphs[i].char)).map((i) => value(reference(i)!));
    const height = (b: BaselineBounds) => b.bottom - b.top;
    const capSamples = samples(FLAT_CAPS, height);
    const lowerSamples = samples(FLAT_LOWER, height);
    const accentSamples = (pattern: RegExp) => indices.filter(i => {
      const a = latinAccent(glyphs[i].char);
      return a && !a.below && pattern.test(a.base) && reference(i);
    }).map(i => height(reference(i)!));
    const accentCaps = accentSamples(/^[A-Z]$/), accentLower = accentSamples(/^[acemnorsuvwxz]$/);
    const capHeight = capSamples.length >= 3 ? median(capSamples) : accentCaps.length >= 2 ? median(accentCaps) : null;
    const xHeight = lowerSamples.length >= 3 ? median(lowerSamples) : accentLower.length >= 2 ? median(accentLower) : null;
    const scale = xHeight ?? capHeight ?? median([...accentCaps, ...accentLower]);
    if (!scale || scale < 4) continue;

    const bodySamples = samples(new Set('acenosuvwxz'), (b) => b.bottom - b.bodyTop);
    const bodyHeight = bodySamples.length >= 3 ? median(bodySamples) : null;
    const ascSamples = samples(new Set('bdhkl'), height);
    const ascHeight = ascSamples.length >= 3 ? median(ascSamples) : null;
    const iHeight = median(samples(new Set('i'), height));
    // Account for optical overshoot when inferring a descender's body baseline
    // from its top. Ordinary letters below anchor directly on their bottom ink.
    const overshoot = (chars: string, flat: number | null) => {
      const roundHeight = median(samples(new Set(chars), height));
      return flat && roundHeight ? Math.max(0, Math.min(scale * 0.025, (roundHeight - flat) / 2)) : 0;
    };
    const capOver = overshoot('CGOSU', capHeight);
    const lowerOver = overshoot('aceosuvw', xHeight);

    for (const i of indices) {
      const g = glyphs[i];
      const b = bounds[i];
      if (opts.accentsOnly || !b || !/^[A-Za-z0-9]$/.test(g.char)) continue;
      const stemHeight = g.char === 'k' ? ascHeight : capHeight;
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
      } else if ('Rk'.includes(g.char) && stemHeight && Number.isFinite(b.stemBottom)
        && b.stemBottom! - b.top >= stemHeight * 0.8
        && b.stemBottom! - b.top <= stemHeight * 1.15
        && b.bottom - b.stemBottom! > scale * 0.02
        && b.bottom - b.stemBottom! < stemHeight * 0.4) {
        // A descending leg is part of the design. The stem's actual foot is
        // a stronger baseline anchor than either the tail or the cap top.
        baseline = b.stemBottom!;
      } else if (g.char === 'J' && capHeight && height(b) <= capHeight * 1.15) {
        baseline = b.bottom;
      } else if ('JQ'.includes(g.char) || (/[A-Z]/.test(g.char) && capHeight && height(b) > capHeight * 1.15)) {
        // Q's tail and unusually tall capital swashes are
        // not baseline anchors. Keep the cap body at the shared height.
        if (!capHeight) continue;
        baseline = b.top + capHeight + (g.char === 'Q' ? capOver : 0);
      } else {
        baseline = b.bottom;
      }
      const shift = baseline - g.baselineYInCell;
      // Even a fraction of a source pixel can become a visible step after font
      // scaling. Only ignore floating-point noise; retain the outlier guard for
      // mis-cut cells or intentionally decorated letters.
      if (Math.abs(shift) <= 0.001 || Math.abs(shift) > scale * 0.5) continue;
      out[i] = { ...g, baselineYInCell: baseline };
      adjustments.push({ char: g.char, variantSuffix: g.variantSuffix, shift });
    }
    // Upper accents move with the body's foot. For below-base marks and true
    // descenders, use the matching letter or the family's reference height.
    for (const i of indices) {
      const g = glyphs[i], b = bounds[i], accent = latinAccent(g.char);
      if (!b || !accent) continue;
      const top = b.baseTop ?? b.bodyTop;
      if ((b.baseBottom ?? b.bottom) - top < scale * 0.5) continue;
      const counterpart = indices.find(j => glyphs[j].char === accent.base && bounds[j]);
      let baseline: number;
      if (!accent.below && !DESCENDERS.has(accent.base) && !/[jfk]/.test(accent.base)) {
        baseline = b.baseBottom ?? b.bottom;
      } else if (counterpart !== undefined) {
        const ref = bounds[counterpart]!;
        baseline = top + out[counterpart].baselineYInCell - (ref.baseTop ?? ref.top);
      } else if (!accent.below && !DESCENDERS.has(accent.base) && accent.base !== 'j') {
        baseline = b.baseBottom ?? b.bottom;
      } else {
        const refHeight = /^[A-Z]$/.test(accent.base) ? capHeight
          : /[bdfhkl]/.test(accent.base) ? ascHeight : xHeight;
        if (!refHeight) continue;
        baseline = top + refHeight;
      }
      const shift = baseline - g.baselineYInCell;
      if (Math.abs(shift) <= 0.001 || Math.abs(shift) > scale * 0.75) continue;
      out[i] = { ...g, baselineYInCell: baseline };
      adjustments.push({ char: g.char, variantSuffix: g.variantSuffix, shift });
    }
  }
  return { glyphs: adjustments.length ? out : glyphs, adjustments };
}
