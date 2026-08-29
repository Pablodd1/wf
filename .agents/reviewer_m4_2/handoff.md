# Review Report: Milestone M4 — Relaxed Outlier Filters (3.0x IQR & Minimum Observation Threshold 2)

**Verdict**: APPROVE

## 1. Observation

All required source files, client libraries, API endpoints, and test suites for Milestone M4 (Requirement R4) were directly inspected and independently verified:

### File-by-File Code Inspection Results

1. **`api/_lib/market-stats.cjs`**:
   - `lower_fence` and `upper_fence` calculated with `q1 - 3.0 * iqr` and `q3 + 3.0 * iqr` when `raw.length >= 2` (lines 36–37).
   - `analytics_ready` flag set to `raw.length >= 2` (line 49).

2. **`api/model-stats.js`**:
   - `MIN_BUCKET = 2` (line 18).
   - `lo = Math.max(q1 - 3.0 * iqr, SANITY_FLOOR)` and `hi = q3 + 3.0 * iqr` (lines 38–39).
   - Per-reference filtering uses `MIN_BUCKET` (lines 98, 113).

3. **`api/pipeline-parse.js`**:
   - `priceIsOutlier` function default multiplier set to `mult = 3.0` (line 903).
   - Per-brand parameter resolver `_iqrParams` sets `mult: 3.0` across all brand rules (lines 951–957).

4. **`api/price-research.js`**:
   - Minimum sample gate set to `minimum_sample: 2` (lines 503, 919).
   - Dial cohort filtering requires `d.count >= 2` (line 750).
   - Methodology label set to `PLAUSIBILITY_FLOOR_THEN_IQR_3_0` (lines 503, 916).

5. **`src/lib/analytics.ts`**:
   - `iqrFilter` uses `prices.length < 2` guard and `q1 - 3.0 * iqr` / `q3 + 3.0 * iqr` fences (lines 57, 64–65).
   - `buildPriceAnalytics` default threshold `minDataPoints = 2` (line 74).

6. **`src/lib/pipeline.ts`**:
   - `iqrOutlierRemoval` uses `prices.length < 2` guard and `3.0 * iqr` multiplier (lines 495, 504–505).
   - `applyIQRFiltering` default threshold `minDataPoints = 2` (line 521).

7. **`src/lib/pipelineClient.ts`**:
   - `applyIQRFiltering` called with threshold `2` (`applyIQRFiltering(forIqr, 2)`, line 80).

8. **`src/pages/InsightDetails.tsx`**:
   - `lowerBound = q1 - 3.0 * iqr` and `upperBound = q3 + 3.0 * iqr` (lines 87–88).

9. **`src/pages/PriceResearch.tsx`**:
   - Methodology type signature updated to `'IQR_3_0' | 'PLAUSIBILITY_FLOOR_THEN_IQR_3_0'` (line 344).
   - All UI copy text updated from 5 to 2 comparable observations (lines 834, 938, 954, 1184, 1199, 1304, 1338, 1386, 1520).
   - Minimum cohort count checks updated to `>= 2` (lines 1509, 1886).

10. **`tests/market-stats.test.cjs`**:
    - Updated test assertions for 3.0x IQR fence calculation (`upper_fence = 114`) and `analytics_ready = true` for >= 2 observations.

### Build and Test Execution Outputs

1. **TypeScript Compilation (`npm run build`)**:
   - Command: `npm run build`
   - Result: Exit Code 0. Zero TypeScript errors. 2785 modules transformed and bundle generated cleanly in 8.11s.

2. **Unit Tests (`node --test tests/market-stats.test.cjs`)**:
   - Command: `node --test tests/market-stats.test.cjs`
   - Result: Exit Code 0. 10/10 tests passed (0 failures).

3. **E2E Test Suites (`node --test tests/e2e/tier1...tier4`)**:
   - Command: `node --test tests/e2e/tier1-feature-coverage.test.cjs tests/e2e/tier2-boundary-corner.test.cjs tests/e2e/tier3-cross-feature.test.cjs tests/e2e/tier4-real-world.test.cjs`
   - Result: Exit Code 0. 4/4 test suites passed (0 failures).

### Integrity Review Findings

- **Hardcoded test results**: None detected. Real standard deviation, percentile, and IQR formulas are active.
- **Dummy/Facade implementations**: None detected. Real filtering and aggregation logic runs across server and client.
- **Shortcuts/bypasses**: None detected. All 9 target files and UI labels are synchronized.
- **Verification integrity**: Verified by direct command execution on Windows environment.

## 2. Logic Chain

1. **Requirement Alignment**: Requirement R4 specifies relaxing Price Research outlier filters from 1.5x IQR to 3.0x IQR fences (`q1 - 3.0*iqr`, `q3 + 3.0*iqr`) and lowering the minimum chart display threshold from 5 to 2 comparable observations.
2. **Implementation Verification**:
   - Direct file inspection confirmed that all server API endpoints (`api/_lib/market-stats.cjs`, `api/model-stats.js`, `api/pipeline-parse.js`, `api/price-research.js`) and client modules (`src/lib/analytics.ts`, `src/lib/pipeline.ts`, `src/lib/pipelineClient.ts`, `src/pages/InsightDetails.tsx`) consistently use `3.0` multiplier and `2` minimum observation threshold.
   - Direct file inspection of `src/pages/PriceResearch.tsx` confirmed that UI labels, methodology descriptions, tooltips, and minimum cohort checks are fully aligned with the 3.0x IQR and 2-observation rules.
3. **Execution Verification**:
   - Running `npm run build` produced 0 compilation errors, ensuring type safety and build integrity.
   - Running `tests/market-stats.test.cjs` and the 4 E2E test suites passed 100%, proving functionality and stability without regressions.
4. **Conclusion Support**: Since code inspection, copy audit, TypeScript compilation, unit tests, and E2E test suites all passed with zero defects and no integrity violations, the verdict is **APPROVE**.

## 3. Caveats

No caveats. All server-side API endpoints, client-side libraries, UI components, and unit/E2E test files are cleanly aligned on Requirement R4 specifications.

## 4. Conclusion

The implementation of Milestone M4 (Relaxed Outlier Filters 3.0x IQR & Minimum Observation Threshold 2) is verified, fully functional, compliant with Requirement R4, and structurally sound. Verdict: **APPROVE**.

## 5. Verification Method

To re-verify this review:

1. **Build Verification**:
   ```powershell
   npm run build
   ```
   *Expected Output*: Exit code 0, 0 TypeScript errors.

2. **Unit Tests**:
   ```powershell
   node --test tests/market-stats.test.cjs
   ```
   *Expected Output*: 10 tests passed, 0 failed.

3. **E2E Test Suites**:
   ```powershell
   node --test tests/e2e/tier1-feature-coverage.test.cjs tests/e2e/tier2-boundary-corner.test.cjs tests/e2e/tier3-cross-feature.test.cjs tests/e2e/tier4-real-world.test.cjs
   ```
   *Expected Output*: 4 test suites passed, 0 failed.
