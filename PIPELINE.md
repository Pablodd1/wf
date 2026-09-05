# WATCHFACTS CONFIDENCE PIPELINE — 85-90% TARGET

## CURRENT STATE (June 18, 2026)

| Metric | Value |
|--------|-------|
| Total Records | 117,744 |
| APPROVED (≥90%) | 39,694 (33.7%) |
| HUMAN (70-89%) | 45,850 (38.9%) |
| RECYCLE (<70%) | 32,200 (27.4%) |
| **Need Action** | **78,050 (66.3%)** |

---

## THE PIPELINE (7-Stage Cascade)

### STAGE 0: INPUT NORMALIZATION
**What:** Clean raw WhatsApp/Instagram messages before parsing
- Strip emojis (🔵 → mark as Patek hint)
- Normalize currency: "k" → 000, "m" → 000000, "1.83m" → 1830000
- Extract N5/2026 patterns → condition=New, year=2026
- Remove dealer fluff: "DM", "PM", "fast deal", "serious buyer only"

**Confidence Impact:** +5-10% base accuracy
**Status:** ✅ Partial (regex handles k/m, N5 patterns)

---

### STAGE 1: REGEX PARSE (Fast, Free)
**What:** Pattern matching for known formats
- Reference patterns: 5712/1A, 15400ST, RM07-01, 126334
- Price patterns: 850k HKD, 72k USD, 1.83m
- Brand from emoji: 🔵 = Patek, 🔴 = AP
- Brand from ref prefix: 5xxx = Patek, 1xxxx = Rolex, RM = Richard Mille

**Scoring:**
| Field Found | Points |
|-------------|--------|
| Reference | +40 |
| Brand | +25 |
| Price | +10 |
| Dial | +10 |
| Condition | +8 |
| Year | +4 |
| Currency | +3 |

**Thresholds:**
- ≥90 points → APPROVED
- 70-89 points → HUMAN
- <70 points → Continue to Stage 2

**Status:** ✅ Working in `/api/reprocess`
**Coverage:** ~40% of records hit ≥70 from regex alone

---

### STAGE 2: CATALOG LOOKUP (Instant, Free)
**What:** Match reference against known database
- `catalog.json` (177 Patek refs)
- `enriched_refs.json` (976 refs with liquidity data)
- Brand inference from ref patterns

**Boosts:**
- Ref found in catalog → +20 confidence
- Collection known → +10 confidence
- Liquidity score >50 → +5 confidence

**Status:** ✅ Working in `/api/catalog-lookup`
**Coverage:** 976 refs mapped, brand inference for Rolex/AP/RM/VC

---

### STAGE 3: WEB ENRICHMENT (8s timeout)
**What:** Query external sources for validation
- DuckDuckGo search: "5712/1A price 2024"
- Chrono24 scrape (blocked on Vercel)
- WatchCharts scrape (blocked on Vercel)
- Official brand URLs

**Boosts:**
- Web result confirms ref exists → +5 confidence
- Price found within 20% of listed → +5 confidence
- Official URL found → +3 confidence

**Status:** ⚠️ Partial — DuckDuckGo blocked, catalog fallback works
**Fix:** Use `/api/catalog-lookup` as primary, web as bonus

---

### STAGE 4: AI TEXT ANALYSIS (DeepSeek → Gemini → Kimi)
**What:** LLM extracts structured data from messy text
- DeepSeek primary (8s, $0.0007/1K tokens)
- Gemini fallback (9s, free tier)
- Kimi last resort (9s, $0.008/1K tokens)

**Batch mode:** Up to 20 records per API call
**Prompt includes:** Regex pre-parse results + raw message

**Boosts:**
- LLM finds ref regex missed → +15-30 confidence
- LLM confirms brand → +10 confidence
- LLM extracts dial from context → +8 confidence

**Status:** ✅ Working in `/api/reprocess`
**Cost:** ~$0.02 per 20 records batched

---

### STAGE 5: IMAGE VERIFICATION (Client-Side)
**What:** Vision AI reads watch photo independently
- Gemini Vision (browser SDK) — no server timeout
- Kimi Vision fallback
- Compares: brand, reference visible on dial, dial color

**Verdicts:**
- MATCH → +10 confidence
- MISMATCH → Route to HUMAN (critical flag)
- UNVERIFIED → No change

