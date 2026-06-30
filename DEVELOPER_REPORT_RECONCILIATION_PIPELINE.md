# Developer Report: From Parser to Reconciliation Pipeline
**Date:** July 1, 2026
**Subject:** Gap Analysis & Implementation Roadmap for Executive Action Plan
**Current System:** WatchFacts React Platform (github.com/Pablodd1/wf)
**Scale:** 2,392,784 listings | Parser v3.1 | Supabase PostgreSQL

---

## EXECUTIVE SUMMARY

Our current system is a **Parser** (regex-based extraction with hardcoded rules). The Executive Action Plan requires a **Reconciliation Engine** (catalog-validated, AI-triaged, human-corrected, statistically-governed).

**Current Architecture:**
```
WhatsApp/Telegram Message -> Parser v3.1 (regex) -> confidence_score -> verdict
                                                          |
                                              APPROVED / REVIEW / HUMAN / RECYCLE
```

**Required Architecture:**
```
Incoming Data (text/image)
    |
    v
[Triage Layer] ---|---> Deterministic Match (80%) ---> Catalog Validator ---> 3-sigma Price Check ---> AUTO-APPROVE
                  |
                  |---> Unmatched/Ambiguous (20%) ---> VLLM (Gemini) ---> confidence >= 0.90? ---|---> YES: Auto-Approve
                                                                                                |
                                                                                                |---> NO: Human Review
                                                                                                         |
                                                                                                         v
                                                                                              [Correction Dashboard]
                                                                                                         |
                                                                                                         v
                                                                                              [Few-Shot Learning Loop]
                                                                                                         |
                                                                                                         v
                                                                                              [Weekly Prompt Update]
```

**Gap Severity:** 12 critical gaps identified across 4 phases.

---

## PHASE 1: INGESTION TRIAGE — GAP ANALYSIS

### 1.1 Deterministic Filtering (80% Auto-Approve) — CRITICAL GAP

**What the plan requires:**
- Regex scanner for reference numbers against a Master Catalog
- If reference exists in catalog AND price within 3-sigma of 30-day market data -> Auto-Approve
- Zero LLM cost for this tier

**What we currently have:**
- `api/_lib/parser.js` — regex-based extraction of brand, reference, price, dial, condition, year
- `verdict()` function — thresholds at 85% (APPROVED), 70% (REVIEW), 50% (HUMAN), <50% (RECYCLE)
- **NO Master Catalog validation** — references are extracted but never verified against known-good list
- **NO 3-sigma price validation** — price is extracted but never compared to market data
- **NO tiered approval** — single-pass scoring, no separation of "catalog match" vs "AI-extracted"

**Current verdict logic (parser.js:744-748):**
```javascript
if (c >= APPROVE_THRESHOLD) return 'APPROVED';   // 85% -- no catalog check
if (c >= HUMAN_THRESHOLD) return 'REVIEW';       // 70%
if (c >= 50) return 'HUMAN';                     // 50%
return 'RECYCLE';                                // <50%
```

**What's missing:**

| Component | Status | Effort | File |
|-----------|--------|--------|------|
| Master Catalog table | **NOT EXISTS** | 2 days | New: `master_catalog` |
| Reference validator | **NOT EXISTS** | 1 day | `api/_lib/catalogValidator.js` |
| 3-sigma price checker | **NOT EXISTS** | 2 days | `api/_lib/priceStats.js` |
| Tiered approval engine | **NOT EXISTS** | 2 days | Modify `api/_lib/parser.js` |
| Content hash (idempotency) | **NOT EXISTS** | 1 day | Add column to `watch_records` |

