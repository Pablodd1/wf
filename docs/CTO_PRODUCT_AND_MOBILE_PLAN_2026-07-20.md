# Curated Luxury Product, Mobile, and Forecast Plan

**Date:** July 20, 2026
**Status:** Planning and evidence review only; no product behavior changed by this document
**Audience:** John, Alex, product, engineering, and data review

## Executive decision

The immediate release priority remains trustworthy listing data. Forecasting, conversion tools, account pages, and richer discovery are valuable, but none should hide or legitimize incorrect prices. A live mobile review found Trading Floor cards where references such as `16610`, `126334`, and `124270` were displayed as USD prices. Those rows are marked as under review, but a reference-shaped amount must be quarantined from customer price display immediately and repaired through the normal evidence workflow.

The product should use normal pages for its major jobs and server-side keyset pagination within large result sets. On mobile, use an explicit **Load more** action. Do not use opaque endless scroll or expose tens of thousands of numbered pages.

## Evidence reviewed

- Current production Curated Luxury homepage and Trading Floor at a 390 x 844 phone viewport.
- Current Price Research route and its beta-login behavior.
- Current Price Research API, outlier rules, monthly aggregates, dial/condition cohorts, and forecast placeholders.
- Current seller-lineage, dealer profile, and private contact contracts.
- Wrist Aficionado New Arrivals as a UX reference. Its useful patterns are a compact Filter entry, sort control, grid/list selection, result count, and explicit Load more. Its product/data model should not be copied blindly.
- ECB Data Portal API as a possible auditable reference-rate source for supported currencies.

## 0. Release-critical data correction

### Finding

The public Trading Floor currently includes archive rows whose reference-like values appear in `price_usd`, producing labels such as `$16,610`, `$126,334`, and `$124,270`. The page also defaults missing region to Asia and many source dates to `Not listed`.

### Plan

1. Add a customer-display gate that suppresses price when the parsed amount equals or strongly resembles the normalized reference and lacks explicit price evidence.
2. Add reason code `REFERENCE_TOKEN_AS_PRICE` and route the record to price review.
3. Never replace the value with an inferred market price. Display `Price under review`.
4. Stop defaulting missing location to Asia; display `Location not provided`.
5. Continue the seller-lineage/date reconciliation before claiming dealer or posting history.
6. Add regression fixtures for the exact production examples and the recurring John references.

### Acceptance

- No reference-shaped value is customer-visible as price without explicit raw-message price evidence.
- Price Research excludes the rows before IQR calculations.
- Raw evidence remains preserved for reviewer inspection.

## 1. Three-month Price Research projection

### Decision

A three-month projection is feasible for eligible exact comparable cohorts. It is not honest or statistically defensible to show a numeric prediction for every reference. Every reference page may show a forecast status, but only evidence-qualified cohorts receive a forecast line.

### Comparable grain

Forecast separately by:

`brand + canonical reference + dial/configuration + condition cohort + WTS intent + USD-normalized asking price`

WTB rows measure demand and must never enter the WTS asking-price target. Reposts, unresolved bundles, invalid prices, unresolved currencies, catalog conflicts, and statistical outliers remain inspectable but excluded.

### Initial eligibility gate

- At least 12 distinct observed months.
- At least 30 unique outlier-clean WTS offers.
- At least 5 unique source identities/dealers where lineage is available.
- A recent valid observation within 60 days.
- At least 6 months with 3 or more observations.
- Exact catalog identity and dial/configuration agreement.

Six to eleven valid months may receive `Directional trend only`. Anything weaker receives `Insufficient evidence`.

### Model strategy

Start simple and auditable:

1. Monthly median baseline carried forward.
2. Robust linear trend or Theil-Sen trend.
3. Exponential smoothing when history supports it.
4. Select a model only through rolling-origin three-month backtesting; it must beat the naive median baseline.

Do not start with an LLM, black-box price guess, or a complex model merely because it looks sophisticated. Report MAE, median absolute percentage error, interval coverage, sample size, and the last actual observation date.

### Chart

- Solid line: historical monthly median.
- Optional thin range: monthly IQR/min-max of included observations.
- Dashed line: three forecast months.
- Shaded band: 80% prediction interval.
- Visible label: `Projection, not an offer or appraisal`.
- Expandable evidence: included observations, excluded outliers, duplicates, model, backtest window, and error.

### Market research signals

Add WTS supply velocity, WTB demand velocity, unique sellers/buyers, repost persistence, price dispersion, and listing age. Call the result a **market activity indicator**, not completed-sales liquidity, until confirmed transaction outcomes exist.

### Release gate

Backtest the system on the known John references (`5712/1A`, `5712/1R`, `3712/1A`, `116500LN`, `52506`) and a stratified set of at least 50 references. John reviews the output before any public forecast is enabled.

