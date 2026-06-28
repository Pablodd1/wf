# WatchFacts v2

Luxury watch intelligence platform. Parse raw WhatsApp/Telegram dealer messages, extract watch details, analyze market prices with outlier detection, and export colored reports.

**Live:** https://watchfacts-poc.vercel.app | **Repo:** `Pablodd1/wf`

---

## What Changed (2026-06-29)

Complete rewrite. The v1 codebase (39 API endpoints, ~25K SLOC) was a proof-of-concept that grew organically. v2 is a focused rebuild with proper architecture.

### What Was Built

| Page | Route | What It Does |
|------|-------|-------------|
| **Home** | `/` | Dashboard — KPI cards, 4 charts (brand dist, confidence pie, price area, daily trends), top 10 refs |
| **Search** | `/#/search` | Full database search — filters by brand, condition, confidence, currency. Paginated (50/page). Direct Supabase queries |
| **Price Research** | `/#/price-research` | **THE FLAGSHIP** — Search reference → chart with monthly blue dots → hover shows Min/Avg/Max → click dot → Insight Details |
| **Insight Details** | `/#/insight?ref=X&month=Y` | Drill-down from chart dot. 4 stat cards: Original (blue), Duplicated (gray), Filtered (green), Outliers (red) |
| **Demo** | `/#/demo` | Paste multiple raw WhatsApp messages → animated 5-stage pipeline → parsed cards with confidence rings → export Excel |
| **Review** | `/#/review` | Human review queue — HUMAN/REVIEW/RECYCLE tabs, keyboard shortcuts (A/E/R/N/P), inline editing |
| **Admin** | `/#/admin` | System health, data quality metrics, connection test, action buttons |
| **Analytics** | `/#/analytics` | Extended charts — condition distribution, catalog match rate, full reference table |
| **Clean** | `/#/clean` | Data cleaning — CSV/JSON upload, column mapping, normalize, export |

### Outlier Logic (NEW)

**Outliers are EXCLUDED from Min/Avg/Max calculations but REPORTED separately.**

```
Original 40 listings
    → Remove 7 duplicates (same ref + price + condition)
    → Remove 3 outliers via IQR method ($196K, $300K, $315K)
    = Filtered 33 listings ← stats calculated on THIS
```

IQR Method: Q1 - 1.5xIQR = lower fence, Q3 + 1.5xIQR = upper fence. Anything outside = outlier.

---

## Architecture v2

| Layer | Stack |
|-------|-------|
| Frontend | React 19 + TypeScript + Vite |
| Routing | React Router v7 (**HashRouter**) |
| Styling | Tailwind CSS |
| Icons | Lucide React |
| Charts | Recharts |
| Animation | Framer Motion |
| Excel | SheetJS (xlsx) |
| Backend | 8 Vercel Serverless Functions (Node.js CJS) |
| Database | Supabase PostgreSQL (2.39M watch_records) |
| Hosting | Vercel |

### File Structure

