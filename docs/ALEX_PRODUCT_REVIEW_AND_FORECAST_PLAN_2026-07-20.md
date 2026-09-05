# Alex product review and forecast plan

**Date:** July 20, 2026  
**Status:** Discussion plan; no production-data changes are authorized by this document  
**Audience:** John, Alex, product, engineering, and data review

**Operational update:** The first mobile marketplace slice is live. Production
WTB deep links now load bounded rows without a filter toggle, the completed
Railway cursor exits cleanly, and the ECB currency endpoint is healthy. Seller
lineage and public forecasts remain gated as recorded in
`docs/CTO_ROLLOUT_STATUS_2026-07-21.md`.

## Executive decisions

1. Curated Luxury should use separate pages for separate jobs: Discover, Want to Buy, Price Research, Post, and Account. Large listing results should use database cursor pagination with an explicit `Load more` action. Do not use opaque infinite scroll or tens of thousands of numbered pages.
2. A three-month projection can be shown only for an exact reference + dial/configuration + condition cohort that passes evidence and backtest gates. Every reference may show a forecast-readiness state, but weak cohorts must say `Insufficient evidence` instead of displaying invented values.
3. Mobile is the primary marketplace viewport. Desktop can use a filter sidebar; mobile should use a sticky Search / Filter / Sort row and a full-height filter sheet.
4. The currency converter is display-only. It must never overwrite raw price, original currency, historical conversion evidence, or normalized USD price.
5. Standard numeric keycap and full-width emoji prices can be decoded deterministically. Private pictographic dealer codes must remain blocked until a reviewed dealer/group codebook exists.
6. Public browsing remains open. Posting, profile editing, contact management, billing, and support history require authenticated accounts.

## Reference storefront review

Reviewed: https://wristaficionado.com/collections/new-arrivals

Useful patterns:

- one clear collection heading;
- a dedicated `Filter` entry instead of crowding the product grid;
- explicit sort control;
- grid/list selection;
- bounded result loading;
- account and contact actions outside the collection filters.

Do not copy its watch-only taxonomy or editorial repetition. Curated Luxury needs category + intent + listing-form + location controls, and must preserve the distinction between source evidence and normalized market data.

## 1. Price Research: three-month projection

### What the current system already does

- Builds an auditable three-month candidate forecast for an exact selected reference, dial, and condition cohort.
- Requires at least 30 clean WTS offers, 12 monthly periods, 5 linked verified dealers, recent evidence, and rolling backtests.
- Requires the trend model to beat a naive last-known-price baseline.
- Keeps forecasts disabled unless `ENABLE_PRICE_FORECASTS=true` is explicitly approved.

### Current limitation

The five recurring John references currently fail one or more date-history and verified-dealer-lineage gates. Therefore a public numeric projection for all references would be misleading.

### Recommended product behavior

Every exact cohort receives one of three states:

1. `Projection available`: three dashed monthly points, 80% interval, backtest error, sample size, seller count, and last observation date.
2. `Directional trend only`: six to eleven usable months; show rising/stable/falling with no invented monthly price targets.
3. `Insufficient evidence`: retain historical chart and list the failed gates.

The forecast must never include WTB budgets, unresolved bundles, repost duplicates, ambiguous currencies, reference-shaped prices, catalog conflicts, or statistical outliers.

### Market research panel

For all references with valid observations, show:

- WTS supply count and velocity;
- WTB demand count and velocity;
- unique observed sellers/buyers where lineage is proven;
- listing age and repost persistence;
- median, IQR, min/max, and excluded outlier count;
- price dispersion and data-completeness score;
- forecast-readiness checklist.

These are marketplace activity indicators, not completed-sales liquidity or appraisal values.

### Release gate

Keep projections off until seller/date lineage improves and the known John references plus a stratified 50-reference report pass owner review.

## 2. Pages, tabs, and loading behavior

### Major pages

- Home
- Discover / Trading Floor
- Want to Buy
- Price Research
- Post an item
- Account / Profile

### Result loading

- Database: keyset/cursor pagination.
- Mobile: 24 records per request.
- Desktop: 48 records per request.
- UI: explicit `Load more`; preserve loaded results, filters, and scroll position after opening a listing.
- Never download millions of rows into the browser.
- Avoid automatic infinite scroll because it harms navigation, footer access, accessibility, data use, and error recovery.

This cursor pattern is already merged for the Trading Floor. The mobile filter
sheet and responsive 24/48 row request sizes are implemented on
`codex/alex-mobile-product-plan`. Remaining work is scroll restoration,
long-run mobile testing, and real-device acceptance.

## 3. Mobile-first acceptance

