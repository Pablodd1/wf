# Three-Way Comparison: What Each System Has
## Date: June 30, 2026

---

## THE THREE SYSTEMS

| # | System | Location | Stack | Role |
|---|--------|----------|-------|------|
| A | **Other Dev** (BitBucket) | `wfrepobitbucket/watchfacts-trade-wf-admin` | Laravel 12 + Angular | Admin panel — exception review, catalog management |
| B | **WF Prototype** (GitHub) | `~/wf/` → `Pablodd1/wf` | React 19 + Vite + Supabase + MySQL | Full web app + parser + WhatsApp ingestion |
| C | **State Machine** (proposed) | This document | Python FastAPI (proposed addition) | Context-aware extraction layer |

---

## FEATURE-BY-FEATURE COMPARISON

### Parser / Extraction Engine

| Feature | A: Other Dev (BitBucket) | B: WF Prototype (~/wf/) | C: State Machine (proposed) |
|---------|--------------------------|--------------------------|------------------------------|
| **Parser exists?** | ❌ NO — no parser code at all | ✅ YES — 894-line parser.js | ✅ YES — planned |
| **Approach** | N/A (parser is external "main service") | Single-pass regex per line | Context-tracked multi-state pipeline |
| **Context tracking** | ❌ No | ❌ No — each line parsed independently | ✅ YES — active_brand, active_currency, active_condition, model_cache |
| **Brand detection** | N/A | ✅ 29 brands with aliases | ✅ 12 brand-specific decoders with ref patterns |
| **Reference extraction** | N/A | ✅ 6 regex patterns, brand-hint ordering | ✅ Per-brand decoder patterns |
| **Dial color** | N/A | ✅ 13 colors + ref-suffix inference (BL→blue, BK→black) | ✅ Same approach |
| **Price parsing** | N/A | ✅ Multi-format: K/M suffixes, European commas, currency-attached | ✅ Same + HKD auto-detection from context |
| **Currency conversion** | N/A | ✅ 12 currencies with static rates | ✅ Same + exchange_rates table |
| **Multi-watch splitting** | N/A | ✅ Splits on //, \|, \\ | ✅ Same + double-newline + emoji markers |
| **HKD bug fix** | N/A | ⚠️ Partial — has conversion but no CONTEXT detection (can't tell if a bare number is HKD vs USD) | ✅ YES — ContextTracker knows dealer is HK-based |
| **Non-watch detection** | N/A | ✅ NORM_004 — filters bags, wallets | ✅ Same |
| **Price-vs-ref validation** | N/A | ✅ NORM_003 — rejects price = reference number | ✅ Same |
| **Listing overrides** | N/A | ✅ LISTING_OVERRIDES for known bad parses | ✅ Same |
| **Confidence scoring** | N/A | ✅ Weighted fields (brand 20%, ref 20%, price 20%, etc.) | ✅ Same approach |

### Routing / Verdict

| Feature | A: Other Dev | B: WF Prototype | C: State Machine |
|---------|-------------|-----------------|-------------------|
| **Auto-approve threshold** | N/A | ✅ 85%+ → APPROVED | ✅ 95%+ → Tier 1 auto |
| **Human review threshold** | N/A | ✅ 70-85% → REVIEW | ✅ 70-95% → Tier 2 AI check |
| **Low confidence** | N/A | ✅ 50-70% → HUMAN | ✅ <70% → Tier 3 human queue |
| **Reject** | N/A | ✅ <50% → RECYCLE | ✅ Tier 4 reject + log |
| **AI gap filling** | ❌ | ✅ gap-detector.js — AI fills missing fields | ✅ Same |

### WhatsApp Ingestion

| Feature | A: Other Dev | B: WF Prototype | C: State Machine |
|---------|-------------|-----------------|-------------------|
| **Green API webhook** | ✅ Has group config (3 instances) | ✅ green-api-webhook.js | ✅ Planned |
| **Baileys listener** | ❌ | ✅ whatsapp-listener/ (Baileys 7.0) | N/A (uses Green API) |
| **Image handling** | ❌ | ✅ Downloads + stores to DO Spaces | ✅ Same |

### Web Application

| Feature | A: Other Dev | B: WF Prototype | C: State Machine |
|---------|-------------|-----------------|-------------------|
| **Frontend** | ✅ Angular | ✅ React 19 (30+ pages) | ❌ (service only) |
| **Exception review UI** | ✅ Built | ✅ ReviewPage.tsx | ❌ |
| **Trading floor** | ❌ | ✅ TradingFloor.tsx | ❌ |
| **Analytics** | ❌ | ✅ AnalyticsPage.tsx + DemandSignals.tsx | ❌ |
| **Price research** | ❌ | ✅ PriceResearch.tsx | ❌ |
| **Bulk import** | ❌ | ✅ BulkImportPage.tsx | ❌ |
| **Export** | ❌ | ✅ ExportPage.tsx (Excel) | ❌ |
| **Admin panel** | ✅ | ✅ AdminPage.tsx | ❌ |
| **Health monitoring** | ❌ | ✅ HealthPage.tsx | ❌ |

### Database

| Feature | A: Other Dev | B: WF Prototype | C: State Machine |
|---------|-------------|-----------------|-------------------|
| **Primary DB** | MySQL (161.35.0.209) | MySQL + Supabase (dual) | Same MySQL |
| **Models** | ✅ Laravel Eloquent (8+ models) | ✅ Direct queries via db.js | ✅ Planned |
| **Exception system** | ✅ ExceptionFlags bitfield | ✅ confidence + verdict | ✅ Uses both |
| **Normalization rules** | ✅ 51K rules in auctions_normalization_rules | ✅ Reads same table | ✅ Same |

### Deployment

| Feature | A: Other Dev | B: WF Prototype | C: State Machine |
|---------|-------------|-----------------|-------------------|
| **Platform** | Traditional PHP hosting | Railway (migrated from Vercel) | Railway |
| **Dockerfile** | ❌ | ❌ (uses railway.json) | ✅ Planned |
| **Background workers** | ✅ Laravel queue | ✅ Planned in migration doc | ✅ Planned |

---

## THE CRITICAL GAP IN ALL THREE

### What's Missing: Context Tracking

Both the existing parser (B) and the other dev's system (A) parse **each line independently**. This is the root cause of:

1. **HKD bug** (284K listings): When a dealer header says "🇭🇰PP Ready in HK", the parser should know ALL subsequent prices are HKD. Without context, it stores HKD values as USD.

2. **Brand inheritance** (35% parse failures): When a header says "🍉🍉PP Used Full Set🍉🍉", every "5712G" line below should inherit brand=Patek Philippe. Without context, lines without an explicit brand name fail.

3. **Condition propagation**: "Full Set" in a header should apply to all listings in that block. Without context, each line must re-detect it.

4. **Model caching**: "5712G Nautilus" in line 1 should cache ref 5712→Nautilus. When line 3 says just "5712G", the model name is known. Without context, it's lost.

### The Fix: ContextTracker

The ContextTracker is a stateful object that processes each line and updates 4 variables:
- `active_brand` — set by emoji headers or brand name detection
- `active_currency` — set by HKD/EUR markers or dealer location
- `active_condition` — set by "Full Set"/"Watch Only" headers
- `model_cache` — learned from confirmed ref+model pairs

This is the ONE thing that neither existing system has, and it's what makes the state machine approach fundamentally better.

---

## WHAT TO DO: MERGE, NOT REBUILD

The WF prototype (B) already has 85% of what we need:
- ✅ Full parser (894 lines, 29 brands, 6 ref patterns, multi-currency)
- ✅ Gap detection + AI filling
- ✅ Confidence scoring + verdict routing
- ✅ WhatsApp ingestion (Baileys + Green API)
- ✅ Full React web app (30+ pages)
- ✅ MySQL + Supabase dual connection
- ✅ Railway deployment config
- ✅ HKD conversion rates

What it's missing:
- ❌ ContextTracker (the killer feature)
- ❌ Message-level segmentation (splitting dealer dumps before parsing)

**Action: Add ContextTracker + message segmentation to the existing parser.js, then push.**

This is a ~300-line addition, not a rebuild.

---

## SUMMARY TABLE

| | Other Dev (A) | WF Prototype (B) | State Machine (C) |
|---|---|---|---|
| **What it is** | Admin panel for reviewing exceptions | Full platform: parser + web app + WhatsApp | Proposed: context-aware extraction layer |
| **Has parser?** | ❌ No | ✅ Yes (894 lines) | ✅ Planned |
| **Has UI?** | ✅ Angular | ✅ React 19 | ❌ Service only |
| **Context tracking?** | ❌ | ❌ | ✅ KEY DIFFERENTIATOR |
| **Lines of code** | ~15K (Laravel + Angular) | ~8K (React + API) | ~1.5K (planned) |
| **Deploy** | Traditional hosting | Railway | Railway |
| **Status** | Production (exception review) | Prototype | Plan |
| **Best feature** | Exception bitfield system | Complete parser with confidence scoring | ContextTracker |
| **Worst gap** | No parser at all | No context tracking | Doesn't exist yet |

**VERDICT: The WF prototype (B) is the strongest base. Add the ContextTracker from (C) to it. Keep the other dev's admin panel (A) for exception review. Don't rebuild anything.**
