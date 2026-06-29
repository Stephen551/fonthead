# ADR 0027 — Test harness: vitest + Playwright with build-validity gates, fontTools as independent validator, and a typographic corpus lint

**Status:** Accepted · backfilled 2026-06-29 from project history (review and correct if the reconstruction is wrong)
**Date:** 2026-06-03 to 2026-06-10 (610d335 / c2e0cdd / 8e95ae2)

## Context

The core was missing the test it most needed: a refactor could silently ship a broken font, and tracing behaviour at the edges was unknown. Phase 0 established a test harness before further hardening, deferring a Cloudflare workers-pool project to Phase 2.

## Decision

Adopt vitest (jsdom) for unit/engine-math tests and @playwright/test for e2e, wired into .github/workflows/ci.yml. Gate every e2e font build on a real SFNT signature with all table checksums valid, and run one built font through fontTools (checkChecksums=2) as an independent second validator in CI (so a bug in the engine's own validator cannot pass). Add an out-of-band typographic corpus lint (npm run test:corpus, ~15 faces in e2e/fixtures/corpus) as a separate Playwright project that builds every face through the real maker and gates fusion/rhythm/word-space metrics with a contact sheet for a human taste pass.

## Alternatives rejected

Relying on the in-engine validateFont alone was rejected (augmented with fontTools). Folding the corpus lint into the per-commit suites was rejected (kept separate so per-commit suites stay fast). A Cloudflare workers-pool project + undici pin was considered but deferred to Phase 2.

## Consequences

A broken font or trace regression fails CI rather than shipping. CI applies D1 migrations before the e2e dev server boots and seeds D1; EMAIL_DRY_RUN keeps e2e from sending mail. The corpus harness encodes a field-failure playbook: a user's broken sheet becomes a fixture and its failure becomes a metric. Corpus gates are recalibrated when the join/kern model changes.

## Evidence

Memory + CLAUDE.md + git commits 610d335 'chore: set up vitest + playwright + CI harness', c2e0cdd 'test(maker): end-to-end build-validity gate' ('CI also runs one built font through fontTools (checkChecksums=2) as an independent second validator'), 8e95ae2 'Add the typographic lint: npm run test:corpus'.
