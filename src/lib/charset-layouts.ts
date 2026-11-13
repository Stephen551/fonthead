import { MARK_PRESET_ROWS, SPLIT_ALPHABET_ROWS, SYMBOL_PRESET_ROWS } from './charsets';

// Row-shape charset match (ADR 0083). detectGeometry already counts the rows on
// a sheet and the shapes in each row. When those counts do not fit the charset
// in the box, they are compared with the layouts fonthead knows, and a clear
// match is offered to the maker as a one-tap swap. Nothing here changes the
// charset by itself: the maker has to accept the suggestion.

export interface CharsetLayout {
  /** Plain-English name shown in the prompt, e.g. "A to Z, a to z and 0 to 9". */
  label: string;
  lines: string[];
}

const AZ = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const az = 'abcdefghijklmnopqrstuvwxyz';
const DIGITS = '0123456789';
const [AM, NZ, am, nz] = SPLIT_ALPHABET_ROWS;
// Same order as DEFAULT_CHAR_LINES and guessCharset's punctuation row.
const PUNCT = ".,!?:;'-&@#";

// Every layout a sheet is likely to follow: the maker's own defaults, the
// generator presets (src/lib/charsets.ts) and the plain subsets people type
// by hand. The latin-ext preset arms the accents slot, not the main sheet, so
// it is not here. Order breaks no ties: an ambiguous match returns nothing.
export const KNOWN_LAYOUTS: CharsetLayout[] = [
  { label: 'A to Z', lines: [AZ] },
  { label: '0 to 9', lines: [DIGITS] },
  { label: 'A to Z and 0 to 9', lines: [AZ, DIGITS] },
  { label: 'A to Z and a to z', lines: [AZ, az] },
  { label: 'A to Z, a to z and 0 to 9', lines: [AZ, az, DIGITS] },
  { label: 'A to Z, a to z, 0 to 9 and a row of punctuation', lines: [AZ, az, DIGITS, PUNCT] },
  { label: 'A to Z in two rows', lines: [AM, NZ] },
  { label: 'A to Z in two rows, then 0 to 9', lines: [AM, NZ, DIGITS] },
  { label: 'A to Z and a to z in four rows', lines: [AM, NZ, am, nz] },
  { label: 'A to Z, a to z and 0 to 9 in five rows', lines: SPLIT_ALPHABET_ROWS },
  { label: 'A to Z, a to z and 0 to 9 in five rows, then a row of punctuation', lines: MARK_PRESET_ROWS },
  { label: 'A to Z, a to z and 0 to 9 in five rows, then 2 rows of symbols', lines: SYMBOL_PRESET_ROWS },
];

const isSymbolRow = (line: string) => !/[A-Za-z0-9]/.test(line);

/** How far a row's shape count may drift from its charset row. Letters and
 *  digits slice cleanly, give or take a touching pair or a split letter.
 *  Ornate symbols over-count (guessCharsetFromRows says the same), so symbol
 *  rows get more room. */
function tolerance(line: string): number {
  const n = [...line].length;
  return isSymbolRow(line) ? Math.max(3, Math.round(n * 0.35)) : Math.max(1, Math.round(n * 0.15));
}

/** Total drift of the sheet's counts from a charset, in units of each row's
 *  tolerance, or null when any row is out of tolerance or the row count differs. */
function drift(lines: string[], cellsPerRow: number[]): number | null {
  if (!lines.length || lines.length !== cellsPerRow.length) return null;
  let total = 0;
  for (let i = 0; i < lines.length; i++) {
    const cells = cellsPerRow[i];
    if (!Number.isInteger(cells) || cells < 1) return null;
    const off = Math.abs(cells - [...lines[i]].length);
    const tol = tolerance(lines[i]);
    if (off > tol) return null;
    total += off / tol;
  }
  return total;
}

/** Whether a charset fits the sheet's rows and per-row shape counts. */
export function charsetFitsRows(lines: string[], cellsPerRow: number[]): boolean {
  return drift(lines, cellsPerRow) != null;
}

/** The known layout the sheet's counts fit best, or null when none fits or two
 *  different layouts fit equally well (an odd sheet stays manual). */
export function matchCharsetLayout(cellsPerRow: number[]): CharsetLayout | null {
  let best: CharsetLayout | null = null;
  let bestDrift = Infinity;
  let tied = false;
  for (const layout of KNOWN_LAYOUTS) {
    const d = drift(layout.lines, cellsPerRow);
    if (d == null) continue;
    if (d < bestDrift - 1e-9) {
      best = layout;
      bestDrift = d;
      tied = false;
    } else if (Math.abs(d - bestDrift) <= 1e-9) {
      tied = true;
    }
  }
  return tied ? null : best;
}

/** What to offer the maker: a known layout when the current charset does not
 *  fit the sheet's row shape and that layout does. Null when the charset fits,
 *  nothing fits, or the best fit is already in the box. An accented charset is
 *  compared like any other: a real accented sheet's detached accent bands add
 *  rows (ADR 0074) that no plain layout has, so it never matches one, while a
 *  plain sheet under a stale accented charset does (ADR 0083). */
export function suggestCharsetLayout(cellsPerRow: number[], current: string[]): CharsetLayout | null {
  if (charsetFitsRows(current, cellsPerRow)) return null;
  const layout = matchCharsetLayout(cellsPerRow);
  if (!layout || JSON.stringify(layout.lines) === JSON.stringify(current)) return null;
  return layout;
}
