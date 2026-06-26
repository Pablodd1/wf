# WatchFacts

Luxury watch intelligence platform. Ingest raw WhatsApp/Telegram dealer messages, parse watch details, enrich from a 6K+ reference catalog, score confidence, and export colored Excel/CSV reports.

**Live:** https://watchfacts-poc.vercel.app · **Repo:** `Pablodd1/wf`

---

## What the app does

1. **Ingest** — dealer messages arrive via POST `/api/ingest` (or Telegram webhook). The pipeline splits bundled messages, extracts brand/reference/dial/price/condition/year, scores confidence, and persists to Supabase (2.39M records and counting).

2. **Parse** — regex-first engine covers 15+ brands with pattern matching (Patek 5711/1A, Rolex 126334, AP 26238ST, RM 07-01, Lange 414.032, VC 4500V, and more). Detects currency (HKD/USD/EUR/GBP/CHF), condition (New/Used/Like New), dial color (from ref suffix + keywords), and year.

3. **Enrich** — three-tier cascade:
   - **Catalog lookup** — 6K+ references with model, collection, case metal, production years, buyer/seller liquidity scores
   - **AI online search** — GPT-4o-mini → OpenRouter free models → Claude Haiku fallback
   - **Web scrape** — Chrono24/WatchCharts (best-effort; blocked from Vercel IPs)

4. **Score** — confidence from 0-100. >=90 + brand + ref = APPROVED. <35 = RECYCLE. Everything else = HUMAN review.

5. **Price Research** — query 2.39M historical records by reference. IQR outlier filtering, duplicate detection, FX conversion, 3-month linear regression forecast, buyer/seller ratios, downloadable Excel reports with confidence badges.

6. **Dashboard** — live stats (total records, approval rate, brand breakdown), data quality audit (missing fields count), AI cost tracker, bulk actions.

7. **Review UI** — keyboard shortcuts (N/P/E/A/R/S/H/Esc), inline field editing, AI re-analysis per row, web lookup per row.

8. **Demo page** — paste raw dealer text, get parsed cards with confidence scores, Clear All to reset, export CSV/Excel.

9. **Export** — colored Excel (3 sheets), CSV with BOM. Conditional formatting: green=clean, yellow=partial, red=issues.

---

## Architecture

| Layer | Stack |
|-------|-------|
| Frontend | React 19 + TypeScript + Vite |
| Routing | React Router v7 (HashRouter) |
| UI | Tailwind CSS + Lucide icons + Motion |
| Charts | Chart.js via react-chartjs-2 |
| Excel | SheetJS (xlsx) |
| Backend | 39 Vercel Serverless Functions (Node.js CJS) |
| AI | DeepSeek (primary), GPT-4o-mini, OpenRouter free, Claude Haiku |
| Database | Supabase PostgreSQL (2.39M watch_records) |
| Hosting | Vercel Hobby (maxDuration: 60s) |

### Files by line count

| File | Lines | Purpose |
|------|-------|---------|
| `api/clean-analyze.js` | 2,020 | Full visible-watch analysis pipeline |
| `api/ingest.js` | 716 | Live ingestion endpoint + parser |
| `api/reprocess.js` | 598 | Bulk re-process existing records |
| `src/utils/parseEngine.ts` | 570 | Client-side regex parser |
| `src/lib/pipeline.ts` | 551 | Pipeline simulation logic |
| `src/hooks/useWatchData.ts` | 493 | Central data hook (fetch + transform) |
| `src/pages/PriceResearch.tsx` | 1,209 | Price research dashboard |
| `src/pages/ReviewPage.tsx` | 955 | Human review interface |
| `src/pages/DemoPage.tsx` | 589 | Demo parsing page |
| `src/lib/normalize.ts` | 616 | Brand/reference normalization |
| `src/lib/masterCatalog.ts` | 339 | Master catalog builder |

39 API files (11,466 total lines) + frontend (13,740 total lines) = ~25K SLOC.

---

## All API Endpoints

