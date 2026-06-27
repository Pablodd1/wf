# WatchFacts — Pending Implementation Plan
# Last updated: 2026-06-26 23:00 UTC
# 11 commits deployed today. All 5 stages complete. Green API + polish remaining.

## What We Built Today (June 26, 2026)

### P0 Parser Fixes (commit 788d851)
- Brand aliases: VC→Vacheron Constantin, LANGE→A. Lange & Söhne, TD→Tudor
- Reference≠price guard: `isReferenceNumber()` on parsePrice + LLM enrichment path
- Karat filter: `isKaratContext()` skips 14k/18k gold (karat, not thousand)
- online-search GET support (was 405 Method Not Allowed)

### Bug Fixes 1-3 (commit 64260b9)
- Bug 1: LLM enrichment `isReferenceNumber` guard on price path
- Bug 2: `splitMultiWatch()` requires each part to have its own reference
- Bug 3: price-research.js WTB detection from raw_message (buyers was always 0)

### Bug Fixes 4-6 (commits 14a88f2, 3941f9b, 0d371d6)
- Bug 4: Fixed broken listing permalink /buy/all → /price-research?ref=
- Bug 5: Year-as-price equality guard in parseFull()
- Bug 6: "Accuracy Rate" renamed to "Auto-Approve Rate", fake trends removed

### Phase 1: Shared Parser (commit 785c73e)
- Extracted canonical parser into `api/_lib/parser.js` (320 lines)
- 16 functions + constants: parseFull, parsePrice, parseCurrency, verdict,
  splitMultiWatch, inferBrandFromRef, inferDialFromRef, isYearLike,
  isReferenceNumber, isKaratContext, toUSD, hashMessage, RATES,
  APPROVE_THRESHOLD, HUMAN_THRESHOLD
- `api/ingest.js`: 333 lines (was 722, -389 duplicated lines)

### Phase 2: Green API + Telegram Unification (commit 33c960d)
- `api/green-api-webhook.js`: 444→270 lines (-174). Uses shared parser.
  Adds dual-write to watch_records (was only live_ingest).
- `api/telegram-ingest.js`: 310→244 lines (-66). Uses shared parser.
  Adds dual-write to watch_records (was only live_ingest).
- 3 ingestion paths now use ONE parser: ingest, green-api-webhook, telegram-ingest

### UI/UX Critical Fixes (commit b4c6ea7)
- App.tsx: added `/insight` route for orphaned InsightDetails (517 lines were dead)
- AdminPage: `/prices` → `/price-research` (dead link)
- PriceResearch: ListingRow `/buy/all` → `/price-research?ref=` (dead link)
- cleanExport.ts: exportCleanExcel now async import('xlsx') (was broken window.XLSX)
- CleanPage.tsx: awaits async exportCleanExcel

### Documentation
- README.md: full architecture, all 39 endpoints, P0 fixes, live test commands
- WatchFacts_Executive_Summary.docx: 8-section Word document (40KB)
- MASTER_PLAN.md: 5-phase implementation plan with personas

---

## Current State

**Live:** https://watchfacts-poc.vercel.app
**Database:** Supabase Pro — 2.39M watch_records + 4,281 live_ingest
**Last deploy:** commit 33c960d
**Smoke test:** 9/9 passing

### What Works
- Live ingestion pipeline (POST /api/ingest) with unified parser
- Price Research with IQR filtering, FX conversion, 3-month forecast
- 6,769 reference catalog lookup with liquidity scores
- AI online search (GPT-4o-mini → OpenRouter free → Claude)
- Colored Excel/CSV export with confidence badges
- Admin dashboard with live stats + data quality audit
- Review UI with keyboard shortcuts + inline editing
- Demo page (paste text, get parsed cards)
- CleanPage with Supabase persistence + Excel/CSV export
- DemandSignals page with buyer/seller ratios
- InsightDetails page (now routed at /insight)
- Green API webhook endpoint (ready, needs credentials)
- Telegram ingest endpoint (ready, needs bot token)

### What's Broken/Blocked
- Image verification: Vercel 60s timeout (needs client-side move)
- Web scraping: Chrono24/WatchCharts blocked from Vercel IPs
- Live WhatsApp feed: no Green API credentials (listeners OFFLINE)
- Telegram bot: no TELEGRAM_BOT_TOKEN

---

## PENDING WORK

### Priority 1 — Green API Activation (needs credentials)
**Effort:** 2h to build endpoints + 30m to activate
**Blocks:** WhatsApp dealer messages flowing into watchfacts.com

- [ ] Build `api/green-api-poll.js` — polling endpoint for receiveNotification
- [ ] Build `api/green-api-backfill.js` — GetChatHistory for new groups
- [ ] Set up cron job: poll every 60 seconds
- [ ] Needs: `GREEN_API_ID_INSTANCE`, `GREEN_API_API_TOKEN` env vars in Vercel
- [ ] Needs: QR scan to activate WhatsApp instance
- [ ] Needs: Join dealer groups (manual or invite links)

