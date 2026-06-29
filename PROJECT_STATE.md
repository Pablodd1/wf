# WatchFacts — Complete Project State
## Last Updated: 2026-06-29
## Session Checkpoint — Start new conversation with this file

---

## CRITICAL CONFIGS

### Supabase
- **URL**: `https://bptrvfncppbjnchsaxtb.supabase.co`
- **Service Role Key**: `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJwdHJ2Zm5jcHBiam5jaHNheHRiIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4MTU2MjYzMSwiZXhwIjoyMDk3MTM4NjMxfQ.x1KpnBCtgcn02hiBJfuNkm3FYq6elHv3Gnys62nu8SU`
- **Table**: `watch_records` — 2,394,571+ rows
- **12 Indexes Created**: `idx_created_at`, `idx_price_usd`, `idx_brand`, `idx_condition`, `idx_reference`, `idx_verdict`, `idx_dial_color`, `idx_source`, `idx_received_at`, `idx_confidence`, `idx_human_edited`, `idx_parser_version`
- **RLS**: Disabled (using service role key for direct browser access)

### GitHub
- **Repo**: `Pablodd1/wf`
- **Branch**: `main`
- **Deploy**: Vercel auto-deploys on push to main

### Catalog Data
- **6,958 entries** across 16 brand files
- **6,410 with real image URLs** from dealerimage.b-cdn.net
- **Processed brands**: Rolex, Patek Philippe, Audemars Piguet, Richard Mille, Vacheron Constantin, Omega, Cartier, Breitling, IWC, Jaeger-LeCoultre, Panerai, Hublot, TAG Heuer, Zenith, Blancpain, Breguet
- Image resolver: 4-layer fallback (catalog → CDN → placeholder → gradient)

---

## ALL PAGES (47 files)

### Public Website (8 pages)
| Page | Route | File | Status |
|------|-------|------|--------|
| Home | `/` | `src/pages/Home.tsx` | Live — watchfacts.com replica |
| Trading Floor | `/trading` | `src/pages/TradingFloor.tsx` | **LIVE** — 4 category filters, real images, ratings, Supabase data |
| Flash Sale Detail | `/flash-sales/:id` | `src/pages/FlashSaleDetail.tsx` | **LIVE** — real data from Supabase by ID |
| Price Research | `/price-research` | `src/pages/PriceResearch.tsx` | **LIVE** — per-dial-color price chart, IQR outlier detection |
| Insight Details | `/insight` | `src/pages/InsightDetails.tsx` | **LIVE** — per-dial filtering, 4 stat cards, TradingFloor-style cards |
| Reports | `/reports` | `src/pages/ReportsPage.tsx` | Static links page |
| Login | `/login` | `src/pages/LoginPage.tsx` | UI ready, no backend auth yet |
| Sign Up | `/signup` | `src/pages/SignUpPage.tsx` | UI ready, no backend auth yet |

### Admin Dashboard (9 tabs under `/admin/*`)
| Tab | Route | File | Status |
|-----|-------|------|--------|
| Search | `/admin/search` | `src/pages/SearchPage.tsx` | **LIVE** — Supabase real-time, inline edit, pagination |
| Data Browser | `/admin/data` | `src/pages/DataBrowser.tsx` | **LIVE** — bulk select, sort/filter, 50/page, watch images |
| Demo | `/admin/demo` | `src/pages/DemoPage.tsx` | Working — parser pipeline demo |
| Review | `/admin/review` | `src/pages/ReviewPage.tsx` | **LIVE** — Supabase data, inline edit, AI suggestions |
| Analytics | `/admin/analytics` | `src/pages/AnalyticsPage.tsx` | **LIVE** — real Supabase queries, 6 chart types |
| Reports | `/admin/reports` | `src/pages/AdminReportsPage.tsx` | **LIVE** — 4 report types, date ranges, export JSON/CSV |
| Health | `/admin/health` | `src/pages/HealthPage.tsx` | **LIVE** — 5 service checks, auto-refresh, alert history |
| Admin | `/admin/` | `src/pages/AdminPage.tsx` | **LIVE** — real verdict counts, health checks, activity log |
| Clean | `/admin/clean` | `src/pages/CleanPage.tsx` | Working — CSV/JSON upload + normalize |

