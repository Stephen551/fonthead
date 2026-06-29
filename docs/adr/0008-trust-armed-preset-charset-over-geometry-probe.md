# ADR 0008 — Trust the armed preset charset for generated and colour sheets over the geometry probe

**Status:** Accepted · backfilled 2026-06-29 from project history (review and correct if the reconstruction is wrong)
**Date:** 2026-06-08 to 2026-06-09 (9e458a3 / f7d9fd9)

## Context

Re-guessing the charset from image geometry is unreliable for AI-generated sheets (the guesser cannot read punctuation from shapes; generators do not reproduce the exact prompt layout) and for colour sheets (drop shadows bridge rows, so no brightness cutoff separates them: every threshold 128-250 found at most 3 rows on a real graffiti sheet, collapsing 6 rows to 2-3). Earlier work also rewrote charset detection to guessCharsetFromRows, placing the alphabet and ~10-cell digit row by POSITION rather than exact per-row cell counts.

## Decision

When a generation preset is armed, stash its exact charset and trace the next dropped sheet against that charset (when row counts match) instead of re-guessing from image geometry. For colour sheets, trust the preset charset's row count to drive the build's profile detector rather than the luminance/ink probe. When no preset is armed, fall back to guessCharsetFromRows, which places rows by position: letters and digits land exactly, punctuation is a best guess to confirm in the editable charset box.

## Alternatives rejected

Per-drop geometry re-guess for every sheet was rejected as unreliable for generated/colour input. A pure brightness/ink threshold for colour rows was rejected (verified that every threshold 128-250 found at most 3 rows). The prior (rowCount, topRowCells) heuristic and reading punctuation from glyph shapes were also rejected.

## Consequences

Generated and colour sheets map correctly drop-and-go (the colour build went from 15-29 glyphs of garbage to all 74); hand-dropped sheets or row-count mismatches fall back to the geometry guess and stay flagged. Punctuation always requires user confirmation in the editable charset box.

## Evidence

Memory + CLAUDE.md + git commits 9e458a3 'Trace a generated sheet against its preset charset' and f7d9fd9 'Build color fonts from the known preset layout, not the row probe': 'every threshold from 128 to 250 found at most 3 rows... the maker now trusts the armed preset charset regardless of what the probe counted.'