Implementation status (2026-07-20): Price Research now computes a three-month candidate forecast only for an explicitly selected reference, dial, and condition cohort. It requires at least 30 clean offers, 12 monthly periods, five linked verified dealer identities, recent evidence, and four rolling test periods. The monthly-median linear trend must beat a last-known-price baseline by at least 5%. Failed cohorts return a visible withholding reason; passing cohorts show a dashed estimate with an error-derived uncertainty band. This is an analytical projection, never a listing price or guarantee. Production release still requires the John-reference and 50-reference validation above, and remains disabled unless `ENABLE_PRICE_FORECASTS=true` is set deliberately after approval.

## 2. Currency converter

### Product behavior

- Available from Trading Floor, Price Research, and listing detail.
- Opens as a compact popover on desktop and a bottom sheet on mobile.
- Includes amount, From, To, swap, converted result, rate source, and timestamp.
- Remembers the user's display currency locally.
- Supports at minimum USD, HKD, EUR, GBP, CHF, JPY, CNY, SGD, and AED after source coverage is verified.

### Data contract

Conversion is a display tool. It never overwrites the immutable original price, original currency, normalization evidence, or the historical FX rate used by Price Research. Store/cache the rate, base, quote, source, and effective timestamp. ECB can provide an auditable official reference-rate source for covered currencies, but its rates are informational and cross-rates may be required through EUR.

Implementation status (2026-07-20): the converter is available on Trading Floor and Price Research for USD, HKD, EUR, GBP, CHF, CNY, JPY, and SGD. The server reads official ECB reference-rate data, derives a USD display base, returns the observation date, and caches the response for six hours. It has no permission to update `watch_records`, normalization fields, or Price Research comparables.

### Mobile acceptance

- Numeric keypad opens automatically.
- Minimum 44 px controls.
- One-handed use without horizontal scrolling.
- Works offline with the last cached rate while clearly showing it is stale.

## 3. Emoji prices

### What can be deterministic

Unicode keycap digits such as `1`, `1\uFE0F\u20E3`, full-width digits, and ordinary currency symbols can be normalized before price parsing. Decorative emoji must be separated from numeric/currency tokens before bundle segmentation.

### What cannot be guessed

Arbitrary dealer codes where an emoji privately means a digit, multiplier, price, or currency cannot be decoded safely without a verified dealer/group codebook or explicit examples. AI may suggest a review candidate, but it cannot auto-approve price or currency.

### Plan

1. Obtain Alex's exact image/raw-message examples.
2. Preserve the original Unicode string and code points.
3. Add deterministic NFKC/keycap-digit decoding.
4. Add `EMOJI_PRICE_AMBIGUOUS` for nonstandard symbols.
5. Build optional reviewed codebooks by dealer/group with effective dates and audit history.
6. Add regression fixtures before shadow reprocessing.

Implementation status (2026-07-20): standard Unicode keycap digits and full-width digits now decode deterministically in normalization v4 while preserving the exact matched raw price text. A WTS line with a price/currency cue and an unresolved pictographic code receives `EMOJI_PRICE_AMBIGUOUS`, is prioritized in the review queue, and is blocked from automatic promotion. Dealer-private symbol meanings remain intentionally unsupported until a reviewed codebook and raw examples exist.

## 4. Discovery, filters, and result loading

### Top-level pages

- Home
- Discover / Trading Floor
- Want to Buy
- Price Research
- Sell or Post
- Profile / Workspace

### Trading Floor filter order

1. Category: All, Watches, Handbags, Jewelry, Accessories, Other.
2. Intent: For sale, Want to buy.
3. Listing form: Single. Keep bundle/multi hidden until approved children replace parents.
4. Location.
5. Brand, model/reference, dial/configuration.
6. Price range and display currency.
7. Condition, year, presentation/accessories.
8. Verified dealer, image available, date range.
9. Sort: newest source post, relevance, price low/high, market rating.

Search and every filter must execute server-side. Default ordering is the original source posting date descending, with a stable ID tie-breaker. Missing source dates sort after dated listings and are labeled honestly.

### Desktop

Use a collapsible left filter panel, sticky search/sort toolbar, removable active-filter chips, grid/list toggle, and result count.

### Mobile

Use a sticky Search + Filter + Sort row. Filter opens a full-height bottom sheet with grouped accordion sections and `Show N results`. Active chips remain horizontally scrollable below search.

### Pagination decision

- Database: keyset/cursor pagination, 24 records per request on mobile and 48 on desktop.
- UI: explicit `Load more`, preserving filters, scroll position, and loaded results when returning from a detail page.
- Do not automatically load forever. It harms navigation, accessibility, data use, footer access, and recovery after failure.
- Do not display `Page 1 of 31,226` on mobile.

## 5. Want to Buy and user posting

### Want to Buy page

Keep a dedicated WTB page. Show demand count, unique buyers, request recency, requested configuration, location, verified poster profile, and stated budget when present.

Market research belongs on WTB detail, but it must remain separated:

