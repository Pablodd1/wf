# Forensic Audit Report — Milestone M2: WTB Demand Signals Integration in Price Research (R2)

**Auditor**: `auditor_m2_1`  
**Working Directory**: `C:\tmp_s3_check\wf`  
**Metadata Directory**: `C:\tmp_s3_check\wf\.agents\auditor_m2_1`  
**Date**: 2026-08-03  
**Profile**: General Project / Forensic Integrity Audit  
**Integrity Mode**: Development (from `ORIGINAL_REQUEST.md`)  
**Verdict**: `CLEAN`

---

## 1. Executive Verdict & Forensic Summary

| Check Phase | Status | Details |
|---|---|---|
| **Phase 1: Hardcoded Output Check** | `PASS` | No hardcoded test results, fake data bypasses, or fixed string literals found in `api/price-research.js` or `src/pages/PriceResearch.tsx`. |
| **Phase 1: Facade Implementation Check** | `PASS` | All WTB demand signals, contact serialization, WhatsApp link synthesis, unredacted raw messages, and image previews are dynamically computed from data payloads. |
| **Phase 1: Pre-populated Artifact Check** | `PASS` | No pre-existing fake attestation files or pre-baked result artifacts detected. |
| **Phase 2: Independent Build Verification** | `PASS` | `npm run build` (`tsc -b && vite build`) executed independently with **Exit Code 0** and 0 TypeScript compilation errors (2,785 modules transformed in 9.53s). |
| **Phase 2: Math & Behavioral Verification** | `PASS` | `node tests/verify_reconciliation_math.cjs` executed with 5/5 test scenarios returning `equals: true`. |

**FINAL VERDICT**: **`CLEAN`**

---

## 2. Observation

1. **Source Code Forensic Inspection (`api/price-research.js`)**:
   - Lines 183-196: `lookupDemand` groups rows by `dial_color` and filters cohorts using `.filter(cohort => cohort.count >= 1)`. All WTB cohorts (including 1+ or 2+ observations) are dynamically retained without hardcoding cohort counts or skipping valid sparse demand.
   - Lines 198-223: `demandRowsSerialized` dynamically maps row payloads:
     ```javascript
     const phone = row.seller_phone || row.phone_number || null;
     const phoneDigits = phone ? String(phone).replace(/[^0-9]/g, '') : '';
     const whatsappUrl = phoneDigits.length >= 7 ? `https://wa.me/${phoneDigits}` : null;
     const imgCandidate = row.thumbnail_url || row.image_url || row.display_image_url || (Array.isArray(row.image_urls) ? row.image_urls[0] : null) || null;
     ```
     All contact names, phone numbers, WhatsApp URLs, unredacted raw messages (`row.raw_message`), and image thumbnails (`imgCandidate`) are extracted directly from dataset objects.
   - Lines 781-804: Dynamic reconciliation object construction:
     ```javascript
     const reconciliation = {
       total_tracked_listings: totalTrackedListings,
       wts_eligible_analytics_count: wtsEligibleAnalyticsCount,
       wtb_demand_count: wtbDemandCount,
       excluded_count: excludedTotalCount,
       excluded_breakdown: { unpriced: unpricedCount, outliers: outliersCount, unsplit_bundles: unsplitBundlesCount },
     };
     ```
   - Searches for pattern `mock|fake|dummy|hardcode` in `api/price-research.js` returned 0 matches.

2. **Frontend UI Forensic Inspection (`src/pages/PriceResearch.tsx`)**:
   - `DemandSignalsSection` dynamically receives `demandCohorts`, `demandCount`, and `demandRows` from the API response payload.
   - Cohort pills render dynamically with `cohort.dial_color` and `cohort.count.toLocaleString()`.
   - `WtbDemandCard` component:
     - Phone / WhatsApp link synthesis:
       ```typescript
       const whatsappUrl = row.whatsapp_url || (phone ? `https://wa.me/${phone.replace(/[^0-9]/g, '')}` : null);
       ```
       Renders an `<a href={whatsappUrl}>` element styled with a WhatsApp green badge (`#25D366`).
     - Unredacted raw source message container:
       ```tsx
       <pre style={{ margin: 0, padding: 10, background: '#111827', color: '#e5e7eb', borderRadius: 6, fontSize: 11, lineHeight: 1.5, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', maxHeight: 130, overflowY: 'auto' }}>
         {row.raw_message}
       </pre>
       ```
       Renders `row.raw_message` directly with zero redactions or asterisks.
     - Thumbnail image container renders `<img src={imgUrl} alt={title} />` when `imgUrl` is present.
   - Strict separation is preserved: WTB listings are rendered in their own dedicated `DemandSignalsSection` and modal view; they are never included in WTS asking-price averages or IQR fences.
   - Searches for pattern `mock|fake|dummy|hardcode` in `src/pages/PriceResearch.tsx` returned 0 matches.

