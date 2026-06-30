# WatchFacts Production Database Audit & Architecture Report
**Date:** June 30, 2026
**Prepared by:** Senior Developer & Data Analyst
**Database:** 161.35.0.209:3306 (DigitalOcean)
**Engine:** MySQL (8 databases, 335 tables)

---

## EXECUTIVE SUMMARY

The WatchFacts production database contains **1,206,011 auctions** ingested primarily from WhatsApp (99.98%). The system has a sophisticated architecture (Laravel backend, Angular frontend, multi-database design, queue jobs, market analytics) but is being crippled by **data quality failures at the ingestion layer**. 

**The single most destructive problem:** 284,431 listings (23.6%) have prices under $100 because dealer prices in HKD are being stored as raw numbers without currency normalization. A watch listed as "HKD 118K" is being stored as $118.

---

## 1. DATABASE SCHEMA MAP

### 8 Databases, Layered Architecture

| Database | Purpose | Key Tables | Scale |
|---|---|---|---|
| `thecollective` | App core (users, companies, payments) | 63 tables | ~300K users |
| `thecollective_catalogs` | Watch knowledge base | brands (360), references (73K), models (2K), dial_colors (807) | Reference data |
| `thecollective_inventory` | **THE MAIN DATABASE** | auctions (1.2M), market_references (100K), normalization_rules (51K), master_catalog (2.2K), exceptions (188K), indicators (4.2M) | Heart of the system |
| `thecollective_products` | Product/inventory management | watches (55K), variants (361K), online_prices (1.6M) | Price guide layer |
| `thecollective_scraping` | Chrono24/eBay scrapers | watches (74K) | External data |
| `watchfacts_live` | Legacy/live platform | master_models (18K), price_check (48K) | Legacy support |
| `watchfacts_platforms_feeds` | Platform feeds | tbl_references (11K), tbl_brands (214) | Cross-platform sync |
| `wf_sterling` | WatchFacts Sterling (reporting) | watch (9.4K), report (10K), GIA data | Inspection reports |

---

## 2. CRITICAL DATA HEALTH FINDINGS

### 2.1 THE PRICE CATASTROPHE (Critical Priority)

| Price Range | Count | % of Total |
|---|---|---|
| **$0 (no price)** | 255,552 | 21.2% |
| **$0.01 - $99 (JUNK)** | 284,431 | 23.6% |
| $100 - $1K | 18,427 | 1.5% |
| $1K - $5K | 65,708 | 5.4% |
| $5K - $10K | 85,228 | 7.1% |
| $10K - $25K | 222,731 | 18.5% |
| $25K - $50K | 137,428 | 11.4% |
| $50K - $100K | 139,521 | 11.6% |
| $100K - $250K | 142,953 | 11.9% |
| $250K - $500K | 66,932 | 5.6% |
| $500K - $1M | 28,888 | 2.4% |
| $1M+ | 13,767 | 1.1% |

**Root Cause:** Dealer messages like "🌟126500 white 6/2026 HKD 283K" are being parsed where "HKD 283K" should become $36,300 USD (at ~7.8 HKD/USD), but instead the number 283 or sometimes a fractional part like 46.21 (from WhatsApp message positioning) gets stored as the price.

**Evidence:**
- `124060 - 41mm Submariner` stored at **$1.00**
- `126711CHNR rootbeer GMT (2026) BRAND NEW` stored at **$21.80**
- `126334 White Stick Datejust` stored at **$12.20**
- `126508 green n6 687k` stored at **$46.21** (this is the 687K HKD = ~$88K watch)

**Impact:** This poisons every downstream average, outlier detection, price guide, and market indicator.

### 2.2 THE IDENTIFICATION CRISIS

| Status | Count | % |
|---|---|---|
| Identified (is_identified=1) | 786,229 | 65.2% |
| **NOT identified** | **419,782** | **34.8%** |

| identification_status | Count |
|---|---|
| NULL (never processed) | 933,296 |
| misidentified | 150,803 |
| identified | 121,344 |
| processing | 558 |
| rejected | 10 |

