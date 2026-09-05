## 2026-08-03T15:03:30Z

<USER_REQUEST>
You are sub_orch_m2_wtb_demand in working directory C:\tmp_s3_check\wf.
Your working metadata directory is C:\tmp_s3_check\wf\.agents\sub_orch_m2_wtb_demand.

Scope & Task: Implement Milestone M2 — WTB Demand Signals Integration in Price Research (R2).
1. Read ORIGINAL_REQUEST.md at C:\tmp_s3_check\wf\.agents\ORIGINAL_REQUEST.md, master plan at C:\tmp_s3_check\wf\.agents\orchestrator\plan.md, and M1 handoff report at C:\tmp_s3_check\wf\.agents\sub_orch_m1_data_consistency\handoff.md.
2. Initialize SCOPE.md, BRIEFING.md, progress.md in your working metadata directory.
3. Dispatch Worker (`teamwork_preview_worker`) to implement WTB demand integration:
   - In `api/price-research.js` (`lookupDemand`), return WTB demand cohorts for reference queries without discarding cohorts with < 5 observations.
   - In `src/pages/PriceResearch.tsx` (reference detail view), render a dedicated "Demand Signals" section displaying WTB listing counts and buyer demand volume side-by-side with WTS asking-price charts.
   - Ensure WTB listings are NOT mixed into WTS asking-price averages or trend graphics.
   - Ensure seller contact / raw message / image flow through on WTB demand cards.
4. Verification & Gate: Dispatch Reviewer (`teamwork_preview_reviewer`), Challenger (`teamwork_preview_challenger`), and Auditor (`teamwork_preview_auditor`).
5. MANDATORY INTEGRITY WARNING: DO NOT CHEAT. All implementations must be genuine. DO NOT hardcode test results, create dummy/facade implementations, or circumvent the intended task. A teamwork_preview_auditor will independently verify your work.
6. Confirm build passes (`npm run build`) and write your final `handoff.md`.
</USER_REQUEST>
