# Handoff Report — Codebase Survey for R3 (Seller Contacts & Raw Messages) and R4 (Outlier Filtering)

**Agent**: `teamwork_preview_explorer_survey_2`  
**Working Directory**: `C:\tmp_s3_check\wf`  
**Metadata Directory**: `C:\tmp_s3_check\wf\.agents\teamwork_preview_explorer_survey_2`  

---

## 1. Observation

### R3 Observations (Seller Contacts & Raw Messages)
1. **Server-side Redaction**: `api/_lib/source-redaction.cjs:3-13` defines `redactPublicSource(value)` which strips phone numbers (`[PHONE REDACTED]`), emails (`[EMAIL REDACTED]`), URLs (`[LINK REDACTED]`), handles (`[HANDLE REDACTED]`), and dealer tags.
2. **Endpoint Redaction Invocation**:
   - `api/price-research-listing.js:94,228` calls `redactPublicSource(...)` on all returned raw messages.
   - `api/co-pilot.js:64`, `api/export-excel.js:92`, and `api/review-packet-item.js:63` also call `redactPublicSource(...)`.
3. **Contact Gating**:
   - `api/listing-contact.js:114-156` gates seller contacts behind the `OWNER_APPROVED_CONTACT_PUBLIC` flag or `seller_listing_lineage_staging` match, returning `contact_available: false` otherwise.
   - `api/reviewed-seller-summary.js:7-11` checks `listing.contact_publication_approved === true` before returning seller phone and activity stats.
4. **Frontend UI Rendering**:
   - `src/pages/TradingFloor.tsx:858-861` hides raw messages when `raw_message_scope === 'normalized_summary'`. Lines 809-851 show `"A publishable source contact was not supplied for this listing"` if `contact_available` is false.
   - `src/pages/PriceResearch.tsx:1915` renders badge `<span ...>ORIGINAL LISTING / CONTACT REDACTED</span>` and text stating direct contact tokens are redacted. Lines 1874-1910 render `Posted by` card which defaults to "Poster data is not available for this listing" if `seller?.dealer_name` is missing.

### R4 Observations (Outlier Filtering & 5-Observation Minimum Gate)
1. **1.5×IQR Multiplier Enforced**:
   - `api/_lib/market-stats.cjs:36-37`: `lower_fence = raw.length >= 5 ? q1 - 1.5 * iqr : null; upper_fence = raw.length >= 5 ? q3 + 1.5 * iqr : null;`
   - `api/model-stats.js:38-39`: `lo = Math.max(q1 - 1.5 * iqr, SANITY_FLOOR); hi = q3 + 1.5 * iqr;`
   - `api/pipeline-parse.js:899,903,949,955,957`: default `mult = 1.5`.
   - `src/lib/analytics.ts:64-65`: `lower = q1 - 1.5 * iqr; upper = q3 + 1.5 * iqr;`
   - `src/lib/pipeline.ts:504-505`: `lowerBound = q1 - 1.5 * iqr; upperBound = q3 + 1.5 * iqr;`
   - `src/pages/InsightDetails.tsx:85-86`: `lowerBound = q1 - 1.5 * iqr; upperBound = q3 + 1.5 * iqr;`
2. **5-Observation Minimum Threshold Enforced**:
   - `api/_lib/market-stats.cjs:27,36,37,49`: `raw.length >= 5` gate for `analytics_ready` and fence calculation.
   - `api/price-research.js:187,447,694,835`: `cohort.count >= 5`, `d.count >= 5`, `minimum_sample: 5`.
   - `api/model-stats.js:18,98,113`: `const MIN_BUCKET = 5;`.
   - `src/lib/analytics.ts:57,74`: `prices.length < 5`, default `minDataPoints = 5`.
   - `src/lib/pipeline.ts:495,521`: `prices.length < 5`, default `minDataPoints = 5`.
   - `src/lib/pipelineClient.ts:80`: `applyIQRFiltering(forIqr, 5)`.
   - `src/pages/PriceResearch.tsx:1828`: `comparableCount >= 5`.

---

## 2. Logic Chain

