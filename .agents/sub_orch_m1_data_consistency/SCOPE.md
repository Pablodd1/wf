# Scope: Milestone M1 — Data Consistency Across Trading Floor and Price Research (R1)

## Objective
Ensure Trading Floor (`/trading`, `/api/reviewed-market-inventory.js`) and Price Research (`/price-research`, `/api/price-research.js`) query the exact same underlying dataset (primary enriched 388 Excel files / Supabase view `reviewed_workbook_market_source_v2`) and display consistent, reconcilable total watch counts.

## Inventory of Target Files / Endpoints
- `api/reviewed-market-inventory.js`: Trading Floor backend endpoint
- `api/price-research.js`: Price Research backend endpoint
- `api/_lib/reviewed-workbook-analytics.cjs`: Backend data loader
- `src/pages/TradingFloor.tsx`: Trading Floor frontend page
- `src/pages/PriceResearch.tsx`: Price Research frontend page

## Requirements & Acceptance Criteria
1. **Identical Query Basis**: Both surfaces derive watch data from `reviewed_workbook_market_source_v2` (or standard DB/JSON data layer fallback).
2. **Total Count Reconciliation Formula**:
   `Total TF Listings = Qualified WTS Comparable Set + WTB Demand Signals + Excluded Listings (Unpriced / Outliers / Unsplit Bundles)`
3. **Reconciled Search Results**: Searching by brand or reference (e.g., `116500LN`) on Trading Floor and Price Research yields identical total dataset listings.
4. **Summary Accounting Header**: `/api/price-research` returns a detailed reconciliation payload containing:
   - `total_tracked_listings`: N (matching Trading Floor total)
   - `wts_eligible_analytics_count`: N_WTS
   - `wtb_demand_count`: N_WTB
   - `excluded_count`: N_EXCLUDED (with breakdown: unpriced, outliers, unsplit bundles)

## Work Items
| # | Work Item | Description | Status |
|---|-----------|-------------|--------|
| 1 | Query Source Alignment | Ensure both endpoints query `reviewed_workbook_market_source_v2` and handle fallback consistently | DONE |
| 2 | Reconciliation Breakdown Logic | Implement total count reconciliation math and return breakdown in `/api/price-research` | DONE |
| 3 | Frontend Count Display Alignment | Update `TradingFloor.tsx` and `PriceResearch.tsx` to surface total reconciled listing count & breakdown | DONE |
| 4 | Verification & Gate | Reviewer, Challenger, Auditor verification + build check | DONE |
