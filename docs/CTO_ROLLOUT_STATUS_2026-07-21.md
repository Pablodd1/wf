# CTO rollout status

**Date:** July 21, 2026  
**Scope:** customer marketplace rollout, worker lifecycle, seller lineage, currency, emoji-price safety, taxonomy, and forecast gates

## Executive status

The customer marketplace is live. The All inventory and Want to Buy deep links
now load bounded customer-safe rows directly from Supabase. The completed
normalization cursor is no longer polled indefinitely by Railway. No public
forecast has been released, no uncertain seller identity has been presented as
a verified dealer, and no private contact evidence has been exposed.

## Verified production behavior

| Gate | Evidence | Decision |
| --- | --- | --- |
| Trading Floor all inventory | Approximately 1,551,923 customer-visible rows after excluding legacy non-market types | Accepted as a planner estimate, not an exact billing count |
| Want to Buy | Approximately 183,305 rows; direct production API and deep link both return 48 records with buyer-request actions | Accepted |
| Cursor pagination | 20 pages, 960 unique IDs, zero repeated IDs, advancing cursor on every page | Accepted |
| Initial deep-link load | PR #62 prevents the mount debounce from clearing the first response | Merged after Preview canary |
| Vercel | `watchfacts-poc` and `wf` production deployments succeeded for merge `cef57d5` | Accepted |
| Railway normalization worker | Final log emitted `lease_complete` and `worker_complete`; service status is `Completed` | Stop polling; restart only for a new approved bounded job |
| Currency converter | Production `/api/fx-rates` returns HTTP 200, eight currencies, ECB reference date 2026-07-20, and USD/HKD 7.840626640994223 | Accepted as display-only conversion |

## Seller and source-date lineage

The private seller export and exact raw-message reconciliation produced:

| Metric | Count |
| --- | ---: |
| Seller export rows scanned | 1,293,376 |
| Exact parent matches ready for private staging | 5,350 |
| Mixed or conflicting parent intent rows blocked | 98 |
| Unmatched parents | 44,552 |
| Staged children with exact seller/date evidence | 2,781 |
| Matched WTS children | 1,495 |
| Matched WTB children | 1,286 |
| Seller-aware repost review clusters | 345 |

The 98 blocked rows include mixed WTS/WTB source messages. They must remain
blocked until line segmentation identifies the intent of each child. They must
not contribute to public dealer activity totals.

### Production staging status

