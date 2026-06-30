# WatchFacts — Developer Handoff Document
**Date:** July 1, 2026 (Session 2 Continuation)
**Platform:** watchfacts-poc.vercel.app
**Repo:** github.com/Pablodd1/wf (branch: `main`)
**Database:** Supabase (PostgreSQL) — 2,392,784 listings

---

## 1. PROJECT OVERVIEW

WatchFacts is a luxury watch trading platform with AI-powered data normalization. The platform ingests free-text dealer messages (WhatsApp, Telegram, email), parses them using an NLP engine (Parser v3.1), normalizes the data into structured records, and presents them on a Trading Floor with price research, analytics, and admin tools.

**Key Metrics:**
- Total Listings: 2,392,784
- Brands: ~200 valid (after filtering ~400 junk entries)
- Catalog Images: 5,044 in Supabase Storage
- Parser Accuracy: 86% (v3.1)
- API Endpoints: 12+
- Deployment: Vercel (serverless) + Supabase (PostgreSQL)

---

## 2. ARCHITECTURE

```
+------------------------------------------------------------------+
|                        CLIENT (React 18 + Vite)                   |
|  +----------+ +----------+ +-------------+ +--------------+    |
|  | Homepage | | Trading  | | Price       | | Blog         |    |
|  |          | | Floor    | | Research    | | (10 articles)|    |
|  +----------+ +----------+ +-------------+ +--------------+    |
|  +----------+ +----------+ +-------------+ +--------------+    |
|  | Admin    | | Login    | | Reference   | | Reports      |    |
|  | (14tabs) | |          | | Check       | |              |    |
|  +----------+ +----------+ +-------------+ +--------------+    |
|  React 18 + TypeScript + Tailwind CSS + shadcn/ui               |
|  Framer Motion + Recharts + Lucide Icons                        |
|  BrowserRouter (react-router-dom v6) <- FIXED from HashRouter   |
+------------------------------------------------------------------+
                              |
                              v
+------------------------------------------------------------------+
|                      API (Vercel Serverless)                      |
|  +--------------+ +--------------+ +----------------------+    |
|  | batch-parse  | | reprocess-   | | green-api-live       |    |
|  | (Parser v3.1)| | batch        | | (WhatsApp webhook)   |    |
|  +--------------+ +--------------+ +----------------------+    |
|  +--------------+ +--------------+ +----------------------+    |
|  | green-api-   | | generate-    | | batch-process        |    |
|  | setup        | | report       | | (cron every 6h)      |    |
|  +--------------+ +--------------+ +----------------------+    |
|  +--------------+ +--------------+ +----------------------+    |
|  | health-check | | settings     | | export               |    |
|  |              | |              | |                      |    |
|  +--------------+ +--------------+ +----------------------+    |
+------------------------------------------------------------------+
                              |
                              v
+------------------------------------------------------------------+
|                    DATABASE (Supabase PostgreSQL)                  |
|  +--------------------+  +--------------+  +----------------+   |
|  | watch_records      |  | reference_   |  | reprocessing_  |   |
|  | (2,392,784 rows)   |  | images       |  | queue          |   |
|  | 28 columns         |  | (5,044 rows) |  | (2,393 batches)|   |
|  +--------------------+  +--------------+  +----------------+   |
|  +--------------------+  +--------------+  +----------------+   |
|  | reprocessing_      |  | reprocessing_ |  | mv_stats_     |   |
|  | progress           |  | logs         |  | summary       |   |
|  | (1 row)            |  | (history)    |  | + 8 more MVs  |   |
|  +--------------------+  +--------------+  +----------------+   |
|  RLS: ENABLED (all tables)                                       |
|  9 Materialized Views (some broken -- see Known Issues)          |
+------------------------------------------------------------------+
```

---

## 3. EVERYTHING THAT WAS BUILT

### A. Parser v3.1-patch1 (`api/_lib/parser.js`)
- Extracts: brand, reference, price, condition, dial color, year, box & papers
- Supports USD/HKD/EUR/GBP/CHF with K/M suffixes
- WhatsApp format: emoji, flags, section headers, multi-listing
- Confidence scoring: APPROVED>85%, REVIEW>70%, HUMAN>50%, RECYCLE<50%
- **NORM_001-004** + 5 listing overrides (see section 7)

### B. Trading Floor (`src/pages/TradingFloor.tsx`)
- Infinite scroll (100/batch) + Load All (10K client-side)
- Real images: Supabase reference_images -> brand gradient fallback
- Dealer names extracted from raw_message
- Filters: FOR SALE, NTQ/WTB, WATCHES, OTHER, condition grades
- Currency converter (10 currencies)
- Stats bar: 2,392,784 listings, 29,512+ dealers

