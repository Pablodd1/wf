# CTO rollout status - 2026-07-20

## Completed in this rollout

1. Applied the repository security-hardening migration to production. Optional
   objects that do not exist in the live schema are now skipped safely.
2. Added and applied database-backed quotas for the public paid-AI routes.
   Anonymous and authenticated roles cannot call the quota RPC; service role can.
3. Rechecked the 13 blocked Patek/Rolex dial-review rows. All 12 live Rolex
   `116500LN` rows are already White. The live Rolex `52506` row is already Ice
   Blue. Stale shadow proposals remain isolated from customer data and must not
   overwrite those correct live values.
4. Stopped the completed Railway cursor worker. It was processing zero rows and
   polling Supabase about every five seconds.
5. Ran the requested 200-image exact-lineage pilot. Six records passed every
   source identity and brand/reference gate and were linked. No lower-confidence
   records were published.

## Image pilot evidence

| Metric | Result |
| --- | ---: |
| Raw image filenames | 16,989 |
| Spaces CSV rows scanned | 1,821,738 |
| Filename lineage matches inspected | 1,000 |
| Customer-safe exact matches | 6 |
| Linked | 6 |
| Guessed or force-linked | 0 |

## Current production safeguards

- Raw messages remain preserved.
- WTB observations stay out of asking-price analytics.
- Bundle parents remain visible until reviewed child sets reconcile.
- Images require exact source identity plus brand/reference agreement.
- Paid-AI routes use shared database-backed quotas keyed by a one-way client hash.
- The completed Railway cursor worker is scaled to zero.

## Next inputs and gates

1. Receive the local path to the manually unbundled UTF-8 CSV parts and run the
   1,000-row lineage/intake audit before any staging import.
2. Receive the legacy `auctions` export keyed by `id`, including `front_image`,
   original posting date, seller identity/contact, company, and raw text.
3. Reconcile the 194 unfilled image targets through `auctions.front_image`; keep
   image work after listing lineage and duplicate review.
4. Resolve the 315 blocked children in the existing 25-parent canary before any
   parent is suppressed.
5. Reconcile the production migration ledger and configure protected GitHub
   migration secrets before enabling automatic production migrations.
6. Schedule analytics refresh and database maintenance away from customer traffic.

## Environment status

A random server-only `AI_RATE_LIMIT_SECRET` is configured in Vercel Production
and Preview. The client address itself is never stored.

## Follow-up branch ready for review

Branch: `codex/batch-002-full-normalization`

The branch was rebased onto current `main` on 2026-07-20. It contains the
post-PR-53 client-facing safeguards and workflows below. No production data was
modified by these commits.

1. Numeric watch references remain searchable; an exact numeric
   reference/price collision is withheld as `REFERENCE_TOKEN_AS_PRICE`.
2. Trading Floor uses cursor pagination: 24 records per mobile request and 48
   per desktop request, with bounded in-browser accumulation and an explicit
   `Load more` action.
3. Trading Floor discovery separates category, WTS/WTB intent, condition, and
   location. WTB does not require an asking price and is excluded from price
   averages.
4. The currency converter is display-only and uses dated ECB exchange-rate
   evidence. It cannot mutate normalized source or USD prices.
5. Standard numeric keycap/full-width emoji prices are parsed
   deterministically. Private pictographic price codes are never guessed and
   receive `EMOJI_PRICE_AMBIGUOUS` for human review.
6. Authenticated dealers can submit WTS and WTB records into a moderated
   `PENDING_REVIEW` queue. Submissions never write directly to public listings.
7. Three-month forecasts are generated only for exact reference + dial +
   condition cohorts meeting sample, recency, dealer-diversity, and rolling
   backtest gates. Public values remain disabled unless
   `ENABLE_PRICE_FORECASTS=true` is deliberately set after owner QA.
8. The authenticated account workspace includes profile, verified activity,
   moderated submissions, display settings, billing status, and support
   tickets. Billing is explicitly inactive during beta.
9. Lightweight Tools, Apps, Community, and Company pages now provide public
   navigation without claiming unreleased apps or commercial plans.

## Verification completed

- Production build passes after rebase.
- 127 normalization tests pass.
- 20 security tests pass.
- Touched frontend files pass ESLint.
- Phone QA at 390 x 844 found no document-level horizontal overflow on Trading
  Floor or Price Research. The Price Research heading contrast issue found in
  screenshot review was corrected on the branch.
- Bundle rows, ambiguous currency/emoji prices, and reference-shaped prices
  remain excluded from automatic publication or price analytics.

## Current deployment gate

Draft PR #55 is open at
`https://github.com/Pablodd1/wf/pull/55`. Supabase created Preview project
`dtghoeidkfjhdybeodiq`; database, services, APIs, configuration, migrations,
seeding, and edge-function checks passed. Both Vercel projects built.

The `wf` Vercel Preview is database-backed. Two cursor pages were checked for
each intent:

- WTS: 24 + 24 records, no repeated IDs, all rows WTS, estimated total
  1,368,619.
- WTB: 24 + 24 records, no repeated IDs, all rows WTB/NTQ-compatible buyer
  intent, estimated total 183,305.
- Requests used the server key and returned a next cursor with `hasMore=true`.

The `watchfacts-poc` Vercel Preview still returns `supabase_not_configured`.
This is an environment-integration difference between the two Vercel projects,
not a database migration failure. Production merge remains blocked until the
client-facing Vercel project is confirmed to receive its production variables.

