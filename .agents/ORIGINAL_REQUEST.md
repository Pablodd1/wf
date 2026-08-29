# Original User Request

## Initial Request — 2026-08-03T14:13:30Z

# Teamwork Project Prompt — WatchFacts Full Data Reconciliation & Navigation Fix

Fix the live WatchFacts production website so ALL 2.27M watches (WTS + WTB) display consistently across Trading Floor AND Price Research, with full raw messages, seller contacts, analytics graphics, and smooth navigation between pages.

Working directory: C:\tmp_s3_check\wf
Integrity mode: development

## Context

WatchFacts is a live production luxury watch marketplace at `https://watchfacts-poc.vercel.app`. The codebase is a Vite + React + TypeScript app deployed on Vercel with 78 serverless API endpoints and a Supabase database backend. The master dataset lives in 388 Excel files at `C:\Users\jasme\Downloads\WF\ALL watches normalized` containing ~11.2M rows (2.27M unique watches after deduplication). A static JSON fallback file (`public/top_watches_trading_floor.json`, 3,000 listings) and a reference analytics file (`enriched_refs.json`, 4,927 references) provide offline data when the database is unavailable.

**Current problems:**
1. Trading Floor (`/trading`) and Price Research (`/price-research`) show inconsistent watch counts — they query different data sources and apply different filters.
2. WTB (Want To Buy) listings are completely excluded from Price Research analytics — they should be counted and displayed as a separate demand signal.
3. Seller contacts, phone numbers, and WhatsApp links are missing on Price Research individual listing detail views.
4. Raw source messages are not displaying on some watch cards across both surfaces.
5. Navigation between pages (Trading Floor, Price Research, Telegram Test, Dealer Login) is not user-friendly — no persistent navigation bar or breadcrumbs for smooth back-and-forth browsing.
6. Price Research outlier filters are too aggressive — too many valid watches are excluded, causing empty analytics charts for references that should have data.

## Requirements

### R1. Data Consistency Across Trading Floor and Price Research
Trading Floor and Price Research must query the same underlying dataset and display consistent total watch counts. When a user sees N watches for a brand on Trading Floor, Price Research must account for the same N watches (showing how many qualified for price analytics vs. how many were WTB demand signals vs. how many lacked prices).

### R2. WTB Demand Signal Integration in Price Research
WTB (Want To Buy) listings must be included in Price Research as a visible "Demand Signals" section — showing buyer interest counts per reference, not mixed into seller asking-price averages. Each reference analytics page should display both WTS asking-price charts AND WTB demand volume side by side.

### R3. Complete Seller Contact & Raw Message Display
Every watch listing detail view (on both Trading Floor and Price Research) must display: (a) the full unredacted raw source message, (b) seller name/handle, (c) phone number with clickable WhatsApp link, and (d) dealer activity stats (WTS count, WTB count, rating if available). No asterisks, no "contact redacted", no blank fields where data exists in the source files.

### R4. Relaxed Outlier Filters for Fuller Analytics
Price Research outlier filters must be relaxed from 1.5×IQR to 3.0×IQR, and the minimum chart display threshold must be lowered from 5 comparable observations to 2. This ensures more references render price trend graphics instead of showing empty/disabled charts.

### R5. Smooth Navigation UX
Add a persistent, always-visible navigation bar or tab system that allows users to move seamlessly between Trading Floor, Price Research, Telegram Test Staging, and Dealer Login from any page. Include breadcrumbs or back-links so users never feel "stuck" on a page.

## Acceptance Criteria

### Data Consistency
- [ ] Trading Floor total listing count and Price Research total listing count are derived from the same data source and are reconcilable (TF total = PR WTS eligible + PR WTB demand + PR excluded with documented reasons)
- [ ] Searching for a specific reference (e.g. `116500LN`) on Trading Floor and Price Research returns results sourced from the same dataset

### WTB Integration
- [ ] Price Research reference detail pages display a "Demand Signals" section showing WTB listing count for that reference
- [ ] WTB listings are NOT mixed into WTS asking-price averages or trend charts

