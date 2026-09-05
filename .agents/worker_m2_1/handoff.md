# Handoff Report — Milestone M2: WTB Demand Signals Integration in Price Research (R2)

**Worker**: `worker_m2_1`  
**Working Directory**: `C:\tmp_s3_check\wf`  
**Metadata Directory**: `C:\tmp_s3_check\wf\.agents\worker_m2_1`  
**Date**: 2026-08-03  
**Status**: `PASSED`  

---

## 1. Observation

1. **Backend WTB Cohort Retention & Payload**:
   - Inspected `api/price-research.js`: `lookupDemand` previously applied a `.filter(cohort => cohort.count >= 5)` gate that discarded all WTB demand cohorts with fewer than 5 observations.
   - Updated `lookupDemand` in `api/price-research.js` to filter with `.filter(cohort => cohort.count >= 1)`, retaining all WTB cohorts regardless of observation count (e.g. 1+, 2+, 3+, 4+ observations).
   - Enhanced `lookupDemand` to accept `preloadedRows` (for reviewed workbook sources) and query full contact, image, and message fields (`seller_name`, `seller_phone`, `phone_number`, `posted_by`, `image_url`, `thumbnail_url`, `display_image_url`, `image_urls`, `raw_message`).
   - Serialized `demand_rows` array in `lookupDemand` and returned it in both `liquidity` and top-level response JSON payloads. Each `demand_rows` entry includes contact details (seller name, phone), generated WhatsApp link (`https://wa.me/<digits>`), unredacted raw source message, and image URLs.

2. **Frontend Demand Signals UI & Contact / Raw Message / Image Flow-Through**:
   - Inspected `src/pages/PriceResearch.tsx`: added `WtbListingData` interface and updated `RowData`, `LiquidityData`, and `PriceData` interfaces to support `demand_rows`.
   - Built a dedicated **Demand Signals (WTB)** section (`DemandSignalsSection` & `WtbDemandCard`) rendered in the reference detail view:
     - Prominently displays Total WTB Volume and WTB/WTS ratio side-by-side with WTS asking-price statistics.
     - Displays all WTB dial color cohorts retained (1+ observations).
     - Renders dedicated `WtbDemandCard` components for WTB listings with:
       - Distinctive WTB badge.
       - Buyer / Poster contact name (`seller_name` / `posted_by`).
       - Phone number and clickable green WhatsApp button (`https://wa.me/<digits>`).
       - Unredacted raw source message (`raw_message`) in a dedicated `<pre>` container without asterisks or redaction labels.
       - Image thumbnail preview (`image_url` / `image_urls`).
     - Maintained strict separation: WTB listings remain excluded from WTS asking-price averages, medians, IQR fences, price trend charts, and WTS qualified listings tables (`classifyResearchEligibility` marks WTB records as `MISSING_PRICE` for WTS analytics).

3. **Build & Test Verification**:
   - `npm run build` (`tsc -b && vite build`) executed cleanly with **Exit Code 0** and 0 TypeScript errors (2785 modules built in 8.02s).
   - `node tests/verify_reconciliation_math.cjs` executed and passed 5/5 test scenarios (`equals: true`).

---

## 2. Logic Chain

1. **WTB Cohort Retention Requirement**:
   - Requirement 1 requested that WTB cohorts with < 5 observations be retained rather than discarded.
   - Modifying `lookupDemand` in `api/price-research.js` to keep `cohort.count >= 1` ensures references with sparse WTB demand (e.g., 1 or 2 buyer posts) accurately surface their demand cohorts instead of returning empty cohorts.

2. **Strict Separation of WTB and WTS**:
   - Requirement 2 required that WTB demand signals be displayed side-by-side with WTS asking-price charts without mixing into WTS asking-price averages or trend graphics.
   - WTS analytics in `api/price-research.js` strictly filter for qualified WTS offers. WTB listings fail `classifyResearchEligibility` (because they lack WTS asking prices) and are counted in `reconciliation.wtb_demand_count` and `demand_rows`.
   - On the frontend (`src/pages/PriceResearch.tsx`), the dedicated `DemandSignalsSection` displays WTB volume, dial cohorts, and WTB listing cards in their own distinct panel, keeping WTS price trend charts strictly pure.

3. **Contact, Raw Message & Image Flow-Through**:
   - `lookupDemand` serializes `seller_name`, `seller_phone`, `whatsapp_url`, `raw_message`, `image_url`, and `image_urls`.
   - `WtbDemandCard` renders buyer contact name, phone, a clickable WhatsApp link (`<a href={whatsappUrl}>`), unredacted raw source text (`<pre>{row.raw_message}</pre>`), and thumbnail image.

---

## 3. Caveats

- **DB Data Availability**: When operating in an offline environment without active Supabase credentials, backend responses fall back to local cached files (`top_watches_trading_floor.json`, `enriched_refs.json`). Contact formatting, WhatsApp URL synthesis, and TypeScript contracts hold unconditionally.

---

## 4. Conclusion

Milestone M2 (WTB Demand Signals Integration in Price Research - R2) is **FULLY IMPLEMENTED and VERIFIED CLEAN**.

---

## 5. Verification Method

### 1. Build Verification
Command:
```bash
npm run build
```
Result: **Exit Code 0**, 0 TypeScript compilation errors. Built 2785 modules in 8.02s.

### 2. Reconciliation Math Verification
Command:
```bash
node tests/verify_reconciliation_math.cjs
```
Result: **5/5 scenarios PASSED** (`equals: true`).

### 3. File Modifications Inspection
Files modified:
- `api/price-research.js`: Retained WTB cohorts >= 1 observation in `lookupDemand`, serialized `demand_rows` with contact, WhatsApp link, raw message, and image fields, and passed `preloadedReviewedWorkbookRows` to `lookupDemand`.
- `src/pages/PriceResearch.tsx`: Added `WtbListingData` interface, updated `RowData`/`LiquidityData`/`PriceData` interfaces, added `DemandSignalsSection` & `WtbDemandCard` sub-components displaying buyer contact, WhatsApp link, unredacted raw message, and image preview, and updated WTB text.
