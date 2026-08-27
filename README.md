# WatchFacts

> Current continuation and external-assistance guide: [`docs/EXTERNAL_AI_ASSISTANCE_HANDOFF_2026-07-22.md`](docs/EXTERNAL_AI_ASSISTANCE_HANDOFF_2026-07-22.md).
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

---

## Mandatory Trading Floor Card Contract

This is a customer-surface release contract, not an optional design example. Every valid
watch listing must render every area below. Missing evidence produces the stated safe
display state; it must never remove the area or the valid listing.

| Order | Mandatory area | Proven evidence | Required safe state when evidence is missing |
|---:|---|---|---|
| 1 | Image | Exact `SELLER_LISTING_IMAGE` belonging to the listing/child | Standard **NO IMAGE** placeholder |
| 2 | Category and intent | Watch plus exact WTS/WTB source intent | Hold for intent review; never guess |
| 3 | Title | Brand, model when proven, and exact observed reference | Brand plus exact observed reference; unresolved values are labeled, not invented |
| 4 | Original raw message | Untouched source message or exact immutable child segment | Visible **Raw message unavailable** state and release review |
| 5 | Price | Verified USD/USDT or dated verified FX conversion to USD | **Price requires review** |
| 5 | Price Rating | Qualified unique WTS comparables for the exact observed reference | **Open for rating** |
| 6 | Location | Proven source-user/dealer country | **Location not available** |
| 6 | Posting date | Actual source timestamp | Visible **Posting date unavailable** state and release review |
| 7 | Posted by | Proven canonical dealer or real source poster/user | **Posting user unavailable**; never synthesize a person/dealer name |
| 7 | User/dealer rating | Evidence-backed rating and review count | **Not rated** |
| 8 | Availability | `CONFIRMED_CURRENT` or `LATEST_OBSERVED` lineage state | Unresolved state is withheld from publication |

Availability labels must preserve their meaning:

- `CONFIRMED_CURRENT` renders as **CONFIRMED CURRENT**.
- `LATEST_OBSERVED` renders as **LATEST OBSERVED** and prominently requires
  **CHECK AVAILABILITY**. It must never be relabeled as confirmed active.

Additional non-negotiable rules:

- Never use catalog/reference imagery, ambiguous bundle media, adjacent-child media,
  visual similarity, or filename similarity as listing-image proof.
- Never assume USD. Preserve the original amount/currency in immutable evidence and use
  only verified USD/USDT or dated verified FX for customer USD and analytics.
- Never fabricate a dealer, poster, rating, review count, location, model, reference,
  price, image, or availability state.
- Exact duplicates and unchanged reposts never render or inflate counts/Price Research;
  their immutable raw evidence remains preserved behind the canonical survivor.
- Missing image, price, rating, dealer rating, or location evidence does not invalidate
  an otherwise valid unique listing; the mandatory safe state renders instead.

Rolex and Patek are currently **background-only** under
`curated_luxury_rolex_patek_background_hold_v1`. Their completed cohorts remain stored,
but Trading Floor, Price Research, broad watch inventory, and customer detail reads must
not publish them until a separate evidence-backed release decision.

The dated evidence-coverage report is
[`docs/audits/ROLEX_PATEK_MANDATORY_CARD_COVERAGE_2026-08-27.md`](docs/audits/ROLEX_PATEK_MANDATORY_CARD_COVERAGE_2026-08-27.md).

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
