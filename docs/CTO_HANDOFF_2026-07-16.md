# Curated Luxury / WatchFacts CTO Handoff - 2026-07-16

## Purpose and authority

This is the current continuation document for opening the project in a new Codex
task or on another computer. It records the verified production state, completed
work, pending data queues, security risks, release workflow, and safe next actions.

Use this document, `AGENTS.md`, repository code, migrations, and tests as the source
of truth. Older handoffs are historical context and may contain superseded counts.
This document contains no credentials. Never paste secrets into a Codex prompt,
commit, issue, pull request, screenshot, or handoff.

Snapshot time: 2026-07-16, America/New_York.

## Executive status

- GitHub repository: `Pablodd1/wf`
- Production branch: `main`
- Current production commit: `35d1cb7104034c320e5b85dd977acc088ad873d2`
- PR #6: merged; Price Research detail/raw-message work, model browsing, and live
  Admin statistics.
- PR #7: merged; case-insensitive reference aggregation, case-insensitive dial
  grouping, and user-facing `Curated Luxury` branding.
- Vercel deployments for both `watchfacts-poc` and `wf`: successful for PR #7.
- Open pull requests at snapshot time: none.
- Production Vite build: passed.
- Normalization/promotion tests: 57 passed.
- Shadow normalization scan: complete for 2,631,468 analyzed rows.
- Shadow proposals are not production corrections. 2,000,805 proposals remain
  pending review/promotion.
- Customer-reviewable UI is deployed. Data promotion, multi-item classification,
  non-watch classification, image reconciliation, and catalog expansion are not
  complete.

## Product naming and URLs

- Product/page name shown to users: `Curated Luxury`.
- Existing external dealer-rating service: `WatchFacts` at
  `https://watchfacts.com/rated-dealers`.
- Existing legal copyright references to `Watchfacts Inc.` were intentionally left
  unchanged pending legal confirmation.
- Current application URL: `https://watchfacts-poc.vercel.app`.
- Repository and infrastructure identifiers may still use `wf` or `watchfacts`.
  Do not rename infrastructure casually; branding and infrastructure names are
  intentionally separate.

## Live services and ownership boundaries

| Component | Service | Responsibility |
| --- | --- | --- |
| Browser application and APIs | Vercel | Curated Luxury UI, Price Research, Trading Floor, Admin/API routes |
| Long-running normalization worker | Railway service `wf`, project `satisfied-vibrancy` | Checkpointed shadow analysis only |
| Primary data and auth | Supabase project `bptrvfncppbjnchsaxtb` | `watch_records`, shadow tables, catalog-related data, dealer auth |
| Media storage | DigitalOcean Spaces | Listing/product media; production and staging buckets must use separate rotated credentials |
| Dealer reputation directory | `watchfacts.com` | External rated-dealer workflow linked from the portal |

DNS changes do not restart Railway or normalization. Vercel serves the browser,
while Railway talks directly to Supabase.

## Architecture and immutable rules

Primary flow:

```text
raw dealer message/media
-> immutable source evidence
-> deterministic candidate segmentation
-> shadow normalization proposal
-> catalog confirmation and policy decision
-> human review where required
-> audited promotion transaction
-> approved Price Research / Trading Floor records
```

Non-negotiable rules:

1. Preserve the untouched raw message and source lineage.
2. Do not overwrite source evidence with normalized or image-derived guesses.
3. Do not restart the full archive to fix a bounded class of errors.
4. Use a new checkpointed enrichment/remediation pass for targeted corrections.
5. Never treat shadow proposals as approved production records.
6. Multi-watch posts must remain linked to the source while producing separate
   candidates only after safe splitting.
7. A bare `$` does not prove USD.
8. Catalog evidence can confirm identity but cannot silently override conflicting
   source evidence.
9. Every production mutation needs previous values, new values, reason, operator,
   policy/parser version, timestamp, and rollback path.
