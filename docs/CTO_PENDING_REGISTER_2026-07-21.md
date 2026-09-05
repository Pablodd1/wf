# Curated Luxury CTO Pending Register

**Date:** July 21, 2026  
**Purpose:** Durable execution register for the Alex review, current rollout, mobile acceptance, and data-trust dependencies.  
**Safety:** This document authorizes no production-data write and no forecast release.

## Executive decisions

1. Keep separate pages for Home, Discover, Want to Buy, Price Research, Post, and Account.
2. Use server-side cursor pagination with an explicit `Load more` action. Do not use opaque infinite scroll or thousands of numbered pages.
3. Treat mobile as the primary marketplace viewport. Use 24 rows per mobile request and 48 per desktop request.
4. Keep the currency converter display-only. It must never overwrite the raw price, original currency, historical FX evidence, or normalized USD value.
5. Decode only deterministic numeric emoji forms. Unknown dealer pictographs remain blocked until copied raw examples create a reviewed codebook.
6. Keep WTB demand separate from WTS asking-price analytics, outliers, ratings, and forecasts.
7. Keep three-month forecasts disabled until exact cohorts pass history, recency, sample, dealer-diversity, and backtest gates.
8. Never publish seller identity or contact details until exact lineage, verified dealer mapping, and contact consent are all proven.

## Current delivery state

### PR #66 - source-backed luxury categories

- State: ready for review, mergeable, not merged.
- Vercel checks: both successful on head `1182706`.
- Preview evidence: 8 Jewelry archive records, 0 evidenced Handbag records, 0 evidenced Accessory records.
- Existing watch WTS and WTB totals remain unchanged.
- Non-watch intent controls are disabled because the archive does not yet contain an independent trustworthy WTS/WTB field.
- Mobile selected-listing behavior was corrected so details replace the featured rail instead of appearing below it.
- Cursor endurance: 20 WTS pages, 480 unique rows, zero duplicate IDs, valid next cursor on every page.
- Safe rollout condition: owner accepts empty source-backed categories and confirms no fabricated relabeling is desired.

### PR #65 - emoji-price audit

- State: draft, mergeable, not merged.
- Exact materialized `EMOJI_PRICE_AMBIGUOUS` count: 0.
- Bounded current-parser scans: first 25,000 rows produced 0 ambiguous pictographic prices.
- This is not proof that the full historical archive is clean.
- Required evidence: Alex supplies copied raw messages in addition to screenshots.
- Safe rollout condition: regression fixtures prove each deterministic form; private pictograph meanings remain review-only.

### PR #67 - forecast readiness evidence

- State: draft, mergeable, not merged.
- Audited: 5 recurring John cohorts plus 50 stratified references.
- Successful cohort requests: 53.
- Forecast-ready cohorts: 0.
- Release candidates: 0.
- Decision: keep `ENABLE_PRICE_FORECASTS=false`.

## Point-by-point Alex plan

### 1. Three-month Price Research projection

The existing data can support projections only for exact comparable cohorts with adequate dated history and verified seller diversity. The current live audit found no release-ready cohorts. Every reference may show a readiness checklist, but it must show `Insufficient evidence` instead of a numeric forecast when a gate fails.

Eligible grain:

`brand + canonical reference + dial/configuration + condition + WTS + outlier-clean USD asking price`

Minimum public-release gates:

- 12 distinct observed months;
- 30 unique clean WTS offers;
- 5 linked verified sellers/dealers;
- recent evidence within 60 days;
- at least 6 months with 3 or more observations;
- rolling three-month backtest beats a naive last-known median baseline.

The Wrist Aficionado collection page may be studied for filter and loading UX and may later become an attributed asking-price source if acquisition is approved. It is not completed-sales evidence and cannot be treated as forecast ground truth.

### 2. Tabs, pages, and result loading

Use pages for distinct jobs and cursor pagination inside large result sets. The recommended result behavior is:

- Mobile: 24 records per request.
- Desktop: 48 records per request.
- Explicit `Load more`.
- Preserve loaded rows, filters, selected currency, and scroll position when returning from detail.
- Keep footer, navigation, and error recovery reachable.

Remaining work: scroll restoration, device-memory profiling, and a real iPhone Safari acceptance pass.

### 3. Mobile-first acceptance

Completed browser checks at 390 x 844:

- demo skip reaches Price Research;
- Trading Floor filter sheet opens and fits;
- listing detail exposes availability, source evidence, and price rating;
- currency converter opens with dated ECB evidence;
- no document-level horizontal overflow;
- 20 consecutive cursor pages produced no duplicate IDs.

Still required:

- real iPhone Safari certification;
- 360 x 800 Android Chrome and 412 x 915 large Android;
- software-keyboard checks for search, converter, posting, and support forms;
- slow/offline/error-state checks;
- detail-back scroll restoration.

### 4. Friendly currency converter

Current supported display currencies: USD, HKD, EUR, GBP, CHF, CNY, JPY, and SGD. Rates use dated ECB evidence and caching.

Remaining decisions and QA:

- confirm AED for day one;
- add clear stale/offline labeling;
- remember display currency per browser/account;
- verify numeric keyboard and swap control on real phones;
- prove converter actions never mutate normalization fields.

### 5. Emoji prices

