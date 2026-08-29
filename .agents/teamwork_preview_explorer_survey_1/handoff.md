# Handoff Report — Data Consistency (R1) & WTB Demand Integration (R2) Survey

**Agent**: `teamwork_preview_explorer_survey_1`  
**Working Directory**: `C:\tmp_s3_check\wf\.agents\teamwork_preview_explorer_survey_1`  
**Date**: 2026-08-03  

---

## 1. Observation

Direct observations from codebase inspection:

1. **Frontend Endpoint Invocation**:
   - Trading Floor (`src/pages/TradingFloor.tsx`:293): Calls `fetch('/api/reviewed-market-inventory?' + params.toString())`.
   - Price Research (`src/pages/PriceResearch.tsx`:491): Calls `fetch('/api/price-research?' + params.toString())`.
   - Demand Signals (`src/pages/DemandSignals.tsx`:24, `src/hooks/useLiquidityData.ts`:28): Calls `fetch('/enriched_refs.json')`.

2. **Database View & Query Filtering**:
   - `api/reviewed-market-inventory.js` (lines 439, 447): Queries view `reviewed_workbook_market_source_v2`. Enforces `has_complete_identity = true`. Filters by `listing_type` (`WTS`, `WTB`, `OTHER`) only if explicitly passed in params; returns all activity by default.
   - `api/price-research.js` (lines 402, 546): Queries `price_research_verified_source` / `reviewed_workbook_analytics` / `watch_records`. Enforces `listing_type === 'WTS'` for price analytics and excludes WTB from main listing set.
   - `api/price-research.js` (lines 137, 188): Calls `lookupDemand()`, which queries `listing_type in ('WTB', 'NTQ')`. Line 188 filters out dial cohorts with `< 5` observations: `demandCohorts.filter(cohort => cohort.count >= 5)`.

3. **Outlier Fences & Minimum Sample Threshold**:
   - `api/_lib/market-stats.cjs` (lines 36–37):
     ```javascript
     const lower_fence = raw.length >= 5 ? q1 - 1.5 * iqr : null;
     const upper_fence = raw.length >= 5 ? q3 + 1.5 * iqr : null;
     ```
   - `api/_lib/market-stats.cjs` (line 49): `analytics_ready: raw.length >= 5`.
   - `src/pages/PriceResearch.tsx` (lines 899, 1130, 1141, 1251): Enforces 5-observation minimum check for chart rendering.

4. **Contact Redaction & Approval Gates**:
   - `api/_lib/source-redaction.cjs` (lines 3–13): `redactPublicSource()` replaces phone numbers, handles, emails, links, and poster names with `[PHONE REDACTED]`, `[POSTER REDACTED]`, etc.
   - `api/listing-contact.js` (line 114) & `api/reviewed-seller-summary.js` (line 8): Checks `contact_publication_approved === true` or flag `OWNER_APPROVED_CONTACT_PUBLIC`. If false, returns `contact_available: false`.

5. **Navigation Structure**:
   - `src/components/MarketHeader.tsx` (lines 6–14): Contains links for `HOME`, `TRADING FLOOR`, `WANT TO BUY`, `PRICE RESEARCH`, `POST ITEM`, `ACCOUNT`, `HIRE FI`. `Telegram Test Staging` (`/telegram-test`) and `Dealer Login` (`/dealer-login`) are not in primary nav header.

