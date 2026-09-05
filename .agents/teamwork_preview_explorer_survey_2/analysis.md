# Comprehensive Codebase Survey Analysis — Seller Contacts (R3) & Outlier Filtering (R4)

**Surveyor:** `teamwork_preview_explorer_survey_2`  
**Date:** 2026-08-03  
**Working Directory:** `C:\tmp_s3_check\wf`  

---

## 1. Executive Summary

This investigation analyzed the WatchFacts codebase to identify all exact file paths, line numbers, and functions that require modification for:
1. **Requirement R3 (Seller Contacts & Raw Messages)**: Displaying unredacted raw source message text, seller name/handle, phone number with a clickable WhatsApp link (`https://wa.me/...`), and dealer activity stats (Total posts, WTS count, WTB count, etc.) across both Trading Floor and Price Research detail views.
2. **Requirement R4 (Relaxed Outlier Filters)**: Changing IQR fence multiplier from 1.5×IQR to 3.0×IQR and lowering the minimum comparable observation threshold from 5 observations to 2.

---

## 2. Requirement R3: Seller Contacts & Raw Message Display

### Current Codebase Behavior
- **Server-Side Redaction**: `api/_lib/source-redaction.cjs` defines `redactPublicSource()` which replaces phone numbers (`[PHONE REDACTED]`), emails (`[EMAIL REDACTED]`), URLs (`[LINK REDACTED]`), handles (`[HANDLE REDACTED]`), and dealer tags with placeholder strings.
- **Server Endpoints Applying Redaction**:
  - `api/price-research-listing.js`: Lines 94 & 228 pass raw messages through `redactPublicSource(...)`.
  - `api/co-pilot.js`: Line 64 passes raw messages through `redactPublicSource(...)`.
  - `api/export-excel.js`: Line 92 passes raw messages through `redactPublicSource(...)`.
  - `api/review-packet-item.js`: Line 63 passes raw messages through `redactPublicSource(...)`.
- **Server Endpoints Gating Seller Contact Info**:
  - `api/listing-contact.js`: Lines 114–156 check `OWNER_APPROVED_CONTACT_PUBLIC` flag or `seller_listing_lineage_staging` match before returning seller contact details. If unverified/unflagged, returns `contact_available: false` with reasons like `DEALER_UNRESOLVED` or `CONTACT_NOT_VERIFIED`.
  - `api/reviewed-seller-summary.js`: Lines 7–11 check `listing.contact_publication_approved === true`. If false, returns `contact_available: false`.
- **Frontend Views**:
  - `src/pages/TradingFloor.tsx`: Lines 858–861 withhold raw messages if `raw_message_scope === 'normalized_summary'`. Lines 867–871 display a truncation notice. Lines 809–851 render contact details or show "A publishable source contact was not supplied for this listing".
  - `src/pages/PriceResearch.tsx`: Lines 1913–1926 display a badge `<span ...>ORIGINAL LISTING / CONTACT REDACTED</span>` and text stating direct contact tokens are redacted. Lines 1873–1911 render `Posted by` card which defaults to "Poster data is not available for this listing" if `seller?.dealer_name` is missing.

### Exact File Paths, Line Numbers, and Required Modifications for R3

#### 1. `api/_lib/source-redaction.cjs`
- **Lines 3–13**: `redactPublicSource(value)`
- **Modification**: Modify `redactPublicSource` to return the original unredacted text string `return String(value || '')`, or remove masking regex patterns so phone numbers, handles, poster names, and links are preserved intact.

#### 2. `api/price-research-listing.js`
- **Lines 94 & 228**: Calls `redactPublicSource(workbookListing.raw_message || '')` and `redactPublicSource(rawSource.text)`.
- **Lines 109–111 & 243–245**: Sets `raw_message_scope` and `raw_message_truncated`.
- **Modification**: Pass `rawSource.text` / `workbookListing.raw_message` directly as `raw_message` without calling `redactPublicSource`. Set `raw_message_scope` to `'original_post'` and `raw_message_truncated` to `false`.

