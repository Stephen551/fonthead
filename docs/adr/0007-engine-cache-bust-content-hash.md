# ADR 0007 — Content-hash the engine cache-bust token everywhere, including the build worker

**Status:** Accepted · backfilled 2026-06-29 from project history (review and correct if the reconstruction is wrong)
**Date:** 2026-06-09 to 2026-06-29 (47e3946 / 5a96ea6 / 082e4c6)

## Context

The vendored engine .js are served immutable for a year via public/_headers, refetched only when their ?v= changes. The token was a hardcoded string (?v=0.8.59) that had to be hand-bumped on every engine edit. It was missed, so a string of real engine fixes were invisible to already-cached browsers; later the build worker pulled ~26 modules via importScripts with a separate hardcoded token so a kern fix 'only worked in incognito'.

## Decision

Derive the engine ?v= cache-bust token from a content hash of the engine bytes at build time (astro.config.mjs injects __ENGINE_V__). Use it for the page <script> tags in make.astro, for maker.ts ENGINE_VERSION, and have font-engine-worker.js read the ?v off its own URL (self.location.search) and reuse it for all importScripts. Never hardcode the token anywhere. Additionally send Cache-Control: no-cache on text/html so deploys reach already-visited browsers.

## Alternatives rejected

Hand-bumped hardcoded version tokens were rejected as the root cause of both the original invisible-fix bug and the 'only works in incognito' regression. Do not reintroduce a literal ?v= in the worker or in ENGINE_VERSION.

## Consequences

Any engine edit auto-busts both the page bundle and the worker plus its imports; the immutable cache stays valid because each content version is genuinely a new URL. The vendored public/assets engine is the one cache trap to watch; a stale cached engine is the first suspect when an engine fix 'does nothing' or only works in incognito.

## Evidence

Memory + CLAUDE.md + git commits 47e3946 'Derive the maker engine cache-bust token from its content', 5a96ea6 'Auto-propagate the engine cache-buster into the build worker', 082e4c6 'Send no-cache on HTML'. CLAUDE.md: 'NEVER hardcode that token... Do NOT reintroduce a literal ?v= in the worker or in ENGINE_VERSION.'