- `Current WTS market context`: outlier-clean asking-price range for the exact comparable watch.
- `Buyer request`: stated WTB budget, if any.
- Never combine WTB budgets with WTS averages or forecasts.

### Posting

Allow authenticated users to post either `For sale` or `Want to buy`. Start with a moderated beta:

- category and intent;
- structured identity fields;
- raw description preserved;
- original currency/price or optional WTB budget;
- source date and location;
- images with lineage;
- contact consent;
- preview, spam/rate controls, and review state.

Public browsing can remain open. Posting, editing, billing, and contact-management actions require authentication.

## 6. Dealer directory and listing profiles

The directory may remain hidden initially, but every listing detail should show the matched verified profile when available:

- display/company name and location;
- rating and review count;
- common groups only where disclosure is permitted;
- active and historical WTS count;
- WTB count;
- posting years and original source-post date;
- other active listings;
- WhatsApp/contact action only after verified identity and consent.

The seller-lineage pipeline created on July 20 is the prerequisite. It has 5,350 batch-002 matches ready for private staging, 98 intent conflicts for review, and no public contact changes. Do not fabricate a profile for unmatched history.

## 7. User workspace

### Required pages

- Profile: professional identity, avatar/brand image, location, languages, ratings, common groups, verification and contact preferences.
- My listings: WTS/WTB tabs, drafts, pending review, active, sold/fulfilled, withdrawn.
- Settings: account, privacy, notifications, display currency, security, contact consent.
- Billing: invoices and payment method only after a commercial billing provider and plan rules are approved.
- Pricing/plans: public plan comparison only after John approves entitlements.
- Help: searchable help plus authenticated ticket submission and status.

Profile design should use real inventory, reputation, activity, and identity evidence. Avoid generic illustration or clip-art decoration.

## 8. Supporting pages

Implement after the marketplace core is stable:

- Tools: glossary, reference/currency help, methodology, apps/downloads.
- Community: editorial/community entry points with moderation ownership.
- Company: about, contact, privacy, terms, methodology, data corrections.

Do not repeat feature descriptions across every page. Keep these discoverable through navigation/footer and contextual links.

## 9. Mobile QA program

Test production-like data at:

- 360 x 800 Android Chrome;
- 390 x 844 iPhone Safari target;
- 412 x 915 large Android;
- tablet portrait and desktop.

Automate screenshots and checks for no horizontal overflow, sticky control overlap, readable charts, 44 px touch targets, keyboard-safe forms, detail-back-scroll restoration, filter persistence, slow network, empty/error states, and 20 consecutive Load more requests. Use real Safari/iPhone testing before release because desktop emulation cannot validate every WebKit behavior.

Recommended mobile navigation: Home, Discover, Research, Post, Profile. Dealer/admin tools stay inside the authenticated workspace rather than crowding the public header.

## 10. Priority and dependency order

### P0: before client-facing expansion

1. Quarantine reference-as-price rows and revalidate public price rules.
2. Complete seller/date lineage canary and review the 98 intent conflicts.
3. Confirm open public access for Discover and the intended Price Research beta policy.
4. Validate WTS/WTB counts change correctly under server-side intent filters.

### P1: highest customer value

5. Mobile filter bottom sheet, category/intent taxonomy, keyset Load more.
6. Currency converter with source/timestamp and no normalization mutation.
7. WTB page and moderated Post flow.
8. Verified dealer summary embedded in listing detail.
9. Emoji-price fixtures and deterministic decoder after Alex supplies examples.

### P2: analytics

10. Build forecast dataset and rolling backtest harness.
11. Review John references, then 50-reference stratified validation.
12. Release three-month projections only for passing cohorts.

### P3: account ecosystem

13. Profile, My Listings, Settings, Help/Tickets.
14. Billing and Pricing after commercial decisions.
15. Glossary, Apps, Community, and Company pages.

## Decisions needed from John and Alex

1. Should Price Research remain beta-login gated or public read-only?
2. Which currencies are required on day one beyond USD/HKD?
3. Provide the raw emoji-price examples, not screenshots alone when possible.
4. Can authenticated buyers post immediately, or should all posts require manual approval during beta?
5. Which dealer group/review fields are contractually safe to show publicly?
6. Are billing plans already defined, or should Billing/Pricing remain hidden?

## Definition of done

No feature is complete merely because its UI exists. Each item requires server-side contracts, mobile acceptance checks, security/privacy review, realistic-data performance tests, error/empty states, and an auditable rule for every displayed price, identity, date, rate, and forecast.

## Reviewed references

- Marketplace filter/load pattern: https://wristaficionado.com/collections/new-arrivals
- ECB exchange-rate API: https://data.ecb.europa.eu/help/api/data
- ECB exchange-rate methodology: https://data.ecb.europa.eu/key-figures/ecb-interest-rates-and-exchange-rates/exchange-rates
