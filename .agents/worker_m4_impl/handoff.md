# Handoff Report: Milestone M4 — Outlier Filter Relaxation (3.0x IQR) & Lower Minimum Observation Threshold (2)

## 1. Observation

All 9 target files and associated test files were systematically inspected and updated to satisfy Requirement R4 (3.0x IQR outlier filter relaxation and minimum 2 observation threshold gate):

- **`api/_lib/market-stats.cjs`**:
  - `lower_fence` and `upper_fence` calculated with `q1 - 3.0 * iqr` and `q3 + 3.0 * iqr` when `raw.length >= 2` (lines 36-37).
  - `analytics_ready` gate set to `raw.length >= 2` (line 49).

- **`api/model-stats.js`**:
  - `MIN_BUCKET = 2` (line 18).
  - `lo = Math.max(q1 - 3.0 * iqr, SANITY_FLOOR)` and `hi = q3 + 3.0 * iqr` (lines 38-39).
  - Updated reference breakdown comment to `// Per-reference breakdown with min-2 gate` (line 105).

- **`api/pipeline-parse.js`**:
  - `priceIsOutlier` function default multiplier set to `mult = 3.0` (line 903).
  - Per-brand parameter resolver `_iqrParams` sets `mult: 3.0` across all brands (lines 951-957).

- **`api/price-research.js`**:
  - Min bucket gate set to `minimum_sample: 2` (lines 503, 919).
  - Dial cohort filtering uses `filter(d => d.count >= 2)` (line 750).
  - Methodology tag set to `PLAUSIBILITY_FLOOR_THEN_IQR_3_0` (lines 503, 916).

- **`src/lib/analytics.ts`**:
  - `iqrFilter` uses `prices.length < 2` guard and `q1 - 3.0 * iqr` / `q3 + 3.0 * iqr` fences (lines 57, 64-65).
  - `buildPriceAnalytics` default `minDataPoints = 2` (line 74).

- **`src/lib/pipeline.ts`**:
  - `iqrOutlierRemoval` uses `prices.length < 2` guard and `3.0 * iqr` multiplier (lines 495, 504-505).
  - `applyIQRFiltering` default `minDataPoints = 2` (line 521).

- **`src/lib/pipelineClient.ts`**:
  - `applyIQRFiltering` call uses threshold `2` (`applyIQRFiltering(forIqr, 2)`, line 80).

- **`src/pages/InsightDetails.tsx`**:
  - `lowerBound = q1 - 3.0 * iqr` and `upperBound = q3 + 3.0 * iqr` (lines 87-88).

- **`src/pages/PriceResearch.tsx`**:
  - Updated methodology type signature to `'IQR_3_0' | 'PLAUSIBILITY_FLOOR_THEN_IQR_3_0'` (line 344).
  - Updated UI copy text referencing observation thresholds from 5 to 2:
    - `"Two source-qualified comparable observations are required before price analytics are published."` (line 834)
    - `"IQR-filtered · only references with 2+ real listings included"` (line 938)
    - `"analytics pending (minimum 2)"` (line 954)
    - `"Analytics are withheld until at least two catalog-consistent observations exist..."` (line 1184)
    - `"Catalog-valid dial cohorts with at least two comparable observations for..."` (line 1199)
    - `"Based on {data.count} comparable WTS listings | standard 3.0 x IQR fences applied."` (line 1304)
    - `"...cohort with two or more observations uses the market plausibility floor and standard 3.0 x IQR method."` (line 1338)
    - `"Price statistics and charts require at least two approved WTS observations..."` (line 1386)
    - `"Price rating and timeline require at least two verified USD comparable offers..."` (line 1520)
  - Updated cohort minimum checks:
    - `analytics.count >= Math.max(2, Number(analytics.methodology.minimum_sample || 2))` (line 1509)
    - `benchmark && comparableCount >= 2` (line 1886)

- **`tests/market-stats.test.cjs`**:
  - Updated test cases to assert 3.0x IQR fence calculation (`upper_fence = 114`) and `analytics_ready = true` for >= 2 observations.

## 2. Logic Chain

1. **Requirement R4 Specification**: Price Research outlier filters must be relaxed from 1.5×IQR to 3.0×IQR fences (`q1 - 3.0*iqr`, `q3 + 3.0*iqr`), and the minimum observation gate for price trend graphics/analytics must be lowered from 5 to 2 observations (`MIN_BUCKET = 2`, `minDataPoints = 2`).
2. **Backend & Library Consistency**: Inspecting all API routes (`api/_lib/market-stats.cjs`, `api/model-stats.js`, `api/pipeline-parse.js`, `api/price-research.js`) and TypeScript analytics/pipeline modules (`src/lib/analytics.ts`, `src/lib/pipeline.ts`, `src/lib/pipelineClient.ts`) confirmed that statistical calculation functions are aligned on 3.0x IQR multiplier and min 2 threshold.
3. **Frontend Presentation & Copy Alignment**: Updating `src/pages/PriceResearch.tsx` ensured that UI labels, methodology descriptions, tooltips, and rendering guards reflect the 3.0x IQR and 2-observation rules accurately, preventing references with 2-4 observations from showing empty/disabled charts or stale "minimum 5" notices.
4. **Verification**: Compiling TypeScript with `npm run build` verified zero type errors. Running all test suites (`node --test tests/e2e/tier1...tier4` and `tests/market-stats.test.cjs`) verified 100% test pass rate with no regressions.

## 3. Caveats

No caveats. All server-side API endpoints, client-side libraries, UI pages, and test files are completely aligned on the 3.0x IQR fence and 2-observation minimum threshold.

## 4. Conclusion

Milestone M4 is fully implemented, verified, and ready for production deployment. References with as few as 2 observations now render price analytics graphics using relaxed 3.0x IQR fences.

## 5. Verification Method

To independently verify the implementation:

1. **TypeScript Build Verification**:
   ```bash
   npm run build
   ```
   *Expected Output*: Zero TypeScript compilation errors. Vite build completes cleanly.

2. **E2E & Unit Test Suites**:
   ```bash
   node --test tests/e2e/tier1-feature-coverage.test.cjs tests/e2e/tier2-boundary-corner.test.cjs tests/e2e/tier3-cross-feature.test.cjs tests/e2e/tier4-real-world.test.cjs
   node --test tests/market-stats.test.cjs
   ```
   *Expected Output*: All tests pass (0 failures, 0 errors).
