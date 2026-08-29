# Handoff Report — Milestone M1 Adversarial Verification

**Agent**: `challenger_m1_2`  
**Role**: `critic`, `specialist` (Empirical Challenger)  
**Working Directory**: `C:\tmp_s3_check\wf\.agents\challenger_m1_2`  
**Date**: 2026-08-03  
**Verdict**: **REJECT**

---

## 1. Observation

### Build Verification Command & Result
Command executed:
```powershell
npm run build
```

Verbatim terminal output:
```
> my-app@0.0.0 build
> tsc -b && vite build

src/pages/PriceResearch.tsx(1982,81): error TS2367: This comparison appears to be unintentional because the types '"unavailable"' and '"reviewed_workbook_source"' have no overlap.
```
Exit code: **1** (Build Failed).

### Source Code Inspection
- File: `src/pages/PriceResearch.tsx`
- Line 63:
  ```typescript
  raw_message_scope: 'original_post' | 'stored_source_message' | 'unavailable';
  ```
- Line 1982:
  ```typescript
  : detail.raw_message_scope === 'stored_source_message' || detail.raw_message_scope === 'reviewed_workbook_source'
  ```

### Edge Case Dataset Accounting Inspection
1. **Handling when `wtb_demand_count === 0`**:
   - Code: `api/price-research.js` line 741:
     `const wtbDemandCount = demand?.demand_count || rows.filter(r => ['WTB', 'NTQ'].includes(String(r.listing_type || '').toUpperCase())).length;`
   - Evaluation: When `demand?.demand_count` evaluates to 0 (or undefined), `unpricedCount` is `Math.max(0, totalTrackedListings - wtsEligibleAnalyticsCount - 0 - outliersCount - unsplitBundlesCount)`.
   - Result: Formula `total_tracked_listings === wts_eligible_analytics_count + wtb_demand_count + excluded_count` holds (`N = WTS + 0 + (N - WTS)`). The UI in `PriceResearch.tsx` renders `0` for WTB Demand Signals cleanly without NaN or null errors.
2. **Handling when all listings are unpriced or outliers**:
   - Unpriced subcase: `classifyResearchEligibility` flags rows as `MISSING_PRICE`. `wtsEligibleAnalyticsCount = 0`, `unpricedCount = totalTrackedListings`. Reconciliation returns `total = 0 + 0 + N (unpriced)`.
   - Outliers subcase: All priced listings are statistical outliers. `wtsEligibleAnalyticsCount = 0`, `outliersCount = totalTrackedListings`. Reconciliation returns `total = 0 + 0 + N (outliers)`.
   - Empty dataset subcase: `api/price-research.js` lines 436-468 returns `emptyReconciliation` (all 0s).
   - Result: Reconciliation formula holds across all subcases. The UI card renders the breakdown and displays the fallback notice section ("Insufficient qualified market evidence") rather than broken chart components.
3. **Bundle parent listing exclusion (`unsplit_bundles`)**:
   - Code: `api/price-research.js` lines 539, 559, 744.
   - Evaluation: Bundle parent listings (`bundle_candidate_count > 1`) are excluded from single-watch analytics by `classifyResearchEligibility` (`outlier_reason: 'BUNDLE_SOURCE_UNSPLIT'`) and tracked in `reconciliation.excluded_breakdown.unsplit_bundles`.
   - Result: Single-watch analytics are protected, and bundle parent listings are accurately accounted for in the exclusion total.

---

## 2. Logic Chain

1. Worker `worker_m1_1` implemented the total count reconciliation formula and summary API payload in `api/price-research.js`, and added the Dataset Listing Reconciliation UI card in `src/pages/PriceResearch.tsx`.
2. Empirical testing of the dataset accounting logic verified that edge cases (`wtb_demand_count === 0`, all unpriced/outlier listings, and `unsplit_bundles`) are correctly handled by the reconciliation formula and UI components.
3. However, during edits to `src/pages/PriceResearch.tsx`, line 1982 was updated to compare `detail.raw_message_scope` against `'reviewed_workbook_source'`, but line 63 (`ListingDetailData` interface) was not updated to include `'reviewed_workbook_source'` in the type union.
4. Running `npm run build` triggers TypeScript compiler `tsc -b`, which fails with error TS2367.
5. The Master Plan and project Acceptance Criteria require `npm run build` to pass with zero TypeScript errors.
6. Therefore, Milestone M1 must be **REJECTED** until the build error is resolved.

---

## 3. Caveats

- The dataset reconciliation accounting logic in `api/price-research.js` is mathematically sound and handles all tested edge cases.
- The build failure is caused by a single missing type union member in `src/pages/PriceResearch.tsx`.

---

## 4. Conclusion

- **Verdict**: **REJECT**
- **Actionable Fix**:
  Update `ListingDetailData` interface in `src/pages/PriceResearch.tsx` (line 63) to include `'reviewed_workbook_source'`:
  ```typescript
  raw_message_scope: 'original_post' | 'stored_source_message' | 'reviewed_workbook_source' | 'unavailable';
  ```

---

## 5. Verification Method

1. Run the build command:
   ```powershell
   npm run build
   ```
2. Invalidation Condition: Exit code is non-zero or TypeScript reports any error in `src/pages/PriceResearch.tsx`.
3. Success Condition: `npm run build` exits with code 0 (`✓ built in ...s`).
