// Shared by the generator prompt and the maker's optional supplement slot.
// Keep both D-with-stroke and eth pairs; sharp-s has no extra capital here.
export const EXTENDED_LATIN_ROWS = [
  'ÀÁÂÃÄÅĀĂĄÆÇĆČĎĐÐÈÉ',
  'ÊËĒĖĘÌÍÎÏĪŁÑÒÓÔÕÖ',
  'ØŒŔŘŚŠŤÙÚÛÜŪŮÝŸŽŻ',
  'àáâãäåāăąæçćčďđðèé',
  'êëēėęìíîïīłñòóôõö',
  'øœŕřśšťùúûüūůýÿžżß',
  '¡¿“”‘’«»–—…€£¥©®™',
];

// The generator presets' main-sheet charsets (make.astro arms these), one row
// per line in the order each prompt tells the AI to draw. Shared with the
// row-shape charset match (ADR 0083) so a sheet drawn from a preset is
// recognised by its row counts even when another charset is in the box.
export const SPLIT_ALPHABET_ROWS = ['ABCDEFGHIJKLM', 'NOPQRSTUVWXYZ', 'abcdefghijklm', 'nopqrstuvwxyz', '0123456789'];
// standard and monoline: two symbol rows in the maker's punctuation order.
export const SYMBOL_PRESET_ROWS = [...SPLIT_ALPHABET_ROWS, '!?@#$%^&*()-_+=[]', '{};:\'",.<>/\\|'];
// script, flat and gradient: row 6 is the eval-calibrated 12-mark row
// (ADR 0053), not the two exotic symbol rows image models garble.
export const MARK_PRESET_ROWS = [...SPLIT_ALPHABET_ROWS, '.,!?:;\'"-&@#'];
