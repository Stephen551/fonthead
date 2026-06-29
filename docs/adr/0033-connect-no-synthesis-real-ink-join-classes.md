# ADR 0033 — Connect uses real ink only with position-independent join classes and a loosen-only weld pass

**Status:** Accepted · backfilled 2026-06-29 from project history (review and correct if the reconstruction is wrong)
**Date:** 2026-06-28 to 2026-06-29 (f8acee7 / 4dcd3b3)

## Context

Per ADR 0001, the engine joins by abutting each letter's own real traced strokes rather than synthesizing connectors. Integration testing showed join classification keyed off sheet neighbours, so a glyph's metrics depended on its arbitrary sheet position. Descender-exit letters have no usable baseline exit stroke for an x-only fixed-height model, and connected placement can drive known pairs into welds.

## Decision

Abut real traced strokes (advance to the dense body edge and let each letter's real thin strokes bridge the seam), never synthesizing vector connector bars between letters. Classify each glyph's join behaviour as a property of the character alone (position-independent), via pure joinClass/anchorAdvance functions; caps stand alone in v1. Letters g/j/q/y/z join left but break right (accept clean breaks rather than faking a join, and do not patch within-tolerance vertical steps with an auto-break, which over-breaks the/and/all/high). Reuse the trim fusion check as a loosen-only weld feedback pass in connect mode: where a known pair penetrates past the gate, GROW the left glyph's cellW; restores only ever grow advances so one sequential sweep is stable, never tighten.

## Alternatives rejected

Engine-synthesized connectors were rejected ('a vector bar can match WIDTH but never the stroke contrast/texture/taper — looks grafted... real ink is the only faithful path'). Neighbour-keyed join classification was rejected ('a font glyph must carry one set of metrics valid in every context'). An auto-break to paper over within-tolerance vertical steps was rejected (over-breaks common pairs). Tightening advances in the weld pass was rejected (would not converge in one sweep).

## Consequences

Connection quality is bounded by whether the input letters carry usable connecting strokes; when a hand's letterforms are genuinely incompatible, that is named an input limit, not an engine bug. joinClass is per-character; the weld pass can only relax joins (maxPenPx identical to trim's gate). Accepting clean breaks after g/j/q/y/z is named as one of the two things that most determine whether the result looks made.

## Evidence

Memory + specs: docs/superpowers/specs/2026-06-28-connected-cursive-design.md join-class table and 'Pass 2 — weld feedback (reuse trim pass 3, loosen-only)' ('If minGap < -maxPenPx, GROW the left glyph cellW... one sequential sweep is stable. Never tighten.'); commit f8acee7 'Make connect classification position-independent'.
