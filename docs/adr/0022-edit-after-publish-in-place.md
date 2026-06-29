# ADR 0022 — Edit-after-publish updates metadata in place; owner actions separate from admin takedown

**Status:** Accepted · backfilled 2026-06-29 from project history (review and correct if the reconstruction is wrong)
**Date:** 2026-06-09 (6369562 / 53dcfcf)

## Context

Publishing was one-way: a typo in the name, the wrong license, or a bad specimen could only be fixed by delete + republish, which destroyed the font's votes and favorites. The app also needs both self-service author control and a separate admin moderation path.

## Decision

Let an author edit a published font's name/specimen/license via an owner-gated, rate-limited updateOwnFont action that updates only metadata in place (binaries untouched; the OG card is dropped to the generic card only when the specimen word changes, via the pure editedFontMeta helper that preserves unrelated meta keys). deleteOwnFont (owner-gated) is full teardown including the social card. removeFont is a distinct admin-only takedown.

## Alternatives rejected

Delete + republish was rejected (it destroyed votes and favorites). Rebuilding binaries on edit was rejected (binaries keep the name they were built with).

## Consequences

Votes and favorites survive an edit; the OG card regenerates only on a specimen change. Owner and admin authorization scopes are kept explicitly separate.

## Evidence

Memory + CLAUDE.md + git commits 6369562 'Let an author edit a published font name, specimen, and license' ('could only be fixed by delete + republish, which destroyed the font votes and favorites... The binaries are untouched') and 53dcfcf 'Add editedFontMeta helper'.
