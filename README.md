# fonthead.dev

A community font library and maker. People turn an alphabet sheet into a real
font, publish it public or private, and browse, favorite, and upvote what
everyone makes. Built under the A&C Meridian quality bar: made, not generated.

**Live:** https://fonthead.stephenalatriste.workers.dev

## Stack

- **Astro 5** SSR on the **Cloudflare Workers** adapter (`@astrojs/cloudflare` 12).
- **React 19** islands for interactive surfaces. **Tailwind v4** via the Vite plugin.
- **Cloudflare D1** (relational) · **R2** (font binaries) · **KV** (Astro sessions).
- **Better Auth** on native D1 for accounts.
- TypeScript strict throughout.

## Cloudflare resources

| Resource | Binding | Name / id |
| --- | --- | --- |
| D1 | `DB` | `fonthead` · `f4991cba-1ebf-4d91-8d91-bca4eadb3ad8` |
| R2 | `FONTS` | `fonthead-fonts` |
| KV | `SESSION` | `aee8ec3771d54c9187ff2ea2164992c6` |

## Commands

```bash
npm run dev              # astro dev with local D1/R2/KV via platformProxy
npm run build            # astro build (outputs the Worker + assets to dist/)
npm run preview          # wrangler dev on the built Worker (prod-like, local bindings)
npm run deploy           # astro build && wrangler deploy
npm run cf-typegen       # regenerate worker-configuration.d.ts after wrangler.jsonc edits

npm run db:apply:local   # apply D1 migrations locally
npm run db:apply:remote  # apply D1 migrations to production
npm run seed:fonts       # regenerate the seed SQL + manifest (see SEED.md)

wrangler deploy --config wrangler.cron.jsonc   # deploy the nightly cron worker
```

Two Workers share the one D1 database: **`fonthead`** (the app) and
**`fonthead-cron`** (the nightly daily-feature job, `cron/worker.ts`).

Secrets (`BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`) live in `.dev.vars` locally and
in `wrangler secret put` for production. Never committed.

## Routes

- `/` — the library: cycling daily-feature hero, popular/new sort, the wall.
- `/f/[id]` — a font's page: type-into specimen, glyph set, metadata, downloads.
- `/make` — the maker (M1 stub; the tracer engine arrives in M2).
- `/sign-in`, `/account` — accounts (Better Auth).
- `/api/auth/[...all]` — Better Auth handler.
- `/cdn/[...key]` — serves font binaries from R2.

## Milestones — all shipped

- **M1.** Scaffold, D1 + R2 wired, the wall renders real faces from D1 with
  specimens served from R2 (lazy-loaded on scroll), font page, maker stub, and a
  Better Auth spike with a protected SSR route.
- **M2.** The maker: the vendored tracer engine runs client-side, traces an
  alphabet sheet, builds OTF/TTF/WOFF2 in a Web Worker, previews and downloads.
  The maker also builds **colour fonts** (gradient → COLRv1, flat → COLRv0/CPAL)
  on the main thread; colour fonts publish as OTF + WOFF2 and render natively in
  colour on the wall and font page. (Single-line mode is not wired — upstream it
  emits an SVG centerline, not yet an installable font.)
- **M3.** Accounts + publish (public/private), maker profiles at `/u/[handle]`,
  auth-aware nav, private-font gating across the wall, font page, and `/cdn`.
- **M4.** Social: votes and favorites with optimistic updates, working
  popular/new sorts. votes_count recomputed in-batch (drift-proof).
- **M5.** The daily feature: a standalone cron worker (`wrangler.cron.jsonc`,
  06:00 UTC) tallies the previous day's most-liked public fonts; the hero cycles
  the featured set, or the house fonts on cold start.
- **M6.** Charter + polish: one mechanical easing, the card-to-page FLIP morph
  via View Transitions, the honest build readout, accessibility (focus, reduced
  motion, AA contrast, sr-only headings), and a perf pass (no React on content
  pages — the hero is vanilla; React loads only on `/make`).

A post-build security review hardened uploads (size cap + font-signature
validation), vote/favorite authorization, the `/cdn` gate, the cron secret, and
production trusted origins.

See `SEED.md` for the launch-wall honesty trail (real vs stand-in).
The design mock and build brief are at the repo root (`fh-*.jsx`,
`fonthead-build-brief.md`).