**Status:** ❌ Broken on serverless (60s timeout)
**Fix:** Move to client-side `/api/analyze-image` or browser SDK

---

### STAGE 6: HUMAN REVIEW (AI-Assisted)
**What:** Owner reviews low-confidence records with AI help
- Side-by-side: image + parsed fields
- AI suggestions: "Did you mean 5712/1A-010?"
- One-click: Approve / Edit / Recycle
- Keyboard shortcuts: A, E, R, N, P

**Status:** ✅ Working in `/#/review`
**Features:** Keyboard shortcuts, selection, help modal

---

### STAGE 7: CONTINUOUS LEARNING
**What:** Every human approval trains the system
- Approved edits → Add to catalog
- Common corrections → Update regex patterns
- Failed parses → Feed back to LLM prompt examples

**Status:** ❌ Not implemented
**Need:** Feedback loop from review UI to catalog

---

## CONFIDENCE MATH

### Current Pipeline (without image):
| Stage | Max Boost | Cumulative |
|-------|-----------|------------|
| Regex parse | 100 | 100 |
| Catalog lookup | +20 | 120 (capped at 100) |
| Web enrichment | +13 | 100 |
| AI analysis | +30 | 100 |
| **Total possible** | — | **100** |

### Target: 85-90% APPROVED Rate

**Current gate:**
- ≥90 = APPROVED (needs ref + brand)
- 70-89 = HUMAN
- <70 = RECYCLE

**Problem:** Too strict. 66% stuck in HUMAN/RECYCLE.

**Proposed new gate:**
- ≥85 = APPROVED (ref + brand + price)
- 70-84 = HUMAN (missing one field)
- 50-69 = AI REVIEW (send to image verification)
- <50 = RECYCLE

---

## BOTTLENECKS & FIXES

| # | Problem | Impact | Fix | Effort |
|---|---------|--------|-----|--------|
| 1 | Image verify timeout | Can't use vision | Move to client-side | 2h |
| 2 | Web search blocked | No price validation | Use catalog as primary | Done |
| 3 | Brand name inconsistency | 31k unknown | Normalize on ingest | 1h |
| 4 | No feedback loop | System doesn't learn | Save approvals to catalog | 2h |
| 5 | Missing 6-digit Rolex refs | 28k Rolex unmapped | Add Rolex catalog | 3h |
| 6 | Missing AP refs | 30k AP unmapped | Add AP catalog | 3h |
| 7 | No image in review UI | Can't verify visually | Add image preview | 2h |

---

## RECOMMENDED IMPLEMENTATION ORDER

### Phase A: Fix Critical (Week 1)
1. **Client-side image verify** — Fix timeout, enable vision pipeline
2. **Brand normalization** — "PATEK PHILIPPE" → "Patek Philippe" on ingest
3. **Lower APPROVE threshold** — 90 → 85 (with ref + brand + price required)

### Phase B: Expand Catalog (Week 2)
4. **Add Rolex references** — Map 6-digit refs to models
5. **Add AP references** — Map 15xxx/26xxx refs to models
6. **Feedback loop** — Human approvals auto-update catalog

### Phase C: Polish (Week 3)
7. **Image in review UI** — Side-by-side photo + fields
8. **Auto-reprocess** — Daily cron re-runs HUMAN records
9. **Price validation** — Flag outliers vs catalog averages

---

## ESTIMATED OUTCOME

| Scenario | APPROVED | HUMAN | RECYCLE |
|----------|----------|-------|---------|
| **Current** | 33.7% | 38.9% | 27.4% |
| After Phase A | 55% | 30% | 15% |
| After Phase B | 75% | 18% | 7% |
| After Phase C | **85%** | **10%** | **5%** |

---

## COST PROJECTION

| Stage | Per Record | 78k Records |
|-------|-----------|-------------|
| Regex + Catalog | Free | $0 |
| AI Batch (20/rec) | $0.001 | $78 |
| Image Verify | $0.003 | $234 |
| **Total** | | **~$312** |

---

## NEXT ACTION

Ready to implement **Phase A**:
1. Fix image verify (client-side)
2. Brand normalization
3. Lower approve threshold to 85

Say "go" to start.