10. Keep production, preview/staging, migration, storage, and local credentials
    separate and least-privilege.

## Normalization completion and pending queues

Job name: `normalization-v4-dial-production`

Verified live status:

| Metric | Count |
| --- | ---: |
| Rows analyzed | 2,631,468 |
| Changed/pending shadow proposals | 2,000,805 |
| Multi-item bundles requiring splitting | 757,433 |
| No deterministic candidate | 324,251 |
| Reference changes | 391,730 |
| Intent changes | 45,746 |
| Price changes | 420,387 |
| Brand changes | 224,873 |
| Currency changes | 261,767 |
| Currency ambiguous | 4,382 |
| Price parse failed | 1,052 |

These flags overlap. Do not add the flag counts to estimate unique records.
The scan is complete, but promotion is deliberately incomplete.

Read-only status endpoint:

```text
https://watchfacts-poc.vercel.app/api/shadow-status?job=normalization-v4-dial-production
```

Do not reset the checkpoint, rename the completed job, or run the whole scan again.

## Review and promotion state

`GET /api/shadow-review-queue` is a bounded, read-only review endpoint. The promotion
policy blocks bundles, missing candidates, ambiguous currency, failed prices, and
ambiguous dials. Catalog confirmation is required before a proposal can become
`READY_FOR_HUMAN_APPROVAL`.

A previous 100-row read-only sample found:

| Change reason | Ready for human approval | Human review |
| --- | ---: | ---: |
| Intent changed | 41 | 59 |
| Currency changed | 43 | 57 |
| Price changed | 29 | 71 |
| Reference changed | 0 | 100 |
| Brand changed | 0 | 100 |

This sample is directional, not a permanent batch identifier. Re-query before acting.
The safest first canary remains a small set of catalog-confirmed intent changes.

Before any live promotion:

1. Verify the review-decision migration exists in production.
2. Re-query the candidate set and inspect raw evidence.
3. Approve a small canary only.
4. Write an immutable review/audit decision.
5. Apply one transaction per source record.
6. Compare Admin, Trading Floor, and Price Research before/after metrics.
7. Verify rollback using stored prior values.
8. Stop on unexpected category, price, currency, or volume movement.

There is no authorization in this handoff to bulk-promote 2,000,805 proposals.

## Price Research status

Deployed behavior:

- Direct reference search and catalog brand/model browsing.
- 23 catalog brands, 553 model labels, and 7,219 catalog references.
- Full dial table, prices, and chart for the bounded market sample.
- Clickable listing details including source data and the untouched raw message.
- Outliers remain visible with exclusion reasons.
- Explicit HKD repair for analytics on the exact reference line.
- Reference searches aggregate historical casing variants.
- Dial labels differing only by capitalization are combined.

Live regression check after PR #7:

```text
116500LN -> 5,000 sampled listings, 1 dial group
116500ln -> resolves to 116500LN, 5,000 sampled listings, 1 dial group
```

The 5,000 value is a bounded sample cap, not an exact lifetime total. Do not label it
as an exact total until a safe indexed count/aggregate is implemented.

Dial grouping policy:

- `Ice Blue` and `Ice blue` are the same group.
- `Blue`, `Blue Roman`, and `Blue Diamond` remain distinct configurations even when
  they share the same base-color swatch.

Remaining Price Research work:

- Expand model/reference coverage beyond the current catalog.
- Create an unmatched-reference queue instead of displaying `Unknown Model` as truth.
- Add duplicate/repost clustering before volume/liquidity claims.
- Add catalog-relative plausibility bands and configuration-aware cohorts.
- Improve listing-date coverage.
- Replace sample-capped totals with explicit `sampled` wording or indexed aggregates.

## Currency detection and USD conversion

Current deterministic aliases include HKD, HK$, dotted H.K.D., Chinese Hong Kong
dollar labels, USD/US$/U$, USDT, EUR, GBP, CHF, SGD, and CNY/RMB. Multipliers include
`k`, `m`, `mn`, `w`, and the Chinese ten-thousand multiplier.