**Proposed Master Catalog schema:**
```sql
CREATE TABLE master_catalog (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  brand TEXT NOT NULL,
  model TEXT NOT NULL,
  reference TEXT NOT NULL UNIQUE,
  dial_colors TEXT[],           -- ['Black', 'Blue', 'White']
  nicknames TEXT[],             -- ['Pepsi', 'Hulk', 'Batman']
  retail_price_usd NUMERIC,
  market_price_low NUMERIC,
  market_price_high NUMERIC,
  category TEXT,                -- 'Dress', 'Diver', 'Chronograph'
  material TEXT,                -- 'Steel', 'Gold', 'Ceramic'
  bracelet TEXT,                -- 'Oyster', 'Jubilee', 'Leather'
  case_size_mm INTEGER,
  movement TEXT,
  water_resistance TEXT,
  image_url TEXT,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Price history for 3-sigma calculations
CREATE TABLE price_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  catalog_reference_id UUID REFERENCES master_catalog(id),
  price_usd NUMERIC NOT NULL,
  dial_color TEXT,
  condition TEXT,
  source TEXT,                   -- 'dealer', 'auction', 'private'
  recorded_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for 3-sigma queries
CREATE INDEX idx_price_history_ref_recorded 
  ON price_history(catalog_reference_id, recorded_at DESC);
```

**Proposed 3-sigma price validator:**
```javascript
// api/_lib/priceStats.js
async function validatePriceAgainstMarket(reference, priceUsd, dialColor = null) {
  // Get last 30 days of price history for this reference
  const stats = await supabase.rpc('get_price_stats', {
    p_reference: reference,
    p_dial_color: dialColor,
    p_days: 30
  });
  
  if (!stats || stats.count < 5) return { valid: true, reason: 'insufficient_data' };
  
  const mean = stats.avg;
  const stdDev = stats.stddev;
  const threeSigma = 3 * stdDev;
  
  const isWithinRange = priceUsd >= (mean - threeSigma) && priceUsd <= (mean + threeSigma);
  
  return {
    valid: isWithinRange,
    mean,
    stdDev,
    threeSigmaLower: mean - threeSigma,
    threeSigmaUpper: mean + threeSigma,
    sampleSize: stats.count,
    reason: isWithinRange ? 'within_3sigma' : 'price_outlier'
  };
}
```

---

### 1.2 AI-Triage (20% Remainder) — CRITICAL GAP

**What the plan requires:**
- Unmatched/ambiguous items go to VLLM (Vision-Language Model)
- Confidence threshold: < 0.90 -> Human Review
- Only process what deterministic filtering can't handle

**What we currently have:**
- **NO VLLM integration** — zero AI/LLM in the pipeline
- **NO vision processing** — can't handle image-based dealer posts
- All messages go through regex parser, regardless of complexity
- No separation of "easy deterministic" vs "hard ambiguous"

**Current data sources (from `watch_records.source`):**
```
whatsapp  -> text messages
telegram  -> text messages  
email     -> text messages
manual    -> manual entry
```

**What's needed:**

| Component | Status | Effort | Notes |
|-----------|--------|--------|-------|
| VLLM integration (Gemini 1.5 Pro) | **NOT EXISTS** | 3 days | Google AI Studio API |
| Image preprocessing | **NOT EXISTS** | 2 days | Screenshot cleaning, OCR |
| Structured JSON output handler | **NOT EXISTS** | 1 day | Schema validation |
| Cost tracking per request | **NOT EXISTS** | 1 day | Monitor AI spend |

**Proposed VLLM prompt schema:**
```javascript
const VLLM_PROMPT = `
You are a luxury watch data extraction expert. Analyze this dealer message/image 
and extract structured data. Return ONLY a JSON object with this exact schema:

{
  "watches": [
    {
      "brand": string | null,        // e.g., "Rolex", "Patek Philippe"
      "model": string | null,        // e.g., "Daytona", "Nautilus"
      "reference": string | null,    // e.g., "126500LN", "5711/1A-010"
      "dial_color": string | null,   // e.g., "Black", "Panda"
      "bracelet": string | null,     // e.g., "Oyster", "Jubilee"
      "year": number | null,
      "condition": string | null,    // "New", "BNIB", "Excellent", etc.
      "price": number | null,
      "currency": string | null,     // "USD", "HKD", "EUR"
      "box_papers": boolean | null,
      "confidence": number,          // 0.0 to 1.0
      "listing_type": "WTS" | "WTB" | "WTT"
    }
  ],
  "confidence": number,             // Overall confidence 0.0-1.0
  "unmatched_text": string[]        // Text that couldn't be parsed
}