### Priority 2 — Image Verification Unblock
**Effort:** 1-2h
**Blocks:** Auto-verification of watch authenticity from photos

- [ ] Move Gemini Vision from serverless to client-side browser SDK
- [ ] Add "Verify Image" button on listing cards
- [ ] Use fetch + Gemini Image API directly from browser
- [ ] Mitigate API key exposure (short-lived tokens or proxy endpoint)
- [ ] Alternative: browser-use external worker at /tmp/browser-use/

### Priority 3 — Web Scraping Unblock
**Effort:** 2-3h | **Cost:** $50-200/mo proxy
**Blocks:** Real-time market prices from Chrono24/WatchCharts

- [ ] browser-use already installed at /tmp/browser-use/ (v0.13.2)
- [ ] Connect through residential proxy (BrightData, Oxylabs, or ScrapingBee)
- [ ] Set up scraping cron for Chrono24/WatchCharts
- [ ] Store results in watch_records or dedicated table
- [ ] Short-term: catalog + AI search already handles 90% of cases

### Priority 4 — UI Polish (from audit: 18 findings)
**Effort:** 1-2h

- [ ] Dead `href="#"` links in DemandSignals NavBar (4 links)
- [ ] Dead `href="#"` links in InsightDetails NavBar (4 links)
- [ ] Dead `href="#"` links in PriceResearch NavBar (4 links)
- [ ] Dead `href="#"` links in PriceResearch Footer (13 links)
- [ ] PriceResearch "Find Dealers" button: `window.open('#')` — placeholder
- [ ] Mobile responsive: zero `sm:`/`md:`/`lg:` breakpoints used in codebase
- [ ] WorkflowSidebar: `hidden md:block` — no export access on mobile
- [ ] TabNav: no hamburger alternative for mobile (horizontal scroll only)
- [ ] Navbar stats: hidden on mobile/tablet (`hidden lg:flex`, `hidden md:flex`)
- [ ] reports.ts: static xlsx import → convert to dynamic import (saves ~400KB)
- [ ] BrowserRouter vs HashRouter inconsistency with `/#/prices` patterns
- [ ] DemandSignals: `window.open` for internal navigation (use navigate())

### Priority 5 — Telegram Bot Activation
**Effort:** 15m setup

- [ ] Create bot via @BotFather → get TELEGRAM_BOT_TOKEN
- [ ] Set env var in Vercel dashboard
- [ ] Disable privacy mode in @BotFather (so bot can read group messages)
- [ ] Add bot to Telegram dealer groups
- [ ] Messages flow automatically through telegram-ingest webhook

### Priority 6 — Performance & DevOps
**Effort:** 2-3h

- [ ] Supabase index: `CREATE INDEX idx_watch_records_verdict ON watch_records(verdict);`
- [ ] Supabase index: `CREATE INDEX idx_watch_records_reference ON watch_records(reference);`
- [ ] CI/CD pipeline (GitHub Actions for build + deploy)
- [ ] Health monitoring cron (ping /api/health every 5min, alert on failure)
- [ ] Bundle size: split xlsx + charts into lazy-loaded chunks (both >400KB)
- [ ] Rate limiting on ingest endpoints (prevent abuse)

---

## Infrastructure Notes

### Capacity
- Vercel Hobby: 100 GB-h/month, 100 GB bandwidth, 60s max function
- Supabase Pro: 8 GB database (currently ~1.2 GB used, 6.8 GB headroom)
- Current records: 2,390,143 watch_records + 4,281 live_ingest

### Green API volume estimates
- 10 groups: ~2,000 msg/day → 0.1 GB-h/day (Hobby: fine)
- 50 groups: ~10,000 msg/day → 0.5 GB-h/day (Hobby: fine)
- 600 groups: ~120,000 msg/day → 6.0 GB-h/day (Hobby: would need Pro at $20/mo)

### LLM bottleneck
- DeepSeek ~8s per call, only fires on confidence < 70
- At 10K/day with 30% needing LLM = 3,000 calls = 6.7 hours LLM time
- Solution for Green API: skip LLM, use regex-only (catalog + shared parser handles most)

---

## Architecture Diagram

```
                    ┌─────────────────────────────────────┐
                    │        api/_lib/parser.js            │
                    │  (canonical — all fixes applied)     │
                    └────┬───────────┬──────────┬─────────┘
                         │           │          │
              ┌──────────▼──┐ ┌──────▼────┐ ┌──▼───────────┐
              │ api/ingest  │ │ green-api  │ │ telegram     │
              │ (manual)    │ │ webhook    │ │ ingest       │
              └──────┬──────┘ └─────┬──────┘ └──────┬───────┘
                     │              │                │
                     ▼              ▼                ▼
              ┌─────────────────────────────────────────────┐
              │            SUPABASE                         │
              │  live_ingest (4K) + watch_records (2.39M)   │
              └─────────────────────┬───────────────────────┘
                                    │
              ┌─────────────────────▼───────────────────────┐
              │              watchfacts.com                  │
              │  Price Research / Dashboard / Admin / API   │
              └─────────────────────────────────────────────┘
```

