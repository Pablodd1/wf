# Scope: Milestone M2 — WTB Demand Signals Integration in Price Research (R2)

## Mission
Integrate WTB (Want To Buy) listings into Price Research as a dedicated "Demand Signals" section:
- Return WTB demand cohorts for reference queries without discarding cohorts with < 5 observations in `api/price-research.js` (`lookupDemand`).
- Render a dedicated "Demand Signals" section in `src/pages/PriceResearch.tsx` displaying WTB listing counts and buyer demand volume side-by-side with WTS asking-price charts.
- Ensure WTB listings are NOT mixed into WTS asking-price averages or trend graphics.
- Ensure seller contact / raw message / image flow through on WTB demand cards.

## Acceptance Criteria
- [x] `api/price-research.js` (`lookupDemand`) returns WTB demand cohorts regardless of observation count (no truncation/discarding of cohorts with < 5 observations).
- [x] `src/pages/PriceResearch.tsx` renders a dedicated "Demand Signals" section in the reference detail view side-by-side with WTS asking-price charts.
- [x] WTB listings are verified NOT to be mixed into WTS asking-price metrics or trend graphics.
- [x] WTB demand cards display seller name/handle, seller contact phone / WhatsApp link, unredacted raw message, and image URL (when available).
- [x] `npm run build` passes cleanly with zero TypeScript / build errors.
- [x] All gate checks (Reviewers, Challengers, Auditor) pass cleanly.
