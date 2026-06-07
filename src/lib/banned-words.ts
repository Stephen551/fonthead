// Curated banlist for handles and font names. Kept deliberately small and
// clinical: only unambiguous slurs and obvious abuse. Adding or removing a word
// is a one-line edit. The admin can also remove a bad name reactively, so this
// only has to catch the obvious stuff at creation time.
//
// Matching runs on a normalized form: lowercased, common leet digits folded to
// letters (so "n1gg3r" still hits), and non-letters stripped (so "f a g g o t"
// and "f-a-g-g-o-t" still hit). Two lists, to dodge the Scunthorpe problem:
//   SUBSTRING - slurs that essentially never appear inside an innocent word, so
//               we block them anywhere in the string.
//   EXACT     - slurs that ARE substrings of real words (raccoon, spicy,
//               torpedo, therapist), so we only block when the whole normalized
//               name IS the slur.

const SUBSTRING: readonly string[] = ['nigger', 'nigga', 'faggot', 'kike', 'wetback'];
const EXACT: readonly string[] = ['coon', 'chink', 'spic', 'gook', 'pedo', 'tranny', 'retard', 'rapist'];

const LEET: Record<string, string> = {
  '0': 'o',
  '1': 'i',
  '3': 'e',
  '4': 'a',
  '5': 's',
  '7': 't',
  '@': 'a',
  $: 's',
};

function normalize(s: string): string {
  return (s || '')
    .toLowerCase()
    .replace(/[013457@$]/g, (c) => LEET[c] ?? c)
    .replace(/[^a-z]/g, '');
}

const SUBSTRING_N = SUBSTRING.map(normalize).filter(Boolean);
const EXACT_N = new Set(EXACT.map(normalize).filter(Boolean));

/** True if the name contains (or, for the exact list, equals) a banned word. */
export function containsBannedWord(s: string): boolean {
  const n = normalize(s);
  if (!n) return false;
  if (EXACT_N.has(n)) return true;
  return SUBSTRING_N.some((w) => n.includes(w));
}