---

## Files Modified Today

```
33c960d fix(Phase2): unify green-api + telegram to shared parser + dual-write
b4c6ea7 fix(UI): wire /insight route, fix broken links, exportCleanExcel async
785c73e refactor(Phase1): extract shared parser into api/_lib/parser.js
0d371d6 fix: Bug 4 — broken listing permalink (subagent)
3941f9b fix: Bug 6 — rename accuracy label (subagent)
14a88f2 fix: Bug 5 — year-as-price guard (subagent)
64260b9 fix(critical): Bug 1-3 — ref guard, split validation, WTB detection
788d851 fix(P0): brand aliases + ref≠price + karat filter + online-search GET
036d551 docs: comprehensive README
abd57a2 docs: Word executive summary
d43bbf6 docs: updated PENDING.md with Green API analysis
```

### Key files

| File | Lines | Purpose |
|------|-------|---------|
| `api/_lib/parser.js` | 320 | Shared parser (NEW — canonical) |
| `api/ingest.js` | 319 | Manual ingest endpoint (uses shared parser) |
| `api/green-api-webhook.js` | 270 | Green API webhook (uses shared parser, dual-write) |
| `api/telegram-ingest.js` | 244 | Telegram webhook (uses shared parser, dual-write) |
| `api/clean-analyze.js` | 2,020 | Full visible-watch analysis pipeline |
| `api/price-research.js` | 360 | Price research with WTB detection |
| `api/online-search.js` | 278 | AI-powered search (GET + POST) |
| `src/pages/PriceResearch.tsx` | 1,209 | Price Research dashboard |
| `src/pages/InsightDetails.tsx` | 517 | Insight Details (now routed at /insight) |
| `src/pages/DemandSignals.tsx` | 292 | Demand Signals page |
| `src/App.tsx` | 28 | Routes (10 routes, /insight added) |

### 39 API Endpoints Summary

**Working (27):** health, pipeline-health, price-research, catalog-lookup,
web-lookup, enrich, online-search, daily-report, ingest, reprocess,
ai-parse, clean-analyze, co-pilot, batch-enrich, batch-image-dial,
bulk-disambiguate, demand-signals, disambiguate, export-report, extract,
feedback, ingest-catalog, instagram-post, normalize-bulk, persist,
pipeline-parse, watch-data, green-api-webhook (endpoint ready, feed offline),
telegram-ingest (endpoint ready, bot offline)

**Blocked (2):** image-verify, verify-image (Vercel 60s timeout)

**Offline (4):** telegram-bot (no token), green-api (no credentials),
scrape-marketplace (Vercel IP blocked), study-log (unused)

**Unknown (6):** test-mode-compare, validate-reference, vision-dial,
scrape-marketplace (full list requires function-by-function audit)

---

## Live Test Commands

```bash
# Health
curl -s https://watchfacts-poc.vercel.app/api/health | jq

# Pipeline stats
curl -s https://watchfacts-poc.vercel.app/api/pipeline-health | jq

# Price research
curl -s "https://watchfacts-poc.vercel.app/api/price-research?reference=5711/1A" | jq

# Online search
curl -s "https://watchfacts-poc.vercel.app/api/online-search?reference=5712/1A&brand=Patek+Philippe" | jq

# Ingest test
curl -s -X POST https://watchfacts-poc.vercel.app/api/ingest \
  -H "Content-Type: application/json" \
  -d '{"rawMessage":"Rolex 126334 Blue Jubilee 2025 New 117000 HKD"}' | jq

# Daily report
curl -s https://watchfacts-poc.vercel.app/api/daily-report | jq

# Green API webhook health
curl -s https://watchfacts-poc.vercel.app/api/green-api-webhook | jq

# Telegram ingest health
curl -s https://watchfacts-poc.vercel.app/api/telegram-ingest | jq
```

---

## Contact / Next Developer

This PENDING.md is the single source of truth for what needs doing.
The working directory is `/home/jasme/wf`, branch `main`, remote `Pablodd1/wf`.
All changes are committed and deployed. No uncommitted work.

The shared parser at `api/_lib/parser.js` is the canonical parser for ALL ingestion
paths. Any fix applied here applies everywhere. Do NOT add parser logic directly
to individual endpoint files — always use the shared module.

To add a new brand: add it to `parseFull()` in `api/_lib/parser.js`.
To fix a price bug: fix it in `parsePrice()` in `api/_lib/parser.js`.
To change verdict thresholds: change `APPROVE_THRESHOLD`/`HUMAN_THRESHOLD` in `api/_lib/parser.js`.