```
wf/
├── api/                          # Serverless functions
│   ├── _lib/
│   │   └── parser.js             # Core watch parser (757 lines)
│   ├── batch-process.js          # Queue-based reprocessing
│   ├── bulk-action.js            # Bulk actions on records
│   ├── cache-dashboard.js        # Dashboard stats cache
│   ├── export-excel.js           # On-demand Excel export
│   ├── generate-report.js        # Daily report generation
│   ├── insight-details.js        # Outlier detection + stats pipeline
│   ├── price-research.js         # Monthly price aggregation
│   └── update-record.js          # Single record update
├── src/
│   ├── components/
│   │   ├── ui/                   # UI primitives
│   │   │   ├── BrandBadge.tsx
│   │   │   ├── ConfidenceRing.tsx
│   │   │   ├── ConditionBadge.tsx
│   │   │   ├── DemandBadge.tsx
│   │   │   ├── DialColorSwatch.tsx
│   │   │   └── StatusPill.tsx
│   │   ├── ExportButtons.tsx     # Excel/CSV/JSON export dropdown
│   │   ├── Layout.tsx            # App shell with Navbar
│   │   ├── Navbar.tsx            # Top bar with stats
│   │   ├── StatsBar.tsx          # KPI bar
│   │   ├── TestModePanel.tsx     # Parser testing
│   │   ├── WatchCard.tsx         # Watch listing card
│   │   └── WatchImage.tsx        # 3-layer image fallback
│   ├── lib/
│   │   ├── reportExport.ts       # 6-sheet colored Excel export
│   │   ├── utils.ts              # cn(), formatPrice(), confidenceColor()
│   │   └── watchImages.ts        # Brand CDN URL patterns
│   ├── pages/                    # All 10 page components
│   │   ├── Home.tsx
│   │   ├── SearchPage.tsx
│   │   ├── PriceResearch.tsx     # FLAGSHIP — chart + dots + drilldown
│   │   ├── InsightDetails.tsx    # Outlier stats + pipeline viz
│   │   ├── DemoPage.tsx
│   │   ├── ReviewPage.tsx
│   │   ├── AdminPage.tsx
│   │   ├── AnalyticsPage.tsx
│   │   ├── CleanPage.tsx
│   │   └── DemandSignals.tsx
│   ├── types/
│   │   └── index.ts              # All TypeScript types
│   ├── App.tsx                   # Router with all 10 routes
│   └── main.tsx                  # HashRouter + ErrorBoundary
├── public/
│   ├── images/                   # Catalog images (add yours here)
│   └── reports/                  # Generated report cache
├── package.json
├── tsconfig.json
├── vite.config.ts
├── tailwind.config.js
└── vercel.json                   # Cron jobs
```

---

## API Endpoints (v2)

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/batch-process` | POST | Process reprocess_queue in batches (cron) |
| `/api/bulk-action` | POST | Bulk approve/recycle/review |
| `/api/cache-dashboard` | POST | Generate dashboard stats cache |
| `/api/export-excel` | POST | Filtered Excel export |
| `/api/generate-report` | POST | Full report from 2.39M records (cron) |
| `/api/insight-details` | GET | Outlier detection + duplicate removal + stats |
| `/api/price-research` | GET | Monthly price aggregation (avg/min/max/count) |
| `/api/update-record` | POST | Single record update |

**Query examples:**
```bash
# Price Research — monthly aggregates for chart
GET /api/price-research?reference=52508&dial=White&months=6

# Insight Details — full pipeline for a month
GET /api/insight-details?reference=52508&month=2026-03&dial=White
```

---

## Data Pipeline

```
RAW MESSAGE (WhatsApp/Telegram)
    ↓
[1] INGEST — parseFull() — regex extraction
    ↓
{ brand, reference, dialColor, condition, year, price, currency, confidence }
    ↓
[2] DUPLICATE DETECTION — same ref + price($100 rounded) + condition
    ↓
Unique records
    ↓
[3] OUTLIER DETECTION — IQR method (Q1 - 1.5xIQR, Q3 + 1.5xIQR)
    ↓
Clean records (outliers flagged but NOT removed from DB)
    ↓
[4] STATS — Min, Avg (Mean), Max calculated on CLEAN records only
    ↓
INSIGHT DETAILS → 4 cards: Original | Duplicated | Filtered | Outliers
```

### Price Research Chart

```
Search "52508" → Supabase query → group by month → avg/min/max per month
    ↓
Render line chart with blue dots
    ↓
Hover dot → tooltip: Min $23,012 | Avg $24,400 | Max $26,660
    ↓
Click dot → navigate to /insight?ref=52508&month=2026-03
    ↓
