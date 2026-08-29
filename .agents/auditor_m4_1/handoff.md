# Forensic Audit Report: Milestone M4

**Work Product**: Milestone M4 (Outlier filter relaxation from 1.5x to 3.0x IQR and lowering minimum observation threshold from 5 to 2)
**Profile**: General Project (Development Mode)
**Verdict**: CLEAN

---

### Summary of Audit
Milestone M4 implementation was forensically audited across all 9 target source files, UI pages, backend API handlers, utility libraries, and test suites.

All modifications genuinely implement:
1. **3.0× IQR Fence Calculations**: `lower = q1 - 3.0 * iqr`, `upper = q3 + 3.0 * iqr`.
2. **Min Observation Threshold (2)**: Sample gating lowered from 5 to 2 (`MIN_BUCKET = 2`, `minDataPoints = 2`, `raw.length >= 2`).
3. **No Cheating / No Facades**: Zero hardcoded test values, zero dummy return constants, zero pre-populated verification logs, and zero bypass shortcuts were found.

---

### Forensic Phase Results

| Check | Verdict | Details |
|---|---|---|
| **1. Hardcoded Output Detection** | PASS | Scanned all 9 target files (`api/_lib/market-stats.cjs`, `api/model-stats.js`, `api/pipeline-parse.js`, `api/price-research.js`, `src/lib/analytics.ts`, `src/lib/pipeline.ts`, `src/lib/pipelineClient.ts`, `src/pages/InsightDetails.tsx`, `src/pages/PriceResearch.tsx`). All statistical calculations use real dynamic arrays of prices and calculate mathematical quartiles/IQR. |
| **2. Facade Detection** | PASS | All functions contain complete, genuine dynamic logic. No `return <constant>` or empty stub functions exist. |
| **3. Pre-populated Artifact Detection** | PASS | No static result artifacts pre-certifying test status were detected. |
| **4. Build Integrity** | PASS | Executed `npm run build`. TypeScript compilation (`tsc -b`) and Vite production bundle succeeded with 0 errors. |
| **5. Test Execution** | PASS | Executed `node --test tests/market-stats.test.cjs` (10/10 passed) and `node --test tests/e2e/tier1...tier4` (4/4 passed). Tests dynamically verify 3.0x IQR fence calculation (`upper_fence = 114`) and `analytics_ready = true` for 2+ observations. |
| **6. Dependency & Scope Check** | PASS | Handled completely via standard native math operations in repository code. |

---

### Detailed File Verification

1. **`api/_lib/market-stats.cjs`**:
   - Lines 36-37: `lower_fence = raw.length >= 2 ? q1 - 3.0 * iqr : null; upper_fence = raw.length >= 2 ? q3 + 3.0 * iqr : null;`
   - Line 49: `analytics_ready: raw.length >= 2`

2. **`api/model-stats.js`**:
   - Line 18: `const MIN_BUCKET = 2;`
   - Lines 38-39: `lo = Math.max(q1 - 3.0 * iqr, SANITY_FLOOR); hi = q3 + 3.0 * iqr;`
   - Line 113: `.filter(([, v]) => v.prices.length >= MIN_BUCKET)`

3. **`api/pipeline-parse.js`**:
   - Line 903: `priceIsOutlier(price, prices, mult = 3.0, tol = 0.10)`
   - Lines 951-957: `_iqrParams` defaults multiplier to `3.0`.

4. **`api/price-research.js`**:
   - Lines 503, 916: `method: 'PLAUSIBILITY_FLOOR_THEN_IQR_3_0'`
   - Lines 503, 919: `minimum_sample: 2`
   - Line 750: `filter(d => d.count >= 2)`

5. **`src/lib/analytics.ts`**:
   - Lines 57, 64-65: `prices.length < 2`, `lower = q1 - 3.0 * iqr`, `upper = q3 + 3.0 * iqr`
   - Line 74: `minDataPoints = 2`

6. **`src/lib/pipeline.ts`**:
   - Lines 495, 504-505: `prices.length < 2`, `lowerBound = q1 - 3.0 * iqr`, `upperBound = q3 + 3.0 * iqr`
   - Line 521: `minDataPoints = 2`

7. **`src/lib/pipelineClient.ts`**:
   - Line 80: `applyIQRFiltering(forIqr, 2)`

8. **`src/pages/InsightDetails.tsx`**:
   - Lines 87-88: `lowerBound = q1 - 3.0 * iqr`, `upperBound = q3 + 3.0 * iqr`

9. **`src/pages/PriceResearch.tsx`**:
   - Line 344: `method: 'IQR_3_0' | 'PLAUSIBILITY_FLOOR_THEN_IQR_3_0'`
   - Lines 1304, 1338: UI methodology labels updated to 3.0x IQR.
   - Lines 834, 938, 954, 1184, 1199, 1386, 1520: UI copy updated from 5 to 2 observations minimum.

---

### Verification Commands & Raw Output

```powershell
# 1. Build Verification
npm run build
# Output:
# ✓ 2785 modules transformed.
# ✓ built in 9.16s (0 errors)

# 2. Market Stats Unit Tests
node --test tests/market-stats.test.cjs
# Output:
# ✔ uses standard 3.0 IQR fences and preserves outliers separately (1.4311ms)
# ✔ claims analytics readiness for two or more observations (0.1446ms)
# ℹ pass 10 | fail 0

# 3. E2E Test Suite
node --test tests/e2e/tier1-feature-coverage.test.cjs tests/e2e/tier2-boundary-corner.test.cjs tests/e2e/tier3-cross-feature.test.cjs tests/e2e/tier4-real-world.test.cjs
# Output:
# ℹ pass 4 | fail 0
```

---

### Conclusion
Milestone M4 changes are verified CLEAN. The work product satisfies all forensic integrity criteria.