### C. Price Research (`src/pages/PriceResearch.tsx`)
- Brand dropdown with **batched fetching + deduplication + validation**
  - Fetches in 1000-record batches (handles full 2.39M table)
  - Filters junk via `filterValidBrands()` from `referenceValidator.ts`
  - Shows: "X brands loaded (Y junk entries filtered)"
- Reference dropdown per selected brand
- Price trend charts by dial color
- IQR outlier detection
- Price range distribution bar
- Data interpretation text

### D. Admin Panel (`src/pages/AdminPage.tsx`) -- 14 Tabs
1. Search -- full-text search
2. Data -- browse raw records
3. Analytics -- charts (brand/verdict/price trends)
4. Review -- human review queue
5. Reports -- PDF/Excel reports
6. Health -- real service checks (FIXED)
7. Export -- CSV/Excel download
8. Quality -- data quality scoring
9. Verification -- reference verification
10. Clean -- data cleaning utilities
11. Import -- bulk import (admin-only, 450 listings)
12. Settings -- parser configuration (API-connected)
13. Blog -- article management
14. Reprocess -- 2.39M record reprocessing dashboard

### E. Blog (`src/pages/BlogPage.tsx`)
- 10 luxury watch articles
- Category filter: Investment, Technology, Reference, Blockchain, Market Data, Education, Analysis, Collecting

### F. Footer (`src/components/Footer.tsx`)
- Real WatchFacts links (trading floor, reports, partners, hire fi, dealer login)
- Stats bar: "2,392,784 listings normalized . Parser v3.0"

### G. Security
- RLS enabled on all reprocessing tables
- 3 duplicate indexes dropped
- Mutable search_path fixed on 3 functions

### H. Green API Integration
- `/api/green-api-live.js` -- WhatsApp webhook handler
- `/api/green-api-setup.js` -- Webhook configuration endpoint
- **Status:** Built, awaiting fresh credentials (current token expired)

### I. Reprocessing Pipeline
- Queue table: 2,393 batches of 1,000 records each
- API endpoint: `/api/reprocess-batch`
- Local Node processor: 60-300 req/sec (ready to run)
- Report tab with before/after comparison

---

## 4. ALL FIXES (Both Sessions)

### CRITICAL: HashRouter -> BrowserRouter (`src/main.tsx`)
**Commit:** `2304756`
**Problem:** All routes (/trading, /blog, /admin, /price-research) showed homepage
**Fix:** Changed `HashRouter` to `BrowserRouter`. `vercel.json` already had SPA rewrites.

### CRITICAL: Health Page DB Timeout (`src/pages/HealthPage.tsx`)
**Commits:** `1bb43df`, `166def9`
**Problem:** `count=exact` on 2.39M rows -> 8s timeout -> HTTP 500 -> "Supabase DB Offline"
**Fix:** Changed to `SELECT id LIMIT 1` lightweight connectivity check

### Price Research Brand Deduplication (Session 1)
**Commits:** `9f87537`, `1bcd144`, `a82433c`
**Problem:** 953 duplicate brands (Patek Philippe x100), references as brands (15510OR), colors (black), prices (5 million)
**Fix:**
- Switched from broken `mv_brand_dist` to direct `watch_records` query
- Added `Map`-based client-side dedup

### Price Research Brand Filtering (Session 2 Continuation)
**Files:** `src/lib/referenceValidator.ts` (NEW), `src/pages/PriceResearch.tsx`
**Problem:** Brand dropdown still showed junk after basic dedup
**Fix:**
- Created `referenceValidator.ts` with `isValidBrand()` and `filterValidBrands()`
  - Filters: pure numbers, years, price suffixes, reference numbers, conditions, colors, materials, non-brand values, overly long strings
- Updated `PriceResearch.tsx`:
  - Batched fetching (1000 records at a time, up to 10K)
  - Calls `filterValidBrands()` on all fetched brands
  - Shows validation note: "X brands loaded (Y junk entries filtered)"
  - Added `validationNote` state + UI display below brand dropdown

### Parser v3.1-patch1 Normalization
**Commit:** `8abaff8` (original), synced to project in Session 2
**Added:** NORM_001 (brand mismatch bypass), NORM_002 (price shorthand), NORM_003 (ref vs price conflict), NORM_004 (non-watch filter), 5 listing overrides

---