### Current status

- The merged Trading Floor uses 24-row mobile requests and responsive grids.
- The merged Price Research heading contrast issue was corrected.
- Prior 390 x 844 browser QA found no document-level horizontal overflow.

### Required production matrix

- 360 x 800 Android Chrome;
- 390 x 844 iPhone Safari target;
- 412 x 915 large Android;
- tablet portrait;
- desktop.

### Checks

- no horizontal overflow or controls hidden behind sticky UI;
- 44 px minimum touch controls;
- filter sheet works one-handed;
- charts remain readable and horizontally bounded;
- forms remain usable when the software keyboard opens;
- listing-detail back action restores scroll and filters;
- 20 consecutive `Load more` requests have no duplicate IDs or memory growth;
- slow, empty, offline, and API-error states are clear.

Real iPhone Safari testing remains required. Desktop responsive emulation is useful but cannot certify all WebKit behavior.

## 4. Currency converter

### Status

Implemented on Trading Floor and Price Research for USD, HKD, EUR, GBP, CHF, CNY, JPY, and SGD using dated ECB evidence and cached rates.

### Remaining QA

- mobile bottom-sheet presentation;
- numeric keyboard and swap control;
- stale/offline rate label;
- remember display currency per authenticated preference or local browser;
- confirm that conversion never mutates normalized source fields;
- add day-one currencies only after source coverage is verified.

Decision needed: currencies required beyond the current set, especially AED.

## 5. Emoji price normalization

### Status

- Standard Unicode keycap digits and full-width digits are decoded deterministically.
- Pictographic price strings receive `EMOJI_PRICE_AMBIGUOUS` and cannot auto-publish.

### Required input

Alex should provide each screenshot together with the original copied raw message where possible. Screenshots alone do not preserve exact Unicode code points.

### Safe next step

Build a versioned dealer/group codebook only from confirmed examples. AI may suggest a candidate meaning for review, but it may not approve a price or currency.

## 6. Discovery filters and accessories

### Desired order

1. Category: Watches, Handbags, Jewelry, Accessories, Other.
2. Intent: For sale, Want to buy.
3. Listing form: Single. Hide bundle/multi parents until reviewed children replace them.
4. Location.
5. Brand, model/reference, dial/configuration.
6. Price range and display currency.
7. Condition, year, presentation/accessories.
8. Verified dealer, image available, source date.
9. Sort: newest source post, relevance, price low/high, market rating.

### Current gap

The current implementation separates category from intent, so users can combine
Watches with WTS or WTB without one filter replacing the other. It includes a
mobile filter sheet for category, intent, condition, location, and archive
coverage. It does not yet expose the complete category taxonomy, price range,
brand/model facets, image/verified-dealer toggles, or sorting.

Legacy non-watch rows still use one `OTHER` listing type and therefore do not
contain a trustworthy independent WTS/WTB dimension. The source-backed category
slice now recognizes `jewelry_archive` as Jewelry and exposes separate Handbags,
Jewelry, Accessories, and Other controls. The live audit found eight Jewelry
archive records and no evidenced Handbag or Accessory source cohorts. Empty
categories stay empty; the application does not relabel watch rows to fill them.
The UI disables non-watch intent controls, and the API rejects handcrafted
category + intent combinations instead of returning misleading watch results.
Category and intent must be normalized independently before non-watch WTS/WTB
filters can be enabled.

All search/filter execution must remain server-side.

## 7. Want to Buy and user posting

### Want to Buy

Keep a dedicated page or saved intent view. WTB does not require price. Show requested configuration, request date, location, buyer profile, and stated budget when present.

Price Research may appear as a separate `Current WTS market context` panel. Never mix WTB budgets into WTS averages, outliers, ratings, or forecasts.

### User posting

The moderated dealer submission workflow is implemented. Authenticated users can submit WTS or WTB into `PENDING_REVIEW`; submissions do not directly publish.

Remaining decisions:

- whether collectors as well as dealers may post during beta;
- whether every beta post needs manual approval;
- moderation ownership and service-level target;
- contact-consent and prohibited-content rules.

## 8. Dealer directory and listing identity

### Status

- Dealer directory and profile routes exist.
- Listing details can show matched dealer name/company, location, rating, review count, common groups, WTS/WTB activity, profile link, and consented WhatsApp action.
- Historical identity remains hidden when exact source-to-dealer lineage is absent.

### Data blocker

Batch 002 has 5,350 private seller-lineage matches ready for staging, 98 intent conflicts blocked for review, and 44,552 unmatched parents. Observed seller identity is not the same as a verified public dealer.

### Decision