1. **R3 Logic**:
   - **Premise**: User requirement R3 specifies that every watch listing detail view (Trading Floor + Price Research) must display unredacted raw source messages, seller name/handle, phone number with a clickable WhatsApp link (`https://wa.me/...`), and dealer activity stats (WTS, WTB, total posts) without redaction labels or withholding logic.
   - **Deduction**: Redaction logic in `api/_lib/source-redaction.cjs` and `api/price-research-listing.js` must be updated so raw messages pass through unredacted. Gating in `api/listing-contact.js` and `api/reviewed-seller-summary.js` must return seller contacts whenever present on the listing or dealer record. Frontend components in `TradingFloor.tsx` and `PriceResearch.tsx` must remove withholding notices, redaction badges, and truncation logic, ensuring phone numbers, WhatsApp URLs, seller handles, and activity stats are displayed.

2. **R4 Logic**:
   - **Premise**: User requirement R4 specifies relaxing Price Research outlier filters from 1.5×IQR to 3.0×IQR, and lowering the minimum comparable observation threshold from 5 observations to 2.
   - **Deduction**: Every occurrence of the `1.5` multiplier in IQR fence calculations (`q1 - 1.5 * iqr`, `q3 + 1.5 * iqr`) across `market-stats.cjs`, `model-stats.js`, `pipeline-parse.js`, `analytics.ts`, `pipeline.ts`, `InsightDetails.tsx`, and `PriceResearch.tsx` must be changed to `3.0`. Every occurrence of the `5` minimum observation gate across `market-stats.cjs`, `price-research.js`, `model-stats.js`, `analytics.ts`, `pipeline.ts`, `pipelineClient.ts`, and `PriceResearch.tsx` must be lowered to `2`.

---

## 3. Caveats

- **Data Sources**: The master dataset includes 388 Excel files at `C:\Users\jasme\Downloads\WF\ALL watches normalized\` (which contain populated seller names, phone numbers, and raw lines) and raw unbundled CSVs. Contact fields should be read from enriched listing records where available.
- **Offline Fallback**: When database endpoints are unavailable, offline fallback datasets (`top_watches_trading_floor.json`) should preserve raw source messages and seller details.

---

## 4. Conclusion

All exact file paths, line numbers, and functions needing modification for R3 and R4 have been identified and documented:

### Files & Line Numbers Requiring Modification:

#### Requirement R3 (Seller Contacts & Raw Messages):
1. `api/_lib/source-redaction.cjs`: Lines 3–13 (`redactPublicSource`)
2. `api/price-research-listing.js`: Lines 94, 109–111, 228, 243–245 (`handler` / `raw_message` processing)
3. `api/listing-contact.js`: Lines 114–156 (`handler` / contact resolution)
4. `api/reviewed-seller-summary.js`: Lines 7–11 (`approvedPhone`)
5. `src/pages/TradingFloor.tsx`: Lines 809–851, 853–878, 889–902 (`ListingDetails` & `sourcePosterContact`)
6. `src/pages/PriceResearch.tsx`: Lines 1873–1911, 1913–1926 (`ListingDetailModal` & `DetailCard`)

#### Requirement R4 (IQR 3.0× & 2+ Observations Threshold):
1. `api/_lib/market-stats.cjs`: Lines 27, 36–37, 49 (`summarizePrices`)
2. `api/price-research.js`: Lines 187, 447, 694, 832–835 (`handler` / cohort & dial filtering)
3. `api/model-stats.js`: Lines 18, 38–39, 98, 113 (`MIN_BUCKET` & `iqrFilter`)
4. `api/pipeline-parse.js`: Lines 899, 903, 949–957, 1120 (`priceIsOutlier` & `_iqrParams`)
5. `src/lib/analytics.ts`: Lines 57, 64–65, 74 (`iqrFilter` & `buildPriceAnalytics`)
6. `src/lib/pipeline.ts`: Lines 495, 504–505, 521 (`iqrOutlierRemoval` & `applyIQRFiltering`)
7. `src/lib/pipelineClient.ts`: Line 80 (`applyIQRFiltering` call)
8. `src/pages/InsightDetails.tsx`: Lines 85–86 (`lowerBound`, `upperBound`)
9. `src/pages/PriceResearch.tsx`: Lines 289, 883, 1246, 1280, 1828 (Types, methodology notes, UI text, benchmark condition)

---

## 5. Verification Method

To independently verify after implementing changes:
1. **TypeScript Build Check**:
   ```bash
   npm run build
   ```
   *Expected Output*: Clean build with 0 TypeScript compilation errors.

2. **Normalization & Market Stats Test Suite**:
   ```bash
   npm run test:normalization
   ```
   *Expected Output*: Test suite executes and verifies 3.0×IQR fence calculations and 2+ observation thresholds.