## 5. KNOWN ISSUES -- PENDING

### P0 (Critical -- Fix Next)
| # | Issue | Details | Suggested Fix |
|---|-------|---------|---------------|
| 1 | **Brand dropdown still may show edge-case junk** | Chinese brand names ("BaoJi", "YaDianBiao"), rare entries like "A3239011.BC34" may pass `isValidBrand()`. The regex patterns are conservative but not exhaustive. | Add explicit block-list for known junk patterns. Add allow-list for known valid brands (use BRAND_MAP from parser). |
| 2 | **mv_brand_dist returns HTTP 500** | Materialized view is broken -- needs to be refreshed or recreated in Supabase SQL Editor | Run `REFRESH MATERIALIZED VIEW mv_brand_dist;` or recreate |
| 3 | **Parser test 9 of 37 FAILS** | 1 test case still fails in parser smoke test. Need to identify which one. | Run parser smoke test locally, identify failing case, fix regex |

### P1 (Important -- Fix Soon)
| # | Issue | Details | Suggested Fix |
|---|-------|---------|---------------|
| 4 | **Green API token expired** | `/api/green-api-setup` returns 401. Need fresh credentials from Green API dashboard | User to provide GREEN_API_ID_INSTANCE + GREEN_API_API_TOKEN |
| 5 | **Reprocessing 2.39M not started** | Queue is filled, local processor is ready, but no batches have been processed yet | Run local Node processor script (see `api/reprocess-local.js`) |
| 6 | **Missing catalog images** | Only 5,044 images for 2.39M listings (~0.2% coverage) | Expand reference_images table or implement external image API |
| 7 | **IQR outlier detection incomplete** | Price validation uses IQR but not consistently across all price fields | Apply IQR filter in parser before saving to DB |
| 8 | **Duplicate brand variants** | "F.P. Journe" vs "F.P.Journe" vs "FPJ" vs "FP Journe" appear as separate brands | Create brand canonicalization map in parser |

### P2 (Nice to Have)
| # | Issue | Details |
|---|-------|---------|
| 9 | **Blog images** | Articles have no images -- add AI-generated or stock watch photos |
| 10 | **Mobile responsive polish** | Some admin tabs overflow on small screens |
| 11 | **Search functionality** | Global search exists but needs better ranking |
| 12 | **Email notifications** | No email system for alerts or reports |

---

## 6. FILE REFERENCE -- Key Files

### Parser (Most Critical)
```
api/_lib/parser.js              -- Core parser engine (v3.1-patch1) [SYNCED July 1]
src/lib/referenceValidator.ts   -- Reference/brand validation utility [NEW July 1]
```

### Frontend Pages
```
src/pages/TradingFloor.tsx      -- Main listing browser
src/pages/PriceResearch.tsx     -- Price analytics (UPDATED July 1 with filterValidBrands)
src/pages/AdminPage.tsx         -- Admin dashboard (14 tabs)
src/pages/BlogPage.tsx          -- 10 luxury watch articles
src/pages/HealthPage.tsx        -- Service monitoring (FIXED)
src/pages/ReprocessPage.tsx     -- 2.39M reprocessing dashboard
```

### API Endpoints
```
api/batch-parse.js              -- Parse watch messages
api/reprocess-batch.js          -- Batch reprocessing + stats
api/green-api-live.js           -- WhatsApp webhook
api/green-api-setup.js          -- Green API config
api/generate-report.js          -- Analytics reports
api/health-check.js             -- System health
api/settings.js                 -- Parser configuration
```

### Shared Components
```
src/components/PublicNavbar.tsx -- Navigation (logo fix)
src/components/Footer.tsx       -- Footer with real links + stats
src/components/DealerNavbar.tsx -- Logged-in nav
src/lib/imageResolver.ts        -- Multi-layer image fallback
```

### Config
```
src/main.tsx                    -- BrowserRouter entry
src/index.css                   -- Global dark input styles
vercel.json                     -- SPA rewrites (IMPORTANT)
index.html                      -- Favicon + meta tags
```

---

## 7. PARSER V3.1-PATCH1 -- NORMALIZATION RULES

### NORM_001: Brand Mismatch Bypass
If text explicitly contains a different luxury brand than the header, use the explicit brand:
- Detects: Bvlgari, Richard Mille, RM, Audemars Piguet, AP, Vacheron
- Use case: Bulk dealer dumps where header says "PP" but text lists "RM30-01"
- Implementation: `parseBrand()` in `api/_lib/parser.js` lines 278-289

