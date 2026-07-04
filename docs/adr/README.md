# Architecture Decision Records

How and why fonthead.dev is built the way it is. One file per decision.

ADR 0001 (cursive connection) was written at decision time and is **Proposed** —
it needs Stephen's ratification. ADRs **0002–0035 were backfilled on 2026-06-29**
by mining the project history (the build memory log, git commit messages,
CLAUDE.md, and the design specs) and consolidating it into grounded,
evidence-cited records. They document decisions already in force; review them and
correct any reconstruction that is wrong. Routine dev/ops gotchas (commit
quoting, deploy-artifact flags, secret-setting procedure, etc.) were deliberately
left out — they live in CLAUDE.md, not here.

| # | Decision | Status |
|---|----------|--------|
| [0001](0001-cursive-connection.md) | Cursive connection model | Proposed |
| [0002](0002-astro5-ssr-cloudflare-workers.md) | Astro 5 SSR on Cloudflare Workers as the application platform | Accepted |
| [0003](0003-better-auth-per-request-d1-kysely-pin.md) | Better Auth on native D1, built per-request, with kysely pinned to 0.28.17 | Accepted |
| [0004](0004-vendored-client-side-font-engine.md) | Vendor the client-side font engine; engine edits stay surgical and additive | Accepted |
| [0005](0005-font-validity-checksums-fonttools.md) | Never trust fontkit for font validity; repair checksums and validate with fontTools | Accepted |
| [0006](0006-no-react-on-content-pages.md) | No React on content pages; React only on the maker | Accepted |
| [0007](0007-engine-cache-bust-content-hash.md) | Content-hash the engine cache-bust token everywhere, including the build worker | Accepted |
| [0008](0008-trust-armed-preset-charset-over-geometry-probe.md) | Trust the armed preset charset for generated and colour sheets over the geometry probe | Accepted |
| [0009](0009-self-classifying-trim-rules.md) | Self-classifying sheet trim rules with a self-verifying trim loop | Accepted |
| [0010](0010-kerning-via-gpos-pairpos.md) | Real kerning emits a GPOS PairPos table, not the legacy kern table | Accepted |
| [0011](0011-absolute-xheight-pair-gap-metric.md) | Measure kerning pair gaps at absolute x-height fractions, not band-normalized | Accepted |
| [0012](0012-colour-fonts-otf-woff2-only.md) | Colour fonts build main-thread and output OTF + WOFF2 only (no TTF yet) | Accepted |
| [0013](0013-r2-then-d1-rollback-publish.md) | Publish writes R2-first then D1 with rollback; deletes are explicit ordered, not FK cascade | Accepted |
| [0014](0014-denormalized-counters-in-atomic-batch.md) | Denormalized counters read and updated inside the atomic D1 batch | Accepted |
| [0015](0015-kv-rate-limiter-and-signature-upload-gate.md) | KV fixed-window rate limiting plus binary-signature upload validation on mutations | Accepted |
| [0016](0016-csp-relaxations-output-escaping-xss.md) | Defence-in-depth XSS via output escaping; deliberate CSP relaxations documented and not tightened | Accepted |
| [0017](0017-transactional-email-via-resend-https.md) | Outbound email via the Resend HTTPS API (Workers cannot do SMTP); inbound via Email Routing | Accepted |
| [0018](0018-custom-d1-moderation-soft-ban.md) | Custom D1 moderation (no CMS); soft read-only bans enforced at requireUser; code-managed banlist | Accepted |
| [0019](0019-admin-authz-via-env-allowlist.md) | Admin authz via an ADMIN_EMAILS env allowlist | Accepted |
| [0020](0020-canonical-domain-auth-config.md) | Better Auth canonical-domain config: BETTER_AUTH_URL and trustedOrigins on the custom domain | Accepted |
| [0021](0021-set-once-handle-and-google-linking.md) | Set-once owner-scoped handle, with Google sign-in linked by verified email when enabled | Accepted |
| [0022](0022-edit-after-publish-in-place.md) | Edit-after-publish updates metadata in place; owner actions separate from admin takedown | Accepted |
| [0023](0023-social-cards-client-canvas-at-publish.md) | Per-font social cards rendered client-side via canvas at publish (no Satori/resvg/sharp) | Accepted |
| [0024](0024-edge-cache-public-binaries.md) | Edge-cache public binaries at the CDN while keeping the D1 visibility check live | Accepted |
| [0025](0025-anonymous-funnel-instrumentation.md) | Anonymous, identifier-free funnel instrumentation as a D1 counter table | Accepted |
| [0026](0026-daily-feature-separate-cron-worker.md) | Daily feature computed by a separate scheduled cron worker | Accepted |
| [0027](0027-test-harness-vitest-playwright-fonttools.md) | Test harness: vitest + Playwright with build-validity gates, fontTools as independent validator, and a typographic corpus lint | Accepted |
| [0028](0028-master-auto-deploy-no-seed-migration-order.md) | master auto-deploys without seeding; remote migrations run before deploy and require approval | Accepted |
| [0029](0029-launch-wall-ofl-standins-no-fake-makers.md) | Cold-start the wall with open-license OFL stand-ins, no fabricated makers | Accepted |
| [0030](0030-connect-mode-staged-two-stage.md) | Connected-cursive ships as a two-stage mode behind one flag (touch floor, then opt-in seamless overlap) | Accepted |
| [0031](0031-connect-plug-to-plug-x-only-placement.md) | Connect via plug-to-plug x-only placement with a single shared anchor/advance origin | Accepted |
| [0032](0032-connect-sibling-of-trim-mutually-exclusive.md) | connectGlyphs is a sibling of trim, mutually exclusive with it; connect-mode disables italic/spacing/kern/optical-sidebearings | Accepted (kerning point superseded by 0039) |
| [0033](0033-connect-no-synthesis-real-ink-join-classes.md) | Connect uses real ink only with position-independent join classes and a loosen-only weld pass | Accepted (no-synthesis rule amended by 0049) |
| [0034](0034-connect-input-contract-preset-and-guide.md) | Input contract for seamless joins: a 'script' generate preset and a non-tracing connector guide | Accepted |
| [0035](0035-connect-no-engine-files-pure-core-tests.md) | Connect touches no vendored engine file; pure decision core is unit-tested, raster gated by corpus/e2e | Accepted |
| [0036](0036-natural-variation-gsub-calt-palette.md) | Natural variation: a 3-sheet same-hand palette cycled by GSUB calt, metrically transparent | Accepted |
| [0037](0037-baseline-hardening-for-imperfect-hands.md) | Harden the auto baseline for imperfect hands (compression, body-anchor, weight floor, baseline leveling), gated so good hands are untouched | Accepted |
| [0038](0038-connector-height-snap-exit-entry-mismatch-gate.md) | Connector-height snap: lower high exit flicks onto the entry join line, gated on the exit-vs-entry mismatch (resolves 0037's rejected stub-snap) | Accepted |
| [0039](0039-connect-ships-gpos-kern-supersedes-0032.md) | Connect mode ships a GPOS kern table (kerning:true + connectKern); supersedes ADR 0032's kerning:false | Accepted |
| [0040](0040-contextual-connect-kern-parked-needs-assembled-feedback.md) | Contextual connect-kern parked: no build-time measure separates the connector bridge from a weld; needs an assembled-glyph feedback pass | Accepted (parked) |
| [0041](0041-connect-rhythm-in-placement-not-kern-densebody-parked.md) | Even connect rhythm belongs in connector placement, not a per-pair kern; dense-body kern parked, superseded by a connection-point spec | Accepted (parked) |
| [0042](0042-phase1-height-prerequisite-not-fix-thin-hand-joins-banked.md) | Connection-point Phase 1 (height normalization) is a prerequisite, not the fix; thin-hand joins banked at ~B pending the placement rework | Accepted (banked) |
| [0043](0043-eye-body-placement-route-proven-parked-on-bridge-weld-protection.md) | Eye-body placement normalization proves the Phase 3 route; parked on bridge-vs-weld protection | Accepted (route proven) |
| [0044](0044-bridged-placement-ships-overhang-cap-zone-split-fusion-gate.md) | Bridged placement ships: the exit-overhang cap is the weld guard, bridged fusion judged above the connect band | Accepted |
| [0045](0045-fidelity-build-natural-pitch-judged-toward-award-bar.md) | The fidelity build: trace the hand at resolution, place it at its own pitch; judged toward the award bar | Accepted |
| [0046](0046-generator-sheet-class-and-the-placement-mode-boundary.md) | Reading the generator sheet class, and the placement-mode boundary that floated the e | Accepted |
| [0047](0047-variation-build-mode-boundary-not-registration.md) | The variation build joins classic: the mode boundary was the whole defect, not variant registration | Accepted |
| [0048](0048-seam-alternates-contextual-not-base-surgery.md) | Seam knots fix by contextual alternates: a lowered-exit .jn01 copy fires before low-entry followers | Parked (warps failed the panel; machinery banked) |
| [0049](0049-measured-parameter-connector-reconstruction.md) | Measured-parameter connector reconstruction permitted; invented letterform variation stays banned | Accepted (amends 0033) |
| [0050](0050-connector-reconstruction-executed-gates.md) | The reconstruction's executed gates: connector-weight attach, entry-side backtrack alternates, the dive gate | Accepted (milestone closed + deployed 2026-07-03) |
| [0051](0051-assembled-pair-seam-sensor-corpus-rollout.md) | The assembled-pair seam sensor: the corpus builds connect faces on the hook and reads every fired seam | Accepted (milestone closed + deployed 2026-07-03) |
| [0052](0052-assembled-seam-feedback-pass-losers-park-themselves.md) | The assembled seam feedback pass: a probe build senses every fired exit seam and a losing alternate parks itself | Accepted (director accepted; milestone closed + deployed 2026-07-03, hook opt-in) |

## Format

Each ADR records Context (the problem), Decision (what was chosen), Alternatives
rejected, Consequences, and Evidence (the memory/commit/doc it is grounded in).
New decisions get the next number; a decision that overturns an older one marks
the older **Superseded by ADR-N** and references it.