Rules:
- If you CANNOT identify the reference number, set it to null. Do NOT guess.
- If multiple watches are in the message, return multiple objects.
- Confidence < 0.90 means human review is needed.
`;
```

---

## PHASE 2: NORMALIZATION PIPELINE — GAP ANALYSIS

### 2.1 Bundle Segmentation (Splitter Agent) — MEDIUM GAP

**What the plan requires:**
- Dealer posts with 30 watches must be split into individual transactions
- Treat `\n` or emoji (🌟) as separators

**What we currently have:**
```javascript
// api/_lib/parser.js:175-183
function splitMultiWatch(text) {
  if (!text) return [''];
  const parts = text
    .split(/(?:\s*\/\/\s*|\s*\|\s*|\s*\\\s*)/)
    .map(p => p.trim())
    .filter(p => p.length > 0);
  return parts.length > 0 ? parts : [text.trim()];
}
```
- Only splits on `//` `|` and `\`
- **Does NOT handle**: Newline separation, emoji separation, numbered lists

**Required enhancement:**
```javascript
function splitMultiWatch(text) {
  if (!text) return [''];
  
  const separators = [
    /\s*\/\/\s*/,           // "//"
    /\s*\|\s*/,             // "|"
    /\s*\\\s*/,             // "\"
    /\n(?=\d+[:.)\s])/,     // "1. " "2) " "3. " at line start
    /\n(?=[🌟⭐🔥💎])/,      // Emoji item markers
    /\n(?=[A-Z][a-z]+\s*\d{4,6})/,  // Brand + reference at line start
    /\n{2,}/,                // Double newlines (paragraph breaks)
  ];
  
  let parts = [text];
  for (const sep of separators) {
    parts = parts.flatMap(p => p.split(sep)).map(p => p.trim());
  }
  
  return parts.filter(p => p.length > 10 && /\d/.test(p));
}
```

---

### 2.2 Semantic Reconciliation — CRITICAL GAP

**What the plan requires:**
- Compare AI-extracted dial, year, bracelet against Master Catalog
- If AI says "Rolex 126233" but dial description doesn't match known dial codes -> **REJECT**

**What we currently have:**
- `inferDialFromRef(ref)` — infers dial from reference suffix (e.g., "5711/1A" -> "blue")
- **NO catalog cross-reference** — extracted dial is never validated against known-valid dials for that reference
- **NO bracelet extraction** — not in our parser at all
- **NO rejection on catalog mismatch** — data goes to DB regardless

**Current parser output (parser.js:837-848):**
```javascript
return {
  brand: finalBrand,      // extracted brand
  ref,                    // extracted reference
  dial,                   // extracted dial -- NOT validated against catalog
  condition,
  year,
  price,                  // extracted price -- NOT validated against market
  currency,
  confidence,             // regex-based score -- NOT catalog-based
  fieldConfidence,        // per-field scores
  listingType,
  accessories,
};
```

**What's needed:**
```javascript
// After extraction, BEFORE saving:
const catalogMatch = await validateAgainstCatalog({
  brand: finalBrand,
  reference: ref,
  dialColor: dial,
  bracelet: extractedBracelet,
  year: year
});

if (catalogMatch.found) {
  // Validate each field against catalog
  const dialValid = catalogMatch.validDialColors.includes(dial);
  const refValid = catalogMatch.reference === ref;
  
  if (!dialValid) {
    flags |= ExceptionFlags.DIAL_MISMATCH;
    tier = 'HUMAN_REVIEW';
  }
}
```

---

## PHASE 3: HUMAN-IN-THE-LOOP — GAP ANALYSIS

### 3.1 Correction Dashboard — CRITICAL GAP

**What the plan requires:**
- Human reviews AI extraction errors
- Makes corrections (e.g., "126508" -> "126503")
- Corrections feed back into the system

**What we currently have:**
- `src/pages/AdminPage.tsx` — has a Review tab but limited functionality
- **NO correction workflow** — humans can view but can't easily correct
- **NO correction tracking** — no database of "what AI got wrong -> what human fixed"
- `human_edited` boolean field exists but no structured correction log

**Current Admin Review tab capabilities:**
- View listings by verdict (APPROVED, REVIEW, HUMAN, RECYCLE)
- Basic stats bar
- **Missing**: Edit fields inline, submit corrections, track correction history

**Required database additions:**
```sql
-- Correction tracking
CREATE TABLE correction_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  watch_record_id UUID REFERENCES watch_records(id),
  -- Original (AI/parser extracted)
  original_brand TEXT,
  original_model TEXT,
  original_reference TEXT,
  original_dial_color TEXT,
  original_price_usd NUMERIC,
  -- Corrected (human reviewed)
  corrected_brand TEXT,
  corrected_model TEXT,
  corrected_reference TEXT,
  corrected_dial_color TEXT,
  corrected_price_usd NUMERIC,
  -- Metadata
  corrected_by TEXT,           -- user_id or 'system'
  correction_reason TEXT,      -- 'ai_error', 'dealer_typo', 'catalog_update'
  exception_flags INTEGER,     -- bitwise flags (from ExceptionFlags system)
  reviewed_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Few-shot examples for prompt improvement