Current fixed conversion table is in
`tools/shadow-reprocess/shadow-reprocess.cjs`. HKD uses `1 / 7.8`; USDT is treated
as USD. Price Research can prefer an explicit USD/USDT equivalent on the exact
reference line; otherwise explicit HKD is divided by 7.8 for analytics.

Known gaps:

- The typo `HDK` is not recognized.
- FX rates are hard-coded and do not carry source/effective-date lineage.
- USDT parity is assumed.
- Section-inherited currency needs reviewer visibility.
- Stored price/currency may disagree with raw-message evidence.

Required Currency Audit UI/queue:

```text
raw message
-> matched price text
-> original amount
-> detected currency and evidence level
-> multiplier
-> FX rate, source, and effective date
-> calculated USD
-> stored USD
-> variance
-> review status and decision
```

Minimum filters: unknown/HDK spelling, bare dollar, multiple currencies, explicit
dual-currency disagreement, section-inherited currency, stored/recalculated variance,
extreme conversion, and price-parse failure.

Treat `HDK` as possible HKD only with supporting Hong Kong/message/dealer context;
otherwise route it to review. Implement this as a targeted shadow remediation pass,
not a full normalization rerun.

## Trading Floor and listing categories

The UI/API support WTS, WTB, NTQ, TRADE, MULTI, and OTHER filters. Production currently
has meaningful WTS and WTB populations. Exact production checks previously found zero
NTQ, TRADE, MULTI, and OTHER rows, so those views are not complete merely because the
filters exist.

Required targeted work:

1. Classify intent changes for WTB, NTQ, and TRADE with deterministic evidence.
2. Create a separately checkpointed multi-item classifier/splitter.
3. Create a separately checkpointed non-watch luxury classifier.
4. Keep unsplit multi-item and non-watch evidence visible without pretending it is a
   normalized single watch.
5. Validate category counts and representative raw messages in Admin before release.

Do not equate `NO_CANDIDATE` with non-watch luxury; it includes unresolved watch data.

## Images and media

Image reconciliation is not complete. The system has storage configuration and image
analysis endpoints, but a complete source-message-to-object-to-candidate manifest has
not been verified.

Required manifest fields are documented in `docs/IMAGE_RECONCILIATION.md`. The safe
workflow is:

```text
source message attachment
-> immutable object manifest with checksum
-> candidate association proposal
-> image/text agreement or conflict evidence
-> reviewed association
```

Do not claim 99% image matching until a labeled validation set measures precision,
recall, coverage, and ambiguous/collage handling. Image evidence confirms or flags;
it does not overwrite the raw listing.

## Dealer authentication and Admin

Current beta behavior:

- Supabase email/password accounts.
- HttpOnly, Secure, SameSite=Lax cookies.
- Dealer, reviewer, and admin roles from trusted `app_metadata`.
- Beta skip is limited to dealer portal, Price Search, and Trading Floor.
- Admin/review operations require authentication and role checks.
- `/api/admin-stats` returns 401 without an authenticated session; that is expected.
- Admin statistics are live rather than the old `parsedWatches.json` mock.

Before removing beta status:

1. Set `VITE_ENABLE_DEALER_SKIP=false` and redeploy.
2. Require MFA for reviewer/admin roles.
3. Complete privileged API authorization inventory.
4. Add password reset and account suspension workflows.
5. Add WAF/rate limits for authentication.
6. Verify append-only security logging and quarterly access review.

## P0 security actions

1. `git ls-files '.env*'` currently confirms `.env.prod`, `.env.production`, and
   `.env.vercel` are tracked even though `.gitignore` prohibits them.
2. Those files contain set Vercel OIDC token values. Treat them as exposed.
3. Storage credentials were previously shared in a Codex conversation, and the same
   credential appeared to be used for production and staging. Treat it as exposed.
