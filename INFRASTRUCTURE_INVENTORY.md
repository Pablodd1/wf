# WatchFacts — Complete Infrastructure & Resources Inventory
**As of:** July 1, 2026
**Purpose:** Single source of truth for all infrastructure, credentials, repos, and external services
**Status:** For reference — do not distribute publicly (contains sensitive endpoints)

---

## 1. PRODUCTION DEPLOYMENT

### Vercel (Frontend + Serverless API)
| Item | Value |
|------|-------|
| **Live URL** | `https://watchfacts-poc.vercel.app` |
| **Git Repo** | `github.com/Pablodd1/wf` (branch: `main`) |
| **Framework** | React 18 + Vite + TypeScript + Tailwind CSS |
| **API** | Vercel serverless functions (`/api/*.js`) |
| **Build** | `npm run build` (tsc + vite build) |
| **Deploy** | Auto on push to `main` via Vercel Git integration |
| **SPA Routing** | `vercel.json` has rewrites: `{"source": "/(.*)", "destination": "/index.html"}` |
| **Last Known Good Deploy** | Parser v3.1 + PriceResearch brand filtering (commits diverged: local 1 ahead, origin 5 ahead) |

### Supabase (PostgreSQL Database)
| Item | Value |
|------|-------|
| **Project URL** | `https://bptrvfncppbjnchsaxtb.supabase.co` |
| **Dashboard** | `app.supabase.com/project/bptrvfncppbjnchsaxtb` |
| **Region** | Unknown (likely us-east-1) |
| **Database** | PostgreSQL 15+ |
| **PostgREST** | Enabled (auto-generated API at `/rest/v1/`) |
| **Row Level Security** | ENABLED on all tables |
| **Service Role Key** | `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...` (JWT for backend) |
| **Anon Key** | Available in Supabase dashboard |
| **Connection Pool** | 10-30 concurrent (Supabase free/pro tier) |

---

## 2. DATABASE — SUPABASE POSTGRESQL

### Primary Table: `watch_records`
| Stat | Value |
|------|-------|
| **Rows** | 2,392,784 |
| **Columns** | 28 |
| **Size** | ~2-5 GB estimated |

**Key columns:** `id` (uuid PK), `brand`, `model`, `reference`, `price_usd`, `price_raw`, `currency`, `dial_color`, `condition`, `year`, `box_papers`, `verdict` (APPROVED/REVIEW/HUMAN/RECYCLE/WTB), `confidence` (0-100), `dealer_name`, `raw_message`, `source`, `listing_type`, `parser_error`, `received_at`, `created_at`

### Secondary Tables
| Table | Rows | Purpose |
|-------|------|---------|
| `reference_images` | 5,044 | Watch catalog images (Supabase Storage refs) |
| `reprocessing_queue` | 2,393 batches | 2.39M reprocessing job queue |
| `reprocessing_progress` | 1 | Overall reprocessing status |
| `reprocessing_logs` | N | Per-batch processing history |

### Materialized Views (9 total)
| View | Status | Notes |
|------|--------|-------|
| `mv_stats_summary` | Working | Record counts, brand counts, price ranges |
| `mv_brand_dist` | **BROKEN** | Returns HTTP 500 — needs REFRESH or recreate |
| `mv_verdict_dist` | Working | APPROVED/REVIEW/HUMAN/WTB/RECYCLE counts |
| `mv_cond_dist` | Working | Condition distribution |
| `mv_dial_dist` | Working | Dial color distribution |
| `mv_top_refs` | Working | Top references by volume |
| `mv_price_buckets` | Working | Price range distribution |
| `mv_dealer_dist` | Unknown | Dealer activity stats |
| `mv_source_dist` | Unknown | Source breakdown (whatsapp/telegram/etc) |

---

## 3. API ENDPOINTS (Vercel Serverless)

| Endpoint | File | Purpose | Status |
|----------|------|---------|--------|
| `/api/batch-parse.js` | `api/_lib/parser.js` | Parse watch messages (core engine) | **Working — v3.1** |
| `/api/reprocess-batch.js` | `api/reprocess-batch.js` | Batch reprocessing worker | Built, not stress-tested |
| `/api/green-api-live.js` | `api/green-api-live.js` | WhatsApp webhook (incoming messages) | Built, **token expired** |
| `/api/green-api-setup.js` | `api/green-api-setup.js` | Green API webhook config | Built, **token expired** |
| `/api/generate-report.js` | `api/generate-report.js` | Analytics PDF/Excel reports | Working |
| `/api/health-check.js` | `api/health-check.js` | System health ping | Working |
| `/api/settings.js` | `api/settings.js` | Parser config read/update | Working |
| `/api/export.js` | `api/export.js` | CSV/Excel data export | Working |
| `/api/gap-detector.js` | `api/_lib/gap-detector.js` | Data gap analysis | Built |