3. **Independent Build Command Output**:
   Command: `npm run build`
   Output snippet:
   ```text
   > my-app@0.0.0 build
   > tsc -b && vite build

   vite v7.3.0 building client environment for production...
   ✓ 2785 modules transformed.
   rendering chunks...
   computing gzip size...
   dist/index.html                                1.41 kB │ gzip:   0.63 kB
   dist/assets/PriceResearch-Bl_2HrNe.js         93.47 kB │ gzip:  21.51 kB
   ...
   ✓ built in 9.53s
   ```
   Exit Code: `0`

4. **Independent Reconciliation Test Execution**:
   Command: `node tests/verify_reconciliation_math.cjs`
   Output:
   ```text
   --- REFINED RECONCILIATION MATH TESTS ---
   Test 1 (Standard): { totalTrackedListings: 100, wtsEligibleAnalyticsCount: 60, wtbDemandCount: 10, unpricedCount: 23, outliersCount: 5, unsplitBundlesCount: 2, excludedTotalCount: 30, sum: 100, equals: true }
   Test 2 (Demand Overflow): { totalTrackedListings: 50, wtsEligibleAnalyticsCount: 35, wtbDemandCount: 12, unpricedCount: 0, outliersCount: 2, unsplitBundlesCount: 1, excludedTotalCount: 3, sum: 50, equals: true }
   Test 3 (Zero WTB): { totalTrackedListings: 50, wtsEligibleAnalyticsCount: 40, wtbDemandCount: 0, unpricedCount: 6, outliersCount: 4, unsplitBundlesCount: 0, excludedTotalCount: 10, sum: 50, equals: true }
   Test 4 (Zero Total): { totalTrackedListings: 0, wtsEligibleAnalyticsCount: 0, wtbDemandCount: 0, unpricedCount: 0, outliersCount: 0, unsplitBundlesCount: 0, excludedTotalCount: 0, sum: 0, equals: true }
   Test 5 (Null Demand): { totalTrackedListings: 50, wtsEligibleAnalyticsCount: 30, wtbDemandCount: 8, unpricedCount: 9, outliersCount: 2, unsplitBundlesCount: 1, excludedTotalCount: 12, sum: 50, equals: true }

   ALL 5 RECONCILIATION MATH TESTS PASSED PERFECTLY!
   ```
   Exit Code: `0`

---

## 3. Logic Chain

1. **Premise**: Hardcoding test outputs, injecting dummy mock responses, or failing typescript build checks constitutes an integrity violation.
2. **Observation 1**: Code inspection of `api/price-research.js` and `src/pages/PriceResearch.tsx` demonstrates that all data transformations (retention of cohorts with count >= 1, contact extraction, WhatsApp link generation `https://wa.me/<digits>`, raw message rendering, thumbnail previewing, and reconciliation math) are dynamically derived from input data payloads. No hardcoded or mock bypasses exist.
3. **Observation 2**: Independent build execution of `npm run build` returned Exit Code 0 with 0 TypeScript compilation errors.
4. **Observation 3**: Independent execution of `tests/verify_reconciliation_math.cjs` confirmed that reconciliation math formulas strictly balance across 5 edge case scenarios (`equals: true`).
5. **Conclusion**: Milestone M2 work product contains zero integrity violations and passes all forensic checks. The verdict is `CLEAN`.

---

## 4. Caveats

- None. All audit checks were executed directly against the local workspace files and verified via clean tool execution.

---

## 5. Conclusion

The forensic audit for **Milestone M2 — WTB Demand Signals Integration in Price Research (R2)** is complete.

**Verdict**: **`CLEAN`**

---

## 6. Verification Method

To re-verify this forensic audit independently:

1. **Run TypeScript Build Check**:
   ```powershell
   npm run build
   ```
   Expected output: Exit code 0, 0 TypeScript errors.

2. **Run Reconciliation Math Verification Test**:
   ```powershell
   node tests/verify_reconciliation_math.cjs
   ```
   Expected output: All 5 tests pass (`equals: true`).

3. **Inspect WTB Demand Logic & Contact Flow-Through**:
   Inspect `api/price-research.js` around line 185 (retention of cohorts >= 1) and line 198 (serialization of `demand_rows` with WhatsApp links and raw messages), and `src/pages/PriceResearch.tsx` around line 1250 (`WtbDemandCard` and `DemandSignalsSection`).
