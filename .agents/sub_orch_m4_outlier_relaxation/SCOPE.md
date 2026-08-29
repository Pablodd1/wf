# Scope: Milestone M4 — Relaxed Outlier Filters for Fuller Analytics (Requirement R4)

## Objective
Relax outlier filtering parameters and sample threshold gates across server API functions and client-side libraries/pages so fuller price analytics and price trend graphics are rendered for references with as few as 2 observations, using a 3.0×IQR fence.

## Requirements & Scope Boundaries
1. Change IQR fence multiplier from 1.5x to 3.0x across server-side API functions and client-side analytics:
   `lower = q1 - 3.0 * iqr`, `upper = q3 + 3.0 * iqr`
2. Lower minimum observation threshold for rendering price trend graphics / analytics from 5 to 2 comparable observations:
   `MIN_BUCKET = 2`, `minDataPoints = 2`, `raw.length >= 2`
3. Modify affected files:
   - `api/_lib/market-stats.cjs`
   - `api/model-stats.js`
   - `api/pipeline-parse.js`
   - `api/price-research.js`
   - `src/lib/analytics.ts`
   - `src/lib/pipeline.ts`
   - `src/lib/pipelineClient.ts`
   - `src/pages/InsightDetails.tsx`
   - `src/pages/PriceResearch.tsx`
4. Ensure references with 2+ observations render price trend graphics instead of empty/disabled charts.

## Target Files Summary
- `api/_lib/market-stats.cjs`: update `raw.length >= 5` to `>= 2`, `1.5 * iqr` to `3.0 * iqr`
- `api/model-stats.js`: `MIN_BUCKET = 2`, `1.5 * iqr` to `3.0 * iqr`
- `api/pipeline-parse.js`: default `mult = 3.0`
- `api/price-research.js`: `cohort.count >= 2`, `d.count >= 2`, `minimum_sample: 2`
- `src/lib/analytics.ts`: `prices.length < 2`, `minDataPoints = 2`, `3.0 * iqr`
- `src/lib/pipeline.ts`: `prices.length < 2`, `minDataPoints = 2`, `3.0 * iqr`
- `src/lib/pipelineClient.ts`: `applyIQRFiltering(forIqr, 2)`
- `src/pages/InsightDetails.tsx`: `3.0 * iqr`
- `src/pages/PriceResearch.tsx`: `comparableCount >= 2`, UI methodology labels from 1.5x to 3.0x / 5 to 2 where applicable.

## Verification
- `npm run build` succeeds cleanly with 0 TypeScript errors.
- Reviewer, Challenger, and Auditor gate verification pass.
