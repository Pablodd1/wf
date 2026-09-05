## 2026-08-03T14:16:06Z
Task: Survey the codebase regarding Seller Contacts & Raw Messages (R3) and Outlier Filtering (R4).
1. Read the original request at C:\tmp_s3_check\wf\.agents\ORIGINAL_REQUEST.md.
2. Investigate listing detail views on both Trading Floor and Price Research surfaces. Locate where seller name, phone number, WhatsApp link, dealer stats, and unredacted raw source messages are rendered (or redacted/missing).
3. Investigate Price Research analytics and outlier filter calculations (find where IQR fences are calculated, where 1.5x IQR is enforced, and where minimum observation thresholds like 5 observations are checked).
4. Identify all exact file paths, line numbers, and functions that need modification to:
   - Display unredacted raw message text, seller name, phone number with clickable WhatsApp button, and dealer activity stats.
   - Change 1.5x IQR fence to 3.0x IQR fence.
   - Lower minimum chart display threshold from 5 comparable observations to 2.
5. Create your metadata directory if it doesn't exist, and write progress.md and analysis.md / handoff.md in C:\tmp_s3_check\wf\.agents\teamwork_preview_explorer_survey_2.
6. Return a comprehensive handoff report detailing findings, files, lines, and recommendations. Include verification commands run and results.

## 2026-08-03T14:18:42Z
Received update from parent (fffac8e7-b53b-441c-a7c4-80de1633cd5a):
Additional user requirements and dataset details added to ORIGINAL_REQUEST.md.
Content: The user clarified:
1. Data Sources:
   - Primary Enriched Source: 388 Excel files at C:\Users\jasme\Downloads\WF\ALL watches normalized\ (contains populated Phone Number, Posted By, raw_line, Final Image URL).
   - Raw Source Batches: Unbundled CSVs at C:\Users\jasme\Documents\Codex\2026-07-12\review\work\wf-data-canary\audit-output\unbundled\.
2. Additional Requirements:
   - "oceandigital" source data should have untouched chatbot RAW messages.
   - If dial color is missing but image is present, use AI vision fallback for dial color.
   - Bundle listings expect no attached image.
   - Maximize watches displayed — document any exclusions.
   - WTB listings must be included/counted alongside WTS in Price Research.
   - Contacts, seller info, images must flow through to both Trading Floor AND Price Research.
