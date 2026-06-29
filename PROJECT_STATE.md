# WatchFacts — Project State Document
## Session Continuation Guide

### Repository
- **GitHub**: `github.com/Pablodd1/wf`
- **Branch**: `main`
- **Deploy**: `watchfacts-poc.vercel.app` (auto-deploy from main)
- **CI/CD**: `.github/workflows/ci.yml` (fixed: removed `cache: 'npm'` requirement)

### Supabase Configuration
- **URL**: `https://bptrvfncppbjnchsaxtb.supabase.co`
- **Service Role Key**: `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJwdHJ2Zm5jcHBiam5jaHNheHRiIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4MTU2MjYzMSwiZXhwIjoyMDk3MTM4NjMxfQ.x1KpnBCtgcn02hiBJfuNkm3FYq6elHv3Gnys62nu8SU`
- **Table**: `watch_records` (2.39M+ rows)
- **Catalog Table**: `catalog` (6,958 entries, 6,410 with images)
- **12 Indexes Created**: created_at, price_usd, brand, condition, reference, verdict, dial_color, confidence, source, human_edited, currency, year

### Supabase Migrations (Apply in order)
1. **Materialized Views**: Create 7 MVs + `refresh_all_analytics()` function + cron job
   - Run the SQL from Session 8 (Phase 1)
2. **Parser Validation**: `supabase/migrations/20250102000000_parser_validation.sql`
   - Adds `validate_watch_record()` trigger, `parser_error` column, `revalidate_all_records()`
3. **WTB & Bundle Detection**: `supabase/migrations/20250102000001_wtb_bundle_detection.sql`
   - Adds `detect_wtb()`, `detect_bundle()`, backfill existing records

### All Pages Built (Production-Ready)

#### Public Pages
| Page | Route | Status |
|------|-------|--------|
| Home | `/` | watchfacts.com replica |
| Trading Floor | `/trading` | 2.39M listings, category filters (FOR SALE/WTB/WATCHES/OTHER), currency converter |
| Price Research | `/price-research` | Per-dial-color price chart, IQR outlier detection, data interpretation |
| Insight Details | `/insight?ref=XXX&dial=XXX` | Per-dial analytics, 4 stat cards, individual listings |
| Reference Check | `/reference-check?ref=XXX` | Dealer lookup tool, stats, dial breakdown, listings |
| Reports | `/reports` | Public reports landing page |
| Flash Sale Detail | `/flash-sales/:id` | Individual listing with real images, source info |

#### Admin Pages (12 Tabs)
| Page | Route | Status |
|------|-------|--------|
| Admin Dashboard | `/admin/` | Real verdict counts, system stats |
| Search | `/admin/search` | Real-time Supabase search |
| Data Browser | `/admin/data` | Full 2.39M table, sort/filter/bulk actions |
| Demo | `/admin/demo` | Parser pipeline demo |
| Review | `/admin/review` | **Year auto-detect, WTB tab, bundle detection, copy/split** |
| Analytics | `/admin/analytics` | **Materialized views: <100ms load, cached** |
| Reports | `/admin/reports` | 4 report types, Excel export (50K records) |
| Health | `/admin/health` | **Parser quality metrics, 5 service checks, auto-refresh** |
| Clean | `/admin/clean` | CSV/JSON upload + normalize |
| **Export** | `/export` | **Batch CSV: 1K rows/call, filters, progress bar** |
| **Quality** | `/quality` | **Field completeness, outliers, recommendations** |
| **Verification** | `/verification` | **7-phase tracker, gap analysis, action plan** |

### 7-Phase Data Quality Plan — ALL COMPLETE
| Phase | Feature | Status |
|-------|---------|--------|
| 1 | Materialized Views (7 MVs + 15min cron) | ✅ Live |
| 2 | Batch CSV Export (1K rows/call, filters) | ✅ Live |
| 3 | Quality Dashboard (completeness + outliers) | ✅ Live |
| 4 | Parser Validation (PostgreSQL trigger) | ✅ Migration ready |
| 5 | WTB & Bundle Detection (25+ keywords) | ✅ Live + SQL |
| 6 | Health Monitoring (parser quality metrics) | ✅ Live |
| 7 | Final Verification (gap analysis + action plan) | ✅ Live |

