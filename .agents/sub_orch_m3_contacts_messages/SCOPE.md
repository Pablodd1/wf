# Scope: Milestone M3 — Complete Seller Contact & Raw Message Display & Image Rules (R3)

## Objective
Implement unredacted raw source message display, complete seller contact details with clickable WhatsApp links and dealer stats, and image/vision fallback rules across Trading Floor, Price Research, and API serverless endpoints.

## Target Files
1. `api/_lib/source-redaction.cjs`
2. `api/price-research-listing.js`
3. `api/listing-contact.js`
4. `api/reviewed-seller-summary.js`
5. `src/pages/TradingFloor.tsx`
6. `src/pages/PriceResearch.tsx`
7. Any relevant helpers/pipeline files for image/vision fallback if required.

## Key Technical Requirements
1. **Unredacted Raw Source Messages**:
   - Update `api/_lib/source-redaction.cjs` and API endpoints (`api/price-research-listing.js`, `api/listing-contact.js`, `api/reviewed-seller-summary.js`) to allow raw messages to pass unredacted.
   - Ensure 'oceandigital' source raw messages from chatbot remain untouched.
   - Update `TradingFloor.tsx` and `PriceResearch.tsx` detail views to display full unredacted raw source messages without withholding notices or redaction tags.

2. **Seller Contacts & Dealer Stats**:
   - Return and render `Posted By` (seller name), `Phone Number`, clickable WhatsApp link (`https://wa.me/<cleaned_phone_digits>`).
   - Render dealer activity stats: WTS count, WTB count, and rating (if available).

3. **Image & Vision Fallback Rules**:
   - Use `Final Image URL` from enriched data.
   - Bundle listings are expected to have no attached image for now.
   - If dial color is missing on a listing but an image IS present, implement/trigger AI vision fallback to determine dial color.

## Verification Requirements
- `npm run build` must pass cleanly with zero TypeScript errors.
- Pass Reviewer, Challenger, and Auditor verification gates.
