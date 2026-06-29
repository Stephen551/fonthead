# ADR 0034 — Input contract for seamless joins: a 'script' generate preset and a non-tracing connector guide

**Status:** Accepted · backfilled 2026-06-29 from project history (review and correct if the reconstruction is wrong)
**Date:** 2026-06-28 (spec / plan)

## Context

The seamless (overlap) stage depends on connectors landing at a common baseline height. The engine absorbs inconsistency, but a preset and a printed guide steer both AI-generated and hand-drawn input toward connectors at a common height.

## Decision

Add a 'script' generate preset (chip + prompt + armed charset) whose prompt tells the model to draw every letter with entry and exit strokes meeting a common baseline connector line and reaching the cell edges, reusing the standard 7-row charset so generated sheets auto-arm. Add a faint per-row connector guide line to the printable template sheet (makeTemplateSheet), drawn in the same vanishing gray as the other guides so it stays above the 128 luminance threshold and never traces.

## Alternatives rejected

Not recorded.

## Consequences

The template guide must stay above the 128 threshold so the pen-ink tracer ignores it; the guide notes that to join after g/j/q/y/z one must flick a baseline connector into the band. This is the opt-in seamless stage's reliability lever, not a default-build change.

## Evidence

Specs: docs/superpowers/specs/2026-06-28-connected-cursive-design.md 'Input contract (makes seamless reliable)': 'A new script generate preset... and a faint per-row connector guide line, in the same vanishing gray as the other guides so it never traces.'