CREATE TABLE few_shot_examples (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  raw_message TEXT NOT NULL,
  ai_extraction JSONB,         -- what the AI extracted
  human_correction JSONB,      -- what human corrected it to
  category TEXT,               -- 'reference_error', 'brand_mismatch', 'price_error'
  is_active BOOLEAN DEFAULT true,
  usage_count INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

---

### 3.2 Few-Shot Learning Loop — CRITICAL GAP

**What the plan requires:**
- Weekly: take 50 AI-vs-Human corrections
- Update System Prompt with new examples
- AI learns dealer-specific quirks ("Cho" = Chocolate, "Jub" = Jubilee)

**What we currently have:**
- **NO few-shot system** — parser is static code, never learns
- **NO weekly update process** — no automation for prompt improvement
- **NO dealer-specific adaptation** — every dealer processed with same rules

**Implementation needed:**
```javascript
// api/_lib/promptUpdater.js
async function generateWeeklyPromptUpdate() {
  // 1. Fetch top 50 corrections from last 7 days
  const corrections = await supabase
    .from('correction_log')
    .select('*')
    .gte('reviewed_at', new Date(Date.now() - 7 * 86400000).toISOString())
    .order('reviewed_at', { ascending: false })
    .limit(50);
  
  // 2. Categorize by error type
  const examples = corrections.map(c => ({
    raw: c.original_raw_message,
    wrong: { brand: c.original_brand, ref: c.original_reference },
    correct: { brand: c.corrected_brand, ref: c.corrected_reference },
    reason: c.correction_reason
  }));
  
  // 3. Update VLLM system prompt with new examples
  const updatedPrompt = VLLM_PROMPT + `\n\nRecent corrections to learn from:\n` +
    examples.map(e => `Input: "${e.raw}"\nWrong: ${JSON.stringify(e.wrong)}\nCorrect: ${JSON.stringify(e.correct)}`).join('\n\n');
  
  // 4. Save to settings
  await saveSystemPrompt(updatedPrompt);
}
```

---

## PHASE 4: DATA ENGINEERING — GAP ANALYSIS

### 4.1 Search-First Engine (Typesense/Elasticsearch) — CRITICAL GAP

**What the plan requires:**
- Search-first engine (Typesense or Elasticsearch) backed by PostgreSQL
- For 2.4M listings, standard SQL search is too slow

**What we currently have:**
- Supabase PostgreSQL with PostgREST API
- Basic `ilike` text search on `raw_message`
- **NO full-text search index** — searches scan entire table
- **NO fuzzy matching** — "Patek" won't find "Patek Phillipe" (typo)
- **NO faceted search** — can't filter by brand + price range + condition simultaneously with good performance

**Current search (AdminPage.tsx):**
```javascript
// Basic PostgREST search
`${SUPABASE_URL}/rest/v1/watch_records?raw_message=ilike.*${query}*&limit=50`
```

**Benchmark concern:**
- `ilike` on 2.39M rows with `%query%` pattern = **full table scan**
- Estimated time: 2-8 seconds per search
- At 10 searches/minute = database overload

**Solution options:**

| Option | Cost | Effort | Pros | Cons |
|--------|------|--------|------|------|
| **Typesense Cloud** | $29/mo (starter) | 2 days | Fast, typo-tolerant, faceted, easy API | Another vendor |
| **Supabase Full-Text** | Free | 1 day | No new vendor, built-in | Less flexible, no fuzzy |
| **Elasticsearch** | $0 (self-hosted on DO) | 5 days | Most powerful, self-hosted | High maintenance |
| **Meilisearch** | $0 (self-hosted) | 3 days | Fast, typo-tolerant, open-source | Another service to manage |

**Recommended:** Typesense Cloud (managed) or Meilisearch on Digital Ocean

```sql
-- If using Supabase Full-Text (intermediate solution):
CREATE INDEX idx_watch_records_fts ON watch_records 
  USING gin(to_tsvector('english', brand || ' ' || COALESCE(reference, '') || ' ' || COALESCE(raw_message, '')));

-- Query:
SELECT * FROM watch_records 
WHERE to_tsvector('english', brand || ' ' || COALESCE(reference, '') || ' ' || COALESCE(raw_message, '')) 
      @@ plainto_tsquery('english', 'Rolex Daytona');
```

---

### 4.2 Idempotency (Content Hash) — MEDIUM GAP

**What the plan requires:**
- Every incoming message has a `content_hash` (MD5 of text + timestamp)
- Duplicate hash = ignore (prevent double-ingestion)

**What we currently have:**
- `hashMessage()` function exists in parser.js (MD5-based)
- **NOT used for deduplication** — only used for internal tracking
- **NO unique constraint** on content hash in database
- Same dealer list can be ingested multiple times

**Current hash function (unused for dedup):**
```javascript
function hashMessage(raw) {
  return _createHash(raw);
}
```

**Required changes:**
```sql
-- Add content_hash column
ALTER TABLE watch_records ADD COLUMN content_hash TEXT;
ALTER TABLE watch_records ADD COLUMN source_message_id TEXT; -- WhatsApp message ID

-- Prevent duplicates
CREATE UNIQUE INDEX idx_watch_records_content_hash 
  ON watch_records(content_hash) 
  WHERE content_hash IS NOT NULL;

-- Also track source message ID for replay protection
CREATE UNIQUE INDEX idx_watch_records_source_id 
  ON watch_records(source_message_id) 
  WHERE source_message_id IS NOT NULL;
```

---

### 4.3 Health Monitor — MEDIUM GAP

**What the plan requires:**
- Real-time dashboard showing "Normalization Success Rate"
- Alert if rate drops below 95%

**What we currently have:**
- `src/pages/HealthPage.tsx` — basic service checks (DB, parser, Green API)
- **NO normalization success rate metric**
- **NO automated alerting**
- **NO degradation detection**

**Required metrics:**
```javascript
// api/_lib/metrics.js
async function calculateNormalizationMetrics(timeRange = '1h') {
  const results = await supabase.rpc('get_normalization_metrics', { 
    p_time_range: timeRange 
  });
  
  return {
    totalProcessed: results.total,
    autoApproved: results.auto_approved,      // Tier 1 + Tier 2
    humanReviewed: results.human_reviewed,    // Tier 3
    rejected: results.rejected,               // Tier 4 (trash)
    successRate: results.auto_approved / results.total * 100,
    avgProcessingTimeMs: results.avg_time,
    aiCostPerListing: results.ai_cost / results.total,
    exceptionFlagBreakdown: results.flag_breakdown
  };
}

// Alert if success rate < 95%
if (metrics.successRate < 95) {
  await sendAlert({
    severity: 'warning',
    message: `Normalization success rate dropped to ${metrics.successRate.toFixed(1)}%`,
    action: 'Review recent corrections and update extraction rules'
  });
}
```

---

## COMPLETE GAP SUMMARY TABLE

### Phase 1: Ingestion Triage

| # | Component | Current | Required | Gap | Effort | Priority |
|---|-----------|---------|----------|-----|--------|----------|
| 1.1 | Master Catalog | None | `master_catalog` table with reference validation | **CRITICAL** | 3 days | P0 |
| 1.2 | 3-sigma Price Check | None | Statistical validation against 30-day history | **CRITICAL** | 2 days | P0 |
| 1.3 | Tiered Approval | Single threshold (85%) | 4 tiers: Catalog Match / AI High / Human / Trash | **CRITICAL** | 2 days | P0 |
| 1.4 | Content Hash (idempotency) | Function exists, unused | DB unique constraint + skip logic | **MEDIUM** | 1 day | P1 |
| 1.5 | VLLM Integration | None | Gemini 1.5 Pro API for vision + text | **CRITICAL** | 3 days | P0 |
| 1.6 | Image Preprocessing | None | Screenshot cleaning, crop, OCR prep | **MEDIUM** | 2 days | P1 |

### Phase 2: Normalization Pipeline

| # | Component | Current | Required | Gap | Effort | Priority |
|---|-----------|---------|----------|-----|--------|----------|
| 2.1 | Bundle Splitter | `//` `|` `\` only | Newline, emoji, numbered list support | **MEDIUM** | 1 day | P1 |
| 2.2 | Semantic Reconciliation | None | Cross-validate against Master Catalog | **CRITICAL** | 3 days | P0 |
| 2.3 | Bracelet Extraction | None | Extract bracelet type from text | **LOW** | 1 day | P2 |
| 2.4 | JSON Schema Output | Ad-hoc object | Structured schema with null safety | **MEDIUM** | 1 day | P1 |

### Phase 3: Human-in-the-Loop

| # | Component | Current | Required | Gap | Effort | Priority |
|---|-----------|---------|----------|-----|--------|----------|
| 3.1 | Correction Dashboard | View-only | Inline edit + submit corrections | **CRITICAL** | 3 days | P0 |
| 3.2 | Correction Log Table | None | `correction_log` table | **CRITICAL** | 1 day | P0 |
| 3.3 | Exception Flags System | None | Bitwise flags (8 types from wf-admin) | **CRITICAL** | 2 days | P0 |
| 3.4 | Few-Shot Examples Table | None | `few_shot_examples` table | **MEDIUM** | 1 day | P1 |
| 3.5 | Weekly Prompt Update | None | Automated prompt improvement job | **MEDIUM** | 2 days | P1 |
| 3.6 | Nickname Tracking | None | `confirmed_nickname` field | **LOW** | 0.5 day | P2 |

### Phase 4: Data Engineering

| # | Component | Current | Required | Gap | Effort | Priority |
|---|-----------|---------|----------|-----|--------|----------|
| 4.1 | Search Engine | PostgREST `ilike` | Typesense/Meilisearch full-text | **CRITICAL** | 3 days | P0 |
| 4.2 | FTS Index | None | GIN index on brand+reference+message | **MEDIUM** | 0.5 day | P1 |
| 4.3 | Health Metrics | Basic uptime | Normalization success rate + alerting | **MEDIUM** | 2 days | P1 |
| 4.4 | Price History Table | None | `price_history` for 3-sigma calc | **CRITICAL** | 1 day | P0 |
| 4.5 | Duplicate Detection | None | Content hash unique constraint | **MEDIUM** | 0.5 day | P1 |

---

## RECOMMENDED IMPLEMENTATION ORDER

### Sprint 1 (Week 1): Foundation — "Stop Parsing, Start Validating"
1. Create `master_catalog` table (seed with top 500 references)
2. Create `price_history` table (backfill from existing data)
3. Build `catalogValidator.js` (reference lookup + dial validation)
4. Build `priceStats.js` (3-sigma calculator)
5. Add `content_hash` column with unique index

### Sprint 2 (Week 2): Triage Engine
6. Implement Tiered Approval (4 tiers)
7. Refactor parser.js to use catalog validation before scoring
8. Integrate exception flags system (from wf-admin analysis)
9. Update database schema with new fields

### Sprint 3 (Week 3): AI Integration
10. Set up Gemini 1.5 Pro API key
11. Build VLLM wrapper with structured JSON output
12. Implement image preprocessing pipeline
13. Connect VLLM to "unmatched" triage path

### Sprint 4 (Week 4): Human Review
14. Build correction dashboard (inline editing)
15. Create `correction_log` table
16. Wire correction -> catalog update pipeline
17. Add correction tracking to Admin UI

### Sprint 5 (Week 5): Search + Polish
18. Deploy Typesense or Meilisearch (on Digital Ocean)
19. Index 2.39M records
20. Replace `ilike` search with search engine
21. Build normalization success rate dashboard
22. Add automated alerting

### Sprint 6 (Week 6): Learning Loop
23. Create `few_shot_examples` table
24. Build weekly prompt update job
25. Implement nickname tracking
26. Full system integration test

**Total Effort:** 6 weeks (1 senior developer)
**Total Cost:** ~$100-200/mo (Typesense + Gemini API)
**Expected Outcome:** 80% auto-approve rate, <5% AI hallucination, 95%+ normalization accuracy

---

## FILES TO CREATE/MODIFY

### New Files (15)
```
api/_lib/catalogValidator.js       <- Reference lookup against master_catalog
api/_lib/priceStats.js              <- 3-sigma price validation
api/_lib/triageEngine.js            <- Tiered approval logic
api/_lib/vllmClient.js              <- Gemini 1.5 Pro API wrapper
api/_lib/imagePreprocessor.js       <- Screenshot cleaning/OCR prep
api/_lib/exceptionFlags.js          <- Bitwise error classification (port from PHP)
api/_lib/promptUpdater.js           <- Weekly few-shot prompt update
api/_lib/metrics.js                 <- Normalization success tracking

src/pages/CorrectionDashboard.tsx   <- Human review + correction UI
src/components/CorrectionCard.tsx   <- Inline correction component

supabase/migrations/001_master_catalog.sql
supabase/migrations/002_price_history.sql
supabase/migrations/003_correction_log.sql
supabase/migrations/004_few_shot_examples.sql
supabase/migrations/005_content_hash.sql
```

### Modified Files (8)
```
api/_lib/parser.js                  <- Add catalog validation, tiered approval
api/batch-parse.js                  <- Integrate triage engine
src/pages/AdminPage.tsx             <- Add correction dashboard tab
src/pages/HealthPage.tsx            <- Add normalization success metrics
src/pages/TradingFloor.tsx          <- Replace ilike with search engine
src/lib/referenceValidator.ts       <- Add catalog cross-reference
database types (supabase)           <- Add new columns
vercel.json env vars                <- Add GEMINI_API_KEY
```

---

## COST ESTIMATE

| Item | Monthly Cost | Notes |
|------|-------------|-------|
| Typesense Cloud (Starter) | $29 | 100K documents, sufficient for 2.39M |
| Gemini 1.5 Pro API | $50-150 | Depends on volume. ~20% of messages = ~480K requests/mo |
| Supabase (current) | $0-25 | May need Pro tier for FTS + connection pool |
| Digital Ocean (Meilisearch alt) | $12-24 | Droplet for self-hosted search |
| **Total** | **$91-228/mo** | vs current: ~$0-25/mo |

---

## RISK ASSESSMENT

| Risk | Probability | Impact | Mitigation |
|------|------------|--------|------------|
| Gemini API cost exceeds budget | Medium | High | Start with flash model (cheaper), upgrade only if needed |
| Master Catalog incomplete | High | Medium | Seed from existing 2.39M data + manual curation top 500 refs |
| Typesense indexing 2.39M records slow | Low | Medium | Batch indexing (1K chunks), run during low-traffic hours |
| Correction dashboard adoption low | Medium | Medium | Make it the default view for admin users, track KPIs |
| Digital Ocean vs Vercel latency | Medium | Medium | Use DO for search/workers only, keep Vercel for frontend |

---

## DEPENDENCIES

| Requirement | Status | Action |
|-------------|--------|--------|
| Gemini 1.5 Pro API key | **NEEDED** | Get from Google AI Studio (free tier: 1500 req/day) |
| Master Catalog data source | **NEEDED** | Extract from existing 2.39M records OR get from wf-admin |
| Typesense/Meilisearch cluster | **NEEDED** | Sign up for Typesense Cloud OR deploy on DO |
| Digital Ocean droplet (optional) | **AVAILABLE** | You mentioned having DO — use for Meilisearch or worker |

---

*Report prepared July 1, 2026. Ready for developer assignment.*
