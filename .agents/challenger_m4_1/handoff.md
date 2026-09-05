# Adversarial Challenge & Empirical Verification Report — Milestone M4

**Verdict**: **REQUEST_CHANGES**

## 1. Challenge Summary

**Overall risk assessment**: **HIGH**

While core API endpoints (`api/_lib/market-stats.cjs`, `api/model-stats.js`, `api/price-research.js`, `api/pipeline-parse.js`) and core TypeScript pipeline utilities (`src/lib/analytics.ts`, `src/lib/pipeline.ts`) correctly implement relaxed 3.0x IQR outlier filtering and the lower min-2 observation gate, two critical client-side modules contain hardcoded `length >= 4` and `comparableCount < 5` gates that break price analytics and rating displays for references with 2 to 4 observations:

1. **`src/pages/InsightDetails.tsx` (Lines 84–90)**: Uses `sortedPrices.length >= 4` to calculate Q1 and Q3, causing `q1`, `q3`, `iqr`, `lowerBound`, and `upperBound` to all evaluate to `0` when `sortedPrices.length` is 2 or 3. This misclassifies **100% of valid prices as outliers**, producing an empty `filteredPrices` array (`[]`) and rendering invalid statistics (`min: Infinity`, `max: -Infinity`, `avg: 0`).
2. **`src/lib/marketPriceRating.ts` (Lines 17–18)**: Retains a hardcoded `comparableCount < 5` check, returning `NOT_RATED` with message `"At least five valid comparable offers are required."` for references with 2, 3, or 4 comparable observations. This directly contradicts the M4 requirement and `PriceResearch.tsx` UI copy.

---

## 2. Observation

### Observation 1: `src/pages/InsightDetails.tsx` Lines 84–90
```ts
84: const q1 = sortedPrices.length >= 4 ? sortedPrices[Math.floor(sortedPrices.length * 0.25)] : 0;
85: const q3 = sortedPrices.length >= 4 ? sortedPrices[Math.floor(sortedPrices.length * 0.75)] : 0;
86: const iqr = q3 - q1;
87: const lowerBound = q1 - 3.0 * iqr;
88: const upperBound = q3 + 3.0 * iqr;
89: const outliers = sortedPrices.filter(p => p < lowerBound || p > upperBound);
90: const filteredPrices = sortedPrices.filter(p => p >= lowerBound && p <= upperBound);
```
*Empirical Test Output (Node.js simulation with `sortedPrices = [15000, 18000]`)*:
```
q1: 0
q3: 0
iqr: 0
lowerBound: 0
upperBound: 0
outliers: [ 15000, 18000 ]
filteredPrices: []
```

### Observation 2: `src/lib/marketPriceRating.ts` Lines 15–19
```ts
15: export function rateMarketPrice(price: number | null | undefined, stats: MarketBenchmark | null, comparableCount: number): MarketPriceRating {
16:   const amount = Number(price);
17:   if (!stats || comparableCount < 5 || !Number.isFinite(amount) || amount <= 0) {
18:     return { code: 'NOT_RATED', label: 'Insufficient market data', reason: 'At least five valid comparable offers are required.', color: '#9ca3af' };
19:   }
```
*Empirical Test Output (`npx tsx` execution)*:
```
Testing rateMarketPrice with comparable counts:
n=2 rating: { code: 'NOT_RATED', label: 'Insufficient market data', reason: 'At least five valid comparable offers are required.', color: '#9ca3af' }
n=3 rating: { code: 'NOT_RATED', label: 'Insufficient market data', reason: 'At least five valid comparable offers are required.', color: '#9ca3af' }
n=4 rating: { code: 'NOT_RATED', label: 'Insufficient market data', reason: 'At least five valid comparable offers are required.', color: '#9ca3af' }
n=5 rating: { code: 'GOOD', label: 'Good price', reason: 'At least 5% below the comparable market center.', color: '#22c55e' }
```

### Observation 3: Unit Tests (`node --test tests/market-stats.test.cjs`)
Executing `node --test tests/market-stats.test.cjs`:
```
✔ uses standard 3.0 IQR fences and preserves outliers separately (1.5087ms)
✔ claims analytics readiness for two or more observations (0.147ms)
✔ labels five to nine rows provisional and ten or more robust (0.1447ms)
✔ merges condition variants into one analytics cohort per dial (0.2592ms)
✔ merges dial labels that differ only by case (0.1432ms)
✔ groups one dial once while preserving condition counts (0.9216ms)
✔ treats unknown and unspecified condition labels as one non-inferred cohort (0.2278ms)
✔ classifies row-level outliers with an auditable reason (0.2442ms)
✔ rejects implausible watch prices before applying IQR fences (0.1535ms)
✔ uses a conservative cohort-relative luxury-watch plausibility floor (0.2278ms)
ℹ tests 10 | pass 10 | fail 0
```

