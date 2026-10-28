/** Canonical Latin decompositions tell us which detached marks belong to a
 * letter. This is charset metadata, never recognition of the uploaded drawing. */
export function latinAccent(char: string): { base: string; above: boolean; below: boolean } | null {
  const parts = [...char.normalize('NFD')];
  if (parts.length < 2 || !/^[A-Za-z]$/.test(parts[0]) || !parts.slice(1).every(c => /^\p{M}$/u.test(c))) return null;
  const below = /[\u0316-\u0333\u0339-\u033c\u0345]/u;
  return { base: parts[0], above: parts.slice(1).some(c => !below.test(c)), below: parts.slice(1).some(c => below.test(c)) };
}

/** The charset supplies the mark's role; geometry only checks whether this
 * component can belong to that body. Side carons may overlap a t's crossbar
 * horizontally while remaining disconnected from the actual ink. */
export function isExpectedAccentMark(
  char: string,
  mark: { minX: number; maxX: number; minY: number; maxY: number },
  body: { minX: number; maxX: number; minY: number; maxY: number },
): boolean {
  const accent = latinAccent(char);
  if (!accent) return false;
  const h = body.maxY - body.minY, width = body.maxX - body.minX;
  const margin = Math.max(width * .25, h * .15);
  const overlaps = mark.maxX >= body.minX - margin && mark.minX <= body.maxX + margin;
  if (overlaps && ((accent.above && mark.maxY <= body.minY + 1 && body.minY - mark.maxY <= h * .65)
    || (accent.below && mark.minY >= body.maxY - 1 && mark.minY - body.maxY <= h * .65))) return true;
  return /[ďťľĽ]/.test(char) && mark.minX >= body.minX + width * .5
    && (mark.minX + mark.maxX) / 2 >= body.maxX - h * .1 && mark.minX - body.maxX <= h * .4
    && mark.maxY <= body.minY + h * .45 && mark.minY >= body.minY - h * .65;
}

/** Any character whose canonical decomposition carries a combining mark.
 * Such glyphs never set the font scale (ADR 0072). Must match isAccentedChar
 * in public/assets/vendor/font-engine-builder.js. */
export function hasCombiningMark(char: string): boolean {
  return /\p{M}/u.test(char.normalize('NFD'));
}

export function charsetCharacters(line: string): string[] {
  return [...line.normalize('NFC')];
}

export function validateCharset(lines: string[]): string[] {
  const normalized = lines.map(l => l.normalize('NFC')).filter(l => l.length > 0);
  // A standalone combining mark would silently shift every later cell. Only
  // accept characters that the font's one-cell/one-codepoint cmap can express.
  if (normalized.some(l => /\p{M}/u.test(l))) throw new Error('This charset contains a separate combining accent. Use a complete accented character such as é, ñ, ü, or ç for each drawn cell.');
  return normalized;
}

/** Reunite detached accent bands only where the declared row needs them.
 * Dynamic programming keeps consecutive rows in order and refuses an
 * incomplete fit. A punctuation row or a second full letter row cannot be
 * swallowed as a mark merely to satisfy the expected count. */
export function mergeAccentBands(bands: number[][], lines: string[]): number[][] {
  if (bands.length <= lines.length || !lines.some(l => [...l].some(c => latinAccent(c)))) return bands;
  type Fit = { cost: number; rows: number[][] };
  let states = new Map<number, Fit>([[0, { cost: 0, rows: [] }]]);
  for (const line of lines) {
    const marks = [...line].map(latinAccent).filter(Boolean);
    const above = marks.some(m => m!.above), below = marks.some(m => m!.below);
    const next = new Map<number, Fit>();
    for (const [start, fit] of states) for (let end = start + 1; end <= Math.min(bands.length, start + 5); end++) {
      const group = bands.slice(start, end);
      const heights = group.map(([a, b]) => b - a);
      const h = Math.max(...heights), body = heights.indexOf(h);
      let cost = 0, valid = true;
      for (let j = 0; j < group.length; j++) {
        if (j === body) continue;
        const gap = j < body ? group[body][0] - group[j][1] : group[j][0] - group[body][1];
        if ((j < body ? !above : !below) || heights[j] > h * 0.55 || gap > h * 0.65) { valid = false; break; }
        cost += gap / h + 0.1;
      }
      if (!valid) continue;
      const candidate = { cost: fit.cost + cost, rows: [...fit.rows, [group[0][0], group[group.length - 1][1]]] };
      if (!next.has(end) || next.get(end)!.cost > candidate.cost) next.set(end, candidate);
    }
    states = next;
  }
  return states.get(bands.length)?.rows ?? bands;
}
