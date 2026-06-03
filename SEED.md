# Launch wall — what is real and what is a stand-in

The M1 wall ships with twelve open-license faces standing in for the house
fonts until the real files land in R2. This note is the honesty trail. It
exists so nobody mistakes the stand-in set for community activity.

## Real (measured, not invented)

- **The faces.** Twelve real OFL fonts, self-hosted as woff2 in the R2
  `fonthead-fonts` bucket under `fonts/<id>.woff2`. No Google CDN.
- **File sizes.** The byte size shown on each card and font page is the real
  woff2 size on disk.
- **Glyph counts.** Read from each woff2 with fontkit at seed time. Real.
- **Format.** `variable` is shown only on the two genuinely variable faces
  (Fraunces, Outfit). The other ten are `static`. True.
- **Designer credit.** Each font is credited to its real designer, with the
  verbatim OFL copyright line shown on the font page for verification.
- **Visibility.** One face (Gloria Hallelujah) is marked private to exercise
  the visibility filter; it is correctly excluded from the public wall.

## Stand-in / placeholder (flagged, not passed off as real)

- **Font display names** are the real family names (Monoton, Anton, …), but the
  whole set is a stand-in for Stephen's house fonts. The font page says so
  ("open-license face, standing in").
- **Specimen words** (Replay, Bakery, …) are sample display strings carried
  over from the design mock, not data claims.
- **Two colour specimens** (Anton with a gradient, Bungee in flat blue) use a
  CSS treatment for wall life. They are presentation styling, not real colour
  fonts, so they carry no "color" category badge. Real colour and single-line
  faces arrive from the maker engine (M2) and the house files.
- **Vote counts are 0.** No fabricated engagement. Real votes begin in M4.
- **No community makers.** The mock's invented personas (e.g. "pixel.mara")
  were dropped. Credit goes to the real OFL designers only.

## How to reseed

```bash
node scripts/seed-fonts.mjs              # regenerate SQL + manifest from fonts-staging
wrangler d1 execute DB --remote --file=scripts/seed.generated.sql
# re-upload binaries with the loop in the repo history if the bucket is reset
```

When the real house fonts are ready, replace the staged files and the FONTS
array in `scripts/seed-fonts.mjs`, then reseed.