**419,782 auctions** (over a third) have no brand, reference, or dial color extracted. 933,296 have NULL identification_status — meaning the identification pipeline never even attempted to classify them.

### 2.3 EXTRACTION PIPELINE FAILURE

The `auction_exceptions` table shows how listings flow through the triage system:

| Method | Total | Approved | Pending | Approval Rate |
|---|---|---|---|---|
| **regex** | 171,934 | 34,052 | **133,252** | **19.8%** |
| **ai** | 16,200 | 2,022 | **13,798** | **12.5%** |
| **nickname** | 64 | 63 | 1 | **98.4%** |

**Findings:**
- Regex-based extraction has a **77.5% stuck rate** — 133,252 items sitting in pending, never approved
- AI-based extraction is even worse at **85.2% stuck rate**
- Nickname matching has 98.4% success but is barely used (64 items vs 171K regex)
- **147,050 items are stuck in PENDING** — this is the human-review backlog and nobody is clearing it

### 2.4 CURRENCY & BRAND CLASSIFICATION ERRORS

**Brand misclassification** — Model names stored as brands:
- "Datejust" appears as a brand with 5,541 listings
- "Day-date" appears as a brand with 2,091 listings
- These should be models under "Rolex"

**Average price anomalies** revealing data corruption:
- Tudor avg: **$1,823,988** (should be ~$5K-$15K)
- TAG Heuer avg: **$493,381** (should be ~$3K-$10K)
- These are caused by currency conversion failures inflating prices

### 2.5 DUPLICATE PROBLEM

- **136,624 duplicate title hashes** found
- Top duplicate: `Rolex 126598RBOW black $25` appears **359 times** (the $25 is the currency bug)
- Same watch listing posted by multiple dealers across different WhatsApp groups

### 2.6 MISSING CRITICAL FIELDS

| Gap | Count |
|---|---|
| Has raw ref but NO normalized ref | 24,742 |
| Has ref but NO dial_color | 65,535 |
| No brand extracted at all | 440,437 |

---

## 3. MASTER CATALOG ASSESSMENT

### Current State
| Metric | Value |
|---|---|
| Master catalog entries | 2,205 |
| Distinct references | 755 |
| Brands covered | 10 |
| Normalization rules | 51,071 |
| Distinct normalized refs (from rules) | 756 |

### Available Catalog Resources (Underutilized)
| Source | Records | Status |
|---|---|---|
| `thecollective_catalogs.references` | 73,164 | Exists but NOT used for matching |
| `thecollective_catalogs.brands` | 360 | Only 10 brands in master_catalog |
| `thecollective_catalogs.models` | 2,037 | Exists |
| `thecollective_catalogs.watch_dial_colors` | 807 | Exists but NOT used for matching |
| `watchfacts_live.master_models` | 18,656 | Exists, separate system |
| `watchfacts_platforms_feeds.tbl_references` | 11,100 | Exists, separate system |

**Gap:** The master catalog has 755 references. The full catalog tables have 73,164 references. **The system is using less than 1.5% of its available reference data for matching.**

---

## 4. THE ANALYTICS LAYER (What Already Exists)

The `market_reference_indicators` table (4,189,550 rows) is a sophisticated analytics engine that already computes:

- **Time windows:** daily, weekly, monthly aggregations
- **Per reference + dial_color + region + condition:** granular tracking
- **Demand metrics:** sale_count, search_count, demand_score, supply_score, delta
- **Liquidity:** wtb_fs_ratio (want-to-buy / for-sale ratio), liquidity_score
- **Price trends:** min/avg/max prices for recent vs previous blocks, price_drift_pct

**This is excellent infrastructure that already exists.** The problem is not that the analytics are missing — it's that the input data feeding them is 45% garbage.

---

## 5. EVALUATION OF THE GEMINI STRATEGY PROPOSAL

### What the Gemini Strategy Gets Right

| Recommendation | Verdict | Notes |
|---|---|---|
| Deterministic filtering first | ✅ Correct principle | System already has this (regex) |
| Tiered approval (auto/AI/human/trash) | ✅ Correct architecture | System already has this structure |
| content_hash for deduplication | ✅ Correct | System already has title_hash |
| Human-in-the-loop feedback loop | ✅ Correct | System already has exception queue |
| Structured JSON output from AI | ✅ Correct | Good practice |
| Confidence scoring thresholds | ✅ Correct principle | System has identification_status |

