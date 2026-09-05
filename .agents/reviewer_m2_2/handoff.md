# Handoff Report — Milestone M2 Review (WTB Demand Signals Integration in Price Research)

**Reviewer**: `reviewer_m2_2`  
**Working Directory**: `C:\tmp_s3_check\wf`  
**Metadata Directory**: `C:\tmp_s3_check\wf\.agents\reviewer_m2_2`  
**Date**: 2026-08-03  
**Verdict**: `APPROVE`

---

## 1. Observation

1. **Backend WTB Cohort Retention (`api/price-research.js`)**:
   - `lookupDemand` line 195: `.filter(cohort => cohort.count >= 1)` retains all WTB demand cohorts regardless of observation count (keeps cohorts >= 1 observation rather than discarding those < 5).
   - Lines 198–224: `lookupDemand` serializes demand row objects with `id`, `brand`, `model`, `reference`, `dial_color`, `condition`, `listing_type`, `raw_message`, `seller_name`, `seller_phone`, `whatsapp_url`, `image_url`, `image_urls`, `has_images`, `created_at`, `listing_date`, `price_usd`, `price_raw`, `currency`.
   - Lines 815–816 & 942: `demand_rows` and `liquidity` (containing `demand_cohorts` and `demand_count`) are returned in the top-level API JSON response.

2. **Frontend UI Rendering & Isolation (`src/pages/PriceResearch.tsx`)**:
   - Lines 2090–2171 (`DemandSignalsSection`): Renders a dedicated "Demand Signals (WTB)" banner displaying total WTB demand volume, WTB/WTS ratio, and dial color cohorts (1+ observations) side-by-side with WTS statistics.
   - Lines 2173–2270 (`WtbDemandCard`): Displays seller/buyer contact name (`sellerName`), phone (`phone`), clickable WhatsApp link (`<a href={whatsappUrl}>`), unredacted raw source message (`<pre>{row.raw_message}</pre>`), and thumbnail image (`imgUrl`).
   - WTB isolation: WTS statistics (averages, medians, IQR fences, monthly price trend charts) filter exclusively for qualified WTS listings (`classifyResearchEligibility` classifies WTB rows as `MISSING_PRICE` for WTS analytics). In `mapWtbToRowData` (lines 2272–2297), WTB rows carry `source: 'WTB_DEMAND'` and `is_outlier: true`, preventing mixing into WTS asking-price statistics.

3. **Build & Script Verification**:
   - Command: `npm run build` (`tsc -b && vite build`) executed cleanly with **Exit Code 0** and 0 TypeScript compilation errors (2785 modules built).
   - Command: `node tests/verify_reconciliation_math.cjs` executed with **Exit Code 0** passing 5/5 math reconciliation scenarios (`equals: true`).

4. **Integrity & Code Review**:
   - No hardcoded test results, dummy facades, or self-certifying shortcuts were found.
   - All contact formatting, WhatsApp link generation, raw message preservation, and UI rendering reflect real underlying data.

---

## 2. Logic Chain

1. **Verification of Criterion 1 (WTB Cohort Retention)**:
   - Observation 1 demonstrates `lookupDemand` in `api/price-research.js` filters WTB cohorts with `.filter(cohort => cohort.count >= 1)`.
   - Therefore, reference queries with 1 to 4 WTB observations retain their cohorts without being discarded by a 5-observation gate.

2. **Verification of Criterion 2 & 3 (UI Rendering & Strict Isolation)**:
   - Observation 2 demonstrates `DemandSignalsSection` in `src/pages/PriceResearch.tsx` renders WTB volume, WTB/WTS ratio, and dial cohorts in a dedicated panel.
   - Observation 2 further confirms that WTS asking-price statistics and graphics use `includedRows` filtered via `classifyResearchEligibility` (which marks WTB rows as `MISSING_PRICE`), preventing WTB listings from contaminating WTS averages, medians, IQR fences, or trend charts.

3. **Verification of Criterion 4 (Contact, Raw Message & Image Flow-Through)**:
   - Observation 1 & 2 confirm `lookupDemand` outputs serialized contact fields (`seller_name`, `seller_phone`, `whatsapp_url`), raw source messages (`raw_message`), and images, which `WtbDemandCard` renders in full with zero redactions or asterisks.

4. **Verification of Criterion 5 (Build & Math Verification)**:
   - Observation 3 confirms `npm run build` succeeds with Exit Code 0 and zero TypeScript errors, and all math reconciliation tests pass 5/5.

---

## 3. Caveats

- **Supabase Credentials Fallback**: In environments without live Supabase database connections, the backend gracefully falls back to cached local JSON structures (`top_watches_trading_floor.json`, `enriched_refs.json`). All TypeScript types, payload contracts, and UI components remain strictly enforced and fully functional.

---

## 4. Conclusion

Milestone M2 — WTB Demand Signals Integration in Price Research (R2) meets all requirements and verification criteria. No integrity violations or defects were identified.

**Verdict**: `APPROVE`

---

## 5. Verification Method

### 1. Build Verification
```powershell
npm run build
```
*Expected*: Exit Code 0, 0 TypeScript errors.

### 2. Reconciliation Math Test Verification
```powershell
node tests/verify_reconciliation_math.cjs
```
*Expected*: Exit Code 0, 5/5 scenarios passed (`equals: true`).

### 3. File Verification
- `api/price-research.js`: Lines 193–196 (`cohort.count >= 1`), lines 198–224 (serialized `demand_rows`).
- `src/pages/PriceResearch.tsx`: Lines 2090–2171 (`DemandSignalsSection`), lines 2173–2270 (`WtbDemandCard`).
