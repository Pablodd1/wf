# WatchFacts

> Current CTO continuation guide: [`docs/CTO_HANDOFF_2026-07-16.md`](docs/CTO_HANDOFF_2026-07-16.md).
> The user-facing product name is **Curated Luxury**; repository and legacy service
> identifiers remain WatchFacts/wf unless a separate infrastructure migration is approved.

![WatchFacts](https://img.shields.io/badge/WatchFacts-v2-gold)

**All-in-one watch intelligence platform** — parse WhatsApp dealer messages, extract watch details, enrich with reference catalog data, and export colored Excel/CSV reports.

---

## 🚀 Quick Access

| URL | What |
|-----|------|
| **[watchfacts-poc.vercel.app](https://watchfacts-poc.vercel.app/)** | Full SPA (Home / Demo / Review / Clean / Reprocess) |
| **[watchfacts-poc.vercel.app/extract](https://watchfacts-poc.vercel.app/extract)** | Standalone extractor with web enrichment |
| **[watchfacts-poc.vercel.app/#/demo](https://watchfacts-poc.vercel.app/#/demo)** | Demo page — paste & parse engine with confidence scoring |

> **All in one link:** https://watchfacts-poc.vercel.app/#/demo

---

## ✨ Features

### Core Parsing Engine
- **Regex-first parser** — 15+ luxury watch brands (Patek Philippe, Rolex, Audemars Piguet, Richard Mille, Vacheron Constantin, Cartier, IWC, Omega, Tudor, Panerai, Hublot, Breitling, Jaeger-LeCoultre, Grand Seiko)
- **Reference detection** — numeric refs, slash formats (5712/1A), RM prefixes, vendor-specific patterns
- **Dial color inference** — from reference suffixes (LN=Black, LB=Blue, LV=Green) and color keywords
- **Price extraction** — USD/HKD/EUR/GBP/CHF with k/m multipliers, multi-currency entries
- **Intent detection** — SELL, BUY (WTB/ISO/NTQ), INQUIRY
- **Condition & year parsing**

### Confidence Scoring
- Brand known → +30 | Valid reference → +25 | Dial color → +20
| Price + realistic → +20–25 | Currency explicit → +5 | Year → +3 | Condition → +2
- **Auto-approve** ≥90% confidence
- **AI review** 60–89% confidence
- **Human review** <60% confidence

### Web Enrichment (Accuracy Booster)
- **Instant catalog lookup** — 976 known references with model name, collection, case metal, production years, buyer/seller ratios, liquidity scores
- **Web search fallback** — DuckDuckGo query for live listing prices
- **Auto-fills missing fields** — model, collection, case metal, year, price
- **+15 confidence boost** for catalog-matched references

### Batch Processing
- **No hard entry limit** — paste 1 or 1000+ lines
- **Live line counter** shows input size
- **Warning at 200+ entries** (browser may lag)
- **Render capped at 500** cards per page — Export to save, then Clear
- **Split compound messages** — merged lines with multiple references auto-separated

### Data Export
- **Colored Excel** (3 sheets: extracted watches + color legend + summary)
- **CSV export** (BOM-prefixed for Excel compatibility)
- **Conditional formatting** — green (clean), yellow (partial), red (issues)
- **Client-ready** — formatted, branded, ready to share

### Editing & Review
- **Inline field editing** — edit any field directly, confidence re-scores live
- **AI Fix** (per row) — Kimi API for low-confidence listings
- **Web Lookup** (per row) — reference catalog enrichment

### User Interface
- Dark theme, gold-accented luxury aesthetic
- Interactive cards with expand/collapse
- Summary counters (auto-approved / AI review / human review)
- Sticky processing pipeline guide
- **Clear All** button — fresh start whenever user wants
- **Permission-based voice search** on Trading Floor and Price Research. Live transcription starts only after a microphone click, shows the interpreted query, and requires explicit acceptance before searching. Chrome and Edge provide the most consistent Web Speech support; typed search remains available everywhere.

---

## 🛠 Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 19 + TypeScript + Vite |
| Routing | React Router v7 |
| UI | Tailwind CSS + Lucide icons |
| Charts | Recharts |
| Excel | xlsx (SheetJS) |
| Backend | Vercel Serverless Functions (Node.js) |
| AI | Kimi (moonshot.ai) |
| Data | Supabase (PostgreSQL + pgvector) |
| Deploy | Vercel |

---

## 📁 Project Structure

```
watchfacts-poc/
├── src/
│   ├── pages/          # React pages (Home, DemoPage, ReviewPage, CleanPage, etc.)
│   ├── components/     # UI components
│   ├── hooks/          # React hooks
│   ├── lib/            # Libraries (pipeline, export, analytics, etc.)
│   └── utils/          # parseEngine.ts — core regex parser
├── api/
│   ├── ai-parse.js     # Kimi AI parsing endpoint
│   ├── clean-analyze.js
│   ├── ingest.js
│   ├── reprocess.js
│   ├── persist.js
│   └── web-lookup.js   # Reference catalog + web search enrichment
├── public/
│   └── extract.html    # Standalone extractor page
├── dist/               # Build output
│   └── enriched_refs.json  # 976-reference enrichment catalog
└── vercel.json         # Deployment config
```

---

## 🚦 API Endpoints

| Endpoint | Description |
|----------|-------------|
| `/api/ai-parse` | Kimi AI parsing for low-confidence entries |
| `/api/web-lookup?reference=5712/1A&brand=Patek` | Reference catalog + web enrichment |
| `/api/reprocess` | Batch reprocess existing records |
| `/api/persist` | Save parsed entries to Supabase |
| `/api/clean-analyze` | Full visible watch analysis |
| `/api/verify-image` | Image vs reference authentication |
| `/api/ingest` | Bulk data ingestion |

---

## 📊 Data

- **117,744** watch records in Supabase
- **976** enriched references with model, metal, production data
- **15+** luxury brands cataloged
- **Patek Philippe parsed dataset**: 109,874 rows CSV/Excel

---

## 🔧 Development

```bash
# Install
npm install

# Dev server (port 3000)
npm run dev

# Build
npm run build

# Deploy to Vercel
npx vercel --prod
```

---

## 📝 Pending Improvements

- [ ] Real-time web search via external search API (SerpAPI, Brave Search)
- [ ] Virtualized list for unlimited batch rendering
- [ ] Batch AI Fix (process all low-confidence with one click)
- [ ] Image upload + OCR for screenshot parsing
- [ ] WebSocket live updates for WhatsApp listener integration
