# WatchFacts — MASTER PLAN
# CTO: Hermes | Date: 2026-06-26
# Stakeholders: Seller (dealer), Buyer, Information Seeker, Owner (Jasmel)

## OBJECTIVE
Deliver a unified, accurate, and user-friendly watch intelligence platform
that serves four user types seamlessly:
  1. SELLER: Submits watch listings, sees parsed results, exports reports
  2. BUYER: Browses listings, sees prices, demand ratios, market trends
  3. INFORMATION SEEKER: Searches references, sees historical pricing, specs
  4. OWNER (Jasmel): Admin dashboard, data quality, green API ingestion

## ARCHITECTURE DECISION
Supabase Pro + Vercel (can upgrade to Pro if needed).
Single shared parser (api/_lib/parser.js) for ALL ingestion paths.
Green API connects via polling (non-invasive, read-only, zero risk to their setup).

---

## PHASE 1: SHARED PARSER EXTRACTION (P0 — Foundation)
**Why:** Three parsers exist with different bugs. Unify before any more work.
**Effort:** 1h
**Deliverable:** api/_lib/parser.js with all functions exported.
**Verification:** All three endpoints (ingest, green-api-webhook, telegram-ingest) 
  produce identical results for the same input message.
**Subagent:** Parser Engineer

### Tasks:
1.1 Create api/_lib/ directory
1.2 Extract from api/ingest.js into api/_lib/parser.js:
    - parseFull(), parsePrice(), parseCurrency(), verdict()
    - splitMultiWatch(), inferBrandFromRef(), inferDialFromRef()
    - isYearLike(), isReferenceNumber(), isKaratContext()
    - brand detection chain (all P0 aliases), reference regex cascade
    - RATES, toUSD(), hashMessage()
    - APPROVE_THRESHOLD, HUMAN_THRESHOLD constants
1.3 Update api/ingest.js to require() from _lib/parser.js
1.4 Verify: build passes, smoke test 12/12

---

## PHASE 2: GREEN API INTEGRATION (P0 — Live Data)
**Why:** All dealer messages must flow into watch_records for watchfacts.com
**Effort:** 2h
**Deliverable:** Green API messages parsed by shared parser, dual-written to both tables
**Subagent:** Backend Integration Engineer

### Tasks:
2.1 Fix api/green-api-webhook.js:
    - Import shared parser from _lib/parser.js
    - Keep Green API payload unwrapping (messageData extraction)
    - Replace parseWatchMessage() → shared parseFull()
    - Remove ALL duplicate parser code (parsePrice, parseBrand, parseCurrency, parseWatchMessage)
    - Add dual-write to watch_records
    - Add Supabase dedup check before write
2.2 Build api/green-api-poll.js:
    - Cron-safe endpoint for Green API receiveNotification polling
    - Fetches receiveNotification, processes through shared parser
    - Deletes notification after processing
    - Dual-writes to live_ingest + watch_records
2.3 Configure cron job:
    - Every 60 seconds: POST to green-api-poll
    - Optional: backfill on first run (process last N messages)
2.4 Fix api/telegram-ingest.js:
    - Import shared parser
    - Add dual-write to watch_records
    - Remove duplicate parser code

---

## PHASE 3: UI/UX & ROUTING AUDIT (P0 — User Experience)
**Why:** All links, tabs, routes must work for sellers, buyers, and information seekers
**Effort:** 2h
**Deliverable:** Every link clickable, every route resolves, no dead pages
**Subagent:** UI/UX Auditor

### Tasks:
3.1 Route audit: Every tab in TabNav, every NavLink, every href
    - Verify each route exists in App.tsx
    - Verify each page component renders without crash
    - Flag any 404, broken link, or white-screen
3.2 Tab navigation audit:
    - Click every tab: Home, Demo, Review, Clean, Admin, Price Research, Demand, Analytics, Search
    - Verify tab highlights correctly (active state)
    - Verify no tab goes to white screen
3.3 Listing permalink fix (Bug 4):
    - PriceResearch.tsx line 246: /buy/all → fix to /price-research?ref=
    - Or create simple BuyPage.tsx with filtered listings
3.4 Report exports:
    - Verify Excel download works from Price Research page
    - Verify CSV download works from Price Research page
    - Verify CleanPage Excel/CSV export works
    - Verify AdminPage export works
3.5 Mobile responsiveness check:
    - Cards should not overflow on mobile
    - Charts should resize
    - Tab navigation should be usable on narrow screens

---

## PHASE 4: REMAINING BUG FIXES (P1 — Data Quality)
**Why:** Squash the last bugs from the CTO audit
**Effort:** 1h
**Subagent:** Bug Fix Engineer

### Tasks:
4.1 Bug 5: Year-as-price safety net in parseFull()
    - After year extraction AND price extraction in parseFull()
    - If priceRaw equals year, nullify priceRaw
4.2 Bug 6: Accuracy rate label fix
    - useWatchData.ts: rename "ACCURACY RATE" → "AUTO-APPROVE RATE"
    - StatsBar.tsx: remove fake hardcoded trend indicators
    - Add tooltip explaining what the metric means
4.3 Bug 4 remaining: routing fix (already in Phase 3 or here)

---

## PHASE 5: FINAL VERIFICATION & DEPLOYMENT
**Why:** Ensure everything works end-to-end before declaring done
**Effort:** 30m
**Deliverable:** 12/12 smoke test, all routes verified, green API tested
**Subagent:** QA Engineer (owner — Jasmel review)

### Tasks:
5.1 Full smoke test (12 endpoints)
5.2 Route click-through test (all tabs, all links)
5.3 Green API poll test (simulate webhook payload)
5.4 Git commit + push + deploy
5.5 Update PENDING.md with completion status

---

## PERSONAS & EXPECTATIONS

### SELLER (Dealer)
- Posts watch message → sees it parsed with confidence score
- Can export CSV/Excel of their listings
- Clear formatting guide so they know how to write messages
- "Join Group" button to submit their WhatsApp group

### BUYER
- Searches reference → sees price range, chart, demand ratio
- Clicks listing → sees details (NOT broken link)
- Can download reports for price comparison

### INFORMATION SEEKER
- Searches any reference → gets specs from catalog
- Sees historical pricing, trend direction
- Clean UI with clear navigation

### OWNER (Jasmel)
- Admin dashboard shows real-time stats
- Green API messages flowing automatically
- Data quality improving (auto-approve rate > target)
- All endpoints working, all tabs functional
