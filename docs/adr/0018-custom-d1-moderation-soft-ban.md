# ADR 0018 — Custom D1 moderation (no CMS); soft read-only bans enforced at requireUser; code-managed banlist

**Status:** Accepted · backfilled 2026-06-29 from project history (review and correct if the reconstruction is wrong)
**Date:** 2026-06-06 (cbf4fa0 / 530f856)

## Context

Moderation needs to gate mutations and screen handles/names for banned words. Stephen vetoed using a CMS for this. Bans needed to cover all mutations from one chokepoint, and the banlist had to dodge the Scunthorpe problem (over-blocking innocent words containing substrings).

## Decision

Build a custom admin/moderation layer treating fonts as app data in D1. Implement bans as soft/read-only: a banned account is rejected inside requireUser (via assertNotBanned), so every mutation becomes read-only while sign-in and browsing are untouched. Curate the handle/font-name banlist in code (src/lib/banned-words.ts, one-line edits) with normalized matching (leet folded, non-letters stripped), split into substring slurs (block anywhere) and exact slurs (block only when the whole name is the slur, so raccoon and therapist pass). Reports unify into one table targeting a font OR a maker with open/resolved status.

## Alternatives rejected

Sanity/CMS was rejected ('fonts are app data in D1, not CMS content; editorial bits stay in code, use Astro content collections if they grow'). Hard-delete/lockout bans were rejected in favor of soft read-only bans. A single substring banlist was rejected (blocks innocent words).

## Consequences

requireUser SELECTs banned on every mutation, so the moderation migration must precede deploy or all mutations 500. Editorial content stays in code; adding a banned word is a code edit. The ban chokepoint covers every mutation from one place.

## Evidence

Memory + git commits cbf4fa0 'Moderation actions: ban enforcement, banlist, report a maker, admin tools' and 530f856 'Add a code-managed name banlist' ('substring slurs... and exact slurs... so raccoon and therapist pass').