### Content Pages (8 pages)
| Page | Route | File | Status |
|------|-------|------|--------|
| About Us | `/about` | `src/pages/AboutUs.tsx` | Static |
| About Simon | `/about-simon` | `src/pages/AboutSimon.tsx` | Static |
| Buying Process | `/buying-process` | `src/pages/BuyingProcess.tsx` | Static |
| Selling Process | `/selling-process` | `src/pages/SellingProcess.tsx` | Static |
| Terms | `/terms` | `src/pages/Terms.tsx` | Static |
| Privacy | `/privacy-policy` | `src/pages/PrivacyPolicy.tsx` | Static |
| Glossary | `/glossary` | `src/pages/Glossary.tsx` | Static |
| Pricing | `/pricing` | `src/pages/PricingPage.tsx` | Static — 3 tiers |

### Other (2 pages)
| Page | Route | File | Status |
|------|-------|------|--------|
| Demand Signals | `/admin/demand` | `src/pages/DemandSignals.tsx` | **LIVE** — real Supabase data, computed sentiment |
| Currency Converter | inline popup | `TradingFloor.tsx` | Working — 9 currencies |

---

## COMPONENTS (18 files)

### Navbars
| Component | Used On | Notes |
|-----------|---------|-------|
| `DealerNavbar.tsx` | TradingFloor, PriceResearch, InsightDetails, FlashSaleDetail | Light mode, HD logo (36px), links: Trading, Price Research, Dealer Dir, Escrow, Hire Fi |
| `PublicNavbar.tsx` | Home, Reports, content pages | Light mode, HD logo (36px) |
| `Navbar.tsx` | Admin dashboard (Layout.tsx) | Dark mode, 9 tabs, real Supabase count |

### Other Components
- `Layout.tsx` — Dark admin wrapper with Navbar + sidebar
- `PageShell.tsx` — Page transition wrapper
- `CookieConsent.tsx` — GDPR banner
- `AISuggestionPanel.tsx` — AI suggestions for human review
- `StatsBar.tsx` — Stats display component
- `WatchCard.tsx` — Card component (legacy, now inline in TradingFloor)
- `WatchImage.tsx` — Image loading with fallback
- `ProtectedRoute.tsx` — Auth guard (not wired yet)
- `ExportButtons.tsx` — CSV/JSON export

### UI Components (8)
- BrandBadge, ConditionBadge, ConfidenceRing, DemandBadge, DialColorSwatch, FilterChip, StageDot, StatusPill

---

## HOOKS & LIBRARIES

| File | Purpose |
|------|---------|
| `src/hooks/useAuth.tsx` | Auth context (placeholder, not wired) |
| `src/hooks/useApi.ts` | **Supabase direct queries** — useSupabase(), supabaseQuery(), supabasePatch(), getCount() |
| `src/lib/imageResolver.ts` | 6,410 catalog image map + brand gradient fallbacks |
| `src/lib/utils.ts` | Formatting utilities |
| `src/lib/reportExport.ts` | Export helpers |
| `src/lib/watchImages.ts` | Brand CDN URL builder |

---

## TYPE DEFINITIONS

| File | Contents |
|------|----------|
| `src/types/index.ts` | WatchListing, DemandSignal, ReviewItem types |
| `src/types/catalog.ts` | Catalog entry types |
| `src/types/xlsx-js-style.d.ts` | XLSX type declarations |

---

## ROUTING (App.tsx)

