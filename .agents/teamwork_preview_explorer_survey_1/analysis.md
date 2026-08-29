# Data Consistency (R1) & WTB Demand Integration (R2) Survey Analysis

## Executive Summary
This report analyzes the WatchFacts codebase regarding **Data Consistency across Trading Floor and Price Research (R1)** and **WTB Demand Integration (R2)**. It provides exact file paths, line numbers, query logic differences, root causes of data count discrepancies, and concrete implementation blueprints for reconciliation.

---

## 1. Primary Data Sources Catalog

| Data Source | Location / Table | Key Columns & Characteristics | Usage Surface |
|---|---|---|---|
| **Enriched Master Excel Dataset** | `C:\Users\jasme\Downloads\WF\ALL watches normalized\` (388 Excel files, ~11.2M rows / 2.27M unique watches) | `Phone Number`, `Posted By`, `raw_line`, `Final Image URL`, `Price ($ USD)`, `Intent / Type` (WTS/WTB), `Normalized Reference`, `Dial Color`, `Condition` | Primary source of truth for enriched seller contacts, phone numbers, and images |
| **Raw Unbundled CSV Batches** | `C:\Users\jasme\Documents\Codex\2026-07-12\review\work\wf-data-canary\audit-output\unbundled\` (16 listing CSVs + 11 raw message CSVs, ~12.4 GB total) | `listing_id`, `raw_line` (100% populated), `dial_color` (97%), `listing_type` (93.3K WTS / 6.6K WTB), `seller_name` (0%), `seller_phone` (0%) | Raw lineage evidence fallback for untouched chatbot messages (`oceandigital`) |
| **Supabase Database Views & Tables** | `reviewed_workbook_market_source_v2`<br>`reviewed_workbook_inventory`<br>`price_research_verified_source`<br>`watch_records` | Database tables storing parsed and reviewed listings with identity verification flags, confidence scores, and currency statuses | Live production DB queried by Vercel serverless API handlers in `api/` |
| **Static Offline Fallbacks** | `public/top_watches_trading_floor.json` (3,000 top listings)<br>`public/enriched_refs.json` (4,927 references)<br>`public/parsedWatches.json` | JSON files bundled with static frontend build | Used for offline fallback when DB is unreachable or in legacy hooks (`useLiquidityData.ts`, `useWatchData.ts`) |

---

## 2. Trading Floor vs. Price Research Data Query Comparison

### A. Trading Floor (`/trading`)
- **Frontend Component**: `src/pages/TradingFloor.tsx` (lines 286–305)
- **API Endpoint**: `GET /api/reviewed-market-inventory` (`api/reviewed-market-inventory.js`)
- **Backend Query Target**: Supabase view `reviewed_workbook_market_source_v2`
- **Query Filter Logic**:
  - `query.eq('has_complete_identity', true)` (`api/reviewed-market-inventory.js`, line 439)
  - `query.neq('verification_status', 'QUARANTINED_SOURCE_CONFLICT')` (line 438)
  - Excludes sentinel identity strings: `['multiple', 'multi', 'mixed']` (lines 442–445)
  - Optional filters: `brand`, `reference_search_key`, `dial_color`, `listing_type` (`WTS`/`WTB`/`OTHER`), `condition`, `has_exact_source_image`
- **Data Scope**: Returns ALL listings matching identity quality checks, **including both WTS for-sale listings and WTB buyer requests**, unpriced listings, and non-USD prices.
- **Displayed Total**: Represents the total count of all inventory records in `reviewed_workbook_market_source_v2` matching filters.

### B. Price Research (`/price-research`)
- **Frontend Component**: `src/pages/PriceResearch.tsx` (lines 488–491)
- **API Endpoint**: `GET /api/price-research?reference=...&brand=...` (`api/price-research.js`)
- **Backend Query Target**: `price_research_verified_source` or `watch_records` / `reviewed_workbook_analytics`
- **Query Filter & Gating Logic**:
  1. **Enforces WTS Only for Price Averages**: `listing_type === 'WTS'` (lines 402, 546 in `api/price-research.js`).
  2. **Classifies Research Eligibility**: `classifyResearchEligibility(row, catalogHit)` in `api/_lib/price-research-eligibility.cjs`:
     - Requires valid brand, model, reference, dial color (unless owner-reviewed identity).
     - Excludes unsplit multi-item bundles (`BUNDLE_SOURCE_UNSPLIT`).
     - Excludes reference-token-as-price (`REFERENCE_TOKEN_AS_PRICE`) or year-token-as-price (`YEAR_TOKEN_AS_PRICE`).
     - Requires explicit verified USD asking price (`price_usd > 0`).
  3. **Repost Deduplication**: `deduplicateReposts()` counts dealer reposts once (line 556).
  4. **Duplicate Suppression**: `loadAnalyticsSuppressedIds()` filters out reviewed duplicate IDs (line 535).
  5. **Outlier Filtering**: `PLAUSIBILITY_FLOOR_THEN_IQR_1_5` applies 1.5× IQR fences (`api/_lib/market-stats.cjs`, lines 36–37).
  6. **Minimum Threshold Gate**: Imposes `raw.length >= 5` requirement for `analytics_ready: true` (line 49 in `api/_lib/market-stats.cjs` and lines 899, 1130, 1141 in `PriceResearch.tsx`).
- **WTB Demand Signals Query (`lookupDemand`)**:
  - Queries `listing_type in ('WTB', 'NTQ')` (`api/price-research.js`, line 137).
  - Applies `classifyDemandEligibility(row, catalog)` (`api/_lib/price-research-eligibility.cjs`, line 34).
  - **CRITICAL BUG/LIMITATION**: Filters out dial cohorts with `< 5` observations (`demandCohorts.filter(cohort => cohort.count >= 5)`, line 188). If a reference has 1–4 WTB listings, `demand_count` returns 0!

---

## 3. Discrepancy Root Causes & Reconciliation Strategy

### Root Causes of Count Differences between Trading Floor and Price Research
1. **Scope Inconsistency**: Trading Floor counts all valid `WTS` + `WTB` listings + unpriced listings. Price Research `totalListings` / `count` only counts qualified `WTS` asking prices that survive 1.5× IQR outlier filtering and the 5-observation minimum threshold.
2. **WTB Suppression in Price Research**: WTB listings are excluded from `totalListings` in Price Research and are hidden from liquidity metrics unless a dial cohort has at least 5 WTB observations.
3. **Data Source Divergence**: Trading Floor queries `reviewed_workbook_market_source_v2` while Price Research queries `price_research_verified_source` or `watch_records`.
4. **Aggressive Outlier Fences**: The 1.5× IQR fence and 5-observation minimum threshold filter out valid data and show empty charts for low-volume references.

### Reconciliation Formula for Reconciled Count (R1)
For any search query (e.g. brand or reference `116500LN`):
$$\text{Total Trading Floor Listings} = \text{Qualified WTS Comparable Set} + \text{WTB Demand Signals} + \text{Excluded Listings (Unpriced/Outliers/Unsplit Bundles)}$$

Price Research must report all four numbers in a unified summary header:
- **Total Tracked Listings**: N (matches Trading Floor count)
- **Qualified WTS Asking Prices**: N_WTS (qualified for price charts & analytics)
- **WTB Demand Volume**: N_WTB (buyer requests)
- **Excluded Evidence**: N_EXCLUDED (with documented reasons: raw currency pending, 3.0× IQR outliers, unsplit bundles)

---

## 4. WTB Demand Signal Integration (R2)

### Current Handling & Filtering Locations
- **Backend**: `api/price-research.js` lines 129–196 (`lookupDemand` function). Line 188 filters `cohort.count >= 5`.
- **Eligibility**: `api/_lib/price-research-eligibility.cjs` lines 34–36 (`classifyDemandEligibility` sets `price_usd: 1` to skip price checks while enforcing identity validation).
- **Frontend**:
  - `PriceResearch.tsx`: Shows small text in "Liquidity & Demand" card (`data.liquidity.demand_count`). Missing dedicated Demand Signals section and buyer listing cards.
  - `DemandSignals.tsx`: Separate route (`/demand`), but reads static `public/enriched_refs.json` instead of querying live DB demand listings.

### Integration Plan into Price Research Detail Page
1. **API Update**: Update `lookupDemand` in `api/price-research.js` to return ALL WTB/NTQ listings for the reference without requiring `cohort.count >= 5`, and include an array of WTB listing objects (`id`, `brand`, `model`, `reference`, `dial_color`, `condition`, `buyer_name`, `buyer_phone`, `raw_message`, `listing_date`).
2. **Frontend UI Update in `PriceResearch.tsx`**:
   - Add a dedicated **"Demand Signals (WTB Buyer Requests)"** section alongside the WTS asking price analytics.
   - Display total WTB count, buyer request cards, buyer contact buttons (WhatsApp link), and full raw buyer source text.
   - Keep WTB demand volume distinct from WTS asking price charts.

---

## 5. Contact & Raw Message Flow (R3)

### Redaction & Suppression Locations
- **`api/_lib/source-redaction.cjs`**: `redactPublicSource()` redacts phone numbers (`[PHONE REDACTED]`), names (`[POSTER REDACTED]`), emails, and links from raw source messages.
- **`api/listing-contact.js` & `api/reviewed-seller-summary.js`**: Checks `contact_publication_approved === true` or flag `OWNER_APPROVED_CONTACT_PUBLIC`. If false, suppresses phone numbers and seller names.

### Unredacted Display Plan
1. Use the enriched master dataset from 388 Excel files (`C:\Users\jasme\Downloads\WF\ALL watches normalized\`), where `Phone Number` and `Posted By` are populated.
2. In API handlers and UI modals on both Trading Floor and Price Research, expose full raw message text without applying `redactPublicSource()`, and display seller name, phone number, and a direct `https://wa.me/<digits>` WhatsApp button.
3. Handle "oceandigital" chatbot records by preserving untouched raw source message text.

