# 0083 — Offer a known charset when the sheet's row shape does not fit the one in the box

Status: Accepted

## Context

A maker bug report on 2026-11-13 came from a typed sheet with 3 rows (A to Z, a to z, 0 to 9) built against a 7-line charset. The row warning fired, but the maker still got a misaligned font.

One way this happens: before `61b06e6` (Oct 27), the latin-ext generator preset armed the main `fh-gen-charset` key with its 7 accented rows. That value stays in a visitor's `localStorage`, and `onFile` uses any armed charset with a non-ASCII character whatever the sheet's row count, so the next plain sheet is traced against 7 accented lines. The reported sheet itself was not available to confirm this was the path; the decision below covers it and any other charset that does not fit.

`detectGeometry` already counts a sheet's rows and the shapes in each row, and `guessCharsetFromRows` uses those counts for a position guess. Nothing compared them with the charset that is actually about to be built.

## Decision

`src/lib/charset-layouts.ts`:

- `KNOWN_LAYOUTS`: A to Z; 0 to 9; A to Z and 0 to 9; A to Z and a to z; A to Z, a to z and 0 to 9 (`SAMPLE_CHAR_LINES`); the same plus a punctuation row (`DEFAULT_CHAR_LINES`); A to Z in two rows, with or without 0 to 9; A to Z and a to z in four rows; the 5-row split alphabet; and the two generator presets (6 rows with the 12-mark row, 7 rows with two symbol rows). The preset rows move from `make.astro` to `src/lib/charsets.ts` (`SPLIT_ALPHABET_ROWS`, `MARK_PRESET_ROWS`, `SYMBOL_PRESET_ROWS`) so the generator and the matcher share one copy. latin-ext is left out because it arms the accents slot, not the main sheet.
- A charset fits the sheet when the row counts are equal and each row's shape count is within tolerance of its characters: 15% (at least 1) for rows with letters or digits, 35% (at least 3) for symbol rows, which the slicer over-counts.
- `suggestCharsetLayout(cellsPerRow, current)` returns the best-fitting known layout when the current charset does not fit, a known layout does, and it is not the charset already in the box. Two layouts fitting equally well return nothing, so odd sheets stay manual.

`src/components/Maker.tsx` (mono only):

- Above the charset box the maker sees "Looks like A to Z, a to z and 0 to 9. Use this charset?" with **use this charset** and **keep mine**. The suggestion is recomputed live from the sheet geometry and the charset text, so it also appears after a hand edit.
- **use this charset** is the only path that applies a suggestion. It swaps the charset, says what it set, and rebuilds the loaded sheet with it. **keep mine** hides that suggestion for that sheet.
- On a drop, an armed charset that does not fit while a known layout does holds the build (`phase` back to `idle`), the same way an unusable mapping already does. A position guess still builds as before, and the prompt shows beside its result, because holding there would change today's flow for unarmed sheets whose symbol rows over-count.

## Alternatives rejected

- Swapping the charset automatically: a confident-looking guess that is wrong is worse than a one-tap question, and the maker may have typed an unusual layout on purpose.
- Holding every drop whose charset does not fit: a randomized probe of the shipped layouts found unarmed 7-row sheets with over-counted symbol rows where the position guess truncates the last row. The prompt fixes those after the build without blocking anyone.
- Color sheets: their geometry is forced to the armed row count and drop shadows skew their shape counts, so the counts are not evidence of a layout.
- A small in-browser handwriting classifier: a separate, later project. It would read letters, not just counts, and could build on this matcher.

## Consequences

A plain sheet under a stale or mistyped charset now stops before building and offers the layout its rows fit. A digits-only sheet, which the position guess maps to A to M, is offered 0 to 9 after its build. Accented sheets are compared like any other: their detached accent bands add a raw row no plain layout has, so they never match one.

## Evidence

- `test/charset-layouts.test.ts`, written first against a stub module: 5 of 10 tests failed (the report's `[26, 26, 10]` against the 7-row preset, presets and subsets, digits-only, layout list). The stale accented charset test was then checked red against a version that skipped non-ASCII charsets. All 11 pass.
- `e2e/charset.spec.ts`: a 3-row sheet with the legacy accented rows armed shows the prompt, holds the build, and builds A to Z, a to z, 0 to 9 after **use this charset**; **keep mine** leaves the box alone.
