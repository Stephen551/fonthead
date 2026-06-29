# ADR 0014 — Denormalized counters read and updated inside the atomic D1 batch

**Status:** Accepted · backfilled 2026-06-29 from project history (review and correct if the reconstruction is wrong)
**Date:** 2026-06-03 (a0a5b77 / b325060)

## Context

vote/favorite/download counts are denormalized for read performance, but a separate count query could return a stale number and votes_count could drift. Account/font deletion can also leave other makers' counts wrong.

## Decision

Keep vote/favorite/download counts as denormalized columns (votes_count, downloads_count) on the fonts row and read/recompute them from inside the same atomic D1 batch as the mutation, so the count cannot go stale or drift. On deletion, recount affected makers' fonts. Queries use SELECT * so new counter columns flow through FontRow.

## Alternatives rejected

Reading the count from a separate query after the mutation, or computing counts on read instead of denormalizing, was rejected (could return a stale number / drift).

## Consequences

All counter writes occur inside the atomic batch; account/font deletion recounts affected fonts to avoid drift; the pattern is reused for any new denormalized counter (downloads_count followed votes_count).

## Evidence

Memory + git commits a0a5b77 ('Vote toggles read the fresh count from inside the same atomic batch instead of a separate query that could return a stale number'), b325060 ('votes_count recomputed from the votes table in-batch, so it cannot drift'), 3dd3bb0.
