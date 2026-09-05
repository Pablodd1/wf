## 2026-08-03T14:16:06Z
Task: Survey the codebase regarding Data Consistency (R1) and WTB Demand Integration (R2).
1. Read the original request at C:\tmp_s3_check\wf\.agents\ORIGINAL_REQUEST.md.
2. Investigate how Trading Floor (`/trading`) and Price Research (`/price-research`) query their datasets. Look at frontend components (e.g. `src/pages/TradingFloor`, `src/pages/PriceResearch`, hooks, components) and Vercel serverless API endpoints (e.g. `api/`).
3. Determine why total listing counts differ between Trading Floor and Price Research. Identify all data sources used (Supabase DB, `public/top_watches_trading_floor.json`, `enriched_refs.json`, Excel source files, etc.).
4. Investigate where WTB (Want To Buy) listings are currently handled or filtered out, and how they should be integrated into Price Research as a separate "Demand Signals" section.
5. Create your metadata directory if it doesn't exist, and write `progress.md` and `analysis.md` / `handoff.md` in C:\tmp_s3_check\wf\.agents\teamwork_preview_explorer_survey_1.

## 2026-08-03T14:18:22Z
From: parent (fffac8e7-b53b-441c-a7c4-80de1633cd5a)
Context: Additional user requirements and dataset details added to ORIGINAL_REQUEST.md.
Content: The user clarified:
1. Data Sources:
   - Primary Enriched Source: 388 Excel files at `C:\Users\jasme\Downloads\WF\ALL watches normalized\` (contains populated `Phone Number`, `Posted By`, `raw_line`, `Final Image URL`).
   - Raw Source Batches: Unbundled CSVs at `C:\Users\jasme\Documents\Codex\2026-07-12\review\work\wf-data-canary\audit-output\unbundled\`.
2. Additional Requirements:
   - "oceandigital" source data should have untouched chatbot RAW messages.
   - If dial color is missing but image is present, use AI vision fallback for dial color.
   - Bundle listings expect no attached image.
   - Maximize watches displayed — document any exclusions.
   - WTB listings must be included/counted alongside WTS in Price Research.
   - Contacts, seller info, images must flow through to both Trading Floor AND Price Research.
Action: Please review the updated ORIGINAL_REQUEST.md at C:\tmp_s3_check\wf\.agents\ORIGINAL_REQUEST.md and incorporate these data source details and requirements into your survey report.