6. **Primary Data Sources Identified**:
   - Master Enriched Dataset: 388 Excel files in `C:\Users\jasme\Downloads\WF\ALL watches normalized\` (~11.2M rows / 2.27M unique watches). Populated with `Phone Number`, `Posted By`, `raw_line`, `Final Image URL`.
   - Unbundled Raw CSVs: 16 listing batch files + 11 raw message batch files in `C:\Users\jasme\Documents\Codex\2026-07-12\review\work\wf-data-canary\audit-output\unbundled\`.
   - Supabase Views: `reviewed_workbook_market_source_v2`, `price_research_verified_source`, `watch_records`.
   - Static JSON Files: `public/top_watches_trading_floor.json`, `public/enriched_refs.json`, `public/parsedWatches.json`.

---

## 2. Logic Chain

1. **Root Cause of Listing Count Discrepancy (R1)**:
   - Observation 1 & 2 show that Trading Floor queries `reviewed_workbook_market_source_v2` without restricting `listing_type` or requiring verified USD prices, counting all WTS + WTB + unpriced listings.
   - In contrast, Price Research queries `price_research_verified_source` / `watch_records` and applies `classifyResearchEligibility()`, restricting `totalListings` / `count` to `WTS` asking prices that have explicit USD values, pass 1.5× IQR outlier filtering, deduplicate reposts, and meet a 5-observation minimum threshold.
   - Therefore, Trading Floor total > Price Research `totalListings` count for any brand or reference.

2. **Root Cause of Missing WTB Demand Signals (R2)**:
   - Observation 2 shows that Price Research backend (`api/price-research.js`:188) discards WTB cohorts with `< 5` observations in `lookupDemand()`.
   - Observation 1 & 2 show that `PriceResearch.tsx` does not render WTB listing cards or a dedicated "Demand Signals" section on reference detail pages, while `DemandSignals.tsx` reads static `public/enriched_refs.json` instead of live DB queries.

3. **Root Cause of Redacted Messages & Missing Contacts (R3)**:
   - Observation 4 shows that `redactPublicSource()` in `api/_lib/source-redaction.cjs` actively strips phone numbers/handles/names from raw message text, and `listing-contact.js` / `reviewed-seller-summary.js` hide seller info unless `contact_publication_approved === true`.
   - However, Observation 6 shows the 388 Excel master dataset has enriched `Phone Number` and `Posted By` fields that should flow through without redaction labels.

4. **Root Cause of Empty Charts (R4)**:
   - Observation 3 shows `api/_lib/market-stats.cjs` uses `1.5 * iqr` fences and requires `raw.length >= 5` for `analytics_ready: true`. References with 2–4 comparable listings have their charts suppressed.

5. **Root Cause of Navigation Friction (R5)**:
   - Observation 5 shows `MarketHeader.tsx` lacks direct links to `/telegram-test` and `/dealer-login`, requiring users to rely on URL typing or missing breadcrumbs.

---

## 3. Caveats

- **DB Ingest State**: The survey examined backend API logic and view queries. The exact number of rows loaded in Supabase depends on whether the database was populated from all 388 Excel files or a subset checkpoint.
- **AI Vision Fallback**: Dial color extraction via AI vision for image-only listings requires an external vision handler (`api/_lib/vision.js` or `api/analyze-image.js`), which should be invoked when `dial_color` is missing/unspecified and `has_images === true`.

---

## 4. Conclusion & Actionable Recommendations

### R1. Reconcile Trading Floor & Price Research Counts
- **API Endpoint Update**: Standardize underlying query view to `reviewed_workbook_market_source_v2` for both Trading Floor and Price Research.
- **Summary Accounting Header**: In `/api/price-research`, return a breakdown header matching Trading Floor total:
  - `total_tracked_listings`: N (matches Trading Floor)
  - `wts_eligible_analytics_count`: N_WTS
  - `wtb_demand_count`: N_WTB
  - `excluded_count`: N_EXCLUDED (with breakdown: unpriced, 3.0× IQR outliers, unsplit bundles)

### R2. Integrate WTB Demand Signals in Price Research
- Update `lookupDemand` in `api/price-research.js` to return all WTB/NTQ listings for the reference regardless of cohort count.
- In `src/pages/PriceResearch.tsx`, add a dedicated **"Demand Signals (WTB Buyer Requests)"** section displaying WTB counts, buyer request cards, buyer contact buttons, and raw buyer messages side-by-side with WTS asking-price charts.

### R3. Unredacted Contacts & Raw Source Messages
- Remove `redactPublicSource()` filtering for authenticated or public customer listing views.
- Ensure `seller_name`, `seller_phone`, and direct WhatsApp links (`https://wa.me/<digits>`) are populated from enriched Excel source fields on both Trading Floor and Price Research detail views.
- Preserve untouched raw source messages for `oceandigital` chatbot records.

### R4. Relax Outlier Filters to 3.0× IQR & Lower Minimum Sample Threshold to 2
- In `api/_lib/market-stats.cjs`:
  - Change IQR fence multiplier from `1.5 * iqr` to `3.0 * iqr`.
  - Change `analytics_ready` threshold from `raw.length >= 5` to `raw.length >= 2`.
- In `src/pages/PriceResearch.tsx`:
  - Change minimum comparable observation check for rendering charts from 5 to 2.

### R5. Persistent Navigation UX
- In `src/components/MarketHeader.tsx`, add persistent links for `TRADING FLOOR` (`/trading`), `PRICE RESEARCH` (`/price-research`), `TELEGRAM TEST` (`/telegram-test`), and `DEALER LOGIN` (`/dealer-login`).
- Ensure breadcrumb header and back buttons are present on all detail pages and subviews.

---

## 5. Verification Method

1. **Build Verification**:
   ```bash
   npm run build
   ```
   Must complete with code 0 and 0 TypeScript errors.

2. **File & Line Verification**:
   - Inspect `api/_lib/market-stats.cjs` lines 36–37, 49 for IQR fence multiplier and sample length threshold.
   - Inspect `api/price-research.js` lines 137–196 for WTB `lookupDemand` query and cohort minimum filter.
   - Inspect `api/reviewed-market-inventory.js` line 439 for Trading Floor query filtering.
   - Inspect `src/pages/PriceResearch.tsx` lines 491, 899, 1085–1101 for Price Research data rendering.
   - Inspect `src/components/MarketHeader.tsx` lines 6–14 for navigation link definitions.

3. **Reconciliation Invalidation Conditions**:
   - Any reference query where `Total Trading Floor` $\neq$ `WTS Eligible` + `WTB Demand` + `Documented Exclusions`.
   - Any WTB listing that alters WTS asking price averages.
   - Any raw message showing `[REDACTED]` tags.

---
