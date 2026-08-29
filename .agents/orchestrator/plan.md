# Master Plan: WatchFacts Full Data Reconciliation & Navigation Fix

## Architecture
- **Frontend**: Vite + React + TypeScript single page application with React Router.
  - Core header component: `src/components/MarketHeader.tsx`
  - Core pages: `TradingFloor.tsx`, `PriceResearch.tsx`, `TelegramTest.tsx`, `DealerLogin.tsx`, `InsightDetails.tsx`.
- **Backend API**: Vercel Serverless Functions (`api/` directory) interfacing with Supabase DB.
  - Endpoints: `api/reviewed-market-inventory.js`, `api/price-research.js`, `api/price-research-listing.js`, `api/listing-contact.js`, `api/reviewed-seller-summary.js`, `api/model-stats.js`, `api/pipeline-parse.js`.
  - Helpers: `api/_lib/market-stats.cjs`, `api/_lib/source-redaction.cjs`.
- **Data Layers**:
  - Primary Enriched Dataset: 388 Excel files at `C:\Users\jasme\Downloads\WF\ALL watches normalized\` (~11.2M rows, 2.27M unique watches; contains enriched `Phone Number`, `Posted By`, `raw_line`, `Final Image URL`).
  - Raw Source Batch Files: Unbundled CSVs at `C:\Users\jasme\Documents\Codex\2026-07-12\review\work\wf-data-canary\audit-output\unbundled\`.
  - Supabase Database Views: `reviewed_workbook_market_source_v2`, `price_research_base_v1`.
  - Static Fallbacks: `public/top_watches_trading_floor.json` (3,000 listings) and `enriched_refs.json` (4,927 references).

## Feature Inventory
| # | Feature | Description | Requirement | Milestone | Status |
|---|---------|-------------|-------------|-----------|--------|
| 1 | Data Consistency | Reconcile total watch counts & search results across Trading Floor & Price Research | R1 | M1 | PLANNED |
| 2 | WTB Demand Integration | Separate WTB listings into "Demand Signals" section in Price Research side-by-side with WTS | R2 | M2 | PLANNED |
| 3 | Seller Contact & Raw Messages | Display unredacted raw source messages (untouched 'oceandigital'), seller name, phone, WhatsApp link, dealer stats | R3 | M3 | PLANNED |
| 4 | Relaxed Outlier Filters | Relax IQR fence from 1.5x to 3.0x; lower chart display threshold from 5 to 2 observations | R4 | M4 | PLANNED |
| 5 | Navigation UX | Persistent 1-click TopNav bar (`/trading`, `/price-research`, `/telegram-test`, `/dealer-login`) & breadcrumbs | R5 | M5 | PLANNED |
| 6 | Image & Vision Rules | Handle bundle listings (no image attached) and AI vision fallback for missing dial colors with image | R3, R4 | M3 | PLANNED |
| 7 | Build & Deployment Integrity | Zero TS build errors (`npm run build`), `git push origin main`, Vercel deployment check | Acceptance | M6 | PLANNED |

## Milestones
| # | Name | Scope | Dependencies | Status |
|---|------|-------|-------------|--------|
| M1 | Data Consistency | Align Trading Floor & Price Research query sources & count reconciliation formula | None | DONE |
| M2 | WTB Demand Signals | Integrate WTB listings as Demand Signals in Price Research | M1 | DONE |
| M3 | Contacts & Raw Messages | Render complete unredacted raw messages ('oceandigital' untouched), phone, WhatsApp button, dealer stats, image handling | None | DONE |
| M4 | Outlier Filter Relaxation | Update IQR multiplier to 3.0x and observation threshold to 2 across API and client libraries | M1, M2 | DONE |
| M5 | Navigation & UX | Implement persistent TopNav, breadcrumbs & back navigation | None | DONE |
| M6 | E2E Testing & Build Integrity | E2E test verification, `npm run build`, `git push origin main`, Vercel check | M1-M5 | DONE |


## Interface Contracts
### Trading Floor ↔ Price Research Data Reconciliation
- **Total Count Reconciliation Formula**:
  `Total TF Listings = Qualified WTS Comparable Set + WTB Demand Signals + Excluded Listings (Unpriced / Outliers / Unsplit Bundles)`
- **Listing Object Payload Contract**:
  - `raw_message`: string (unredacted; untouched chatbot RAW for 'oceandigital')
  - `seller_name`: string (from `Posted By`)
  - `seller_phone`: string (from `Phone Number`)
  - `whatsapp_url`: string (`https://wa.me/<digits>`)
  - `dealer_stats`: `{ wts_count: number, wtb_count: number, rating?: number }`
  - `image_url`: string (from `Final Image URL`; omitted for bundles)

## Code Layout
- `src/components/MarketHeader.tsx`: Top navigation bar component
- `src/components/Breadcrumbs.tsx`: Reusable breadcrumb & back-link component
- `src/pages/TradingFloor.tsx`: Trading Floor main page & detail modal
- `src/pages/PriceResearch.tsx`: Price Research search & reference detail page
- `src/pages/TelegramTest.tsx`: Telegram test staging surface
- `src/pages/DealerLogin.tsx`: Dealer login surface
- `src/pages/InsightDetails.tsx`: Individual insight/reference detail page
- `src/lib/analytics.ts`: Client-side analytics & IQR calculations
- `src/lib/pipeline.ts`: Data pipeline processing & filtering
- `api/_lib/market-stats.cjs`: Server-side IQR fences & sample threshold gates
- `api/_lib/source-redaction.cjs`: Source redaction rules
- `api/price-research.js`: Price Research API endpoint (cohorts, demand lookup)
- `api/price-research-listing.js`: Listing detail endpoint
- `api/listing-contact.js`: Seller contact endpoint
- `api/reviewed-seller-summary.js`: Dealer summary endpoint
- `api/model-stats.js`: Model stats & IQR endpoint
- `api/pipeline-parse.js`: Pipeline parser endpoint