### Shared Libraries (`api/_lib/`)
| File | Purpose |
|------|---------|
| `parser.js` | **Core parser v3.1** — brand, ref, price, condition, dial, year, B&P extraction |
| `db.js` | Database connection wrapper |
| `supabase.js` | Supabase client initialization |
| `gap-detector.js` | Missing data detection |

---

## 4. GREEN API (WHATSAPP INTEGRATION)

| Item | Value |
|------|-------|
| **Service** | Green API (`green-api.com`) |
| **Purpose** | Receive dealer WhatsApp messages, forward to parser |
| **Webhook URL** | `https://watchfacts-poc.vercel.app/api/green-api-live` |
| **Instance ID** | **EXPIRED — needs refresh** |
| **API Token** | **EXPIRED — needs refresh** |
| **Last Status** | 401 Unauthorized on `/api/green-api-setup` |
| **Dashboard** | `console.green-api.com` |

**How to refresh:**
1. Log into `console.green-api.com`
2. Create new instance (or refresh existing)
3. Copy `idInstance` and `apiTokenInstance`
4. Set in Vercel env vars: `GREEN_API_ID_INSTANCE` and `GREEN_API_API_TOKEN`
5. Call `/api/green-api-setup` to configure webhook

---

## 5. TELEGRAM BOT (OPTIONAL)

| Item | Value |
|------|-------|
| **Status** | Not configured |
| **Env Var** | `TELEGRAM_BOT_TOKEN` |
| **Code** | Placeholder in Health page |
| **Priority** | Low — Green API is primary |

---

## 6. SECONDARY REPO: BITBUCKET WF-ADMIN

### Repository Details
| Item | Value |
|------|-------|
| **URL** | `bitbucket.org/watchfacts-trade/wf-admin` |
| **User's Local Copy** | `C:\Users\jasme\Downloads\wfrepobitbucket` |
| **Stack** | PHP Laravel (backend) + Angular (frontend) |
| **Purpose** | Separate admin panel with production normalization rules, brand catalogs, exception handling |
| **API Access** | **TOKEN FAILED** (401 — Atlassian API token ≠ Bitbucket App Password) |
| **App Passwords** | Deprecated by Atlassian (removed July 28, 2026) |

### Key Files Identified (need upload)
```
backend/app/Models/AuctionsNormalizationRule.php          ← Normalization rules
backend/app/Services/Extractor/ExceptionFlags.php          ← Exception handling
backend/app/Models/TradingFloor/FlashSale.php              ← Trading floor model
backend/app/Models/GreenApiInstance.php                    ← Green API config
backend/app/Services/Catalogs/AuctionNormalizationImportService.php  ← Import logic
backend/app/Jobs/FlashSale/ProcessUpdateNormalizationRule.php        ← Normalization jobs
backend/routes/catalogs.php                                ← Catalog API routes
backend/routes/groups.php                                  ← Group management routes
```

---

## 7. DIGITAL OCEAN (NEW — NOT YET INTEGRATED)

| Item | Value |
|------|-------|
| **Status** | Available but not connected to project |
| **Owner** | Jasmel |
| **Potential Uses** | Backend API server, parser worker, database hosting, file storage |
| **Current Integration** | None |

**Suggested use cases:**
- **Parser worker:** Run reprocessing of 2.39M records (more reliable than local)
- **API server:** If Vercel serverless limits are hit (10s timeout, memory limits)
- **File storage:** Watch images, exports, reports
- **Database:** Read replica or migration target if Supabase outgrows
- **Cron jobs:** Scheduled tasks (reprocessing, cleanup, reports)

---

## 8. DOMAIN / DNS

