# ADR 0029 — Cold-start the wall with open-license OFL stand-ins, no fabricated makers

**Status:** Accepted · backfilled 2026-06-29 from project history (review and correct if the reconstruction is wrong)
**Date:** 2026-06-02

## Context

The wall needs content before real makers publish, but the project's values bar forbids fabricated testimonials, makers, or data.

## Decision

Seed the launch wall with 12 open-license OFL faces standing in for house fonts, credited to their real designers, with votes=0 and no fabricated makers, documenting the honesty trail in SEED.md.

## Alternatives rejected

Fake makers and fabricated votes were rejected (votes kept at 0, real designer credit, honesty trail recorded).

## Consequences

Stand-ins were later removed from prod once 7 real fonts existed; the local/CI seed retains them on purpose (e2e search.spec matches them), so stand-in code branches became dev/CI-only.

## Evidence

Memory: 'Launch wall = 12 open-license OFL faces standing in for house fonts, credited to real designers, votes=0, no fake makers. Honesty trail in SEED.md.'