Deterministic forms such as Unicode keycap digits and full-width digits may be normalized. Decorative emoji may be removed from numeric context. A private emoji meaning a dealer-specific digit, multiplier, or currency may not be guessed by AI.

Next action: store copied raw examples, Unicode code points, dealer/group scope, effective dates, reviewed interpretation, and reviewer identity in a versioned codebook. Until then, use `EMOJI_PRICE_AMBIGUOUS` and block promotion.

### 6. Discovery filters and accessories

Required order:

1. Category: Watches, Handbags, Jewelry, Accessories, Other.
2. Intent: For sale, Want to buy.
3. Listing form: reviewed single listings only.
4. Location.
5. Brand, model/reference, dial/configuration.
6. Price range and display currency.
7. Condition, year, presentation/accessories.
8. Verified dealer, image available, source date.
9. Sort.

PR #66 supplies the safe source-backed category foundation. Empty categories remain empty until real records exist. Remaining filters must execute server-side.

### 7. Want to Buy and user posting

Keep Want to Buy as a dedicated page or saved intent view. A WTB record does not require price. Show requested configuration, original request date, location, verified buyer profile, and budget only when explicitly stated.

Recommended Price Research treatment: a collapsed `Current for-sale market context` panel may appear when at least five clean comparable WTS offers exist. Never merge the WTB budget into WTS averages or forecasts.

Posting remains moderated. Authenticated beta users may submit WTS or WTB into `PENDING_REVIEW`; no submission directly publishes.

Product decisions still required:

- dealers only or collectors too;
- manual approval for every beta post;
- moderation owner and response target;
- public read-only Price Research or beta-login gated.

### 8. Dealer directory and profile

Routes and display contracts exist, but public identity is data-gated. Current private lineage evidence includes 5,350 exact parent matches, 98 intent conflicts, and 44,552 unmatched parents.

Required sequence:

1. Apply the private seller-lineage schema.
2. Stage a 100-parent canary.
3. Reconcile identity, intent, original date, and consent.
4. Review conflicts.
5. Expand to the 5,350 exact matches.
6. Link only reviewed identities to verified public dealer profiles.

The dealer directory may remain hidden during beta while verified dealer summaries appear inside listing details.

### 9. Account workspace

Existing shells/contracts: Profile, My Listings, Settings, Billing placeholder, Help/Tickets.

Before release:

- verify authorization boundaries and account recovery;
- define MFA and notification policy;
- connect profiles to verified dealer lineage;
- define support ownership;
- replace placeholder profile visuals only with consented real media;
- keep Billing/Pricing hidden until plans, entitlements, taxes, refunds, and payment provider are approved.

### 10. Tools, Apps, Community, and Company

Keep these pages concise. Publish real tools, methodology, app availability, owned community channels, privacy, terms, corrections, and contact information. Do not repeat feature marketing on every page.

## Private lineage infrastructure status

The private lineage schema is now applied and verified through the controlled
workflow. Successful run: [29873517110](https://github.com/Pablodd1/wf/actions/runs/29873517110).

Verified in the target Supabase project:

- both private staging tables exist;
- `anon` and `authenticated` have no `SELECT` privilege;
- row-level security is enabled on both tables;
- `service_role` can read both tables;
- the transaction completed without changing listings or publishing contact data.

The remaining infrastructure task is migration-ledger reconciliation. A new
manual, read-only ledger workflow must be run and reviewed before automatic
production migration pushes are enabled. Do not rerun the schema workflow or
enable `ENABLE_PRODUCTION_MIGRATIONS` solely because the files exist.

## Priority queue

### P0 - data trust

1. Review and merge PR #66 only after owner approval of the source-backed empty categories.
2. Owner-review the completed 100-parent private seller-lineage canary after the read-only ledger check.
3. Keep the 98 reviewed intent conflicts blocked until child-level segmentation resolves WTS/WTB intent.
4. Add Alex's copied emoji examples and regression fixtures.
5. Keep forecasts disabled.

Duplicate review is prepared as a private, reversible lane. Candidate pairs
must be staged from a read-only report and reviewed against both raw messages
before analytics suppression. No raw row deletion is permitted.

### P1 - mobile marketplace

6. Add scroll/filter restoration.
7. Complete real-device mobile acceptance.
8. Finish converter mobile/offline behavior and decide AED.
9. Add remaining server-side facets and sort controls.
10. Complete the separate WTB view and moderated posting acceptance.

### P2 - identity and accounts

11. Expand reviewed lineage from 100 to 5,350 parent matches.
12. Link consented verified dealer summaries.
13. Test Profile, My Listings, Settings, Help, and authorization boundaries.

### P3 - analytics

14. Improve source-date and verified-seller coverage.
15. Re-run John cohorts and the stratified 50-reference forecast audit.
16. Release only cohorts that pass every gate.

### P4 - images and commercial features

17. Resume image lineage only after listing relationships are proven.
18. Define billing plans before enabling Billing/Pricing.
19. Complete supporting pages and content acceptance.

## Safe rollout rule

No production-data mutation is approved merely because a script, UI, or migration exists. Every write path requires a bounded canary, exact before/after counts, conflict and orphan reports, rollback or idempotent replay, and explicit owner approval of the reviewed evidence.