| Item | Value |
|------|-------|
| **Current Domain** | `watchfacts-poc.vercel.app` (Vercel subdomain) |
| **Custom Domain** | Not configured (potential: `watchfacts.com` or similar) |
| **DNS** | Managed by Vercel (if using `.vercel.app`) or external registrar |
| **SSL** | Auto-provided by Vercel (Let's Encrypt) |

---

## 9. ENVIRONMENT VARIABLES (VERCEL)

```bash
# Supabase (REQUIRED — working)
SUPABASE_URL=https://bptrvfncppbjnchsaxtb.supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJwdHJ2Zm5jcHBiam5jaHNheHRiIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4MTU2MjYzMSwiZXhwIjoyMDk3MTM4NjMxfQ.x1KpnBCtgcn02hiBJfuNkm3FYq6elHv3Gnys62nu8SU

# Green API (EXPIRED — needs refresh)
GREEN_API_ID_INSTANCE=<PASTE FROM console.green-api.com>
GREEN_API_API_TOKEN=<PASTE FROM console.green-api.com>

# Telegram (optional)
TELEGRAM_BOT_TOKEN=<optional>

# Parser tuning (optional)
APPROVE_THRESHOLD=85
HUMAN_THRESHOLD=70
```

---

## 10. FRONTEND PAGES

| Page | Route | Status |
|------|-------|--------|
| Homepage | `/` | Working |
| Trading Floor | `/trading` | Working |
| Price Research | `/price-research` | **Enhanced — brand filtering** |
| Blog | `/blog` | Working (10 articles) |
| Admin Dashboard | `/admin` | Working (14 tabs) |
| Login | `/login` | Working |
| Sign Up | `/signup` | Working |
| Reference Check | `/reference-check` | Working |
| Reports | `/reports` | Working |
| Analytics | `/analytics` | Working |
| Health | `/health` | **Fixed — lightweight DB check** |
| Reprocess | `/reprocess` | Built, queue filled |
| Data Browser | `/data-browser` | Working |
| Demand Signals | `/demand` | Working |
| Export | `/export` | Working |
| Settings | `/settings` | Working |
| Glossary | `/glossary` | Working |
| About Us | `/about-us` | Working |
| About Simon | `/about-simon` | Working |
| Buying Process | `/buying` | Working |
| Selling Process | `/selling` | Working |
| Privacy Policy | `/privacy` | Working |
| Terms | `/terms` | Working |
| Flash Sale Detail | `/flash-sale/:id` | Working |
| Insight Details | `/insight/:month` | Working |

---

## 11. TECH STACK SUMMARY

| Layer | Technology | Version |
|-------|-----------|---------|
| **Frontend** | React | 18.2 |
| **Build Tool** | Vite | 6.0 |
| **Language** | TypeScript | 5.3 |
| **Styling** | Tailwind CSS | 3.4 |
| **Components** | shadcn/ui | latest |
| **Animation** | Framer Motion | latest |
| **Charts** | Recharts | latest |
| **Icons** | Lucide React | latest |
| **Router** | react-router-dom | 6 (BrowserRouter) |
| **Backend** | Vercel Serverless | Node 18+ |
| **Parser** | Vanilla Node.js | CommonJS |
| **Database** | PostgreSQL | 15+ (Supabase) |
| **ORM/Client** | @supabase/supabase-js | 2.x |
| **Hosting** | Vercel | Pro/Free |
| **Database Host** | Supabase | Free tier |
| **WhatsApp** | Green API | Instance-based |
| **Secondary Repo** | Laravel + Angular | PHP 8.x + Angular 15+ |
| **Available Cloud** | Digital Ocean | Not integrated |

---

## 12. KNOWN CREDENTIALS STATUS

| Service | Status | Action Needed |
|---------|--------|---------------|
| Supabase | **Working** | None — service role key active |
| Vercel | **Working** | None — Git integration active |
| Green API | **EXPIRED** | Refresh tokens from console.green-api.com |
| Bitbucket API | **FAILED** | Need new scoped token or App Password (deprecated July 2026) |
| Telegram | **Not set** | Optional — get from @BotFather if needed |
| Digital Ocean | **Available** | Decision needed on how to use |

---

## 13. RESOURCE UTILIZATION

| Resource | Current | Limit | Status |
|----------|---------|-------|--------|
| Supabase DB Storage | ~2-5 GB | 500 MB (free) / 8GB (pro) | **May exceed free tier** |
| Supabase Bandwidth | Unknown | 2 GB (free) | Monitor |
| Supabase API Calls | High | 100K/day (free) | May need pro |
| Vercel Deployments | Active | 6,000/min (pro) | OK |
| Vercel Function Duration | ~1-3s avg | 10s (hobby) / 60s (pro) | OK for now |
| Image Storage | 5,044 images | Supabase Storage bucket | OK |

---

## 14. DISASTER RECOVERY

| Scenario | Recovery |
|----------|----------|
| Supabase DB corruption | Export daily via `pg_dump` or Supabase CLI |
| Vercel deploy failure | Rollback to previous deployment in Vercel dashboard |
| Green API outage | Messages queue in Green API, replay when back |
| Local dev machine failure | `git clone` + `npm install` on new machine |
| Bitbucket repo lost | Local copy at `C:\Users\jasme\Downloads\wfrepobitbucket` is backup |

---

*Document saved for future reference. Do not modify unless infrastructure changes.*
*Last updated: July 1, 2026*
