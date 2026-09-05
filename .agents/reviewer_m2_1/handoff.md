# Handoff Report — Milestone M2: WTB Demand Signals Integration Code Review & Verification

**Reviewer**: `reviewer_m2_1`  
**Roles**: `reviewer`, `critic`  
**Working Directory**: `C:\tmp_s3_check\wf`  
**Metadata Directory**: `C:\tmp_s3_check\wf\.agents\reviewer_m2_1`  
**Date**: 2026-08-03  
**Verdict**: `APPROVE`  

---

## 1. Observation

1. **WTB Cohort Retention Gate (`api/price-research.js`)**:
   - `lookupDemand` previously used a `.filter(cohort => cohort.count >= 5)` threshold.
   - Verified that line 195 in `api/price-research.js` now uses `.filter(cohort => cohort.count >= 1)`. All WTB demand cohorts (1+, 2+, 3+, 4+ observations) are retained without discarding small cohorts.
   - `lookupDemand` accepts `preloadedRows` and correctly queries fields: `seller_name`, `seller_phone`, `phone_number`, `posted_by`, `image_url`, `thumbnail_url`, `display_image_url`, `image_urls`, and `raw_message`.
   - Serialized `demand_rows` payload includes formatted WhatsApp link (`https://wa.me/<digits>`), raw message, seller/buyer name, phone number, and image candidates.

2. **Frontend Demand Signals UI & Contact / Message Flow-Through (`src/pages/PriceResearch.tsx`)**:
   - `WtbListingData` interface and updated `LiquidityData` and `PriceData` interfaces accurately model `demand_rows`.
   - `DemandSignalsSection` (lines 2090–2171) renders a dedicated WTB Demand Signals section displaying Total WTB Volume and WTB/WTS ratio side-by-side with WTS asking-price statistics.
   - `WtbDemandCard` (lines 2173–2270) renders:
     - WTB status badge.
     - Buyer / Poster name (`seller_name` / `posted_by`).
     - Phone number and clickable green WhatsApp link button (`https://wa.me/<digits>`).
     - Unredacted raw source message in a dark `<pre>` container without redaction or asterisks.
     - Image thumbnail preview when available.
   - WTB listings are strictly separated from WTS asking-price stats: `mapWtbToRowData` marks WTB rows with `is_outlier: true` and `source: 'WTB_DEMAND'` so they are excluded from WTS averages, medians, IQR fences, and trend graphics.

3. **Build & Execution Verification**:
   - `npm run build` (`tsc -b && vite build`) executed cleanly with **Exit Code 0** and 0 TypeScript compilation errors (2,785 modules transformed in 9.56s).
   - `node tests/verify_reconciliation_math.cjs` executed with **Exit Code 0** and 5/5 test scenarios passed (`equals: true`).

4. **Integrity & Adversarial Review**:
   - Checked for integrity violations (hardcoded test outputs, dummy implementations, shortcuts, self-certifying bypasses). None found. Code dynamically processes WTB records and builds real WhatsApp links and UI elements.

---

## 2. Logic Chain

1. **Criterion 1 (Cohort Retention)**:
   - Observation: Line 195 of `api/price-research.js` filters WTB cohorts with `cohort.count >= 1`.
   - Logic: Cohorts with < 5 observations (e.g. 1 to 4 observations) are retained in `demand_cohorts` and returned in the API response.

2. **Criterion 2 (Dedicated Demand Signals UI)**:
   - Observation: `DemandSignalsSection` in `src/pages/PriceResearch.tsx` renders WTB volume, WTB/WTS ratio, dial cohorts, and listing cards.
   - Logic: The component is inserted at line 1192 in the main reference detail view flow, providing side-by-side visibility with WTS price charts.

3. **Criterion 3 (Strict WTB / WTS Separation)**:
   - Observation: `classifyResearchEligibility` in `api/price-research.js` flags WTB rows as `MISSING_PRICE` for WTS stats. In `src/pages/PriceResearch.tsx`, `mapWtbToRowData` sets `is_outlier: true`.
   - Logic: WTB listings cannot contaminate WTS averages, medians, IQR bounds, or line chart points.

4. **Criterion 4 (Contact, Raw Message & Image Flow-Through)**:
   - Observation: `WtbDemandCard` renders `sellerName`, `phone`, `whatsappUrl`, `raw_message`, and `imgUrl`.
   - Logic: All 4 data elements (seller/buyer contact, phone, WhatsApp link, unredacted raw source message, image) are visible on WTB demand cards.

5. **Criterion 5 (Build Verification)**:
   - Command: `npm run build` -> Exit code 0, 0 TypeScript errors.

---

## 3. Caveats

- In offline or DB-unreachable environments, backend APIs gracefully fall back to preloaded JSON datasets (`top_watches_trading_floor.json`, `enriched_refs.json`). Contact parsing and WhatsApp URL formatting operate deterministically in both online and fallback modes.

---

## 4. Conclusion

Milestone M2 (WTB Demand Signals Integration in Price Research) meets all requirements and quality standards.

**Explicit Verdict**: `APPROVE`

---

## 5. Verification Method

To independently re-verify:

1. **TypeScript Build Verification**:
   ```powershell
   npm run build
   ```
   *Expected Output*: Exit Code 0, 0 TypeScript errors.

2. **Reconciliation Math & WTB Formula Test**:
   ```powershell
   node tests/verify_reconciliation_math.cjs
   ```
   *Expected Output*: Exit Code 0, 5/5 tests PASSED (`equals: true`).

3. **Code Inspection**:
   - Inspect `api/price-research.js` line 195 (`cohort.count >= 1`).
   - Inspect `src/pages/PriceResearch.tsx` lines 2090–2270 (`DemandSignalsSection` & `WtbDemandCard`).
