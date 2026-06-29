# ADR 0025 — Anonymous, identifier-free funnel instrumentation as a D1 counter table

**Status:** Accepted · backfilled 2026-06-29 from project history (review and correct if the reconstruction is wrong)
**Date:** 2026-06-10 (48e4b0a)

## Context

The product lives or dies on the visits->drops->builds->downloads->publishes loop, and measurement had to start before any account exists and never cost a user anything.

## Decision

Instrument the maker funnel with eight anonymous events written to a (day, event, meta) counter table via a public, enum-validated, rate-limited, best-effort upsert-increment action. Bucket build failures by a classifyBuildError classifier that stores a class, never a message. Privacy is structural: there is nowhere to put an identifier.

## Alternatives rejected

Storing per-user or per-message detail was rejected ('Privacy is structural: there is nowhere to put an identifier'; failures count by kind 'without ever storing a message').

## Consequences

The funnel is public (starts before sign-up) and privacy-safe by construction; junk events are enum-rejected; a lost count never costs a user anything (best-effort, fire-and-forget). Surfaced in an admin funnel readout.

## Evidence

Git commit 48e4b0a 'Add the funnel counter backend: migration, action, failure classifier': 'enum-validated so junk cannot enter, rate-limited per IP, and best-effort... Privacy is structural... classifyBuildError buckets build failures into classes... without ever storing a message.'
