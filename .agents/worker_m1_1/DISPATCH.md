## 2026-08-03T14:23:39Z

TASK: Implement Milestone M1 — Data Consistency Across Trading Floor and Price Research (R1).

Read these specification and context files BEFORE starting work:
1. ORIGINAL_REQUEST: C:\tmp_s3_check\wf\.agents\ORIGINAL_REQUEST.md
2. MASTER PLAN: C:\tmp_s3_check\wf\.agents\orchestrator\plan.md
3. SURVEY HANDOFF: C:\tmp_s3_check\wf\.agents\teamwork_preview_explorer_survey_1\handoff.md

MANDATORY INTEGRITY WARNING:
DO NOT CHEAT. All implementations must be genuine. DO NOT hardcode test results, create dummy/facade implementations, or circumvent the intended task. A teamwork_preview_auditor will independently verify your work. Integrity violations WILL be detected and your work WILL be rejected.

REQUIREMENTS & DETAILED INSTRUCTIONS:
1. Query Dataset Alignment:
   - Ensure Trading Floor (`api/reviewed-market-inventory.js`, `src/pages/TradingFloor.tsx`) and Price Research (`api/price-research.js`, `src/pages/PriceResearch.tsx`) query the same underlying dataset (primary enriched 388 Excel files / Supabase view `reviewed_workbook_market_source_v2`).
   - Ensure fallback/offline logic (e.g. static JSON datasets) also maintains dataset parity across both pages.

2. Total Count Reconciliation:
   - Implement total count reconciliation math:
     Total TF Listings = Qualified WTS Comparable Set + WTB Demand Signals + Excluded Listings (Unpriced / Outliers / Unsplit Bundles).
   - In `/api/price-research.js` (and any related API helpers), return a structured reconciliation summary breakdown object in the response payload:
     - `total_tracked_listings` (matches Trading Floor total)
     - `wts_eligible_analytics_count`
     - `wtb_demand_count`
     - `excluded_count` (with breakdown: `unpriced`, `outliers`, `unsplit_bundles`)

3. Search Consistency:
   - Ensure brand search and reference search (e.g. `116500LN`) return identical total dataset listings on both surfaces (Trading Floor and Price Research).

4. Verification:
   - Execute `npm run build` using command line to ensure zero TypeScript errors and a clean build.
   - Document build outputs and test commands in your handoff report.

5. Deliverables:
   - Write your full report to `C:\tmp_s3_check\wf\.agents\worker_m1_1\handoff.md`.
   - Include code changes made, build results, and exact verification steps taken.
