# ADR 0013 — Publish writes R2-first then D1 with rollback; deletes are explicit ordered, not FK cascade

**Status:** Accepted · backfilled 2026-06-29 from project history (review and correct if the reconstruction is wrong)
**Date:** 2026-06-03 to 2026-06-09 (a0a5b77 / 3f71569)

## Context

A failed publish must never orphan binaries in R2, and the inverse problem is that fonts.owner_id is ON DELETE SET NULL, so deleting an auth user via FK cascade would orphan fonts and their R2 objects. D1 has a ~100 bound-parameter limit.

## Decision

On publish, write the binaries (and per-font OG cards) to R2 first, then insert the D1 row inside a try/catch that deletes any written objects if the row insert fails, so a failed publish never orphans binaries. On account and own-font deletion, purge dependent rows and R2 objects explicitly and in order (fonts + their R2 binaries/og cards, avatar, votes/favorites with recount, reports/anonymize, then session/account/user) rather than relying on FK cascade, chunking IN-lists at 50 to stay under D1's bound-parameter limit.

## Alternatives rejected

Leaning on FK cascade for deletion was explicitly rejected ('fonts.owner_id is ON DELETE SET NULL so the auth user delete would orphan fonts + R2').

## Consequences

Publish has atomic-ish semantics across two storage systems; any R2+D1 write path follows the rollback pattern. Deletion is a manual ordered purge that also recounts other makers' fonts so wall ranking does not drift; e2e verifies the social card and binary both 404 after deletion.

## Evidence

Memory + git commits a0a5b77 'feat(actions): harden the mutations' ('Publish now writes R2 then D1 inside a try/catch that deletes any written objects if the row insert fails'), 3f71569 'Add self-service account deletion' ('Deletes are explicit and ordered rather than leaning on FK cascade, and IN-lists are chunked under D1 bound-parameter limit'), 6ed1b46.