#### 3. `api/listing-contact.js`
- **Lines 114–156**: `hasOwnerApprovedPublicContact(listing.flags)` and dealer lineage checks.
- **Modification**: Fallback to returning `seller_name` and `seller_phone` directly from `watch_records` whenever present, normalizing `seller_phone` to format `whatsapp_url` (`https://wa.me/${phone}`), and returning `contact_available: true`.

#### 4. `api/reviewed-seller-summary.js`
- **Lines 7–11**: `approvedPhone(listing)` function.
- **Modification**: Remove requirement for `contact_publication_approved === true`; return `listing.phone_number` and `listing.posted_by` whenever present, and fetch `loadSellerAnalytics`.

#### 5. `src/pages/TradingFloor.tsx`
- **Lines 809–851**: `ListingDetails` contact section.
- **Lines 853–878**: `ListingDetails` raw message section.
- **Lines 889–902**: `sourcePosterContact` helper.
- **Modification**: Remove withholding condition for `normalized_summary`. Always render `listing.raw_message || listing.raw_line || listing.description`. Always display seller name, phone display, clickable WhatsApp button (`https://wa.me/${digits}`), and `sellerAnalytics` metrics grid.

#### 6. `src/pages/PriceResearch.tsx`
- **Lines 1873–1911**: `Posted by` `DetailCard`.
- **Lines 1913–1926**: `Original listing` `DetailCard`.
- **Modification**: Remove `ORIGINAL LISTING / CONTACT REDACTED` badge and redaction notice text. Render complete `detail.raw_message`. Ensure `seller` contact card displays seller name, phone number, WhatsApp button, and dealer activity stats (`total_posts`, `wts_posts`, `wtb_posts`, `active_listings`, first/last post).

---

## 3. Requirement R4: Relaxed Outlier Filters (3.0×IQR & 2+ Observations)

### Current Codebase Behavior
- **1.5×IQR Fence Enforced**:
  - Outlier calculations multiply Interquartile Range (IQR) by `1.5` to construct lower and upper fences (`q1 - 1.5 * iqr`, `q3 + 1.5 * iqr`).
- **5-Observation Minimum Gate**:
  - References, cohorts, dial groups, and analytics charts enforce `count >= 5` or `prices.length >= 5` before rendering price statistics or running IQR outlier filtering.

### Exact File Paths, Line Numbers, and Required Modifications for R4

#### 1. `api/_lib/market-stats.cjs`
- **Line 27**: `const sample_quality = raw.length < 5 ? 'observational' : ...`
  - **Modification**: Change `raw.length < 5` to `raw.length < 2`.
- **Lines 36–37**:
  ```js
  const lower_fence = raw.length >= 5 ? q1 - 1.5 * iqr : null;
  const upper_fence = raw.length >= 5 ? q3 + 1.5 * iqr : null;
  ```
  - **Modification**: Change `raw.length >= 5` to `raw.length >= 2`. Change `1.5` to `3.0`.
- **Line 49**: `analytics_ready: raw.length >= 5`
  - **Modification**: Change `raw.length >= 5` to `raw.length >= 2`.

#### 2. `api/price-research.js`
- **Line 187**: `.filter(cohort => cohort.count >= 5)`
  - **Modification**: Change `cohort.count >= 5` to `cohort.count >= 2`.
- **Line 447**: `methodology: { method: 'IQR_1_5', minimum_sample: 5, ... }`
  - **Modification**: Change `'IQR_1_5'` to `'IQR_3_0'`, and `minimum_sample: 5` to `minimum_sample: 2`.
- **Line 694**: `.filter(d => d.count >= 5)`
  - **Modification**: Change `d.count >= 5` to `d.count >= 2`.
- **Lines 832–835**:
  ```js
  method: 'PLAUSIBILITY_FLOOR_THEN_IQR_1_5',
  minimum_sample: 5,
  ```
  - **Modification**: Change `'PLAUSIBILITY_FLOOR_THEN_IQR_1_5'` to `'PLAUSIBILITY_FLOOR_THEN_IQR_3_0'`, and `minimum_sample` to `2`.

