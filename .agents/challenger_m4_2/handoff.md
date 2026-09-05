# Handoff Report: Milestone M4 — Outlier Filter Relaxation Empirical Challenge

**Verdict**: **REQUEST_CHANGES**

---

## 1. Observation

A comprehensive empirical audit and adversarial stress test suite was executed against the implementation of Milestone M4 (Requirement R4: 3.0x IQR outlier filter relaxation and minimum 2 observation threshold gate).

While the server-side API endpoints (`api/_lib/market-stats.cjs`, `api/model-stats.js`, `api/pipeline-parse.js`, `api/price-research.js`) and core TypeScript helpers (`src/lib/analytics.ts`, `src/lib/pipeline.ts`) correctly apply 3.0x IQR multipliers and `minDataPoints = 2`, empirical testing uncovered **two critical unrelaxed threshold gates** in the frontend components:

1. **`src/lib/marketPriceRating.ts` (lines 17–18)**:
   - **Observed Code**:
     ```typescript
     if (!stats || comparableCount < 5 || !Number.isFinite(amount) || amount <= 0) {
       return { code: 'NOT_RATED', label: 'Insufficient market data', reason: 'At least five valid comparable offers are required.', color: '#9ca3af' };
     }
     ```
   - **Empirical Execution**: Executing `rateMarketPrice(20000, { avg: 20000, min: 18000, max: 22000 }, 2)` produces:
     ```json
     {
       "code": "NOT_RATED",
       "label": "Insufficient market data",
       "reason": "At least five valid comparable offers are required.",
       "color": "#9ca3af"
     }
     ```
   - **Failure Impact**: When viewing Price Research reference detail cards (`src/pages/PriceResearch.tsx` lines 1527 and 1777), any reference with 2, 3, or 4 observations renders the market stats card, but the Market Price Rating badge displays `"Insufficient market data - At least five valid comparable offers are required."` instead of rating the price.

2. **`src/pages/InsightDetails.tsx` (lines 84–85)**:
   - **Observed Code**:
     ```typescript
     const q1 = sortedPrices.length >= 4 ? sortedPrices[Math.floor(sortedPrices.length * 0.25)] : 0;
     const q3 = sortedPrices.length >= 4 ? sortedPrices[Math.floor(sortedPrices.length * 0.75)] : 0;
     ```
   - **Empirical Execution**: Executing `sortedPrices = [25000, 26000]` (length 2) or `[25000, 26000, 27000]` (length 3) yields:
     - `q1 = 0`, `q3 = 0`, `iqr = 0`
     - `lowerBound = 0`, `upperBound = 0`
     - `filteredPrices = sortedPrices.filter(p => p >= 0 && p <= 0)` -> `[]` (0 filtered prices)
     - `outliers` -> `[25000, 26000]` (all prices marked as outliers and excluded)
   - **Failure Impact**: When a user inspects a reference with 2 or 3 comparable observations on `InsightDetails.tsx`, 100% of valid prices are discarded as outliers, displaying 0 filtered prices and empty price metrics.

---

## 2. Logic Chain

1. **Requirement R4 Specification**: Price Research outlier filters must be relaxed from 1.5×IQR to 3.0×IQR, and the minimum chart display threshold must be lowered from 5 comparable observations to 2.
2. **Empirical Verification**:
   - Running existing test suites (`node --test tests/market-stats.test.cjs` and `tests/e2e/tier1...4`) passed because existing tests only covered `market-stats.cjs`.
   - Executing a dedicated stress harness (`C:\tmp_s3_check\wf\.agents\challenger_m4_2\stress_test_suite.js`) against all modified and dependent components revealed that `rateMarketPrice` in `src/lib/marketPriceRating.ts` and `InsightDetails.tsx` still retain hardcoded `min-5` and `min-4` threshold guards.
3. **Impact Analysis**:
   - `rateMarketPrice`: Directly used on `PriceResearch.tsx` to render price rating badges. With 2–4 observations, the user sees `analytics.stats` populated, but the rating badge explicitly claims 5 offers are required.
   - `InsightDetails.tsx`: Directly used for reference drill-down details. With 2–3 observations, calculating IQR using `length >= 4 ? ... : 0` causes `lowerBound` and `upperBound` to collapse to 0, wiping out all valid prices (`filteredCount: 0`) and misclassifying them as outliers.
4. **Conclusion**: Milestone M4 cannot be approved until both frontend components are updated to support the minimum 2 observation threshold.

---

## 3. Caveats

No caveats. All server-side API functions (`market-stats.cjs`, `model-stats.js`, `pipeline-parse.js`, `price-research.js`) and client utilities (`analytics.ts`, `pipeline.ts`, `pipelineClient.ts`) were verified and confirmed working correctly with 3.0x IQR fences and `minDataPoints = 2`. The only defect is in `src/lib/marketPriceRating.ts` and `src/pages/InsightDetails.tsx`.

---

## 4. Conclusion

Verdict: **REQUEST_CHANGES**

The worker must make the following two modifications:

1. **Update `src/lib/marketPriceRating.ts`**:
   - Change `comparableCount < 5` (line 17) to `comparableCount < 2`.
   - Update line 18 reason text from `'At least five valid comparable offers are required.'` to `'At least two valid comparable offers are required.'`.

2. **Update `src/pages/InsightDetails.tsx`**:
   - Change `sortedPrices.length >= 4` (lines 84–85) to `sortedPrices.length >= 2`.

---

## 5. Verification Method

To verify the defects and validate the required fixes:

1. **Execute Empirical Stress Test Suite**:
   ```bash
   npx tsx .agents/challenger_m4_2/stress_test_suite.js
   ```
   *Current Result*: 24 PASSED, 3 FAILED (`rateMarketPrice` and `InsightDetails` checks fail).
   *Expected Result After Fix*: 27 PASSED, 0 FAILED.

2. **Run Standard Build and Test Command**:
   ```bash
   npm run build
   node --test tests/market-stats.test.cjs
   ```
