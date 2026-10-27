# 0072 — Accented glyphs never set the font scale

Status: Accepted

## Context

Every build path scaled the face so its tallest ink reached 0.80 em
(`measureGlyphBounds().maxAsc`). Once ADR 0071 kept accents intact, an
accented capital such as Á or É became the tallest glyph, so adding an
accent supplement shrank the whole alphabet. In a synthetic test, H fell from
800 to 593 units, about 26% smaller. Color builds and the maker's px↔UPM
helpers (body pad, pair feedback, face metrics, auto spacing) shared the same
assumption.

## Decision

The scale reference is the tallest glyph without a combining mark in its
canonical decomposition (`isAccentedChar` in the builder, `hasCombiningMark`
in `src/lib/accents.ts`; the two must match). `measureGlyphBounds` returns
that as `maxAsc` and the true tallest ink as `maxAscAll`. Mono, flat color and
gradient color builds set the ascender to
`max(0.80 em, maxAscAll × scale)`, so accented capitals are covered by
hhea, typo and win ascent and never clip. The maker's helpers use the same
reference. A face made only of accented glyphs falls back to the tallest ink,
as before.

## Alternatives rejected

- Keep the line height and let letters shrink: an accent supplement silently
  changes the size of every existing letter.
- Keep the old ascender and let accents overflow it: clips on Windows and in
  browsers that honor win/typo ascent.

## Consequences

Plain letters keep their size whether or not accents are present. Fonts that
include accented capitals get a taller default line height (about 1.13 em
instead of 0.85 em plus descender in the synthetic test). ASCII-only fonts are
byte-for-byte unaffected in outlines and metrics. Existing exports must be
rebuilt to pick this up.
