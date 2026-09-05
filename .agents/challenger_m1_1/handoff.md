# Handoff Report — Milestone M1 Data Consistency Reconciliation Adversarial Audit

**Agent**: `challenger_m1_1`  
**Role**: `critic`, `specialist` (EMPIRICAL CHALLENGER)  
**Working Directory**: `C:\tmp_s3_check\wf\.agents\challenger_m1_1`  
**Date**: 2026-08-03  
**Verdict**: **`REJECT`**  

---

## 1. Observation

Direct empirical observations executed on the codebase:

### 1. Build Verification Failure
- Command executed: `npm run build` (`tsc -b && vite build`)
- Result: **Exit Code 1** (Build failed)
- Verbatim Error Output:
  ```
  src/pages/PriceResearch.tsx(1982,81): error TS2367: This comparison appears to be unintentional because the types '"unavailable"' and '"reviewed_workbook_source"' have no overlap.
  ```
- Code location: `src/pages/PriceResearch.tsx:1982`:
  ```tsx
  detail.raw_message_scope === 'stored_source_message' || detail.raw_message_scope === 'reviewed_workbook_source'
  ```
- Root Cause: Interface `ListingDetailData` (line 63) defines `raw_message_scope` as `'original_post' | 'stored_source_message' | 'unavailable'`. The string `'reviewed_workbook_source'` is not in the union type, triggering TypeScript compiler error TS2367.
- Contradiction: Worker `worker_m1_1` claimed in `handoff.md` (lines 55, 73, 84) that `npm run build` passed with zero errors. Empirical execution proves the build is currently broken.

### 2. Reconciliation Formula Audit
- Code location: `api/price-research.js` (lines 741–760):
  ```javascript
  const wtbDemandCount = demand?.demand_count || rows.filter(r => ['WTB', 'NTQ'].includes(String(r.listing_type || '').toUpperCase())).length;
  const wtsEligibleAnalyticsCount = includedRows.length;
  const outliersCount = statisticalOutlierRows.length;
  const unsplitBundlesCount = bundleParentExcludedCount;
  const totalTrackedListings = rows.length;
  const unpricedCount = Math.max(0, totalTrackedListings - wtsEligibleAnalyticsCount - wtbDemandCount - outliersCount - unsplitBundlesCount);
  const excludedTotalCount = unpricedCount + outliersCount + unsplitBundlesCount;
  ```
- Mathematical Flaw in formula:
  1. `wtbDemandCount` uses `demand?.demand_count` when present. `demand?.demand_count` is queried from `sourceTable` (`watch_records`) inside `lookupDemand()` (lines 129–196) and filtered by dial group count (`count >= 5`). Meanwhile, `rows` comes from `reviewed_workbook_market_source_v2` (`loadReviewedWorkbookAnalyticsRows`).
  2. Because `demand_count` comes from a different query/source than `rows`, `wtbDemandCount` can be higher than the WTB rows in `rows`.
  3. When `wtsEligibleAnalyticsCount + wtbDemandCount + outliersCount + unsplitBundlesCount > totalTrackedListings`, `Math.max(0, ...)` clamps `unpricedCount` to `0`.
  4. When `unpricedCount` is clamped to `0`, `excluded_count` becomes `outliersCount + unsplitBundlesCount`.
  5. The sum `wts_eligible_analytics_count + wtb_demand_count + excluded_count` exceeds `total_tracked_listings` (e.g. `35 + 20 + 3 = 58 !== 50`).
  6. Furthermore, `unpricedCount` is calculated by subtraction (`totalTrackedListings - wtsEligible - wtbDemand - outliers - unsplitBundles`). Payout/pricing exclusions (such as rows with valid prices that fail catalog dial matching or repost deduplication) are lumped into `unpricedCount` rather than being tracked accurately.

### 3. Reference Search Key Matching
- `api/reviewed-market-inventory.js` uses `referenceComparisonKey(val)` -> uppercase alphanumeric regex `[^A-Z0-9]`.
- `api/price-research.js` uses `normRef(val)` -> uppercase alphanumeric regex `[^A-Z0-9]`, and calls `listEquivalentReferences(rawRef, brand)` from `api/_lib/catalog.js`.
- Test results for keys (`116500LN`, `Submariner`, `5711/1A-001`, `PAM00111`, `26331ST.OO.1220ST.01`):
  - `116500LN`: TF key `'116500LN'`, PR keys `['116500LN']` — Match: **YES**
  - `Submariner`: TF key `'SUBMARINER'`, PR keys `['SUBMARINER']` — Match: **YES**
  - `5711/1A-001`: TF key `'57111A001'`, PR keys `['57111A', '57111A001']` — Match: **YES**
  - `PAM00111`: TF key `'PAM00111'`, PR keys `['PAM00111']` — Match: **YES**
  - `26331ST.OO.1220ST.01`: TF key `'26331STOO1220ST01'`, PR keys `['26331STOO1220ST01']` — Match: **YES**