Insight page → run full pipeline → show 4 stat cards
```

---

## Image Resolution (3-Layer Fallback)

The `WatchImage` component tries sources in order:

1. **Local catalog** — `/images/{brand}_{reference}.png`
   - Copy your images from `C:\Users\jasme\Downloads\Catalog` here
   - Rename to: `Rolex_52508.png`, `Patek Philippe_5711_1A.png`, etc.

2. **Brand website CDN** — 20+ brands configured
   - Patek: `static.patek.com/images/articles/face_white/350/{ref}~01.jpg`
   - AP: `audemarspiguet.com/content/dam/ap/com/products/watches/{ref}/assets/landing.jpg`
   - RM: `richardmille.com/sites/default/files/.../{ref}.png`
   - Others → Chrono24 CDN

3. **Silhouette placeholder** — `/watch-silhouette.svg`

---

## Environment Variables

| Variable | Required | Purpose |
|----------|----------|---------|
| `VITE_SUPABASE_URL` | ✅ | Supabase project URL |
| `VITE_SUPABASE_ANON_KEY` | ✅ | Supabase anon key (frontend) |
| `SUPABASE_URL` | ✅ | Same, for API endpoints |
| `SUPABASE_SERVICE_ROLE_KEY` | ✅ | Service role key (API endpoints) |
| `ALLOWED_ORIGIN` | ❌ | CORS origin (default: `*`) |

---

## Development

```bash
cd ~/wf
npm install
npm run dev          # Dev server on localhost:3000
npm run build        # Production build
npx vercel --prod    # Deploy
```

### Adding Catalog Images

```bash
# Copy your catalog images
Copy from: C:\Users\jasme\Downloads\Catalog
Paste to:  public/images/
Rename to: {Brand}_{Reference}.png  (e.g., Rolex_52508.png)
```

### Cron Jobs (vercel.json)

```json
{
  "crons": [
    { "path": "/api/batch-process", "schedule": "0 */6 * * *" },
    { "path": "/api/generate-report", "schedule": "0 3 * * *" }
  ]
}
```

---

## What Was Deleted (v1 → v2)

v1 had 39 API endpoints, many experimental/unused. v2 keeps only what's needed:

**Deleted (will not work anymore):**
- `api/ingest.js` — old ingestion (had `\${}` template literal bug)
- `api/green-api-webhook.js` — WhatsApp webhook
- `api/telegram-ingest.js` — Telegram ingestion
- `api/catalog-lookup.js` — old catalog (replaced by direct Supabase queries)
- `api/verify-image.js` — 60s timeout, never worked
- `api/ai-parse.js` — ES module syntax bug
- `api/enrich.js`, `api/online-search.js` — AI enrichment cascade
- `api/daily-report.js` — replaced by `generate-report.js`
- All `scripts/` — Python migration scripts (no longer needed)
- All `src/sections/` — replaced by `src/pages/`

**To recover a deleted file:** `git show HEAD~1:api/ingest.js > api/ingest.js`

---

## Pending Work

### P0 — Deploy & Test
- [ ] `npm install && npm run build` — verify no errors
- [ ] `npx vercel --prod` — deploy
- [ ] Add Supabase env vars to Vercel dashboard
- [ ] Test Price Research → search "52508" → click chart dot → verify Insight Details

### P1 — Catalog Images
- [ ] Copy images from `C:\Users\jasme\Downloads\Catalog` to `public/images/`
- [ ] Verify WatchImage component finds them

### P2 — Theme Consistency
- [ ] Price Research + Insight use white theme (matches your screenshots)
- [ ] Rest of app uses dark theme (gray-950)
- [ ] Decide: unify to one theme or keep dual?

### P3 — Features
- [ ] Wire ExportButtons to all pages (Home, Search, Price Research)
- [ ] Parser v2 integration — swap `api/_lib/parser.js` for enhanced version
- [ ] Mobile responsive pass
- [ ] Currency converter page (linked in footer but 404s)
- [ ] Glossary page (linked in footer but broken)

### Blocked
- [ ] Image verification — needs client-side Gemini SDK (Vercel 60s limit)
- [ ] WhatsApp/Telegram ingestion — needs QR scan + bot tokens

---

## Key Design Decisions

1. **HashRouter over BrowserRouter** — Vercel static hosting compatibility
2. **Outliers excluded from stats** — IQR method, reported separately in red card
3. **Mean (not Median) for averages** — matches your reference images
4. **White theme for Price Research** — matches your screenshots
5. **Demo data fallback** — works without Supabase for development
6. **Client-side parsing in Demo** — no API call needed for paste workflow