4. Older repository documentation also reports hardcoded MySQL credentials in scripts.

Required response:

1. Inventory which services still use every exposed credential.
2. Create distinct least-privilege production and staging credentials.
3. Rotate/revoke DigitalOcean, Vercel/OIDC, database, Railway, Supabase, and other
   exposed/legacy credentials as applicable.
4. Update service environment variables directly in the owning platform.
5. Verify production and staging independently.
6. Remove tracked environment files in a dedicated security PR.
7. Run a repository/history secret scan and decide whether history rewrite is required.
8. Never copy old credential values to the new computer.

Removing files from the latest commit does not revoke secrets already present in Git
history. Rotation is mandatory.

## Domain cutover

The custom domain can move without affecting completed normalization or pending shadow
data. Before changing DNS:

1. Finish authenticated desktop/mobile smoke tests on the deployed production build.
2. Add the intended apex and `www` domains to the correct Vercel project.
3. Preserve Microsoft 365 MX/SPF/DMARC, DKIM, Twilio, and other non-web records.
4. Change only apex/`www` web records; do not replace nameservers casually.
5. Verify SSL, login, Price Research, Trading Floor, Admin authorization, and logout.
6. Keep the previous web target available during an observation window.

Confirm the current authoritative DNS provider before acting. The 2026-07-14 audit
reported DigitalOcean nameservers rather than GoDaddy.

## New-computer bootstrap

Prerequisites: Git, Node.js/npm, GitHub CLI, and access to the relevant Vercel,
Railway, Supabase, DigitalOcean, and DNS accounts. Do not export browser cookies or
copy `.env*` files from the old machine.

```powershell
gh auth login
gh repo clone Pablodd1/wf
Set-Location wf
git switch main
git pull --ff-only origin main
npm install
npm run test:normalization
npm run build
```

Then read, in order:

1. `AGENTS.md`
2. `docs/CTO_HANDOFF_2026-07-16.md`
3. `docs/SHADOW_PROMOTION_POLICY.md`
4. `docs/CURRENCY_RULES.md`
5. `docs/DEALER_AUTH_SECURITY.md`
6. `docs/DOMAIN_CUTOVER_AND_DATA_CONTINUITY.md`
7. `docs/IMAGE_RECONCILIATION.md`

Restore environment variables through the platform dashboards or an approved secret
manager. Required names vary by component; inspect code and platform configuration.
Typical server-only names include `SUPABASE_URL`, a Supabase server/service key,
normalization job settings, review/operator credentials, media-storage credentials,
and external AI/API keys. Never prefix a secret with `VITE_`.

## Development and release workflow

1. Start from updated `main` with a clean working tree.
2. Create `codex/<short-description>`.
3. Keep one coherent risk area per PR.
4. Preserve unrelated user changes.
5. Add regression tests for every parser/data-quality defect.
6. Run:

```powershell
npm run test:normalization
npm run build
git diff --check
```

7. `npm run lint` has historical repository-wide failures. Run targeted lint for
   changed files, record pre-existing errors separately, and do not claim full lint is
   clean until the backlog is fixed.
8. Commit, push, and open a draft PR.
9. Wait for Vercel previews/checks.
10. Review preview UI and API behavior with representative raw records.
11. Merge only after evidence and rollback implications are understood.
12. Verify the production deployment and live endpoints after merge.

Do not push directly to `main`. Do not run production migrations from Vercel request
handlers. Apply additive migrations through the controlled Supabase workflow.

## Deployment and operational checks

Vercel:

- Build command: `npm run build`
- Output directory: `dist`
- API functions live under `api/`
- Confirm both configured Vercel projects point to the intended repository/branch.

Railway normalization worker:

- Start command: `node tools/shadow-reprocess/railway-worker.cjs`
- One replica only.
- Do not expose a public worker domain.
- Preserve the completed job/checkpoint; targeted remediation gets a new job name.

Read-only checks:

