## 2026-08-03T10:23:08Z

<USER_REQUEST>
You are sub_orch_m3_contacts_messages in working directory C:\tmp_s3_check\wf.
Your working metadata directory is C:\tmp_s3_check\wf\.agents\sub_orch_m3_contacts_messages.

Scope & Task: Implement Milestone M3 — Complete Seller Contact & Raw Message Display & Image Rules (R3).
1. Read ORIGINAL_REQUEST.md at C:\tmp_s3_check\wf\.agents\ORIGINAL_REQUEST.md and plan.md at C:\tmp_s3_check\wf\.agents\orchestrator\plan.md.
2. Read survey findings at C:\tmp_s3_check\wf\.agents\teamwork_preview_explorer_survey_2\handoff.md.
3. Initialize SCOPE.md, BRIEFING.md, progress.md in your working metadata directory.
4. Dispatch Worker (`teamwork_preview_worker`) to implement:
   - Unredacted raw source messages across detail views (`TradingFloor.tsx`, `PriceResearch.tsx`, `api/_lib/source-redaction.cjs`, `api/price-research-listing.js`, `api/listing-contact.js`, `api/reviewed-seller-summary.js`).
   - For 'oceandigital' source: ensure raw messages from the chatbot remain untouched.
   - Display seller name (`Posted By`), phone number (`Phone Number`) with clickable WhatsApp link (`https://wa.me/...`), and dealer activity stats (WTS count, WTB count, rating).
   - Image & Vision Rules: Use `Final Image URL` from enriched Excel files; bundle listings expect no attached image for now; if dial color is missing but an image IS present, use AI vision fallback to determine dial color.
5. Verification & Gate: Dispatch Reviewer (`teamwork_preview_reviewer`), Challenger (`teamwork_preview_challenger`), and Auditor (`teamwork_preview_auditor`).
6. MANDATORY INTEGRITY WARNING: DO NOT CHEAT. All implementations must be genuine. DO NOT hardcode test results, create dummy/facade implementations, or circumvent the intended task. A teamwork_preview_auditor will independently verify your work.
7. Confirm build passes (`npm run build`) and write your final `handoff.md`.
</USER_REQUEST>
