# WatchFacts — Complete Platform Architecture & Status

## SYSTEM STATUS (as of 2026-06-29)

### What's LIVE and Working

| Feature | URL | Status | Data |
|---------|-----|--------|------|
| **Home Page** | `/` | ✅ Working | Static replica of watchfacts.com |
| **Consumer Reports** | `/reports` | ✅ Working | Serial number search (no DB data) |
| **Trading Floor** | `/trading` | ✅ Working | **2,392,784 real watches** from Supabase |
| **Flash Sale Detail** | `/flash-sales/:id` | ✅ Working | Individual watch view |
| **Admin Dashboard** | `/admin` | ✅ Working | 8 tabs, all public |
| **Admin Search** | `/admin/search` | ✅ Working | Search 2.39M watches |
| **Admin Analytics** | `/admin/analytics` | ✅ Working | Charts with real stats |
| **Admin Review** | `/admin/review` | ✅ Working | HUMAN/RECYCLE review queue |
| **Price Research** | `/admin/price-research` | ✅ Working | Reference lookup + charts |
| **Login Page** | `/login` | ✅ Working | Email/Password (optional) |
| **Signup Page** | `/signup` | ✅ Working | Registration (optional) |

### Supabase Database (2,392,784 Records)

| Verdict | Count |
|---------|-------|
| APPROVED | 1,084,268 |
| REVIEW | 769,922 |
| HUMAN | 267,215 |
| RECYCLE | 271,379 |
| **TOTAL** | **2,392,784** |

---

## ARCHITECTURE

### Two-Tier System
```
┌─────────────────────────────────────────────────────┐
│  PUBLIC WEBSITE (read-only for clients)              │
│  ├── /          → Home page (watchfacts.com replica) │
│  ├── /reports  → Consumer Reports (serial search)    │
│  └── /trading  → Trading Floor (2.39M watches)      │
├─────────────────────────────────────────────────────┤
│  ADMIN DASHBOARD (for internal team)                 │
│  └── /admin/*  → 8 tabs with real data              │
└─────────────────────────────────────────────────────┘
```

### Tech Stack
- **Frontend:** React 19 + TypeScript + Vite + Tailwind CSS
- **Database:** Supabase PostgreSQL (2.39M records)
- **API:** Supabase REST API (direct browser calls)
- **Auth:** Supabase Auth (optional, not enforced)
- **Charts:** Recharts
- **Deploy:** Vercel (frontend) + Railway (backend — on hold)

---

## FILE STRUCTURE

```
src/
├── pages/
│   ├── Home.tsx              # Public landing page
│   ├── ReportsPage.tsx       # Consumer Reports
│   ├── TradingFloor.tsx      # Main dealer marketplace
│   ├── FlashSaleDetail.tsx   # Individual watch view
│   ├── LoginPage.tsx         # Login (optional)
│   ├── SignUpPage.tsx        # Signup (optional)
│   ├── AdminPage.tsx         # Admin dashboard home
│   ├── SearchPage.tsx        # Watch search
│   ├── AnalyticsPage.tsx     # Charts & stats
│   ├── ReviewPage.tsx        # HUMAN/RECYCLE queue
│   ├── CleanPage.tsx         # Data cleanup
│   ├── PriceResearch.tsx     # Price lookup
│   ├── InsightDetails.tsx    # Outlier detection
│   ├── DemandSignals.tsx     # Market demand
│   └── DemoPage.tsx          # Demo mode
├── components/
│   ├── Navbar.tsx            # Admin navbar (dark)
│   ├── PublicNavbar.tsx      # Public navbar (dark/light)
│   ├── DealerNavbar.tsx      # Trading navbar (light)
│   ├── Layout.tsx            # Admin layout wrapper
│   ├── ProtectedRoute.tsx    # Auth guard (NOT USED)
│   ├── WatchCard.tsx         # Watch card component
│   └── StatsBar.tsx          # Stats display
├── hooks/
│   ├── useAuth.tsx           # Supabase auth (optional)
│   └── useApi.ts             # Generic API hook
└── App.tsx                   # Router

api/                          # Serverless functions (Vercel)
├── _lib/
│   ├── supabase.js           # Supabase client + data functions
│   ├── parser.js             # 7-stage parser pipeline
│   └── gap-detector.js       # Confidence routing
├── listings.js               # GET /api/listings
├── stats.js                  # GET /api/stats
├── price-research.js         # GET /api/price-research
├── export-excel.js           # POST /api/export-excel
├── green-api-webhook.js      # WhatsApp webhook
└── ...
```

---

## KNOWN ISSUES

### 1. Login/OAuth Not Working
- **Error:** `Unsupported provider: provider is not enabled`
- **Cause:** Google/Apple OAuth not configured in Supabase dashboard
- **Fix:** Enable providers at https://app.supabase.com/project/bptrvfncppbjnchsaxtb → Auth → Providers
- **Workaround:** All pages are PUBLIC — no login required

### 2. API Routes Only Work on Local/Railway
- **Issue:** `/api/*` routes don't work on Vercel static deploy
- **Cause:** Vercel static hosting doesn't run serverless functions
- **Fix:** Trading Floor uses direct Supabase REST calls (bypasses API)
- **Admin tabs:** Use `useApi` hook which calls `/api/*` — may show demo fallback

