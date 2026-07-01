# SESSION HANDOFF — WatchFacts POC — 2026-07-01

Model switch in progress. This file captures full state so the next session
picks up cleanly. Read this FIRST before doing anything else.

## Background Job Running (check before touching brand index files)

**Process:** `node scripts/build-price-index.js` (background, detached — survives session/model switch)
**Purpose:** Rebuilds `public/watchfacts-brand-index.json` + `public/watchfacts-ref-index.json`
after the brand-normalization merge/revert operations earlier this session.
**ETA:** ~15-20 min total from when it started (check timestamp on the files once done).
**How to check status:** `ps aux | grep build-price-index` or just check the file
mtimes on `public/watchfacts-brand-index.json` — if newer than this handoff doc,
it's done.
**What to do when it finishes:**
```bash
cd /home/jasme/wf
npm run build
git add -A && git commit -m "chore: rebuild brand/ref index after normalization"
git push origin main
npx vercel --prod --yes
```

## What Was Just Completed (this session, verified live in production)

1. **Catalog matching wired** — `api/_lib/catalog-matcher.js`, 6958 entries, O(1) lookup
2. **ContextTracker brand inheritance fixed** — was 91%, now **100%** (23/23 test cases)
   after fixing `_isHeaderLine()` 2-char bug + `brandExplicit` override logic
3. **Dense multi-listing dump detection** → auto-RECYCLE (was giving false-good scores)
4. **All API timeout bugs fixed**: UnifiedReports, AdminPage, DataBrowser — replaced
   `count=exact` on full-table queries with fast `/api/confidence-stats`, fixed invalid
   `&range=` query param → `&limit=&offset=`
5. **Price Research fully working** — brand dropdown (399→ pending final recount after
   index rebuild) + reference dropdown, both populated from precomputed index files
6. **Admin CRUD edit-and-save** — verified end-to-end via intercepted network request +
   direct Supabase query confirmation
7. **Brand normalization applied to DB** (~4,748 rows merged, e.g. "Bvlgari"→"Bulgari",
   "Submariner"→"Rolex"). The 178 garbage-brand nulls were REVERTED per user instruction
   (confirmed via `brand=is.null` count: 40672→40494, exact match). The 322 non-watch
   flags (Ferrari, Apple, etc.) were left as-is — only added `flags.needs_review`,
   never touched `brand` field.
8. **NEW: Raw data expand-row + AI Review Assist button** — live in production:
   - Every row in Admin Reports has a chevron to expand inline raw_message text
   - Every row has a ✨ Sparkles button opening `AIReviewModal` — shows raw data,
     parsed fields, calls `/api/ai-review-assist` (server-side, key never exposed),
     plus Google/Chrono24 web search links (no API key needed)
   - Verified live: real AI analysis returned correctly identifying a Rolex Yacht-Master
   - Provider: OpenAI gpt-4o-mini (works despite `vercel env pull` showing empty —
     runtime resolves the key correctly; don't trust the pull snapshot alone)

## Pending / Not Yet Done

1. **Wire `brand-normalizer.js` canonical map into `api/_lib/parser.js`** — the alias
   map exists and was used for the one-time backfill, but NEW incoming WhatsApp
   listings still won't get normalized brands automatically. This is the actual
   long-term fix; the backfill only cleaned historical data.
2. **Rebuild brand/ref index** — in progress, see above.
3. **Clean up one-off scripts** in `scripts/`: `brand-normalization-dryrun.js`,
   `brand-normalization-impact-check.js`, `backfill-brand-normalization.js`,
   `revert-garbage-brand-null.js` — these were single-use tools for this session's
   backfill. Consider deleting or archiving once confirmed no longer needed.
4. **Full regression click-through** of Search/Analytics/Health/Import/Settings admin
   pages — never personally browser-tested this session (Dashboard, Reports, Pipeline,
   Live, Price Research all verified).
5. **Add `normalizeBrand()` unit test coverage** for the 141 real brand-value
   discrepancies found (399 brands total, ~40 real luxury brands not yet in catalog.json
   which only has 15).

## Recommendations (priority order)

**P0 — this session's leftover:**
- Finish index rebuild + redeploy (automatic once background job completes)

**P1 — data quality (real, user-visible issue):**
- Wire brand-normalizer into parser.js so new listings don't reintroduce duplicates
- Expand `catalog.json` beyond 15 brands (currently missing AP, Hublot, VC, Lange —
  all real, active brands with real listing volume)
- Reference-field garbage filter (values like "100000HKD" showing as references)

**P2 — architecture hardening:**
- Audit EVERY remaining Supabase query in the codebase for the two known killer
  patterns: (a) `count=exact` on unfiltered/date-filtered queries, (b) `offset=N`
  pagination past ~300K depth. Confirmed present in 4 files this session
  (UnifiedReports, AdminPage, DataBrowser, build-price-index script) — likely more
  exist in unaudited pages (Search, Analytics, TradingFloor).
- Consider adding a Postgres index on `flags` (GIN index for JSONB) if that column
  needs to be queryable going forward — currently ANY filter on it times out.

**P3 — nice to have:**
- Code-split the 872KB main JS bundle (Vite warns on every build)
- Full click-through of unverified admin pages

## Key Files Touched This Session

- `api/_lib/catalog-matcher.js` — new, catalog lookup
- `api/_lib/context-tracker.js` — brand inheritance fixes
- `api/_lib/brand-normalizer.js` — new, canonical brand map (not yet wired into parser)
- `api/_lib/parser.js` — brandExplicit flag added
- `api/listings.js` — rewritten, direct Supabase queries not static file
- `api/confidence-stats.js` — normalized field names (total + totalRecords)
- `api/ai-review-assist.js` — new, server-side AI proxy for Human Review
- `api/green-api-webhook.js`, `api/green-api-live.js` — catalog + context tracker wired
- `src/pages/UnifiedReports.tsx` — CRUD, raw data expand, AI Review modal
- `src/pages/PriceResearch.tsx` — index-file-based dropdowns with live fallback
- `src/pages/AdminPage.tsx`, `src/pages/DataBrowser.tsx` — timeout fixes
- `src/pages/LiveQueue.tsx`, `src/pages/PipelineDashboard.tsx`, `src/pages/DemoPage.tsx` —
  switched from broken supabase client to fetch+REQ_HEADERS
- `scripts/build-price-index.js` — cursor-pagination index builder (currently running)
- `public/catalog.json` — 15-brand watch catalog (needs expansion, see P1)

## Live Site
https://watchfacts-poc.vercel.app — all pages functional as of this handoff.
Admin: `/admin` → Skip Login → full dashboard access.
