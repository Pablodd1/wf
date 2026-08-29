## 2026-08-03T14:23:43Z

Implement Milestone M3 — Complete Seller Contact & Raw Message Display & Image Rules (R3).

1. Read reference documents:
   - C:\tmp_s3_check\wf\.agents\ORIGINAL_REQUEST.md
   - C:\tmp_s3_check\wf\.agents\orchestrator\plan.md
   - C:\tmp_s3_check\wf\.agents\teamwork_preview_explorer_survey_2\handoff.md
   - C:\tmp_s3_check\wf\.agents\sub_orch_m3_contacts_messages\SCOPE.md

2. Implement implementation requirements:
   a. Unredacted raw source messages across detail views (`src/pages/TradingFloor.tsx`, `src/pages/PriceResearch.tsx`, `api/_lib/source-redaction.cjs`, `api/price-research-listing.js`, `api/listing-contact.js`, `api/reviewed-seller-summary.js`).
      - Update `api/_lib/source-redaction.cjs` and API endpoints so raw messages pass through unredacted.
      - For 'oceandigital' source: ensure raw messages from the chatbot remain untouched.
      - Remove withholding notices and redaction labels in UI (`TradingFloor.tsx`, `PriceResearch.tsx`).
   b. Seller contact & dealer stats display:
      - Display seller name (`Posted By`), phone number (`Phone Number`) with a clickable WhatsApp link (`https://wa.me/<digits>`), and dealer activity stats (WTS count, WTB count, rating).
      - Ensure contact details and seller summaries are returned without gating behind public approval flags.
   c. Image & Vision Rules:
      - Use `Final Image URL` from enriched Excel files / dataset.
      - Handle bundle listings: expect no attached image for bundle listings for now.
      - If dial color is missing on a listing but an image IS present, use AI vision fallback (or integrate AI vision fallback helper in the pipeline) to determine dial color.

3. MANDATORY INTEGRITY WARNING: DO NOT CHEAT. All implementations must be genuine. DO NOT hardcode test results, create dummy/facade implementations, or circumvent the intended task. A teamwork_preview_auditor will independently verify your work.

4. Verify build:
   - Run `npm run build` and ensure it completes with zero TypeScript errors.
   - Run `npm run test:normalization` if available.

5. Write handoff report at `C:\tmp_s3_check\wf\.agents\worker_m3_1\handoff.md` summarizing files modified, verification commands & outputs, and key rationale.
