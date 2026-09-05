# Dispatch Log

## 2026-08-03T14:14:55Z

You are the Project Orchestrator for the WatchFacts Full Data Reconciliation & Navigation Fix project.

Working directory: C:\tmp_s3_check\wf
Your working metadata directory: C:\tmp_s3_check\wf\.agents\orchestrator

Your task:
1. Read the original user request at `C:\tmp_s3_check\wf\.agents\ORIGINAL_REQUEST.md`.
2. Set up your working metadata directory (`C:\tmp_s3_check\wf\.agents\orchestrator`) and initialize `BRIEFING.md`, `plan.md`, and `progress.md`.
3. Decompose the requirements (R1: Data Consistency, R2: WTB Integration, R3: Seller Contacts & Raw Messages, R4: Relaxed Outlier Filters, R5: Navigation UX, and Build Integrity) into milestones and dispatch specialists to execute them.
4. Regularly update `progress.md` in `C:\tmp_s3_check\wf\.agents\orchestrator\progress.md` with current state, completed subtasks, and recent changes.
5. Verify build integrity (`npm run build`), `git push origin main`, and verify Vercel deployment.
6. When all milestones are completed and verified, report completion to the Project Sentinel.

## 2026-08-03T14:17:37Z

IMPORTANT ADDITIONAL CONTEXT FROM USER:
1. Data Sources Available:
   - Unbundled CSVs (Raw source of truth) at `C:\Users\jasme\Documents\Codex\2026-07-12\review\work\wf-data-canary\audit-output\unbundled\`
   - Normalized Excel Files (388 files, enriched data source) at `C:\Users\jasme\Downloads\WF\ALL watches normalized\` with populated `Phone Number`, `Posted By`, `raw_line`, and `Final Image URL`.
2. Additional Requirements:
   - "oceandigital" source data should have untouched chatbot RAW messages.
   - If dial color is missing but image is present, use AI vision fallback to determine dial color.
   - Bundle listings expect no attached image for now.
   - Display max possible watches — document/report any exclusions.
   - WTB listings must be included/counted alongside WTS.
   - Contacts, seller info, images must flow through to both Trading Floor AND Price Research.