HashRouter with these routes:
- `/` → Home
- `/trading` → TradingFloor
- `/flash-sales/:id` → FlashSaleDetail
- `/price-research` → PriceResearch
- `/insight` → InsightDetails (query params: ref, dial, month, brand)
- `/reports` → ReportsPage
- `/login`, `/signup`, `/pricing`
- `/about`, `/about-simon`, `/buying-process`, `/selling-process`
- `/terms`, `/privacy-policy`, `/glossary`
- `/admin/*` → AdminRoutes (9 tabs)
- Redirects: `/search`→`/admin/search`, `/data`→`/admin/data`, `/review`→`/admin/review`, `/analytics`→`/admin/analytics`, `/health`→`/admin/health`

---

## WHAT WORKS (100% LIVE)

### Trading Floor
- [x] Real watch images from catalog (6,410 images)
- [x] Rating system (computed from data quality, 0-100 → X/10 or NO RATING)
- [x] 4 category filters: FOR SALE, NTQ/WTB, WATCHES, OTHER
- [x] Currency converter popup (9 currencies)
- [x] Search by reference/brand
- [x] Condition filter (N1-N9)
- [x] Region filter
- [x] Pagination
- [x] Stats bar (total listings, dealers, live data indicator)
- [x] Click card → FlashSaleDetail

### Price Research
- [x] Model + Reference dropdowns
- [x] **Per-dial-color price chart** — separate line per dial color
- [x] IQR outlier detection with actual removed prices shown
- [x] 4 stat cards (Original/blue, Duplicated/gray, Filtered/green, Outliers/red)
- [x] Data interpretation panel
- [x] Dial color breakdown table (clickable → InsightDetails)
- [x] Price range distribution bar
- [x] Monthly breakdown table with per-dial prices
- [x] Date range selector (1M/3M/6M/1Y/ALL)
- [x] Chart dots clickable → InsightDetails

### Insight Details
- [x] Per-dial filtering (from Price Research click)
- [x] Per-month filtering (from chart dot click)
- [x] 4 stat cards with actual numbers
- [x] Data flow visualization (Original → Duplicates → Unique → Outliers → Final)
- [x] Actual outlier prices displayed as red badges
- [x] Actual duplicate prices displayed as gray badges
- [x] Individual listings in TradingFloor card format
- [x] Real watch images on cards

### Admin Dashboard (9 tabs)
- [x] Search — Supabase real-time, inline edit
- [x] Data Browser — bulk select, sort/filter, export selected
- [x] Demo — parser pipeline visualization
- [x] Review — Supabase data, inline edit, AI suggestions
- [x] Analytics — 6 real chart types from Supabase
- [x] Reports — 4 report types, date ranges, JSON/CSV export
- [x] Health — 5 service checks, auto-refresh 30s, alerts
- [x] Admin — real verdict counts, activity log
- [x] Clean — CSV/JSON upload + normalize

---

## WHAT'S NEXT (Priority Order)

### Phase 1: Connect Green API (HIGHEST PRIORITY)
- [ ] User provides Green API credentials (instance ID, API token)
- [ ] Set up webhook endpoint to receive WhatsApp messages
- [ ] Build message ingestion pipeline (receive → parse → store)
- [ ] Test with real dealer group messages
- [ ] **This is the most impactful next step** — it enables live data flow

### Phase 2: Authentication & Access Control
- [ ] Wire up useAuth hook with Supabase Auth
- [ ] Protect `/admin/*` routes with login gate
- [ ] Admin role = full access, Reviewer role = limited
- [ ] Keep public pages open
- [ ] Add password reset flow

### Phase 3: Enhanced Review Workflow
- [ ] Bulk select + bulk approve/recycle on Review page
- [ ] Keyboard shortcuts (A=Approve, R=Recycle, E=Edit, N=Next)
- [ ] Filter by confidence range, date, source
- [ ] Badge count on Review tab showing pending items

### Phase 4: Telegram Alerts
- [ ] Add Telegram bot token + chat ID config
- [ ] Alert rules: parser failure, Green API down, DB disconnect, queue backlog
- [ ] Only alert on errors (not routine success)
- [ ] Quiet hours configuration
- [ ] In-app notification toasts

