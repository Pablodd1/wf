# Forensic Audit Handoff Report — Milestone M1 (Data Consistency R1)

**Agent**: `auditor_m1_1`  
**Role**: `forensic_auditor`, `critic`, `specialist`  
**Working Directory**: `C:\tmp_s3_check\wf\.agents\auditor_m1_1`  
**Date**: 2026-08-03  
**Verdict**: `INTEGRITY VIOLATION`

---

## 1. Observation

1. **Code Changes Inspected**:
   - `api/_lib/reviewed-workbook-analytics.cjs`:
     - Line 3: Updated `MARKET_SOURCE_VIEW` from `'reviewed_workbook_market_source'` to `'reviewed_workbook_market_source_v2'`.
     - Lines 75-81: Removed `.eq('listing_type', 'WTS')` restriction in `loadReviewedWorkbookAnalyticsRows`, allowing WTB demand listings, unpriced records, and bundles matching `has_complete_identity = true` and valid verification status to be retrieved for reconciliation.
   - `api/price-research.js`:
     - Lines 741-759: Calculated exact count reconciliation metrics dynamically from database query rows:
       `totalTrackedListings = rows.length`
       `wtsEligibleAnalyticsCount = includedRows.length`
       `wtbDemandCount = demand?.demand_count || ...`
       `outliersCount = statisticalOutlierRows.length`
       `unsplitBundlesCount = bundleParentExcludedCount`
       `unpricedCount = totalTrackedListings - wtsEligibleAnalyticsCount - wtbDemandCount - outliersCount - unsplitBundlesCount`
       `excludedTotalCount = unpricedCount + outliersCount + unsplitBundlesCount`
     - Lines 760-773: Constructed dynamic `reconciliation` summary object in response payload.
   - `src/pages/PriceResearch.tsx`:
     - Lines 260-270: Added `reconciliation` interface properties to `PriceData`.
     - Lines 1157-1200: Added UI card rendering `Dataset Listing Reconciliation (Trading Floor Parity)`.
     - Line 1982: Added condition check:
       `detail.raw_message_scope === 'stored_source_message' || detail.raw_message_scope === 'reviewed_workbook_source'`

2. **Static Analysis Results**:
   - Hardcoded values / watch counts / fake payloads: **None found**. All reconciliation numbers are computed dynamically from real database query row subsets.
   - Genuine query source: **Confirmed**. Endpoint queries `reviewed_workbook_market_source_v2` / Supabase.
   - Facade or dummy functions: **None found**. Math calculations reflect actual row filtering and IQR/outlier classifications.

3. **Build Execution (`npm run build`)**:
   - Executed `npm run build` in `C:\tmp_s3_check\wf`.
   - Result: Exit Code 1 (FAILED).
   - Verbatim error:
     ```
     > my-app@0.0.0 build
     > tsc -b && vite build

     src/pages/PriceResearch.tsx(1982,81): error TS2367: This comparison appears to be unintentional because the types '"unavailable"' and '"reviewed_workbook_source"' have no overlap.
     ```

---

## 2. Logic Chain

1. **Dataset View & Reconciliation Math Verification**:
   - `api/_lib/reviewed-workbook-analytics.cjs` correctly aligns query sources with Trading Floor (`reviewed_workbook_market_source_v2`).
   - `/api/price-research.js` calculates `total_tracked_listings`, `wts_eligible_analytics_count`, `wtb_demand_count`, and `excluded_count` dynamically. The formula `total_tracked_listings === wts_eligible_analytics_count + wtb_demand_count + excluded_count` holds mathematically.
   - Static analysis passed with no evidence of fake math or hardcoded results.

2. **Build Integrity Check Failure**:
   - Acceptance Criteria and Build Integrity guidelines require `npm run build` to complete with zero TypeScript errors.
   - In `src/pages/PriceResearch.tsx`, line 63 defines `ListingDetailData.raw_message_scope` as `'original_post' | 'stored_source_message' | 'unavailable'`.
   - On line 1982, `detail.raw_message_scope` (which is of type `ListingDetailData['raw_message_scope']`) is compared against `'reviewed_workbook_source'`.
   - Because `'reviewed_workbook_source'` is not a member of the `raw_message_scope` union type, the TypeScript compiler (`tsc -b`) throws `TS2367` and terminates the build process with Exit Code 1.
   - Per Integrity Forensics rules, a work product whose build fails does not meet completion criteria and must be flagged with `INTEGRITY VIOLATION`.

---

## 3. Caveats

- **Scope of Audit**: Audit was conducted strictly read-only on implementation files. As per auditor guidelines, implementation code was not modified to fix the TypeScript error.
- **Worker Handoff Discrepancy**: Worker `worker_m1_1` claimed `npm run build` succeeded with exit code 0. However, empirical command execution during audit revealed `npm run build` fails with TS2367 on `src/pages/PriceResearch.tsx:1982`.

---

## 4. Conclusion

**Verdict**: `INTEGRITY VIOLATION`

Milestone M1 satisfies data alignment and reconciliation math requirements, but **fails project build integrity**. `npm run build` fails with a TypeScript compilation error (`TS2367`) in `src/pages/PriceResearch.tsx` at line 1982 due to an unhandled union type in `ListingDetailData.raw_message_scope`.

---

## 5. Verification Method

### 1. Build Verification Command
Run the following command in `C:\tmp_s3_check\wf`:
```powershell
npm run build
```
**Observed Result**:
Fails with Exit Code 1:
`src/pages/PriceResearch.tsx(1982,81): error TS2367: This comparison appears to be unintentional because the types '"unavailable"' and '"reviewed_workbook_source"' have no overlap.`

### 2. Static Analysis Verification
Inspect `api/_lib/reviewed-workbook-analytics.cjs` and `api/price-research.js` to confirm genuine database queries against `reviewed_workbook_market_source_v2` and dynamic calculation of `reconciliation` payload object.
