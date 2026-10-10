# ADR 0058 — Google Analytics 4 via the standard Google tag, with an Analytics-only CSP allowlist

**Status:** Accepted
**Date:** 2026-10-10
**Amends:** [ADR 0016](0016-csp-relaxations-output-escaping-xss.md) (the CSP gains three Google hosts)

## Context

A Google Analytics 4 property (measurement ID `G-JR40KDFN2W`) needs to collect
page views from fonthead.dev. The site already runs Cloudflare Web Analytics,
injected at the zone, and ADR 0025 keeps an identifier-free funnel counter in D1;
neither is replaced by this decision.

Three facts shaped the install:

- Every page renders through `src/layouts/Base.astro` (19 of 19 pages at the
  time of writing), so its `<head>` is the one place a site-wide tag can live.
- The CSP in `src/middleware.ts` (ADR 0016) allows scripts only from `'self'`
  and `static.cloudflareinsights.com`, and connections only to `'self'`, `data:`
  and `cloudflareinsights.com`. Without a change the browser blocks gtag.js
  outright, and the property collects nothing.
- The site uses Astro's `ClientRouter`, so most navigations after the first are
  client-side swaps, not full document loads.

## Decision

1. **Install the standard Google tag, unchanged, in the Base layout `<head>`.**
   The two-script snippet Google publishes (the `async` loader from
   `https://www.googletagmanager.com/gtag/js?id=…` plus the inline
   `dataLayer` / `gtag('js')` / `gtag('config')` block) is emitted with
   `is:inline` so Astro ships it verbatim. The measurement ID is a frontmatter
   constant and is treated as public configuration: it appears in every page's
   HTML by design and is not a secret, so it is not an environment binding.
   No Google Tag Manager container, no `gtag('set')` or `config` parameters, no
   advertising, remarketing, or Google Signals features are enabled in code.
   Those are property-side settings and stay off unless someone turns them on
   in the GA4 admin, at which point this CSP will block their hosts (see below).

2. **Render the tag only off localhost.** `Base.astro` emits the snippet when the
   request hostname is neither `localhost` nor `127.0.0.1`, which is the same
   production test `middleware.ts` already uses to skip the HTTPS upgrade.
   `astro dev`, the Playwright e2e dev server, and `wrangler dev --local`
   therefore never send page views, and CI runs do not pollute the property.
   Both the custom domain and the `*.workers.dev` host render it.

3. **Exactly once per document.** All pages carry the identical pair of head
   scripts, and `ClientRouter` keeps matching `<head>` scripts in place across
   client-side navigations rather than re-running them, so `gtag('config')`
   runs once per full page load. Page views for client-side navigations are
   the property's business: GA4 Enhanced Measurement's "page changes based on
   browser history events" (on by default) observes `ClientRouter`'s
   `history.pushState`. No custom `astro:page-load` listener is added.

4. **Allow Google's documented Analytics-only hosts in the CSP, and nothing
   more.** The additions to the existing directives are exactly the set Google
   lists for "Google Analytics without any Ads features" in its CSP guide
   (developers.google.com/tag-platform/security/guides/csp):

   | Directive | Added hosts |
   |---|---|
   | `script-src` | `https://www.googletagmanager.com` |
   | `img-src` | `https://www.googletagmanager.com https://*.google-analytics.com` |
   | `connect-src` | `https://www.googletagmanager.com https://*.google-analytics.com https://*.google.com` |

   The host is appended to the existing `script-src` rather than introducing
   the `script-src-elem` directive Google's table names: once `script-src-elem`
   exists it fully replaces `script-src` for element loads, so adopting it would
   mean duplicating every existing script source for no gain. The live gtag.js
   for this property posts hits to `*.google-analytics.com/g/collect` and
   `analytics.google.com/g/collect` (region-prefixed variants included);
   `https://*.google.com` covers the second family. Every other CSP directive
   and every other security header is unchanged.

## Alternatives rejected

- **Google Tag Manager.** Out of scope by requirement, and a container adds a
  second script host plus `frame-src` and `'unsafe-inline'` requirements that
  widen the CSP further than a direct tag.
- **Measurement ID as an environment binding.** It is public by nature and
  changes with the property, not the environment. A binding would add a
  `wrangler types` round-trip and a `.dev.vars` entry for a value that is not
  secret, and would make the tag disappear silently on a fresh checkout.
- **Gating on `import.meta.env.PROD` instead of hostname.** `wrangler dev` on
  the built Worker is a production build served from localhost; it would have
  reported local page views. The hostname test is the production notion the
  middleware already uses.
- **A narrower connect-src (`https://*.analytics.google.com` only, no
  `*.google.com`).** It would work today, but it departs from the vendor's
  stated requirement and would fail silently if Google shifts a collection
  endpoint. The documented set is the defensible minimum; nothing from the
  "with Ads features" list (`*.g.doubleclick.net`, `pagead2.googlesyndication.com`,
  per-TLD `*.google.<TLD>`, `frame-src`) is included.
- **A custom `astro:page-load` page_view sender.** It is not the standard tag,
  and it would double-count against Enhanced Measurement's history tracking.

## Consequences

- Production pages load one external script from Google and set GA's
  first-party `_ga` cookies. The privacy page's "Hosting and analytics" section
  still describes only the privacy-respecting page-view counter; whether and
  how to describe Google Analytics there, and any consent requirement, is a
  product and legal decision deliberately left out of this change.
- Enabling Google Ads linking or Google Signals later will be blocked by the
  CSP until `connect-src` and `img-src` are extended with the "with Ads
  features" hosts. That is intended: the policy, not a GA admin toggle, decides
  what the browser may contact.
- Local and CI runs render no tag, so an e2e assertion about the tag cannot be
  written against the dev server; the production verification is a live check
  that `gtag/js?id=G-JR40KDFN2W` loads and `gtag('config', …)` appears once in
  the served HTML on representative routes.

## Evidence

- `src/layouts/Base.astro`: the `GA_MEASUREMENT_ID` constant, the `gaOn`
  hostname gate, and the two `is:inline` head scripts.
- `src/middleware.ts`: the three amended CSP directives and their comments.
- Production CSP before this change (captured 2026-10-10):
  `script-src 'self' 'unsafe-inline' 'unsafe-eval' https://static.cloudflareinsights.com; … connect-src 'self' data: https://cloudflareinsights.com`.
- The live `https://www.googletagmanager.com/gtag/js?id=G-JR40KDFN2W` (540 KB,
  fetched 2026-10-10) references `google-analytics.com/g/s/collect` and
  `analytics.google.com/g/s/collect` as its collection endpoints.
