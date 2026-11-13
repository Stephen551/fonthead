import { mergeAccentBands } from './accents';

export const UNASSIGNED_CHAR = '□';

/** A narrow grid is not evidence for an A-M/N-Z layout. Suggest consecutive
 * capitals and leave any additional cells explicitly unassigned. */
export function shortRowCharset(counts: number[]): string[] | null {
  if (!counts.length || counts.some(n => !Number.isInteger(n) || n < 1 || n > 26)) return null;
  const total = counts.reduce((a, b) => a + b, 0);
  const shortGrid = counts.every(n => n < 10);
  const alphabetOnly = total === 26 || total === 52;
  if (!shortGrid && !alphabetOnly) return null;
  if (counts.length === 1 && counts[0] === 26) return null;
  if (counts.every(n => n === 13) || counts.every(n => n === 26)) return null;
  const letters = total === 52 ? 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz' : 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  let offset = 0;
  return counts.map(count => {
    const row = Array.from({ length: count }, (_, i) => letters[offset + i] || UNASSIGNED_CHAR).join('');
    offset += count;
    return row;
  });
}

export function mappingProblems(lines: string[], detectedRows?: number): string[] {
  const problems: string[] = [];
  if (!lines.length) return ['Enter the characters on your sheet, one row per line.'];
  if (detectedRows != null && lines.length !== detectedRows) problems.push(`Your sheet has ${detectedRows} detected rows, but the mapping has ${lines.length}.`);
  const seen = new Set<string>();
  const repeated = new Set<string>();
  for (const char of lines.join('')) {
    if (seen.has(char)) repeated.add(char);
    seen.add(char);
  }
  if (seen.has(UNASSIGNED_CHAR)) problems.push('Replace each □ with the character shown in that cell.');
  if ([...seen].some(c => /\s/.test(c))) problems.push('Remove spaces between characters in the mapping.');
  if ([...seen].some(c => c.codePointAt(0)! > 0xffff)) problems.push('Use letters and symbols such as A, é, or !. Emoji are not supported.');
  repeated.delete(UNASSIGNED_CHAR);
  if (repeated.size) problems.push(`Each character needs its own key. Repeated: ${[...repeated].join(' ')}`);
  return problems;
}

/** Rows the mapping check should count: detected bands with detached accent
 *  bands folded into their letters, exactly as traceSheet does (ADR 0074). */
export function sheetRowCount(bands: number[][], lines: string[]): number {
  return mergeAccentBands(bands, lines.map(l => l.normalize('NFC'))).length;
}

export type VariationRowPlan =
  | { kind: 'match' }
  | { kind: 'shared'; lines: string[]; sharedLines: string[] }
  | { kind: 'skip'; warning: string };

/** What to do with a natural-variation sheet whose traced row count differs
 *  from the base mapping. A sheet whose geometry guess shares at least two rows
 *  with the base mapping is traced against that guess and contributes those
 *  rows. Anything else is a different layout (often a sheet left in a variation
 *  slot from an earlier font), so it is left out of the build with a plain
 *  warning rather than failing the base font (ADR 0081). */
export function variationRowPlan(slot: number, detectedRows: number, baseLines: string[], guessedLines: string[]): VariationRowPlan {
  if (detectedRows === baseLines.length) return { kind: 'match' };
  const sharedLines = guessedLines.filter((line, idx) => line === baseLines[idx]);
  if (guessedLines.length === detectedRows && sharedLines.length >= 2) return { kind: 'shared', lines: guessedLines, sharedLines };
  const rowsWord = (n: number) => `${n} ${n === 1 ? 'row' : 'rows'}`;
  return {
    kind: 'skip',
    warning: `Variation sheet ${slot + 2} has ${rowsWord(detectedRows)} but your sheet has ${baseLines.length}, so it was left out of this font. Remove it under natural variation, or use a variation sheet with the same rows.`,
  };
}

/** The generator's armed charset from localStorage, NFC-normalized like every
 *  other charset path (parseCharset, validateCharset), so a decomposed é never
 *  reads as e plus a repeated combining mark. */
export function parseArmedCharset(raw: string | null): string[] | null {
  if (!raw) return null;
  try {
    const arr = JSON.parse(raw);
    return Array.isArray(arr) && arr.length > 0 && arr.every((r) => typeof r === 'string')
      ? arr.map((r: string) => r.normalize('NFC'))
      : null;
  } catch {
    return null;
  }
}

export interface GlyphSpacing {
  char: string;
  advance: number;
  left: number;
  right: number;
}

/** Flag severe intrusion, not ordinary optical bearings. Connected cursive and
 * italic builds intentionally overhang, but still need finite, positive widths. */
export function spacingProblems(glyphs: GlyphSpacing[], upm: number, intentionalOverlap = false): string[] {
  return glyphs.filter(g => {
    if (![g.advance, g.left, g.right, upm].every(Number.isFinite) || g.advance <= 0 || upm <= 0) return true;
    if (intentionalOverlap) return false;
    const inkWidth = g.right - g.left;
    const intrusion = Math.max(0, -g.left) + Math.max(0, g.right - g.advance);
    return inkWidth > 0 && intrusion > upm * 0.1 &&
      (g.advance < inkWidth * 0.75 || intrusion > Math.max(inkWidth * 0.35, upm * 0.2));
  }).map(g => g.char);
}
