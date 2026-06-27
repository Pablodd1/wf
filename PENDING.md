# WatchFacts — Pending Implementation Plan
# Updated: 2026-06-26 (post-P0 fixes + Bug 1-3 fixes + Green API analysis)

## Priority Order (P0 → P3)

---

## ✅ COMPLETED TODAY (2026-06-26)

### P0 — Parsing Accuracy Fixes (commit 788d851)
- [x] Brand aliases: VC→Vacheron, LANGE→A.Lange, TD→Tudor
- [x] Ref≠price: isReferenceNumber() guard on parsePrice + LLM path
- [x] Karat filter: isKaratContext() skips 14k/18k gold
- [x] online-search GET support (was 405)

### Bug Fixes 1-3 (commit 64260b9)
- [x] Bug 1: LLM enrichment isReferenceNumber guard (api/ingest.js:603)
- [x] Bug 2: splitMultiWatch requires reference per part (no cross-contamination)
- [x] Bug 3: price-research WTB detection — buyers counted from raw_message

### Documentation
- [x] README.md: full architecture, all endpoints, P0 fixes, live test commands
- [x] WatchFacts_Executive_Summary.docx: 8-section Word document

---

## STEP 1 — SHARED PARSER (Phase 1: Extract canonical parser)
**Priority: P0 | Effort: 1h**

Currently THREE parsers exist with different bugs:
- api/ingest.js: COMPLETE (all fixes applied)
- api/green-api-webhook.js: BROKEN (8 gaps, no dual-write, no LLM)
- api/telegram-ingest.js: BROKEN (own parser, no dual-write)

**Fix:** Extract parseFull(), parsePrice(), verdict(), splitMultiWatch(),
isYearLike(), isReferenceNumber(), isKaratContext(), brand aliases
from api/ingest.js → api/_lib/parser.js

Then import in all three endpoints. One parser, one set of fixes.

---

## STEP 2 — FIX GREEN API WEBHOOK
**Priority: P0 | Effort: 30m**

After Step 1 is done:
- [ ] Import shared parser from _lib/parser.js
- [ ] Replace parseWatchMessage() with shared parseFull()
- [ ] Remove duplicate parsePrice/parseBrand/parseCurrency/parseWatchMessage
- [ ] Add dual-write to watch_records (copy ingest.js lines 676-707)
- [ ] Add Supabase dedup check before watch_records write
- [ ] Keep Green API payload unwrapping (messageData extraction)

---

## STEP 3 — FIX TELEGRAM INGEST
**Priority: P0 | Effort: 30m**

Same treatment:
- [ ] Import shared parser
- [ ] Replace duplicate code
- [ ] Add dual-write to watch_records

---

## STEP 4 — GREEN API POLLING BACKUP
**Priority: P1 | Effort: 1h**

Build api/green-api-poll.js:
- [ ] Cron every 60s: call Green API receiveNotification
- [ ] Parse through shared parser
- [ ] Dual-write to live_ingest + watch_records
- [ ] Safety net for webhook failures
- [ ] Needs: GREEN_API_ID_INSTANCE, GREEN_API_API_TOKEN env vars

---

## STEP 5 — GREEN API BACKFILL
**Priority: P1 | Effort: 30m**

Build api/green-api-backfill.js:
- [ ] One-time call: GetChatHistory for each group
- [ ] Process last 500 messages through shared parser
- [ ] Dedup: skip already in watch_records
- [ ] Needs: GREEN_API_ID_INSTANCE, GREEN_API_API_TOKEN

---

## REMAINING BUGS (from CTO audit)

### Bug 4 — Broken /buy/all permalinks
**Priority: P2 | Effort: 30m (quick fix) or 3h (proper page)**

PriceResearch.tsx line 246 links to non-existent /buy/all route.
Quick fix: redirect to /price-research?ref=...
Proper fix: create BuyPage.tsx with filtered listings

### Bug 5 — Year as price (additional safety)
**Priority: P2 | Effort: 30m**

Add explicit year-vs-price guard in parseFull() between year extraction
and priceRaw assignment. Current P0 guard handles most cases but edge
cases with "2023 HKD102k" format need extra safety.

### Bug 6 — Misleading "58% accuracy" label
**Priority: P2 | Effort: 1h**

useWatchData.ts:451 reports auto-approval rate as "accuracy."
Rename to "CONFIDENCE PASS RATE" or "AUTO-APPROVE RATE."
Remove fake hardcoded trend indicators in StatsBar.tsx.

---

## BLOCKED / NEEDS CREDENTIALS

### Image Verification
- [ ] Move Gemini Vision to client-side browser SDK (Vercel 60s timeout blocker)
- [ ] OR: browser-use external worker pattern
- **Blocks:** Cannot auto-verify watch authenticity from photos

### Telegram Bot
- [ ] Needs TELEGRAM_BOT_TOKEN env var
- [ ] Disable privacy mode in @BotFather
- **Blocks:** No Telegram group ingestion

### WhatsApp Listener (Green API)
- [ ] Needs: GREEN_API_ID_INSTANCE, GREEN_API_API_TOKEN
- [ ] User must scan QR code to activate WhatsApp instance
- [ ] Join dealer groups (manual or invite links)
- **Blocks:** No WhatsApp group ingestion

---

## INFRASTRUCTURE NOTES

### Capacity (current limits)
- Vercel Hobby: 100 GB-h/month, 100 GB bandwidth, 60s max function
- Supabase Pro: 8 GB database (currently ~1.2 GB used)
- Current records: 2.39M watch_records + 4,281 live_ingest
  
### Green API volume estimates
- 10 groups:   ~2,000 msg/day  → 0.1 GB-h/day  (Hobby: fine)
- 50 groups:  ~10,000 msg/day  → 0.5 GB-h/day  (Hobby: fine)
- 600 groups: ~120,000 msg/day → 6.0 GB-h/day  (Hobby: would need Pro)

### LLM bottleneck
- DeepSeek ~8s per call, only fires on confidence < 70
- At 10K/day with 30% needing LLM = 3,000 calls = 6.7 hours LLM time
- Solution: skip LLM for high-volume Green API messages, regex-only mode

---

## Files Modified Today
- api/ingest.js: P0-A/B/C fixes, Bug 1 LLM guard, Bug 2 split validation
- api/online-search.js: P0-D GET support
- api/price-research.js: Bug 3 WTB demand detection
- README.md: full documentation
- WatchFacts_Executive_Summary.docx: Word document