Unauthenticated Preview requests to `/api/dealer-workspace` and
`/api/dealer-submissions` return `unauthenticated`. This proves that beta skip
cannot read or write dealer account data. A deliberately linked Preview dealer
is still required to prove positive profile/ticket isolation without changing
production identity data.

Owner-reference Preview QA:

- Patek 5712/1A Blue: 523 outlier-clean all-condition observations; 122 unknown
  dial rows remain excluded from exact dial analytics.
- Patek 5712/1R Black: 10 outlier-clean all-condition observations.
- Patek 3712/1A Blue: 8 outlier-clean all-condition observations.
- Rolex 116500LN: 904 White and 355 Black outlier-clean observations.
- Rolex 52506 Blue: 216 outlier-clean observations; displayed range remains
  $34,000-$62,500, so the historical $244 evidence stays excluded.

Forecasts remain correctly withheld. Exact condition cohorts fail one or more
of: 12 monthly periods, five linked verified dealers, and evidence newer than
three months. `ENABLE_PRICE_FORECASTS` must remain disabled.

The deeper Patek 5712/1A New cohort check found a $20,152 observation that the
old 10%-of-median plausibility floor allowed. The shared floor is now 25% of the
interpolated cohort median, before IQR. Raw rows remain immutable and excluded
evidence stays auditable. Customer Trading Floor responses also withhold
sub-$1,000 reference prices (for example a live Rolex row at $132) as
`PRICE_BELOW_PLAUSIBILITY_FLOOR` instead of presenting them as valid asks.

Still required before merge:

1. Confirm `watchfacts-poc` Production retains the required Supabase variables;
   its PR Preview is not database-configured even though `wf` Preview is.
2. Verify a linked Preview dealer can edit only its own profile, see its own listings,
   and create a support ticket. Beta skip must not permit these writes.
3. Keep forecasts disabled until the five John references and a stratified
   50-reference backtest report are approved.
4. Re-test Patek 5712/1A New and the sub-$1,000 Trading Floor row after the
   latest safety commit deploys, confirming both are visibly excluded/withheld.

## Deliberately deferred

- The repository-wide ESLint baseline still contains 155 pre-existing issues
  in legacy components. The new/touched files pass targeted lint; broad cleanup
  remains a separate performance/debt task.
- Seller attribution for batch 002 remains blocked by missing source envelope
  fields for most parent rows. No seller name, phone, dealer identity, or region
  may be inferred.
- Image linkage remains after exact listing/source/dealer lineage. Six exact
  pilot links are proven; lower-confidence media must not be published.
- The 54,170 staged unbundled children remain pending review. Review-ready does
  not mean customer-approved, and bundle parents must not be suppressed until
  their child sets reconcile.

## Product review saved

Alex's July 20 product feedback, the referenced luxury storefront review,
mobile-first discovery decisions, forecast release gates, currency/emoji rules,
WTB/posting workflow, dealer directory requirements, and account-page backlog
are preserved in `docs/ALEX_PRODUCT_REVIEW_AND_FORECAST_PLAN_2026-07-20.md`.
That document is discussion-ready and does not authorize production-data writes
or forecast release.

## Seller-to-child reconciliation completed locally

The exact seller manifest was joined to the full 54,170-row staged-child set in
a private, ignored audit artifact. It recovered original source date and observed
seller evidence for 2,781 children across 1,217 parents. The cohort contains
1,495 WTS and 1,286 WTB children with zero child/parent intent conflicts.

The same scan identified 345 strong seller-aware repost candidate clusters
covering 899 rows. Every cluster spans multiple source timestamps, so these are
review candidates rather than automatic deletions. No production writes, dealer
assignments, contact publication, image publication, approval, or parent
suppression occurred. See
`docs/SELLER_CHILD_LINEAGE_RECONCILIATION_2026-07-20.md`.

## Seller-child staging gate prepared

The branch now includes additive migration
`20260721120000_seller_child_lineage_staging.sql` and a dry-run-first staging
tool. The table is private to `service_role`, has no public read/write policy,
requires an exact parent-lineage foreign key, and uses database checks to block
public contact and unverified child-image publication. It does not update
`watch_records`, approve children, or suppress parent listings.

A fresh deterministic run reproduced the earlier reconciliation exactly and
generated two local reviewer CSV files. Both contain 345 clusters, blank human
decision fields, pseudonymous seller identities, and no raw phone values. The
100-row child staging canary completed with `write=false`, `persisted=0`, and
zero public or production mutations.

Current verification is 131 normalization tests, 20 security tests, 11 focused
seller-child tests, targeted ESLint, and a successful production build.

The current Vercel branch Preview is deployed but protected by Vercel
Authentication. Direct terminal requests to Price Research and Trading Floor
redirect to `vercel.com/login`, so runtime data behavior must be checked in an
authenticated Preview browser. This is not evidence of an API failure. Do not
apply the child manifest to production until the Supabase Preview migration is
green and an authenticated read-only regression confirms existing WTS, WTB,
Price Research, and dealer-workspace behavior.

## Forecast readiness audited live

The five John cohorts and a 50-reference stratified cohort were audited through
the live Price Research read API. None qualified for release: all 47 successful
stratified/owner responses lacked the required monthly history, verified dealer
diversity, and recent dated evidence; 44 also lacked 30 clean offers. Eight
requests produced operational holds (five database statement timeouts, one
client timeout, and two cohorts without a New/Used condition). Forecasts remain
disabled. See `docs/FORECAST_READINESS_AUDIT_2026-07-20.md`.