### Observation 4: TypeScript Build (`npm run build`)
Executing `npm run build`:
```
✓ built in 8.13s
Zero TypeScript compilation errors.
```

---

## 3. Logic Chain

1. **Requirement Verification**: Requirement R4 specifies: *"Price Research outlier filters must be relaxed from 1.5×IQR to 3.0×IQR, and the minimum chart display threshold must be lowered from 5 comparable observations to 2. This ensures more references render price trend graphics instead of showing empty/disabled charts."*
2. **Impact of Observation 1**: When a user opens an insight details view (`/insight/:ref`) for a reference with 2 or 3 observations (a primary use-case of M4), `InsightDetails.tsx` sets `q1 = 0` and `q3 = 0` because `sortedPrices.length >= 4` fails. This forces `lowerBound = 0` and `upperBound = 0`. Consequently, all valid positive prices are excluded (`filteredPrices = []`), and `outliers` contains every price. This renders broken analytics cards (`min: Infinity`, `max: -Infinity`) and empty report exports.
3. **Impact of Observation 2**: In `PriceResearch.tsx`, UI copy states *"Price rating and timeline require at least two verified USD comparable offers"*. However, when a reference has 2, 3, or 4 comparable observations, `rateMarketPrice` checks `comparableCount < 5` and returns `NOT_RATED` with the stale message `"At least five valid comparable offers are required."`. This blocks price rating for all references with 2 to 4 observations.
4. **Conclusion**: Even though the backend API endpoints and build succeed, the implementation fails Requirement R4 for references with 2–4 observations in `InsightDetails.tsx` and `marketPriceRating.ts`. Therefore, changes are requested.

---

## 4. Caveats

No caveats. Both defects were directly observed, isolated to specific lines of code, and reproduced empirically via test harnesses.

---

## 5. Conclusion

**Verdict**: **REQUEST_CHANGES**

To satisfy Milestone M4, the following two fixes must be applied by the worker:

### Required Action Items for Worker (`worker_m4_impl`):

1. **Fix `src/pages/InsightDetails.tsx` (Lines 84–90)**:
   Update quantile calculation to handle `length >= 2` without forcing fallback to `0`:
   ```ts
   // IQR for this view's processing (minimum 2 observations)
   const q1 = sortedPrices.length >= 2 ? sortedPrices[Math.floor(sortedPrices.length * 0.25)] : 0;
   const q3 = sortedPrices.length >= 2 ? sortedPrices[Math.floor(sortedPrices.length * 0.75)] : 0;
   ```
   Or use `iqrFilter` from `src/lib/analytics.ts`.

2. **Fix `src/lib/marketPriceRating.ts` (Lines 17–18)**:
   Update `comparableCount < 5` to `comparableCount < 2` and update the reason message:
   ```ts
   if (!stats || comparableCount < 2 || !Number.isFinite(amount) || amount <= 0) {
     return { code: 'NOT_RATED', label: 'Insufficient market data', reason: 'At least two valid comparable offers are required.', color: '#9ca3af' };
   }
   ```

---

## 6. Verification Method

To independently verify the bugs and re-verify after fixes:

1. **Run empirical test harness**:
   ```bash
   npx tsx -e "
   import { rateMarketPrice } from './src/lib/marketPriceRating';
   console.log(rateMarketPrice(15000, { min: 10000, max: 20000, avg: 15000 }, 2));
   "
   ```
   *Expected Output after fix*: `{ code: 'MARKET', label: 'Market price', ... }` (instead of `NOT_RATED`).

2. **Verify `InsightDetails.tsx` behavior with n=2**:
   ```bash
   npx tsx -e "
   const sortedPrices = [15000, 18000];
   const q1 = sortedPrices.length >= 2 ? sortedPrices[Math.floor(sortedPrices.length * 0.25)] : 0;
   const q3 = sortedPrices.length >= 2 ? sortedPrices[Math.floor(sortedPrices.length * 0.75)] : 0;
   const iqr = q3 - q1;
   const lowerBound = q1 - 3.0 * iqr;
   const upperBound = q3 + 3.0 * iqr;
   const filteredPrices = sortedPrices.filter(p => p >= lowerBound && p <= upperBound);
   console.log('filteredPrices count:', filteredPrices.length);
   "
   ```
   *Expected Output after fix*: `filteredPrices count: 2`.

3. **Run existing test suites**:
   ```bash
   node --test tests/market-stats.test.cjs
   npm run build
   ```
