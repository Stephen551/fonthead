# Lighthouse — fonthead.dev

Recorded against the live deployment (`https://fonthead.stephenalatriste.workers.dev`)
on 2026-06-04, mobile profile, headless Chrome. This is the M6 "Lighthouse high"
gate, run for real.

| Page | Performance | Accessibility | Best Practices | SEO |
|------|:-----------:|:-------------:|:--------------:|:---:|
| Library wall (`/`) | 99–100 | 96 | 100 | 100 |
| Font page (`/f/ac-flames`) | 99 | 100 | 100 | 100 |

Performance reads 99–100 run to run (network jitter, not a code change).

## Accessibility reds closed in this pass

- **landmark-one-main** (both pages): every page now has a single `<main>`.
- **color-contrast** (wordmark dot): `--signal` tuned `#e0392a → #d4342a` to clear
  the 4.5:1 AA floor as small text.
- **label-content-name-mismatch** (cards): the specimen link's label now leads
  with the specimen word; the vote button's name derives from its live count;
  badges were lifted out of the specimen link so their text stops leaking into
  the link name.

## Known remaining (one item, on the wall — a design call)

- **target-size**: the stacked font-name (15.5px) and maker-handle (11.5px) links
  in each card are under the WCAG 2.2 AA 24px target minimum and sit ~3px apart.
  Closing it means loosening the card's meta spacing (each link grown to ~24px),
  which changes the card's rhythm. Left for Stephen to approve rather than
  restyled unilaterally.

## Judge-panel hardening (2026-06-04)

A 12-judge panel (Awwwards / OWASP / WCAG / CWV bar) ran two iterations against
the build. It passed on iteration 2 at **8.08/10 average, every judge ≥7**
(up from 7.42). The fix pass that closed it shipped to prod alongside these
scores:

- **Security 3 → 8**: closed a stored XSS in the cycling hero (a font name like
  `</script>...` could execute under the inline-script CSP) by escaping the
  `set:html` data island and rejecting `< > &` in font names; added
  `Strict-Transport-Security` and `Permissions-Policy` headers.
- **Performance**: static assets (`/_astro`, `/fonts`, `/assets`) now cache
  immutably for a year (were `max-age=0`).
- **Responsive/visual**: wall specimens size to their card via a container query
  (no mid-glyph shearing at 375px); hero/maker-header overflow guarded; slider
  thumb raised to the 24px WCAG target.
- **SEO**: site-wide WebSite/Organization/SearchAction JSON-LD + per-font
  CreativeWork + per-page meta descriptions.

The raw `*.report.html` / `*.report.json` outputs are gitignored (regenerate with
`npx lighthouse <url>`).