### Seller Contacts & Raw Messages
- [ ] Clicking any watch listing on Trading Floor or Price Research shows the full raw source message text (no asterisks or redaction labels)
- [ ] Seller name and phone number are displayed when available, with a clickable WhatsApp button

### Outlier Filters
- [ ] Price Research uses 3.0×IQR fences instead of 1.5×IQR
- [ ] References with 2+ comparable observations render price trend charts (previously required 5+)

### Navigation
- [ ] A persistent navigation bar is visible on every page allowing 1-click access to Trading Floor, Price Research, Telegram Test, and Dealer Login
- [ ] Users can navigate back to the previous page from any detail view without using the browser back button

### Build Integrity
- [ ] `npm run build` completes with zero TypeScript errors
- [ ] `git push origin main` succeeds and Vercel deployment builds successfully

## Follow-up — 2026-08-03T14:17:37Z

IMPORTANT ADDITIONAL CONTEXT FROM USER:

## Data Sources Available

### 1. Unbundled CSVs (Raw Source of Truth)
Location: `C:\Users\jasme\Documents\Codex\2026-07-12\review\work\wf-data-canary\audit-output\unbundled\`
- 16 listing batch files (`unbundle_*_listings_batch_*.csv`) — total ~8.3 GB
- 11 raw message batch files (`unbundle_*_raw_messages_batch_*.csv`) — total ~1.0 GB  
- 11 mapping batch files (`unbundle_*_mapping_batch_*.csv`) — total ~3.1 GB

Listing CSV columns: `listing_id, source_record_id, candidate_index, brand, reference, model, raw_line, condition, price_raw, price_currency, price_usd, price_text, listing_type, dial_color, set_status, listing_status, change_flags, review_status, analyzed_at, source_created_at, source_type, seller_name, seller_phone, dealer, exchange, image_url`

Raw Messages CSV columns: `source_record_id, raw_message, candidate_count, brand, reference, listing_type, created_at, source_type, seller_name, seller_phone, dealer, change_flags, review_status, analyzed_at`

**CRITICAL FINDINGS from unbundled CSV audit (100K sample):**
- seller_name: 0% populated (empty in unbundled CSVs)
- seller_phone: 0% populated (empty in unbundled CSVs)
- image_url: 0% populated (empty in unbundled CSVs)
- raw_line: 100% populated ✅
- dial_color: 97% populated ✅
- WTS: 93,365 | WTB: 6,595

### 2. Normalized Excel Files (388 files, 28 columns each)
Location: `C:\Users\jasme\Downloads\WF\ALL watches normalized\`
Columns: `Auction ID, Posting Date, Posted By, raw_line, Phone Number, Intent / Type, Brand, Model, Raw Reference, Normalized Reference, Catalog Reference, Catalog Model, Dial Color, Catalog Dial, Condition, Price ($ USD), Verification Tier, Confidence %, Verification Status, User Image URL, Catalog Image URL, Final Image URL, qa_disposition, catalog_status, trading_floor_eligible, price_research_eligible, dial_resolution_source, Currency`

**The Excel files DO have:**
- `Phone Number` populated (enriched via earlier pipeline)
- `Posted By` (seller/dealer name) populated
- `raw_line` (100% populated)
- `Final Image URL` (some populated)
- `Dial Color` (97%+ populated)

### 3. User's Additional Requirements
1. Data from "oceandigital" source should have RAW messages coming from the chatbot untouched
2. If no dial color is available but an image IS present, use AI vision to determine the dial color from the image
3. If it's a bundle listing, no image is attached for now (expected)
4. Display as many watches as possible — ask the user if some can't be posted and explain why
5. WTB listings must be included and counted alongside WTS
6. All contacts, seller info, images should flow through to both Trading Floor AND Price Research

The full 388-file audit is currently running and will provide exact population rates. Use the Excel files as the primary enriched data source since they have the contacts enriched.