---

## 6. Outlier Filter & Threshold Relaxation (R4)

### Target Code Changes
- **`api/_lib/market-stats.cjs`**:
  - Line 36: Change `q1 - 1.5 * iqr` to `q1 - 3.0 * iqr`.
  - Line 37: Change `q3 + 1.5 * iqr` to `q3 + 3.0 * iqr`.
  - Line 36/49: Change `raw.length >= 5` to `raw.length >= 2`.
- **`api/price-research.js`**:
  - Line 832/835: Update methodology metadata to `PLAUSIBILITY_FLOOR_THEN_IQR_3_0` and `minimum_sample: 2`.
- **`src/pages/PriceResearch.tsx`**:
  - Update threshold checks from 5 to 2 (`comparableCount >= 2`).
  - Update UI helper text from "minimum 5" to "minimum 2" and "1.5 x IQR" to "3.0 x IQR".

---

## 7. Persistent Navigation UX (R5)

### Target Code Changes
- Update `src/components/MarketHeader.tsx` to include top-level links:
  - `TRADING FLOOR` (`/trading`)
  - `PRICE RESEARCH` (`/price-research`)
  - `TELEGRAM TEST` (`/telegram-test`)
  - `DEALER LOGIN` (`/dealer-login`)
- Ensure navigation bar is persistent on every page layout (`Layout.tsx`, `MarketNav.tsx`, `MarketHeader.tsx`).
- Add persistent breadcrumb header to all detail modals and subpages.

---

## 8. Verification Results

| Command Run | Result | Notes |
|---|---|---|
| `npm run build` | **PASSED** (0 TypeScript errors, 8.34s) | Builds all production Vite chunks cleanly |
| `Get-ChildItem` search for data references | **PASSED** | Verified references to static files and endpoints |