| Endpoint | Method | Status | Purpose |
|----------|--------|--------|---------|
| `/api/health` | GET | ✅ | Health check + AI provider status |
| `/api/pipeline-health` | GET | ✅ | Live pipeline stats (2.39M records) |
| `/api/ingest` | POST/GET | ✅ | Live message ingestion |
| `/api/price-research` | GET | ✅ | Reference price analysis |
| `/api/catalog-lookup` | GET | ✅ | 6K+ reference catalog lookup |
| `/api/web-lookup` | GET | ✅ | Catalog + DDG web search |
| `/api/enrich` | GET | ✅ | Multi-source enrichment |
| `/api/online-search` | GET/POST | ✅ | AI-powered watch search (P0-D fixed) |
| `/api/daily-report` | GET | ✅ | Automated daily digest |
| `/api/reprocess` | POST | ✅ | Bulk re-process records |
| `/api/ai-parse` | POST | ✅ | AI-only parsing |
| `/api/clean-analyze` | POST | ✅ | Full visible watch analysis |
| `/api/verify-image` | POST | ⚠️ TIMEOUT | Image verification (exceeds 60s Vercel limit) |
| `/api/image-verify` | POST | ⚠️ TIMEOUT | Alternative image verify (same issue) |
| `/api/telegram-bot` | POST | ⚠️ OFFLINE | Needs TELEGRAM_BOT_TOKEN |
| `/api/telegram-ingest` | POST | ⚠️ OFFLINE | WhatsApp listener (no QR scan) |
| `/api/green-api-webhook` | POST | ⚠️ OFFLINE | Green API webhook |
| `/api/co-pilot` | POST | ✅ | AI co-pilot suggestions |
| `/api/batch-enrich` | POST | ✅ | Batch enrichment |
| `/api/batch-image-dial` | POST | ✅ | Batch image dial detection |
| `/api/bulk-disambiguate` | POST | ✅ | Bulk brand disambiguation |
| `/api/demand-signals` | GET | ✅ | Market demand signals |
| `/api/disambiguate` | POST | ✅ | Single brand disambiguation |
| `/api/export-report` | POST | ✅ | Excel export generator |
| `/api/extract` | POST | ✅ | Standalone extraction |
| `/api/feedback` | POST | ✅ | Human review feedback loop |
| `/api/ingest-catalog` | POST | ✅ | Catalog ingestion |
| `/api/instagram-post` | POST | ✅ | Instagram caption generator |
| `/api/normalize-bulk` | POST | ✅ | Bulk normalization |
| `/api/persist` | POST | ✅ | Save to Supabase |
| `/api/pipeline-parse` | POST | ✅ | Pipeline parsing |
| `/api/scrape-marketplace` | POST | ✅ | Marketplace scraper |
| `/api/study-log` | POST | ✅ | Study logging |
| `/api/test-mode-compare` | POST | ✅ | Test mode comparison |
| `/api/validate-reference` | GET | ✅ | Reference validation |
| `/api/vision-dial` | POST | ✅ | Vision-based dial detection |
| `/api/watch-data` | GET | ✅ | Watch data endpoint |

---

## P0 Fixes (2026-06-26)

Deployed in commit `788d851`:

| Fix | What changed | Before | After |
|-----|-------------|--------|-------|
| Brand aliases | `api/ingest.js` parseFull() | VC→Unknown, LANGE→Rolex, TD→AP | VC=Vacheron, LANGE=A.Lange, TD=Tudor |
| Ref vs price | `api/ingest.js` parsePrice() + parseFull() | 126334→$126,334 price | 126334=ref, 117000hkd=price |
| Karat filter | `api/ingest.js` isKaratContext() + kMatch | 14k gold→$14,000 | 14k gold=karat, $3550=price |
| online-search GET | `api/online-search.js` handler() | 405 Method Not Allowed | 200 OK with query params |

---

## Pending Work

### P0 — Parsing accuracy (3 remaining)
- [ ] No-price inquiry → HUMAN (currently APPROVED if confidence high)
- [ ] 7010R → Patek (currently Rolex — fixed by brand-before-ref ordering but untested)
- [ ] Additional brand edge cases from HUMAN queue

### P1 — Price Research UI (not started)
- [ ] Brand dropdown (currently hardcoded)
- [ ] Model selector with autocomplete
- [ ] Date range toggle (1M/6M/1Y/All)
- [ ] Blue dot on chart for month selection
- [ ] Insight Details panel (min/avg/max, outlier tracking)
- [ ] Two-column listing detail layout

### Stage 3 — Data integrity
- [ ] CleanPage: save results to Supabase (ZERO Supabase calls currently)
- [ ] Bulk UPDATE verdicts on historical records
- [ ] Normalize brand spellings

### Stage 4 — Smart cascade
- [ ] Always fire online-search on catalog miss
- [ ] Agreement scoring (online vs parsed)
- [ ] Store successful lookups to catalog_building table

### Blocked / broken
- [ ] Image verify — Vercel 60s timeout (needs client-side move)
- [ ] Web scraping — Chrono24/WatchCharts blocked from Vercel IPs
- [ ] Telegram bot — needs TELEGRAM_BOT_TOKEN
- [ ] WhatsApp listener — needs QR scan

---

## Development

```bash
cd /home/jasme/wf
npm install
npm run dev          # Dev server on port 3000
npm run build        # tsc -b && vite build
npx vercel --prod    # Deploy to production
git push origin main # Push to Pablodd1/wf
```

### Live test commands

```bash
# Pipeline health
curl -s https://watchfacts-poc.vercel.app/api/pipeline-health | jq

# Price research
curl -s "https://watchfacts-poc.vercel.app/api/price-research?reference=5711/1A" | jq

# Online search (now supports GET)
curl -s "https://watchfacts-poc.vercel.app/api/online-search?reference=5712/1A&brand=Patek+Philippe" | jq

# Ingest a test message
curl -s -X POST https://watchfacts-poc.vercel.app/api/ingest \
  -H "Content-Type: application/json" \
  -d '{"rawMessage":"Rolex 126334 blue dial 117000hkd"}' | jq

# Daily report
curl -s https://watchfacts-poc.vercel.app/api/daily-report | jq
```