---

## 2. Logic Chain

1. **TypeScript Build Verification**:
   - Running `npm run build` triggers `tsc -b && vite build`.
   - `tsc` checks all TypeScript source files.
   - `src/pages/PriceResearch.tsx` line 1982 checks `detail.raw_message_scope === 'reviewed_workbook_source'`.
   - `ListingDetailData` interface at line 63 defines `raw_message_scope` without `'reviewed_workbook_source'`.
   - TypeScript flags TS2367: comparison between types with no overlap. Build fails.
   - Conclusion: Build integrity criterion is NOT satisfied.

2. **Reconciliation Formula Integrity**:
   - The required reconciliation invariant is:
     `total_tracked_listings === wts_eligible_analytics_count + wtb_demand_count + excluded_count`
     where `excluded_count === unpriced + outliers + unsplit_bundles`.
   - In `api/price-research.js`, `wtbDemandCount` comes from `demand?.demand_count` (which queries `watch_records` and applies `count >= 5` per dial filter).
   - `rows` comes from `reviewed_workbook_market_source_v2`.
   - When `demand?.demand_count` differs from WTB rows present in `rows`, the components are not derived from a single partitioned set.
   - Using `Math.max(0, totalTrackedListings - ...)` hides negative values but causes `sum(components) != total_tracked_listings` whenever the subtrahend exceeds `totalTrackedListings`.
   - Conclusion: The reconciliation formula does not mathematically hold for all query paths and sources.

---

## 3. Caveats

- **Database Connection**: In offline environments where Supabase is unreachable, endpoints rely on static fallback data structures or return database connection errors. The TypeScript build failure and reconciliation formula logic flaw were verified independently of live database state.
- **Reference Resolution for Pure Text Models**: Search queries containing model names without numbers (e.g. "Submariner") rely on `parseTradingSearch` and catalog lookup. If a search string has no digits, `parseTradingSearch` treats the entire string as brand unless resolved by catalog.

---

## 4. Conclusion

**Verdict: `REJECT`**

The implementation submitted for Milestone M1 cannot be approved due to two blocking issues:
1. **TypeScript Build Failure**: `npm run build` fails with TS2367 in `src/pages/PriceResearch.tsx`.
2. **Reconciliation Formula Failure**: `api/price-research.js` uses cross-table counts for `wtb_demand_count` and subtraction with `Math.max(0, ...)` for `unpricedCount`, violating the exact identity `total_tracked_listings === wts_eligible_analytics_count + wtb_demand_count + excluded_count` under demand overflow scenarios.

### Required Worker Actions to Reach APPROVE:
1. Add `'reviewed_workbook_source'` and `'normalized_summary'` to `ListingDetailData['raw_message_scope']` in `src/pages/PriceResearch.tsx` so `npm run build` passes cleanly.
2. In `api/price-research.js`, ensure `wtbDemandCount` is consistently derived from the exact same `rows` set being reconciled (or align `demand_count` computation with `rows` partitioning) so that `wts_eligible_analytics_count + wtb_demand_count + unpriced + outliers + unsplit_bundles` strictly equals `total_tracked_listings`.

---

## 5. Verification Method

To independently verify these findings:

1. **Build Check**:
   ```powershell
   npm run build
   ```
   *Expected Output*: TypeScript error `TS2367` on line 1982 of `src/pages/PriceResearch.tsx`.

2. **Reconciliation Formula Script Check**:
   ```powershell
   node C:\tmp_s3_check\wf\.agents\challenger_m1_1\test_reconciliation.cjs
   ```
   *Expected Output*:
   - `Case 2 (Demand Overflow)` shows `totalTrackedListings: 50`, `sum: 58`, `equals: false`.
   - Key matching tests demonstrate key alignment for `116500LN`, `Submariner`, `5711/1A-001`, `PAM00111`, `26331ST.OO.1220ST.01`.