Keep the directory hidden during beta if desired, but show a verified dealer summary inside listing detail whenever identity and contact consent are both proven.

## 9. Account pages

### Implemented shell/contracts

- Profile
- My listings
- Settings and display currency
- Billing placeholder
- Help and support-ticket submission

### Not production-complete

- Profile requires verified dealer linkage.
- Billing remains intentionally inactive until plans, entitlements, refunds, taxes, and a payment provider are approved.
- Pricing page should remain hidden until those commercial decisions exist.
- Notifications, account recovery, MFA policy, ticket operations, and real profile media still need acceptance testing.

## 10. Tools, apps, community, and company

Lightweight public routes exist. Keep them concise and useful:

- Tools: glossary, currency/reference help, methodology.
- Apps: current platform availability and honest roadmap.
- Community: collector/dealer/wholesaler entry points and moderation ownership.
- Company: about, contact, privacy, terms, corrections, methodology.

Do not repeat a long feature list on every page.

## Priority order

### P0: data trust and beta usability

1. Stage seller/date lineage privately and review the 98 intent conflicts.
2. Validate the reference-price plausibility hotfix before merging its separate PR.
3. Complete category/intent correctness and WTS/WTB count validation.
4. Add Alex's raw emoji examples and regression fixtures.

### P1: mobile discovery

5. Build the mobile filter sheet and complete category facets.
6. Add scroll/filter restoration and 20-page load testing.
7. Finish currency-converter mobile/offline QA.
8. Separate the WTB experience while retaining optional WTS market context.

### P2: identity and account release

9. Stage the 5,350 seller-lineage matches without public contact publication.
10. Link only reviewed identities to verified dealer profiles.
11. Test profile, own-listings boundary, support tickets, and contact consent with a deliberately linked Preview dealer.

### P3: projections

12. Improve historical source-date and verified-seller coverage.
13. Run John-reference and stratified 50-reference backtests.
14. Release only passing forecast cohorts; keep all others visibly withheld.

### P4: commercial/supporting pages

15. Approve plans and payment provider before enabling Billing/Pricing.
16. Finish notification, recovery, help operations, and community ownership.

## Decisions for John and Alex

1. Should Price Research be public read-only or remain beta-login gated?
2. Should collectors be able to post during beta, or dealers only?
3. Should every WTB detail show WTS market context by default or behind an expandable section?
4. Which currencies are required on day one beyond the implemented set?
5. Which dealer rating, review, common-group, location, and contact fields may be public?
6. Are commercial plans already defined, or should Billing/Pricing stay hidden?
7. Can Alex provide original raw emoji-price text beside each screenshot?

## July 20 follow-up: point-by-point review

This section preserves Alex's follow-up as a release checklist. It does not
authorize production-data changes or enable forecasting.

| # | Request | Current evidence | CTO recommendation | Release state |
| --- | --- | --- | --- | --- |
| 1 | Three-month Price Research projection | Forecast code and UI states exist, but the audited cohorts do not have enough monthly history and verified seller lineage. | Give every exact reference + dial/configuration + condition cohort a readiness result. Display numeric projections only after the existing sample, history, recency, dealer-diversity, and rolling-backtest gates pass. | Blocked by evidence; keep `ENABLE_PRICE_FORECASTS=false`. |
| 2 | Tabs/pages versus infinite scroll | Trading Floor already uses cursor pagination and bounded page sizes. | Keep distinct pages for Home, Discover, Want to Buy, Price Research, Post, and Account. Use explicit `Load more`; do not use opaque infinite scroll or thousands of numbered pages. | Architecture decided; scroll restoration and long-run testing remain. |
| 3 | Mobile-first experience | Responsive checks passed at 360 x 800 and 390 x 844. The branch now includes a sticky Search / Filter row, full-height filter sheet, 44 px controls, and 24-row mobile requests. Emulation is not a substitute for iPhone Safari. | Add Sort, test 412 x 915 and tablet, run 20-page loading, and certify on a real iPhone Safari. | Branch implementation complete; real-device and long-run acceptance remain. |
| 4 | Friendly currency converter | Display-only converter exists for eight currencies with dated ECB evidence. | Keep conversion separate from normalized source values. Add a mobile sheet, stale/offline label, remembered display currency, and confirm whether AED is required. | Implemented foundation; mobile/offline QA remains. |
| 5 | Emoji prices | Keycap and full-width numeric forms are deterministic; unknown pictographic codes are blocked. | Add copied raw examples as regression fixtures. Maintain a reviewed dealer/group codebook; never let AI guess or approve an unknown emoji price. | Safe baseline implemented; examples required. |
| 6 | Filters and Accessories | Category and intent are independent. Desktop has grouped controls; mobile has a filter sheet. Eight source-backed Jewelry archive rows exist; no evidenced Handbag or Accessory rows exist, and legacy non-watch records cannot yet be split truthfully by intent. | Preserve the source-backed empty categories, normalize Category and Intent into independent stored fields, then add identity, price, image, dealer, and sort controls. | Safe source-backed taxonomy implemented on branch; Preview count verification and data migration remain. |
| 7 | Want to Buy and posting | Moderated WTS/WTB submission contracts exist; submissions enter review. | Keep Want to Buy as a dedicated page. Show optional `Current WTS market context` behind an expandable section, never mixing WTB budgets into WTS analytics. Permit posting only for authenticated beta roles and require moderation. | Foundation implemented; product policy and acceptance testing remain. |
| 8 | Dealer directory and profiles | Routes and UI exist; verified public identity depends on exact source lineage and consent. | Keep the directory hidden during beta if desired, but show verified dealer summaries in listing detail. Never publish an observed phone/name as a verified dealer without reviewed linkage and contact consent. | Blocked by lineage review. |
| 9 | Settings, billing, pricing, listings, profile, help | Account workspace and support-ticket contracts exist; billing is a placeholder. | Release Profile, My Listings, Settings, and Help only after authorization tests. Keep Billing/Pricing hidden until plans, entitlements, taxes, refunds, and a payment provider are approved. Replace placeholder profile art only after real dealer media consent. | Shell exists; security and commercial decisions remain. |
| 10 | Tools, apps, community, company | Lightweight public routes exist. | Keep these pages concise and useful; do not repeat feature marketing across every page. Publish only real app availability and owned community/support channels. | Content acceptance remains. |

