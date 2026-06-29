# ADR 0005 — Never trust fontkit for font validity; repair checksums and validate with fontTools

**Status:** Accepted · backfilled 2026-06-29 from project history (review and correct if the reconstruction is wrong)
**Date:** 2026-06-03 (cde3467)

## Context

Described as 'the rule that burned trust once': the maker shipped fonts Windows refused to open. Root cause was opentype.js writing a table checksum one-off when a table length is not 4-byte aligned, plus fontkit/opentype.js ignoring table checksums entirely while Windows enforces them. A 242-glyph colour font surfaced the bad CFF checksum.

## Decision

On every build, repair every SFNT table checksum plus head.checkSumAdjustment (src/lib/sfnt.ts fixSfntChecksums) before the woff2 wrap, gate publish with verifySfntChecksums, and run the engine's own validateFont as a hard drop gate. Validate authoritatively with fontTools in Python (TTFont(path, checkChecksums=2), the same check Windows applies). Never ship a font that fails both validateFont and fontTools, and never rely on fontkit/opentype.js to validate.

## Alternatives rejected

Trusting fontkit (or opentype.js) for validation was rejected: it ignores table checksums, the exact thing Windows enforces. The integration that skipped the engine's drop-gate is what broke.

## Consequences

Every build (mono and colour) corrects checksums before woff2 wrapping and drops any font failing validateFont; publishFont re-checks server-side; CI runs one built font through fontTools as an independent second validator. This is a standing hard architectural rule codified in CLAUDE.md and inherited by every new build path (including connect mode).

## Evidence

Memory + CLAUDE.md ('the rule that burned trust once') + git commit cde3467 'Fix font validity: correct table checksums + reinstate the validateFont drop gate': 'opentype.js could write a table checksum one off when a table length is not 4-byte aligned... Windows enforces checksums and rejected the file, while fontkit ignored it.'
