# fonthead.dev — build brief

For Claude Code. Read alongside CLAUDE.md. fonthead.dev is a community font library and maker: people turn an alphabet sheet into a real font, publish it public or private, and browse, favorite, and upvote what everyone makes. The design is set (the Claude Design mock defines the look and the three screens). This brief is how we build it for real.

## Stack (locked)

- Astro 5, SSR on the Cloudflare adapter. TypeScript strict. React islands for interactive surfaces. Tailwind.
- Cloudflare D1 for relational data. R2 for font binaries and source assets. Better Auth on the D1 adapter for accounts.
- The existing vanilla font engine runs client-side in a Web Worker. No server compute builds fonts.
- A Cloudflare Cron Trigger runs the daily feature.

## Architecture

- The library and font pages are SSR Astro pages reading from D1. Each published font's woff2 is served from R2 and loaded via `@font-face` so specimen cards render in the real face. Lazy-load fonts as cards enter the viewport so the wall stays fast.
- Mutations (vote, favorite, publish, set visibility) are Astro Actions. Interactive components (maker, voting, favorites, the card-to-page morph) are React islands. Everything else is server-rendered.
- The maker runs the engine in a worker. On publish, the generated woff2, otf, and ttf upload to R2 and a row is written to D1.
- Public fonts' woff2 is publicly readable from R2. Private fonts are gated behind auth.

## Data model (D1)

- **users**: id, handle, email, created_at
- **fonts**: id, owner_id, name, maker_handle, specimen_word, meta (json: treatment, colors, size, italic, badge), visibility (public | private), glyph_count, otf_key, ttf_key, woff2_key, otf_size, ttf_size, woff2_size, votes_count (denormalized), created_at
- **votes**: user_id, font_id, created_at — unique on (user_id, font_id)
- **favorites**: user_id, font_id, created_at — unique on (user_id, font_id)
- **featured**: date, font_ids (json) — written nightly by the cron

## Routes

- `/` library (home / browse): cycling daily-feature hero, sort popular | new, the wall of cards.
- `/f/[id]` font page: a specimen you can type into, metadata, downloads, favorite, vote.
- `/make` maker: the client-side engine island; on finish, publish to the library (public or private) or keep it private.
- `/u/[handle]` profile: a maker's fonts. Supporting.
- Better Auth routes for sign-in and session.
- Actions: vote, favorite, publishFont, setVisibility.
- Cron worker: nightly, compute the previous day's most-liked public fonts, write the featured row.

## Components to port from the design mock

FontCard, CyclingWordmark, CardMorph (the FLIP card-to-page), BuildReadout (binarize, slice, trace, build), AdvancedReveal, FavBtn, VoteBtn, Badge, plus the CSS tokens (one easing variable, one signal color, the monochrome ink palette). Keep the mock's in-use choices: card style A (readout) and hero A (centered colossus) unless Stephen picks otherwise. Replace the Google-font stand-ins with real font files.

## The A&C interaction charter (carry it through)

- One easing token across everything. No spring, no bounce.
- The machine shows its work: the real build steps, not a spinner.
- The card becomes the page: a true FLIP morph, not a fade.
- Technical readouts as ambient texture: glyph count, file size, format, in mono.
- One signal color, used only on active states.

## Milestones (gate each before the next is authorized)

Each gate is something Stephen can verify without reading code.

- **M1 Skeleton.** Astro deploying on Cloudflare, D1 and R2 wired, the library renders fonts from D1 with specimens served from R2. Gate: a live URL, the wall renders real fonts.
- **M2 Maker.** The engine integrated in the worker, drop a sheet and build a font in the browser, download the files. Gate: build a font end to end, files download.
- **M3 Accounts and publish.** Better Auth, publish to the library public or private, the font appears on the wall and the maker's profile. Gate: sign in, publish, see it on the wall and the profile.
- **M4 Social.** Voting and favorites with optimistic updates, sort popular and new. Gate: vote and favorite, counts persist across reload, both sorts work.
- **M5 Daily feature.** The cron computes the previous day's most-liked and the hero features it. Cold start runs the house fonts. Gate: trigger the cron, the hero shows the featured set.
- **M6 Charter and polish.** The easing, the morph, the readouts, performance, accessibility. Gate: judge panel at bar, Lighthouse high.

## Launch content

The wall ships with Stephen's house fonts, the real ones, not the Google stand-ins in the mock. Target around twelve, spanning the range: clean text, an italic, a script, flame layered-color, gradient color, single-line, and a variable. The gradient, flame, and single-line faces are already made. Dev can run stand-ins until the real files are in R2.

## Before launch

User-uploaded fonts need a report and takedown path, since people will upload type they do not own. Light is fine: a report link plus an admin removal. Not a milestone blocker, but it is on the pre-launch list.

## Never (see CLAUDE.md)

No fabricated data; placeholder and flag instead. Read before write. No partial milestone hand-offs. No AI-default slop. Voice rules on all copy. Anything pushed builds clean.