### Reference-site conclusion

The reviewed Wrist Aficionado collection uses a clear collection title, a
dedicated filter entry, brand/collection navigation, account/search actions,
and separate contact/selling paths. Those interaction patterns are useful, but
Curated Luxury should not copy its watch-only taxonomy or its repeated editorial
sections. Curated Luxury needs category, intent, listing form, location, and
evidence-aware controls because it serves collectors, dealers, and wholesalers
across multiple luxury categories.

The reference site may be used for interaction benchmarking and, subject to its
terms and an approved acquisition method, as one attributed asking-price source.
It is not completed-sales evidence and must not be treated as ground truth for
forecast training. External observations need source, capture time, currency,
configuration, condition, and duplicate controls before they can join a market
cohort.

### Mobile evidence captured July 20

A 390 x 844 browser pass confirmed that the global header, Price Research entry,
and expanded currency converter fit without obvious page-level horizontal
overflow. A subsequent 360 x 800 pass confirmed the stacked header, three primary
navigation actions, Search / Filter row, full-height filter sheet, active-filter
badge, and 24-row request size. A fresh 1440 x 900 pass confirmed grouped desktop
filters and the 48-row request size. These checks are browser emulation, not a
real-iPhone Safari certification.

A fresh production Playwright pass on July 21 repeated the 390 x 844 checks.
Demo skip reached Price Research, the Trading Floor filter sheet opened with
Category, Intent, Condition, Location, and Coverage controls, and both documents
reported no horizontal overflow. The direct anonymous Price Research URL still
redirected to Dealer Login; whether Price Research should be public read-only is
a product/access-policy decision, not a responsive-layout defect.

The production WTS cursor was also exercised for 20 consecutive mobile-size
pages: 480 unique rows, 24 rows per page, zero repeated IDs, and a valid next
cursor on every page. The full read took about 24 seconds over the network. This
passes the bounded-pagination correctness gate; device memory profiling still
requires a real phone session.

### Recommended WTB market-research decision

Show a collapsed `Current for-sale market context` panel on a WTB detail page
when at least five valid comparable WTS observations exist. The panel may show
median, range, observation count, and chart access. It must not merge the buyer's
budget into WTS averages, ratings, outliers, or forecasts. When fewer than five
valid WTS observations exist, show `Insufficient comparable offers` rather than
an estimate.

### Current rollout note

PR #59 (`codex/trading-floor-customer-quality`) was closed without merge on
July 20, 2026. Its two reviewed commits were carried forward onto
`codex/alex-mobile-product-plan`, together with the mobile discovery work. Main
is unchanged until this consolidated branch receives review and a successful
Preview deployment.

## Definition of done

A visible page is not a finished feature. Each item requires server-side contracts, mobile QA, security/privacy checks, real-data performance tests, clear error/empty states, and auditable evidence for every displayed price, date, identity, rate, and projection.