### What the Gemini Strategy Gets Wrong (Critical Gaps)

| Recommendation | Problem |
|---|---|
| "Use Typesense/Elasticsearch + PostgreSQL" | **WRONG.** They already have MySQL with 4.2M indicator rows. Migrating to PostgreSQL+ES is a 3-month project that solves nothing. The data quality problem exists BEFORE the database layer. |
| "Use Gemini 1.5 Pro for vision extraction" | **PARTIALLY WRONG.** Only some data is images. 99.98% comes from WhatsApp TEXT. The text parsing is the actual bottleneck, not vision. Vision is secondary. |
| "Stop parsing, start reconciling" | **MISLEADING.** They already HAVE a reconciliation system (normalization_rules, exception workflow). The problem isn't the architecture — it's that the regex parser has bugs and the exception queue has 147K uncleared items. |
| "3-sigma auto-approve for prices" | **DANGEROUS.** With 284K listings under $100, the 3-sigma range is so wide it would auto-approve garbage. You must fix the currency conversion FIRST, then establish sigma bands. |
| "Build a Splitter Agent" | **REDUNDANT.** The system already segments by message. The splitter works. |
| "Idempotency via content_hash" | **ALREADY EXISTS.** title_hash field is present. 136K duplicates still exist because the dedup logic isn't enforced on insert. |

### What the Gemini Strategy Completely Misses

1. **The $0-$100 price catastrophe (284K listings)** — Not mentioned at all
2. **Currency normalization (HKD → USD)** — Not mentioned at all
3. **The 147K-item exception backlog** — Not mentioned at all
4. **Brand misclassification (Datejust as brand)** — Not mentioned
5. **Master catalog only has 755 refs vs 73K available** — Not mentioned
6. **Regex parser has specific known bugs** — Not mentioned
7. **The existing market_reference_indicators analytics engine** — Not mentioned (they already have what Gemini suggests building)
8. **WhatsApp is 99.98% of data, not images** — Strategy assumes 60% images, which is false

### Overall Grade: C+

The Gemini strategy is a **generic AI-architecture whitepaper** that describes a pipeline pattern. It is technically sound in principle but written by someone who never looked at the actual database. It would send the developer on a 3-month infrastructure migration (PostgreSQL, Typesense, Gemini vision) while the real problems — currency bugs, parser bugs, exception backlog, catalog underutilization — would remain unfixed.

---

## 6. RECOMMENDED ACTION PLAN (Reality-Based)

### Phase 1: FIX THE DATA (Weeks 1-2) — Zero new infrastructure needed

**1.1 Currency Normalization (CRITICAL)**
- Build a price normalizer that detects HKD, $, emoji-prices, K/M multipliers
- Convert all to USD at ingestion time using exchange_rates table (already exists, 166 rows)
- Retroactively fix 284K corrupted prices via batch UPDATE

**1.2 Fix Regex Parser Bugs (from prior audit)**
- AP ref truncation at dots (26240OR → 2624)
- $-price-to-ref confusion ($25 stored as ref)
- Bare price → assumed USD instead of HKD
- Multi-watch price bleed (price from line N assigned to line N+1)
- Confidence scoring too aggressive (ALL → RECYCLE)

**1.3 Clear the Exception Backlog**
- 147,050 pending items need batch processing
- Auto-approve items where normalized_reference matches master_catalog
- Auto-reject items where brand=NULL AND reference=NULL (true garbage)

**1.4 Fix Brand Classification**
- "Datejust", "Day-date", "Daytona" → reclassify as Rolex models
- Build brand→model hierarchy from thecollective_catalogs (360 brands, 2K models)

### Phase 2: EXPAND THE CATALOG (Weeks 2-3)

**2.1 Populate Master Catalog from Existing Data**
- Import from `thecollective_catalogs.references` (73K refs available)
- Import from `watchfacts_live.master_models` (18K models)
- Import from `watchfacts_platforms_feeds.tbl_references` (11K refs)
- Target: 10,000+ master_catalog entries (from current 755)