```powershell
gh pr list --repo Pablodd1/wf --state open
gh run list --repo Pablodd1/wf --limit 10
Invoke-RestMethod 'https://watchfacts-poc.vercel.app/api/shadow-status?job=normalization-v4-dial-production'
Invoke-RestMethod 'https://watchfacts-poc.vercel.app/api/catalog-brands'
```

Production UI smoke checklist:

- Landing/navigation display `Curated Luxury`.
- Dealer login, beta skip boundaries, and logout behave correctly.
- Price Search returns identical results for uppercase/lowercase references.
- Model browse lists all catalog brands/models/references.
- Dial capitalization duplicates are merged; meaningful configurations remain distinct.
- Listing detail shows source information and untouched raw message.
- Outliers show raw source evidence and exclusion reason.
- Trading Floor exact-reference search and pagination work.
- Admin is unauthorized when signed out and live when signed in with the correct role.
- Mobile search input does not lose focus or jump while typing.

## Ordered next work

1. **P0 security:** rotate exposed credentials; remove tracked env files; secret scan.
2. **Post-merge QA:** complete the smoke checklist for PR #7 on production.
3. **Currency Audit:** implement evidence/rate/variance queue and `HDK` review handling.
4. **Promotion canary:** re-query and review a small catalog-confirmed intent batch.
5. **Admin verification:** show accurate category counts and raw-message drill-down.
6. **Trading Floor categories:** targeted NTQ/TRADE/MULTI/OTHER enrichment passes.
7. **Catalog coverage:** unmatched-reference/model queue and controlled catalog additions.
8. **Images:** media manifest, checksum verification, labeled matching evaluation.
9. **Analytics quality:** duplicate/repost suppression and configuration-aware price bands.
10. **Auth hardening:** disable beta skip only after accounts/MFA/recovery are ready.
11. **Domain cutover:** perform after production QA, without changing data infrastructure.

## Recommended opening prompt for a new Codex task

```text
Continue the Curated Luxury / WatchFacts CTO rollout in Pablodd1/wf.

First read AGENTS.md and docs/CTO_HANDOFF_2026-07-16.md completely. Treat the
repository, migrations, tests, and that handoff as authoritative; older handoffs are
historical. Do not ask me to paste the old conversation and do not copy credentials
from another computer or prompt.

Begin with read-only verification of main, open PRs/checks, Vercel production, the
normalization status endpoint, and the catalog endpoint. Report discrepancies before
making changes. Preserve raw evidence, do not rerun the completed normalization job,
do not bulk-promote shadow proposals, and do not mutate production data without an
audited canary and rollback path.

The first priorities are: (1) exposed-credential rotation/tracked-env remediation,
(2) PR #7 production smoke testing, (3) Currency Audit design/implementation, and
(4) a re-queried catalog-confirmed intent canary. Use small branches and draft PRs.
Always report files changed, tests, deployment status, data impact, and remaining risk.
```

## Supporting documents

- `docs/CTO_HANDOFF_2026-07-14.md`: historical normalization/Price Search handoff.
- `docs/SHADOW_PROMOTION_POLICY.md`: review gates and audit requirements.
- `docs/NORMALIZATION_CONTRACT.md`: normalized data contract.
- `docs/CURRENCY_RULES.md`: required currency evidence hierarchy.
- `docs/RAILWAY_NORMALIZATION_WORKER.md`: worker configuration and safety.
- `docs/DEALER_AUTH_SECURITY.md`: beta and production auth requirements.
- `docs/DOMAIN_CUTOVER_AND_DATA_CONTINUITY.md`: DNS/data separation.
- `docs/IMAGE_RECONCILIATION.md`: media lineage requirements.
- `docs/CATALOG_RECONCILIATION.md`: catalog strategy.
- `docs/DEPLOYMENT_RUNBOOK.md`: release principles.

Where an older document conflicts with this dated handoff, verify the live system and
update the documentation rather than assuming the older count or status is current.