### NORM_002: Price Shorthand Validation
- HKD with "m" suffix -> multiply by 1,000,000
- Capped at $10M USD equivalent (flags for review if exceeded)
- Pattern: `hkd998m` -> HKD 998,000 -> $127,700 USD
- Implementation: `parsePrice()` lines 484+ and post-processing in `parseFull()`

### NORM_003: Reference vs Price Conflict
If extracted price is within 1% of the reference number -> reject the price
- Example: reference "126301" should NOT become price $126,301
- Implementation: `validatePriceNotReference()` lines 591-600

### NORM_004: Non-Watch Filter
Detects bags, leather goods, jewelry -> sets `listingType: 'OTHER'`, reduces confidence to 30%
- Keywords: bag, shoulder bag, leather, crossbody, tote, clutch, purse, wallet
- Implementation: `detectNonWatch()` lines 605-609

### Listing Overrides (5 cases)
| ID | Input | Output |
|----|-------|--------|
| 101910 | Brand: Rolex, Price: $126,301 | Brand: Bulgari, Model: Serpenti Tubogas, Price: $12,500 |
| RM30-01 | Brand: Patek Philippe | Brand: Richard Mille, Model: RM30-01 Le Mans, Price: $268,000 |
| 126301 | Price = reference number | Price: $15,900 (extracted from "15,900 + Label") |
| 774209 | Listed as Rolex | Brand: Gucci, Model: Horsebit 1955, Category: OTHER, Price: $1,825 |
| hkd998m | "hkd998m" shorthand | HKD 998,000 -> $127,700 USD |

---

## 8. REFERENCE VALIDATOR (`src/lib/referenceValidator.ts`)

### Exports
```typescript
isValidBrand(brand: string): boolean
  // Returns false for: pure numbers, years, prices, conditions, colors,
  // references, materials, non-brand values, overly long strings

filterValidBrands(brands: string[]): string[]
  // Filters array through isValidBrand() + Map-based deduplication
  // Returns sorted unique valid brands

isReferenceLike(value: string): boolean
  // Quick check if value looks like a watch reference number
```

### Validation Rules (isValidBrand)
1. Must be string, >= 2 chars, <= 50 chars
2. NOT pure number
3. NOT a year (19xx or 20xx)
4. NOT price format (123K, 1.5M, $1,000)
5. NOT condition (new, used, mint, etc.)
6. NOT color (black, blue, etc.)
7. NOT material (gold, steel, etc.)
8. NOT reference-like (4-6 digit alphanumeric like "126301")
9. NOT generic (unknown, n/a, none, etc.)

### Integration Points
- `PriceResearch.tsx` -- brand dropdown filtering
- Can be used in: Admin data browser, Trading Floor filters, Import validation

---

## 9. DATABASE SCHEMA

### watch_records (2,392,784 rows)
```
id (uuid, PK)
brand (text)           -- e.g., "Rolex", "Patek Philippe"
model (text)           -- e.g., "Datejust", "Nautilus"
reference (text)       -- e.g., "126334", "5711/1A"
price_usd (numeric)    -- normalized to USD
price_raw (text)       -- original price text
currency (text)        -- USD, HKD, EUR, etc.
dial_color (text)      -- Blue, Black, White, etc.
condition (text)       -- New, N1-N9, Mint, etc.
year (integer)         -- 1990-2026
box_papers (text)      -- full set, box only, papers only, none
verdict (text)         -- APPROVED, REVIEW, HUMAN, RECYCLE, WTB
confidence (numeric)   -- 0-100 score
dealer_name (text)     -- extracted from raw_message
raw_message (text)     -- original dealer text
source (text)          -- whatsapp, telegram, email, manual
listing_type (text)    -- WATCH, OTHER
received_at (timestamp)
created_at (timestamp)
```

### Materialized Views
```
mv_stats_summary      -- total_records, total_brands, total_refs, avg/min/max price
mv_brand_dist         -- brand distribution (BROKEN -- returns HTTP 500)
mv_verdict_dist       -- verdict distribution (working)
mv_cond_dist          -- condition distribution
mv_dial_dist          -- dial color distribution
mv_top_refs           -- top references by volume
mv_price_buckets      -- price range distribution
```

### Reprocessing Tables
```
reprocessing_queue     -- 2,393 batches (status: pending/processing/completed/failed)
reprocessing_progress  -- 1 row tracking overall progress
reprocessing_logs      -- per-batch history
```

---

## 10. HOW TO RUN LOCALLY

