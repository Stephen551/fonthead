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
