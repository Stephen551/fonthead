# Claude Design prompt — fonthead.dev (community font library + maker)

Paste this into Claude Design. It replaces the earlier white-cube and arcade prompts. The product changed: fonthead is now a community font library, not just a tool.

---

## What it is

fonthead.dev is two things in one free web app:
1. A maker that turns an alphabet sheet (hand-drawn or AI-generated) into a real, complete, installable font: every glyph, properly spaced, exported as OTF, TTF, and WOFF2. It also makes color fonts (gradient and flat) and single-line fonts for Cricut pens and plotters.
2. A community library where people publish the fonts they make, browse what everyone else has made, and favorite and upvote them.

The home is the library, not a marketing page. You land in the work.

## Who it's for

A non-technical Etsy or Cricut crafter who wants a font made without learning typography, and a designer who wants control. Simple by default, depth on demand (progressive disclosure).

## Scope: design these three screens

Focus on the three screens that define the product. Sign-in and profiles are supporting, not the centerpiece. Do not try to design the whole app at once.
1. **The library** (home / browse): where you land, a wall of fonts the community made.
2. **A font's page**: one font's specimen and detail page.
3. **The maker**: drop a sheet, build a font, publish it or keep it private.

## Aesthetic

White, clean, content-forward. The fonts are the hero and the only real color. The chrome stays quiet.

This is NOT the empty tasteful-minimal look (a big headline floating in whitespace). That version failed. It is clean because the room is full of work: every font specimen brings its own character and color. The reference is the best type-discovery sites, but for community-made fonts.

Avoid by name: no purple or indigo SaaS gradient, no rounded-2xl soft-shadow cards, no Inter or system-ui for display type, no three-icon feature row, no empty-hero minimalism.

## The hero / masthead (top of the library)

A "fonthead" wordmark that cycles through real made fonts: the same word, re-rendered every few seconds in a different face (flame, gradient, single-line, a clean italic). Constant word, cycling face, so range is the message: the same letters, wildly different every few seconds.

This slot is also the daily feature. At launch it cycles the house fonts. Once there is community activity, it features the previous day's most-liked fonts, cycling the top few. Automatic, not hand-curated. Cold start: with no "yesterday" yet, it just runs the house fonts.

The cycling faces are what bring color and life to the white room. Reduced-motion: show a single static specimen.

## The library (home / browse)

The wall. Each font is a live specimen card showing:
- the font actually rendered (a real specimen string, not just a name in a default face)
- the font name and the maker
- an upvote count and a favorite control
- a public/private badge

Sort by popular and by new. A clear "Make a font" entry. Quiet chrome, loud specimens. This is where browsing and discovery live.

## A font's page

One font shown large as a specimen you can type into. Its metadata sits as quiet technical texture (glyph count, file size, formats, in mono). Download buttons (OTF, TTF, WOFF2). Favorite and upvote. Maker credit. If it is a color or single-line font, show that clearly.

## The maker

Drop a sheet, watch the font build, name it, then publish it to the library or keep it private. Simple by default: three clear moves a crafter can follow. Advanced controls live behind a reveal for the pro. When the font builds, show the real process (binarize, slice, trace, build), not a fake spinner.

## Accounts

Needed now, because of uploads, favorites, and profiles. Keep sign-in light and out of the way. Each font is public or private, set by its maker.

## The A&C stamp: interaction and motion charter (the most important part)

This is where "made, not generated" lives, and it is the hardest thing for a generic build to fake. Simple but quietly technical. Understated, precise, engineered, never flashy.
- **One consistent, slightly mechanical easing** across the whole app. Never bouncy or springy. The restraint is the tell.
- **The machine shows its work.** When a font builds, show the real steps as an honest readout, not a spinner.
- **Technical readouts as ambient texture.** Glyph count, file size, format, set in mono, sitting quietly on every font.
- **Measured transitions, not fades.** A specimen card expands into the font's page with exact, tracked motion: the card becomes the page.
- **Restrained micro-interactions.** Favorite and upvote land with a precise tick and a mono count roll-up. No confetti.

Note: establish the interaction language here, which transitions happen and how the timing feels. The exact easing curves and the honest build readout get finished in code, not in the mockup.

## Voice

Direct, plain, confident. No marketing slop. No em dashes. No fabricated statistics. Never use transform, elevate, solutions, growth systems, online presence, or hand-coded.

## The bar

It must feel made, not generated. Clean but not empty: the fonts fill the room with life. If it reads as a generic minimal SaaS template, it failed. Build it light, fast, and accessible.
