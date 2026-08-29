## 2026-08-03T15:03:50Z
Worker m2_1 assignment for Milestone M2 - WTB Demand Signals Integration in Price Research (R2).

Task instructions:
1. api/price-research.js:
   - In lookupDemand (and any related helper/cohort logic in api/price-research.js or api/_lib/market-stats.cjs), return WTB demand cohorts for reference queries without discarding cohorts with < 5 observations.
   - Retain all WTB cohorts regardless of observation count (e.g. 1+ or 2+ observations).
2. src/pages/PriceResearch.tsx:
   - In the reference detail view, render a dedicated "Demand Signals" section displaying WTB listing counts and buyer demand volume side-by-side with WTS asking-price charts.
   - Ensure WTB listings are strictly separated and NOT mixed into WTS asking-price averages or trend graphics.
   - Ensure seller contact (name, phone, WhatsApp link), unredacted raw source message, and image flow through on WTB demand cards/listings.
3. Verify Build:
   - Run npm run build and ensure zero TypeScript errors and clean exit code 0.
4. Report:
   - Write handoff.md in C:\tmp_s3_check\wf\.agents\worker_m2_1\handoff.md detailing changes made, verification results (npm run build output), and files modified. Send completion message back to parent.
