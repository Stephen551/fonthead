export { EXTENDED_LATIN_ROWS as ACCENT_ROWS } from '../src/lib/charsets';

// This older supplied image contains Đ and ð, not a case pair. Preserve its
// actual drawings; the new prompt adds Ð, đ and ß to complete the repertoire.
export const LEGACY_ACCENT_ROWS = [
  'ÀÁÂÃÄÅĀĂĄÆÇĆČĎĐÈÉ', 'ÊËĒĖĘÌÍÎÏĪŁÑÒÓÔÕÖ', 'ØŒŔŘŚŠŤÙÚÛÜŪŮÝŸŽŻ',
  'àáâãäåāăąæçćčďðèé', 'êëēėęìíîïīłñòóôõö', 'øœŕřśšťùúûüūůýÿžż', '¡¿“”‘’«»–—…€£¥©®™',
];