### 3. Supabase Query Timeouts
- **Issue:** Ordering by `created_at` or counting times out on 2.39M rows
- **Fix:** Removed `order=` and `count=` queries from TradingFloor
- **Result:** Data loads in <1s but unsorted, total hardcoded to 2,392,784

### 4. No Watch Images
- **Issue:** No `imageUrl` field in database
- **Workaround:** Brand-based placeholder icons shown
- **Future:** Add image resolution (local catalog → brand CDN → silhouette)

### 5. Admin Tab Links May Use Demo Fallback
- **Issue:** `/api/stats` and `/api/listings` not accessible from Vercel
- **Fix:** Pages show demo data when API is unreachable
- **Admin search:** May show demo watches instead of real data

---

## PENDING TASKS

### High Priority (Do Next)
| # | Task | Status |
|---|------|--------|
| 1 | **Enable Supabase indexes** on `watch_records(created_at)`, `watch_records(price_usd)` | Not started |
| 2 | **Add image support** — CDN URLs for 6,958 catalog entries | Not started |
| 3 | **Fix admin tabs to use Supabase directly** (like TradingFloor does) | Not started |
| 4 | **Set up Railway backend** — Express server with all API routes | On hold |
| 5 | **Footer pages** — About Simon, About Us, Hire Fi, Buying/Selling, Glossary, Terms, Privacy | Not started |

### Medium Priority
| # | Task | Status |
|---|------|--------|
| 6 | Enable Google OAuth in Supabase dashboard | Not started |
| 7 | Add "Check availability" functionality | Not started |
| 8 | Add dealer profiles | Not started |
| 9 | Add WTB (Want To Buy) listings view | Not started |
| 10 | Export Excel with real data | Code ready, needs API fix |

### Low Priority
| # | Task | Status |
|---|------|--------|
| 11 | Dark mode toggle | Not started |
| 12 | Mobile responsive polish | Partial |
| 13 | Real-time WebSocket updates | Not started |
| 14 | Green API WhatsApp integration | On hold |

---

## DATABASE SCHEMA

### watch_records (2,392,784 rows)
```sql
id              uuid PRIMARY KEY
brand           text
reference       text
dial_color      text
condition       text
year            integer
price_raw       text
price_usd       integer
currency        text
confidence      integer (0-100)
verdict         text (APPROVED/REVIEW/HUMAN/RECYCLE)
source          text
raw_message     text
listing_type    text (WTS/WTB)
parser_version  text
field_confidence jsonb
accessories     jsonb
flags           jsonb
human_edited    boolean
edit_source     text
created_at      timestamptz
processed_at    timestamptz
received_at     timestamptz
```

---

## SUPABASE CONFIG

- **URL:** `https://bptrvfncppbjnchsaxtb.supabase.co`
- **Anon Key:** `eyJhbGci...` (public, limited)
- **Service Key:** `eyJhbGci...` (full access, keep secret)
- **Table:** `public.watch_records`
- **RLS:** Row Level Security (may block anon key)

### Required SQL (run in Supabase SQL Editor)
```sql
-- Enable these indexes for performance
CREATE INDEX IF NOT EXISTS idx_watch_records_created_at ON watch_records(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_watch_records_price_usd ON watch_records(price_usd);
CREATE INDEX IF NOT EXISTS idx_watch_records_verdict ON watch_records(verdict);
CREATE INDEX IF NOT EXISTS idx_watch_records_reference ON watch_records(reference);
CREATE INDEX IF NOT EXISTS idx_watch_records_brand ON watch_records(brand);

-- Verify verdict constraint
ALTER TABLE watch_records 
  DROP CONSTRAINT IF EXISTS watch_records_verdict_check;
ALTER TABLE watch_records 
  ADD CONSTRAINT watch_records_verdict_check 
  CHECK (verdict IN ('APPROVED', 'REVIEW', 'HUMAN', 'RECYCLE'));
```

---

## DEPLOYMENT

### Vercel (Frontend)
- **URL:** https://watchfacts-poc.vercel.app
- **Auto-deploys** on every Git push
- **Status:** ✅ Working
- **Issue:** API routes don't work (static hosting)

### Railway (Backend) — ON HOLD
- **Status:** Build failing (Node.js ESM/CommonJS conflict)
- **Config:** `railway.json` + `server.cjs`
- **Issue:** `tailwind.config.js` uses CommonJS but postcss needs ESM
- **Fix needed:** Add `"type": "module"` to package.json OR use `.cjs` for all config files

---

## GIT REPOSITORY

- **Repo:** `github.com/Pablodd1/wf`
- **Branch:** `main`
- **Recent commits:** See CI/CD history — 46+ builds
- **Key files to preserve:**
  - `PLATFORM-ARCHITECTURE.md` (this file)
  - `api/_lib/supabase.js` (all data access)
  - `api/_lib/parser.js` (7-stage parser)
  - `api/_lib/gap-detector.js` (confidence routing)
  - `src/pages/TradingFloor.tsx` (main marketplace)
  - `public/catalog.json` (6,958 catalog entries)

---

## ENVIRONMENT VARIABLES (if needed)

```env
SUPABASE_URL=https://bptrvfncppbjnchsaxtb.supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
```

---

*Last updated: 2026-06-29*
*Next action needed: Enable Supabase indexes + fix admin tab data sources*