### Phase 5: Parser v2 Production
- [ ] Swap parser v2 into the ingestion pipeline
- [ ] 7-stage pipeline: INGEST → VALIDATE → NORMALIZE → ENRICH → ML_SCORE → CATALOG_MATCH → VERDICT
- [ ] 4-tier confidence routing: 100% auto, 90% review-suggested, 80% must-review, <80% manual
- [ ] Test with 100 real messages

### Phase 6: AI Vision for Image Matching
- [ ] Upload watch photo → AI identifies reference number
- [ ] Match against catalog for validation
- [ ] Requires AI API key (OpenAI/Google)

### Phase 7: Settings Page
- [ ] Parser confidence thresholds
- [ ] Green API config
- [ ] Telegram bot token + alert toggles
- [ ] Catalog auto-refresh interval
- [ ] Export defaults

---

## KNOWN ISSUES

1. **No backend server** — all data flows through Supabase direct from browser. This works but exposes the service role key. Mitigation: RLS policies + anon key migration needed long-term.
2. **Auth not wired** — Login/Signup pages are UI only. Admin routes are public.
3. **Green API not connected** — No live WhatsApp ingestion yet.
4. **Client-side dial filtering** — WATCHES/OTHER filters on Trading Floor are client-side (fetch then filter). For 2.39M records this means fetching pages then filtering. Works for now but could miss matches across page boundaries.
5. **Analytics sample** — Fetches 5,000 records for client-side aggregation. Not all 2.39M. Accurate for trends but not exact counts.
6. **Currency converter** — Uses fixed exchange rates, not live. Good for estimates only.
7. **No image upload** — Clean page normalizes text but can't handle image uploads.

---

## HOW TO START A NEW SESSION

1. Read this file first
2. Check `src/App.tsx` for routing
3. Check `src/hooks/useApi.ts` for Supabase query patterns
4. All Supabase calls use the constants at the top of each file
5. Vercel auto-deploys on `git push origin main`

## CRITICAL FILES TO KNOW

| Purpose | File |
|---------|------|
| Add a new page | `src/App.tsx` → add Route |
| Add admin tab | `src/components/Navbar.tsx` → add to NAV_ITEMS |
| Query Supabase | `src/hooks/useApi.ts` → useSupabase() or supabaseQuery() |
| Resolve watch image | `src/lib/imageResolver.ts` → resolveWatchImage(ref, brand) |
| Trading Floor | `src/pages/TradingFloor.tsx` |
| Price Research | `src/pages/PriceResearch.tsx` |
| Insight Details | `src/pages/InsightDetails.tsx` |
| Admin Analytics | `src/pages/AnalyticsPage.tsx` |
| Admin Health | `src/pages/HealthPage.tsx` |
| Admin Reports | `src/pages/AdminReportsPage.tsx` |
| Data Browser | `src/pages/DataBrowser.tsx` |

---

## IMPROVEMENT SUGGESTIONS

### Performance
- Add Redis caching layer for repeated queries
- Implement server-side pagination for Data Browser (currently fetches 50, client-side pagination)
- Add debounced search (currently has 300ms timeout)
- Lazy-load chart libraries (recharts is heavy)

### UX
- Add skeleton loading states to all pages (some have, some don't)
- Add toast notifications for actions (update, export, etc.)
- Keyboard shortcuts on Review page
- Mobile responsive pass on admin pages
- Dark mode toggle for public pages

### Data Quality
- Run parser v2 on all 2.39M records to re-score confidence
- Build deduplication pipeline (exact match + fuzzy match)
- Normalize all brand names ("ROLEX" → "Rolex")
- Fill missing dial colors from raw message parsing

### Features
- Price alerts (notify when reference drops below threshold)
- Watchlist / favorites for users
- Dealer profiles with ratings
- Escrow flow UI
- Export to PDF reports
- Scheduled automated reports (daily/weekly email)

---

**END OF STATE DOCUMENT — Start new session with this as context**