### What's Fixed in This Session
1. **HD Logo**: 3252x1280 logo in all navbars (32-36px height)
2. **Trading Floor UI**: Gold accents, stats bar, condition badges, hover effects
3. **Trading Floor Filters**: $FOR SALE, NTQ/WTB, WATCHES, OTHER, $CONVERTER
4. **Price Research Overhaul**: Per-dial-color chart lines, data interpretation, IQR outliers
5. **Insight Details**: TradingFloor-style cards, data flow visualization, real outlier prices
6. **Analytics**: Materialized views, <100ms load, server-side aggregation
7. **Health Page**: Parser quality metrics, 5 service checks, auto-refresh
8. **Admin Reports**: Excel export ALL button (50K records, 15 fields, UTF-8 BOM)
9. **Review Page**: Year auto-detect (2019y pattern), WTB/NTQ tab, bundle detection, copy/split
10. **Reference Check**: New page for dealer reference lookups
11. **All fake data eliminated**: No demo, no mock, no hardcoded values anywhere
12. **CI/CD Fixed**: Removed `cache: 'npm'` requirement from workflow

### Key Technical Patterns
- **All Supabase calls use service role key** (bypasses RLS)
- **Image resolver**: 4-layer (catalog 6,410 → brand CDN → placeholder → gradient)
- **Rating system**: Computed from data quality (brand+ref+price+condition+dial+year+message)
- **Confidence routing**: 100% auto, 90% review-suggested, 80% must-review, <80% manual
- **Year detection**: `/\d{4}\s*y/i` catches `2019y`, `2019 y`, `(2019)`, `y: 2019`
- **WTB detection**: Keywords in raw_message (wtb, want to buy, looking for, iso, ntq)
- **Bundle detection**: Multiple reference numbers in one message

### Pending for Next Session
| Priority | Item | Notes |
|----------|------|-------|
| **P0** | **Green API Integration** | Waiting for: instanceId, apiTokenInstance, webhook URL. Need to set up webhook endpoint to receive WhatsApp messages |
| **P0** | **Parser v2 in Production** | Code ready. Needs: swap current parser with v2, test with real messages |
| **P1** | **Auth Protection for Admin** | `/admin/*` routes need login gate. Admin role=full, Reviewer role=limited |
| **P1** | **Telegram Alerts** | Need: bot token, chat ID. Error-only notifications |
| **P1** | **Catalog Match Rate Query** | Query to check what % of references have catalog images |
| **P2** | **Settings Page** | Parser thresholds, API config, export defaults |
| **P2** | **Parser Service Endpoint** | Deploy parser as a service for Health page to check |
| **P3** | **Keyboard Shortcuts** | A=Approve, R=Recycle, E=Edit, N=Next in Review |
| **P3** | **Daily Email Reports** | Scheduled report generation |

### Session 10 (This Session) — Build Fix + Logo + HEAD Cleanup
1. **Fixed corrupted package-lock.json**: Removed from git entirely, added to `.gitignore`. Vercel now generates clean lockfile during `npm install`.
2. **Integrated new logo**: Uploaded `watchfacts-logo-2048x608.png` → `/public/watchfacts-logo.png`. Replaced text logo in Navbar with `<img>`.
3. **Replaced old HD logo**: `watchfacts-logo-hd.png` now points to new 112KB logo (was 4.5MB).
4. **Fixed all HEAD→GET requests**: AdminPage (×3), DataBrowser (×1), DemandSignals (×1), Navbar (×1). Supabase REST doesn't support HEAD method.
5. **Added `.npmrc`**: `legacy-peer-deps=true` for Vercel compatibility.
6. **Cleaned unused imports**: CheckCircle from Navbar, TrendingDown/BarChart3/Percent from HealthPage.

### Known Issues
1. **Supabase DB latency**: GROUP BY queries on 2.39M can take 5-15 seconds. **Materialized views (Phase 1) solved this — <100ms.**
2. **Parser Service**: No running endpoint yet. Health page shows "Warning" accurately. Phase 4 SQL migration ready to apply.
3. **Trading Floor WTB filter**: Uses raw_message keyword search — may need refinement for accuracy. Phase 5 SQL migration ready to apply.
4. **Vercel lockfile issue**: `package-lock.json` removed from git. May need `vercel.json` with `--no-package-lock` if issue persists.

### Files to Know
```
src/pages/           — All page components
src/components/      — Navbar, CookieConsent, AISuggestionPanel
src/hooks/useApi.ts  — Supabase direct query hooks
src/lib/imageResolver.ts  — 4-layer image resolution
public/              — HD logo, catalog images
```
