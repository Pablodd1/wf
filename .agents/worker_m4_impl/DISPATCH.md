## 2026-08-03T15:15:46Z
You are teamwork_preview_worker assigned to implement Milestone M4 — Relaxed Outlier Filters for Fuller Analytics (Requirement R4).

Working Directory: C:\tmp_s3_check\wf
Metadata Directory: C:\tmp_s3_check\wf\.agents\worker_m4_impl

Context & Guidance:
Read ORIGINAL_REQUEST.md at C:\tmp_s3_check\wf\.agents\ORIGINAL_REQUEST.md and the survey handoff at C:\tmp_s3_check\wf\.agents\teamwork_preview_explorer_survey_2\handoff.md.

Task Objective:
Relax outlier filtering parameters and sample threshold gates across server API functions and client-side libraries/pages so fuller price analytics and price trend graphics are rendered for references with as few as 2 observations, using a 3.0x IQR fence.

Required Changes:
1. Change IQR fence multiplier from 1.5x to 3.0x across server-side API functions and client-side analytics (`lower = q1 - 3.0 * iqr`, `upper = q3 + 3.0 * iqr`).
2. Lower minimum observation threshold for rendering price trend charts / analytics from 5 to 2 comparable observations (`MIN_BUCKET = 2`, `minDataPoints = 2`, `raw.length >= 2`).
3. Affected files to inspect and modify:
   - `api/_lib/market-stats.cjs`: update `raw.length >= 5` to `>= 2`, `1.5 * iqr` to `3.0 * iqr`.
   - `api/model-stats.js`: update `MIN_BUCKET = 5` to `2`, `1.5 * iqr` to `3.0 * iqr`.
   - `api/pipeline-parse.js`: update default `mult = 1.5` to `mult = 3.0`.
   - `api/price-research.js`: update `cohort.count >= 5` to `>= 2`, `d.count >= 5` to `>= 2`, `minimum_sample: 5` to `2`.
   - `src/lib/analytics.ts`: update `prices.length < 5` to `< 2`, default `minDataPoints = 5` to `2`, `1.5 * iqr` to `3.0 * iqr`.
   - `src/lib/pipeline.ts`: update `prices.length < 5` to `< 2`, default `minDataPoints = 5` to `2`, `1.5 * iqr` to `3.0 * iqr`.
   - `src/lib/pipelineClient.ts`: update `applyIQRFiltering(forIqr, 5)` to `(forIqr, 2)`.
   - `src/pages/InsightDetails.tsx`: update `1.5 * iqr` to `3.0 * iqr`.
   - `src/pages/PriceResearch.tsx`: update `comparableCount >= 5` to `>= 2`, and update methodology labels / UI text referencing 1.5x or 5 observations to 3.0x and 2 observations.

MANDATORY INTEGRITY WARNING:
DO NOT CHEAT. All implementations must be genuine. DO NOT hardcode test results, create dummy/facade implementations, or circumvent the intended task. A teamwork_preview_auditor will independently verify your work. Integrity violations WILL be detected and your work WILL be rejected.

Verification:
1. Run `npm run build` to verify there are 0 TypeScript compilation errors.
2. If available, run `npm run test:normalization` or test suites.
3. Write your handoff report to `C:\tmp_s3_check\wf\.agents\worker_m4_impl\handoff.md` with full details of modified files, build/test results, and send a message back to the orchestrator.
