# ADR 0016 — Defence-in-depth XSS via output escaping; deliberate CSP relaxations documented and not tightened

**Status:** Accepted · backfilled 2026-06-29 from project history (review and correct if the reconstruction is wrong)
**Date:** 2026-06-04 to 2026-06-05 (2e0ed56 / 95aba9c)

## Context

A stored XSS (CWE-79) shipped: the cycling hero emitted JSON.stringify(faces) through set:html, which does not HTML-escape, and JSON.stringify does not escape < > &, so a crafted font name broke out of the <script> and executed under the unsafe-inline CSP. Separately, the in-browser font engine genuinely requires eval and inline scripts, and Astro's CSP feature is incompatible with ClientRouter and inline style attributes.

## Decision

Set site-wide security headers and CSP via src/middleware.ts. Close the XSS surface by output escaping, not by the CSP: escape < > & to \uXXXX before any set:html into a script/JSON-LD context (round-tripped via JSON.parse on the client), reject < > & in user-controlled font name/specimen at publish, and write user-controlled DOM text via textContent. Keep the load-bearing CSP relaxations: script-src 'unsafe-eval' (wawoff2 Emscripten glue calls new Function), connect-src data: (the WASM binary is an inline data URL), worker-src/font-src/img-src blob:, and script/style 'unsafe-inline'; do not pursue Astro's CSP feature.

## Alternatives rejected

Relying on the CSP to contain the injection was rejected (the CSP keeps unsafe-inline, so the surface is closed by escaping). Tightening the CSP / adopting Astro's CSP feature was rejected (incompatible with ClientRouter and inline styles, and the surface is already closed by escaping). Dropping script-src 'unsafe-inline' was tested and deferred because Astro injects inline island-hydration scripts on /make.

## Consequences

All JSON-into-script data round-trips through the escape helper; input refinement rejects markup at the action. The specific CSP relaxations are load-bearing and must not be 'cleaned up'; if the maker stops producing woff2, the CSP is the first suspect. The decision is documented explicitly so future tightening attempts know why it was left.

## Evidence

Memory + CLAUDE.md + git commits 2e0ed56 'Fix stored XSS in the hero data island + harden headers' and 95aba9c 'Document the CSP relaxations as a deliberate decision' ('The XSS surface is closed by output escaping, not the CSP.').