```bash
# Clone
git clone https://github.com/Pablodd1/wf.git
cd wf

# Install
npm install

# Dev server
npm run dev

# Build
npm run build

# Parser smoke test (if available)
npm test -- parser

# Local reprocessing (runs batches against live Supabase)
node api/reprocess-local.js
```

---

## 11. ENVIRONMENT VARIABLES (VERCEL)

```
SUPABASE_URL=https://bptrvfncppbjnchsaxtb.supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJwdHJ2Zm5jcHBiam5jaHNheHRiIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4MTU2MjYzMSwiZXhwIjoyMDk3MTM4NjMxfQ.x1KpnBCtgcn02hiBJfuNkm3FYq6elHv3Gnys62nu8SU

# Green API (EXPIRED -- needs refresh)
GREEN_API_ID_INSTANCE=<PASTE FROM console.green-api.com>
GREEN_API_API_TOKEN=<PASTE FROM console.green-api.com>

# Telegram (optional)
TELEGRAM_BOT_TOKEN=<optional>

# Parser tuning (optional)
APPROVE_THRESHOLD=85
HUMAN_THRESHOLD=70
```

---

## 12. BITBUCKET WF-ADMIN REPO (Separate Laravel+Angular Admin)

**Location:** `bitbucket.org/watchfacts-trade/wf-admin` (user's local copy: `C:\Users\jasme\Downloads\wfrepobitbucket`)
**Stack:** PHP Laravel backend + Angular frontend
**Purpose:** Separate admin panel with production normalization rules, brand catalogs, exception handling

### Key Files to Extract (for integration into React platform)
```
backend/app/Models/AuctionsNormalizationRule.php    -- Production normalization rules
backend/app/Models/TradingFloor/FlashSale*.php       -- Trading floor data models
backend/app/Services/Extractor/ExceptionFlags.php    -- Exception flag extraction
backend/app/Services/Catalogs/AuctionNormalizationImportService.php  -- Import service
backend/app/Jobs/FlashSale/ProcessUpdateNormalizationRule.php        -- Normalization job
backend/routes/catalogs.php                          -- Catalog API routes
backend/routes/groups.php                            -- WhatsApp group routes
```

### Integration Plan (see `BITBUCKET_INTEGRATION_PLAN.md` for details)
1. Extract brand canonicalization rules from `AuctionsNormalizationRule.php`
2. Port exception handling from `ExceptionFlags.php`
3. Import catalog management logic from `AuctionNormalizationImportService.php`
4. Merge Green API instance config from `GreenApiInstance.php`

---

## 13. IMMEDIATE NEXT STEPS FOR NEW DEVELOPER

### Priority 1 (Do First)
1. **Commit current changes** -- Parser v3.1 sync, referenceValidator.ts, PriceResearch.tsx updates
2. **Fix remaining brand junk in dropdown** -- Tune `isValidBrand()` regex. Add explicit allow-list using BRAND_MAP from parser.
3. **Fix mv_brand_dist** -- Log into Supabase SQL Editor and run `REFRESH MATERIALIZED VIEW CONCURRENTLY mv_brand_dist;`
4. **Test parser** -- Run parser smoke test, fix the 1 remaining failure

### Priority 2 (Do Next)
5. **Get Green API credentials** -- Ask user for fresh token, test webhook
6. **Start reprocessing** -- Run `node api/reprocess-local.js` to begin processing 2.39M records
7. **Add brand canonicalization** -- Map "F.P. Journe" / "FPJ" / "F.P.Journe" -> single brand

### Priority 3 (Do Later)
8. Expand catalog images (5,044 -> target 50,000+)
9. Integrate Bitbucket wf-admin normalization rules (see BITBUCKET_INTEGRATION_PLAN.md)
10. Add blog article images
11. Polish mobile responsive design
12. Implement email notifications

---

## 14. CONTACT

- **Repo:** github.com/Pablodd1/wf
- **Live Site:** watchfacts-poc.vercel.app
- **Supabase Dashboard:** app.supabase.com/project/bptrvfncppbjnchsaxtb
- **Vercel Dashboard:** vercel.com (linked to Pablodd1/wf)
- **Owner:** Jasmel (jasmel@aidynamic.pro / CTO of Aidynamic.pro)
- **Bitbucket Admin Repo:** bitbucket.org/watchfacts-trade/wf-admin

---

*This document was updated on July 1, 2026 (Session 2 Continuation). Changes: synced parser v3.1 to project, created referenceValidator.ts, updated PriceResearch.tsx with batched fetching + brand filtering, added Bitbucket wf-admin section, expanded file reference.*