The additive private tables `seller_listing_lineage_staging` and
`seller_child_lineage_staging` are now present in the target Supabase project.
The controlled migration run [29873517110](https://github.com/Pablodd1/wf/actions/runs/29873517110)
verified both tables, RLS, and privilege boundaries. No lineage rows were
written during that schema rollout.

Required action:

1. Run the read-only migration-ledger check and reconcile the manually applied
   migration timestamps before enabling automatic migration pushes.
2. The 100-parent private canary is now staged and fully reconciled: 100/100
   matched, with zero unmatched, conflicting, orphaned, or field-mismatch rows.
3. Owner-review the canary evidence, then stage the 5,350 exact parent matches
   only after explicit approval.
4. Stage child lineage only after its parent rows exist and the child review
   gates pass.
5. Do not assign `dealer_id` or publish contact until an approved directory
   identity and contact consent are proven.

## Emoji-price status

Normalization v4 already decodes standard Unicode keycap digits and full-width
digits while preserving the exact raw price token. An unresolved pictographic
dealer code receives `EMOJI_PRICE_AMBIGUOUS` and is blocked from automatic
promotion. No AI model is allowed to guess the digit, multiplier, currency, or
price represented by a private emoji.

Remaining evidence requirement: add Alex's original raw message examples as
regression fixtures. Screenshots alone are insufficient when the exact Unicode
sequence is unknown.

## Non-watch taxonomy status

Production currently has eight `OTHER` records. All eight come from the
`jewelry_archive` media pilot, have an image, and lack normalized brand and
reference fields. This is enough to label the source cohort as jewelry archive
evidence, but not enough to claim a complete Handbags, Jewelry, Accessories,
and Other marketplace taxonomy.

Required action:

1. Add independent `category` and `intent` fields to the normalized listing
   contract.
2. Classify only from source evidence; leave unresolved values null/review.
3. Add category-specific required fields and filters after the migration has a
   reviewed canary.
4. Do not infer category from an image alone.

## Three-month forecast decision

Keep `ENABLE_PRICE_FORECASTS=false`. The latest read-only audit requested five
recurring John cohorts plus 50 stratified reference cohorts. Zero cohorts were
forecast-ready and zero were release candidates. Current blockers are dated
monthly history, verified seller diversity, recency, sample size for many
cohorts, and measured rolling-backtest performance.

The customer UI may show a forecast-readiness state. It may not show an
expected future price, confidence interval, or directional claim until the
exact reference + dial + condition cohort passes every gate and owner review.

## Product decisions saved

- Use separate pages for Discover, Want to Buy, Price Research, Post, Account,
  Dealer Profile, Settings, Help, and later Billing/Pricing.
- Use explicit `Load more` cursor pagination. Mobile requests 24 rows and
  desktop requests 48; do not use unbounded infinite scroll.
- Mobile discovery uses a sticky search/filter entry and a full-height filter
  sheet. Filters execute in Postgres.
- The currency converter is display-only and never changes stored prices.
- Public browsing remains open. Posting and account changes require auth.
- Billing/Pricing remains hidden until plans, entitlements, taxes, refunds, and
  the payment provider are approved.

## Next safe work order

1. Reconcile the production migration ledger through the read-only workflow.
2. Owner-review the completed 100-parent canary, then stage the approved
   5,350-row cohort privately.
3. Review the 345 seller-aware repost clusters; do not delete source evidence.
4. Add Alex's exact emoji-price messages to regression tests.
5. Design and canary the independent luxury-category migration.
6. Materialize dated, seller-aware comparable cohorts before rerunning
   forecast readiness.
7. Resume image-to-child lineage only after parent/child and seller lineage are
   proven.

## 2026-07-21 continuation checkpoint

### Pushed access fix

Branch `codex/human-review-lineage-panel` contains commit
`0863607 Fix protected dealer login routing`.

Root cause found: `DealerLogin` redirected an already-signed-in user back to a
requested protected route before checking whether the user's role could access
that route. A dealer or unprovisioned account could bounce between login and
Human Review/Admin without a clear reason.

Fix: protected route role checks now run before redirect. Review Queue requires
`reviewer` or `admin`; Dashboard/Admin/Multi Listings require `admin`. When the
current role is insufficient, the login page stays put and explains the role
required instead of looping.

Validation:

- `node --test tests/security-boundaries.test.cjs tests/dealer-workspace.test.cjs`
- `npx eslint src/pages/DealerLogin.tsx tests/security-boundaries.test.cjs`
- `npm run build`

### John reference dial review

Read-only Railway run:

`railway run node tools/shadow-reprocess/review-target-dials.cjs`

No production writes were applied (`apply=false`).

Result:

- `Rolex 116500LN`: 12 target rows reviewed, all blocked.
- `Rolex 52506`: 1 target row reviewed, blocked.
- `Patek Philippe 5712/1A`, `5712/1R`, and `3712/1A`: no rows were applied by
  this script because the approval policy only accepts already-staged pending
  rows that pass every catalog and ambiguity gate.

Important finding: `116500LN Panda` is repeatedly present in raw text, but it is
blocked because final catalog dial values must remain `White` or `Black`. Do
not auto-promote `Panda` as a final dial. Treat it as a raw/dealer alias that
needs a deterministic alias policy and human-reviewed mapping to catalog
`White` when the source clearly means the white panda Daytona.

### Reference unknown-dial exposure

Read-only targeted audits:

- `Patek Philippe 5712/1A`: 80 unknown/empty dial rows sampled; 5 catalog-backed
  `Blue` proposals; 75 bundle/multilisting rows blocked.
- `Patek Philippe 5712/1R`: 299 rows sampled; 153 catalog-backed `Black`
  proposals; 139 bundle rows blocked; remaining rows had no dial evidence.
- `Patek Philippe 3712/1A`: 81 rows sampled; 25 catalog-backed `Blue`
  proposals; 56 bundle rows blocked.
- `Rolex 116500LN`: 15 rows sampled; 3 explicit raw-text proposals, 3 ambiguous
  multi-dial catalog rows, 1 bundle row, 9 unresolved/no-evidence rows.
- `Rolex 52506`: 0 unknown-dial rows sampled by the narrow reference audit.

Recommendation: create a reviewed dial-alias policy before applying these
corrections. Catalog single-dial Patek rows are safer than Rolex `Panda` rows,
but bundle rows must stay blocked until split.

### Price-normalization audit

Read-only Railway run scanned 5,000 priced `watch_records` rows:

`audit-output/price-normalization/rollout-20260721-mismatches.json`

Result:

- 843 mismatch rows found.
- 755 high-severity mismatches.
- 755 rows were explicit HKD reference-line corrections.
- 88 rows were explicit USD reference-line corrections.
- 142 canary-eligible rows.
- 624 rows excluded from canary because they are bundle or multilisting context.
- 20 rows excluded because normalized price is below the luxury floor.

This confirms the HKD issue is still material and should be handled by bounded
canaries, not broad update batches. Most rejected candidates are being rejected
for the right reason: the raw context is bundle/multilisting and must be split
before price correction.

### Updated next work order

1. Open/merge the protected-login fix after preview verification.
2. Review the 142 price canary candidates and apply only those with exact
   single-listing raw evidence.
3. Create the `Panda` alias decision for `116500LN`: raw alias allowed,
   catalog dial remains `White` when evidence is explicit.
4. Apply safer catalog single-dial Patek corrections only after shadow-review
   rows are staged and sampled.
5. Keep bundle/multilisting parents out of price correction until the child
   rows are split, lineage-linked, and seller/date preserved.
6. Continue seller-lineage staging before any image lineage expansion.