**2.2 Build Dial Color Dictionary**
- Map the 807 entries in `watch_dial_colors` to dealer shorthand
- "Blk" → "Black", "Cho" → "Chocolate", "Champ" → "Champagne"
- "Wim" → "Wimbledon", "Burple" → custom mapping

### Phase 3: IMPROVE MATCHING (Weeks 3-4)

**3.1 Fuzzy Reference Matching**
- Implement Levenshtein distance for ref matching (12671O vs 126710)
- Build brand-specific ref pattern extractors (Rolex 6-digit, Patek collection/case, AP fused)

**3.2 Expand Nickname Matching**
- Current: 64 items, 98.4% success rate
- This is the highest-performing extraction method and it's barely used
- Build nickname dictionary: Pepsi, Batman, Hulk, Daytona, Root Beer, Destro, Pikachu

### Phase 4: ANALYTICS & REPORTING (Weeks 4-6) — What the user actually needs

**4.1 Price Outlier Detection**
- Per-reference 3-sigma bands (AFTER currency fix)
- Flag listings where price > 2x or < 0.5x the 30-day average
- The `market_reference_indicators` table already has min/avg/max — use it

**4.2 Duplicate Detection**
- Enforce title_hash uniqueness on insert
- Build fuzzy duplicate detection (same ref + similar price within 5% + same dealer within 7 days)

**4.3 Graphics & Reports**
- Brand distribution charts
- Price trend lines per reference
- Dealer activity heatmaps
- Identification rate funnel (total → identified → normalized → catalog-matched)
- Market indicators dashboard (demand/supply/liquidity scores)

---

## 7. INFRASTRUCTURE NOTES

### What NOT to Change
- **Do NOT migrate to PostgreSQL.** MySQL is handling 4.2M analytics rows fine. The problem is data quality, not the database engine.
- **Do NOT build a new frontend.** The Angular admin panel is mature and functional.
- **Do NOT replace the Laravel backend.** The queue/job architecture is sound.

### What TO Add (Later)
- **Read replica** for analytics queries (offload reporting from the write DB)
- **Materialized views** or scheduled aggregation jobs for common report queries
- **Elasticsearch** ONLY for the public search experience (not for the ingestion pipeline)
- **Redis** for caching hot reference lookups during ingestion

---

## APPENDIX A: Database Connection Details
```
Host: 161.35.0.209
Port: 3306
User: john
Password: [REDACTED]
Databases: 8 (see schema map above)
```

## APPENDIX B: Key Table Sizes
```
auctions:                    1,206,011 rows
auction_watches:             1,162,680 rows  
market_reference_indicators: 4,189,550 rows
auction_exceptions:            188,198 rows
normalization_rules:           51,071 rows
master_catalog:                 2,205 rows
catalogs.references:           73,164 rows
```

## APPENDIX C: Sample Problem Queries

```sql
-- Find currency-corrupted prices
SELECT * FROM auctions 
WHERE price > 0 AND price < 100 
ORDER BY created_on DESC LIMIT 50;

-- Find stuck exceptions
SELECT * FROM auction_exceptions 
WHERE status = 'pending' 
ORDER BY created_at ASC LIMIT 100;

-- Find duplicate listings
SELECT brand, reference, dial_color, price, COUNT(*) as cnt
FROM auctions
WHERE reference IS NOT NULL AND price > 0
GROUP BY brand, reference, dial_color, price
HAVING cnt > 5
ORDER BY cnt DESC;

-- Brand misclassification
SELECT brand, COUNT(*) FROM auctions 
WHERE brand IN ('Datejust', 'Day-date', 'Daytona', 'Submariner')
GROUP BY brand;
```

---

**Bottom Line:** The Gemini strategy describes the right PATTERN but diagnoses the wrong DISEASE. The system doesn't need new infrastructure — it needs its existing pipeline fixed. Fix the currency bug (284K listings), clear the exception backlog (147K items), expand the master catalog (755 → 10K+), and the analytics already in place will produce trustworthy reports.
