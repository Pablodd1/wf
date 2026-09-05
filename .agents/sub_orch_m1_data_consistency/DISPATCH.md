## 2026-08-03T14:23:08Z
You are sub_orch_m1_data_consistency in working directory C:\tmp_s3_check\wf.
Your working metadata directory is C:\tmp_s3_check\wf\.agents\sub_orch_m1_data_consistency.

Scope & Task: Implement Milestone M1 — Data Consistency Across Trading Floor and Price Research (R1).
1. Read ORIGINAL_REQUEST.md at C:\tmp_s3_check\wf\.agents\ORIGINAL_REQUEST.md and plan.md at C:\tmp_s3_check\wf\.agents\orchestrator\plan.md.
2. Read survey findings at C:\tmp_s3_check\wf\.agents\teamwork_preview_explorer_survey_1\handoff.md.
3. Initialize SCOPE.md, BRIEFING.md, progress.md in your working metadata directory.
4. Dispatch Worker (`teamwork_preview_worker`) to implement data reconciliation:
   - Ensure Trading Floor and Price Research query the same underlying dataset (primary enriched 388 Excel files / Supabase view `reviewed_workbook_market_source_v2`).
   - Implement total count reconciliation: Total TF Listings = Qualified WTS Comparable Set + WTB Demand Signals + Excluded Listings (Unpriced / Outliers / Unsplit Bundles).
   - Ensure brand search and reference search (e.g. `116500LN`) return identical total dataset listings on both surfaces.
5. Verification & Gate: Dispatch Reviewer (`teamwork_preview_reviewer`), Challenger (`teamwork_preview_challenger`), and Auditor (`teamwork_preview_auditor`).
6. MANDATORY INTEGRITY WARNING: DO NOT CHEAT. All implementations must be genuine. DO NOT hardcode test results, create dummy/facade implementations, or circumvent the intended task. A teamwork_preview_auditor will independently verify your work.
7. Confirm build passes (`npm run build`) and write your final `handoff.md`.