#### 3. `api/model-stats.js`
- **Line 18**: `const MIN_BUCKET = 5;`
  - **Modification**: Change `5` to `2`.
- **Lines 38–39**:
  ```js
  const lo = Math.max(q1 - 1.5 * iqr, SANITY_FLOOR);
  const hi = q3 + 1.5 * iqr;
  ```
  - **Modification**: Change `1.5` to `3.0`.

#### 4. `api/pipeline-parse.js`
- **Line 899**: `@param {number} [mult=1.5] - IQR fence multiplier`
- **Line 903**: `function priceIsOutlier(price, prices, mult = 1.5, tol = 0.10)`
- **Lines 949–957**: default mult parameters in `_iqrParams`.
- **Line 1120**: `note: Insufficient data for IQR (${poolSize} < 5 points)`
  - **Modification**: Change default `mult` from `1.5` to `3.0`, and threshold from `5` to `2`.

#### 5. `src/lib/analytics.ts`
- **Line 57**: `if (prices.length < 5) return { keep: prices, remove: [] };`
  - **Modification**: Change `prices.length < 5` to `prices.length < 2`.
- **Lines 64–65**:
  ```ts
  const lower = q1 - 1.5 * iqr;
  const upper = q3 + 1.5 * iqr;
  ```
  - **Modification**: Change `1.5` to `3.0`.
- **Line 74**: `export function buildPriceAnalytics(records: WatchRecord[], minDataPoints = 5)`
  - **Modification**: Change default `minDataPoints = 5` to `minDataPoints = 2`.

#### 6. `src/lib/pipeline.ts`
- **Line 495**: `if (prices.length < 5)`
  - **Modification**: Change `prices.length < 5` to `prices.length < 2`.
- **Lines 504–505**:
  ```ts
  const lowerBound = q1 - 1.5 * iqr;
  const upperBound = q3 + 1.5 * iqr;
  ```
  - **Modification**: Change `1.5` to `3.0`.
- **Line 521**: `minDataPoints = 5`
  - **Modification**: Change default `minDataPoints = 5` to `minDataPoints = 2`.

#### 7. `src/lib/pipelineClient.ts`
- **Line 80**: `const { outliers } = applyIQRFiltering(forIqr, 5);`
  - **Modification**: Change `applyIQRFiltering(forIqr, 5)` to `applyIQRFiltering(forIqr, 2)`.

#### 8. `src/pages/InsightDetails.tsx`
- **Lines 85–86**:
  ```ts
  const lowerBound = q1 - 1.5 * iqr;
  const upperBound = q3 + 1.5 * iqr;
  ```
  - **Modification**: Change `1.5` to `3.0`.

#### 9. `src/pages/PriceResearch.tsx`
- **Line 289**: `method: 'IQR_1_5' | 'PLAUSIBILITY_FLOOR_THEN_IQR_1_5'; minimum_sample: number;`
  - **Modification**: Update type to `'IQR_3_0' | 'PLAUSIBILITY_FLOOR_THEN_IQR_3_0'`.
- **Line 883**: `IQR-filtered — only references with 5+ real listings included`
  - **Modification**: Update text to `IQR-filtered — references with 2+ real listings included`.
- **Line 1246**: `standard 1.5 x IQR fences applied.`
  - **Modification**: Update text to `standard 3.0 x IQR fences applied.`.
- **Line 1280**: `cohort with five or more observations uses the market plausibility floor and standard 1.5 x IQR method.`
  - **Modification**: Update text to `cohort with two or more observations uses the market plausibility floor and standard 3.0 x IQR method.`.
- **Line 1828**: `{benchmark && comparableCount >= 5 && <div ...>`
  - **Modification**: Change `comparableCount >= 5` to `comparableCount >= 2`.

---

## 4. Verification Methods

1. **TypeScript Build Verification**:
   - Command: `npm run build`
   - Goal: Ensure 0 TypeScript or build errors.
2. **Normalization Test Suite**:
   - Command: `npm run test:normalization`
   - Goal: Verify core normalization, market stats, and price research eligibility tests pass cleanly with updated 3.0x IQR parameters.
