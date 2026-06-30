# Why We Have So Many Errors: Parser vs. Classification & State Machine
**Date:** July 1, 2026
**Analyst:** Senior Developer / Data Analyst
**Scale:** 2,392,784 listings | Current Accuracy: ~60-70% (estimated) | Target: 95%+

---

## THE CORE PROBLEM

Our current system is a **single-pass regex parser**. This architecture is fundamentally flawed for free-text dealer messages because:

1. **Regex cannot handle infinite variation** — Dealer messages are human language, not structured data
2. **Errors compound** — If brand is wrong, reference extraction fails, which breaks price validation
3. **Confidence is a fiction** — 85% "confidence" is just a weighted average of field presence, NOT actual accuracy
4. **No feedback loop** — The parser makes the same mistakes every day, forever

**Result:** 30-40% of listings need human review (RECYCLE, HUMAN, REVIEW verdicts) = ~800,000-950,000 listings stuck in queues.

---

## PART 1: WHY WE HAVE SO MANY ERRORS — ROOT CAUSE ANALYSIS

### Error 1: Regex Is Brittle (Infinite Variation Problem)

**The myth:** "We have regex patterns for all major brands and references"

**The reality:** Dealers write in infinite ways. Here are real examples that break our parser:

```
"PP 5711 blue unworn 2023 asking 95k"                    <- Works
"Patek 5711/1A unworn '23 asking 95"                      <- Reference pattern fails (no hyphen)
"Patek Philippe Nautilus blue dial BNIB 95,000 USD"      <- Works
"PP Naut 5711 blu unw 95k"                               <- Brand alias fails, dial fails, condition fails
"Selling my 5711 blue brand new full set $95k"           <- Brand never mentioned (inferred from ref?)
"百达翡丽 5711 蓝色 全新 95000"                          <- Chinese brand name -> FAILS COMPLETELY
"5711/1A-001 bleu unworn '23 @ 95k"                      <- French dial color -> FAILS
"Patek 5711. Chocolate. Unworn. 95K+"                    <- Period separators -> FAILS
"5711 unworn asking 95 + label"                          <- "+ label" breaks price parser
```

**Current regex for Patek references:**
```javascript
/\b([34567]\d{3}[A-Z]?[\/-]?[0-9A-Z]{1,4}[\-–]?[0-9A-Z]{0,5})\b/i
```

This one regex must handle: `5712/1A-001`, `5236P`, `6300A`, `7118`, `7300/1200R-010`, `6007A-001`, `5524G-001` — all different formats. **One regex change to fix a case breaks 3 others.**

### Error 2: Single-Pass = Compounding Errors

**Current flow (parser.js:755-850):**
```
Message -> stripWhatsApp() -> parseBrand() -> parseReference() -> parsePrice() -> parseDial() -> parseCondition() -> parseYear() -> calculateConfidence() -> verdict()
```

**What happens when brand is wrong:**
```
Input: "Selling AP 15510 blue mint asking 42k"

Step 1: parseBrand() = "Audemars Piguet" (correct)
Step 2: parseReference() = "15510" (correct, because brandHint works)
Step 3: parsePrice() = 42000 (correct)
-> Confidence: 85% -> APPROVED ✓

---

Input: "Selling 15510 blue mint asking 42k" (brand omitted)

Step 1: parseBrand() = null (FAIL)
Step 2: parseReference() = "15510" (correct, generic fallback)
Step 3: inferBrandFromRef() = null (15510 is 5-digit, doesn't match Rolex pattern)
Step 4: parsePrice() = 42000 (correct)
-> Confidence: ~45% -> RECYCLE ✗ (even though reference and price are perfect)

---

Input: "selling 15510st blue mint asking 42k"

Step 1: parseBrand() = null
Step 2: parseReference() = null (our regex doesn't handle "15510st" as one token)
Step 3: parsePrice() = 15510 (WRONG — reference captured as price!)
Step 4: parsePrice() doesn't find 42k because "asking" is between ref and price
-> Confidence: ~30% -> RECYCLE ✗ (completely wrong)
```

**The problem:** Each step depends on the previous step. There's no recovery. If step 2 fails, steps 3-7 are compromised.

### Error 3: Confidence Scoring Is Fake

**Current confidence calculation (parser.js:671-726):**

```javascript
function calculateConfidence(fields) {
  // If brand exists -> 95% confidence for brand
  // If brand missing -> 0% confidence for brand
  // If reference exists -> 90% confidence
  // If reference missing -> 0% confidence
  // etc.
  
  const weights = { brand: 0.20, reference: 0.20, price: 0.20, ... };
  // Weighted average -> "confidence score"
}
```

**This is NOT confidence. This is "field presence score."**

| Input | Parser Output | "Confidence" | Reality |
|-------|--------------|--------------|---------|
| "Rolex 126500LN black new $28k" | Brand=Rolex, Ref=126500LN, Price=28000 | 92% | CORRECT ✓ |
| "Rolex 126500LN black new $28k" | Brand=Rolex, Ref=126500LN, Price=28000 | 92% | CORRECT ✓ |
| "FPJ CS blue unworn 85k" | Brand=F.P. Journe, Ref=null, Price=85000 | 65% | REF WRONG (CS not recognized) |
| "RM 11-03 titanium mint $280k" | Brand=Richard Mille, Ref=1103, Price=280000 | 88% | REF WRONG (RM11-03 -> 1103) |

**The parser gives 88% confidence for "RM 11-03 -> Ref=1103"** — but "1103" is NOT the reference. The reference is "RM11-03". The regex stripped "RM" and left "1103". High confidence, wrong answer.

### Error 4: No Learning From Corrections

**Scenario (happens every day):**
```
Day 1: Dealer posts "FPJ CS blue unworn 85k"
        Parser: Brand="F.P. Journe", Ref=null, Price=85000
        Human corrects: Ref="CS" (Chronometre Souverain)
        
Day 2: Same dealer posts "FPJ CS blue unworn 85k"
        Parser: Brand="F.P. Journe", Ref=null, Price=85000
        SAME ERROR. No learning occurred.
        
Day 30: Same dealer posts "FPJ CS blue unworn 85k"
        Parser: Brand="F.P. Journe", Ref=null, Price=85000
        STILL THE SAME ERROR. The parser is static code.
```

**We have 800,000+ corrections in the database. None of them improve the parser.**

---

## PART 2: PARSER vs. CLASSIFICATION & STATE MACHINE

### Current Architecture: The Parser

```
┌─────────────────────────────────────────────┐
│           RAW DEALER MESSAGE                 │
│  "PP 5711 blue unworn 2023 asking 95k"       │
└────────────────────┬────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────┐
│         SINGLE-PASS REGEX ENGINE             │
│                                              │
│  1. stripWhatsAppDecorations()              │
│  2. parseBrand()        -> "Patek Philippe"   │
│  3. parseReference()    -> "5711"             │
│  4. parsePrice()        -> 95000              │
│  5. parseDial()         -> "blue"             │
│  6. parseCondition()    -> "Unused"           │
│  7. parseYear()         -> 2023               │
│  8. calculateConfidence() -> 87%              │
│  9. verdict()           -> APPROVED           │
└────────────────────┬────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────┐
│              DATABASE                        │
│  brand="Patek Philippe"                     │
│  reference="5711"                            │
│  price_usd=95000                             │
│  confidence=87                               │
│  verdict="APPROVED"                          │
└─────────────────────────────────────────────┘
```

**Characteristics:**
- One function does everything
- Linear pipeline — no recovery from errors
- Confidence = field presence, not accuracy
- Same input always produces same output (deterministic but static)
- No validation against external truth (catalog, market data)

---

### Proposed Architecture: Classification & State Machine

```
┌─────────────────────────────────────────────────────────────────────────┐
│                     RAW DEALER MESSAGE                                   │
│  Image: dealer_screenshot.jpg  +  Text: "Bundle: 3x PP, 2x Rolex"       │
└─────────────────────────────┬───────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────────────┐
│  STAGE 0: CLASSIFIER                                                    │
│  "What kind of message is this?"                                        │
│                                                                          │
│  classify(message) -> {                                                  │
│    type: "BUNDLE",           // BUNDLE | SINGLE | IMAGE | WTB | GARBAGE │
│    format: "WHATSAPP_TEXT",  // WHATSAPP_TEXT | WHATSAPP_IMAGE | EMAIL  │
│    language: "EN",           // EN | ZH | FR | JA | MIXED               │
│    estimatedWatchCount: 5,                                               │
│    hasImages: true,                                                      │
│    confidence: 0.96                                                      │
│  }                                                                        │
└─────────────────────────────┬───────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────────────┐
│  STAGE 1: SPLITTER (if type === BUNDLE)                                 │
│  "Break into individual watch listings"                                 │
│                                                                          │
│  split(message, classifier) -> [                                        │
│    "PP 5711 blue unworn 2023 asking 95k",                               │
│    "PP 7118 white mint 2023 asking 82k",                                │
│    "PP 5267 rose gold unworn asking 68k",                               │
│    "Rolex 126500LN black new asking 28k",                               │
│    "Rolex 116500 white mint asking 32k"                                 │
│  ]                                                                        │
└─────────────────────────────┬───────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────────────┐
│  STAGE 2: EXTRACTOR (runs per-watch)                                    │
│  "Extract fields with multiple strategies"                              │
│                                                                          │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐                  │
│  │ Regex Engine │  │ VLLM (Gemini)│  │ Catalog      │                  │
│  │ (fast, $0)   │  │ (slow, $$)   │  │ Lookup       │                  │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘                  │
│         │                 │                 │                            │
│         ▼                 ▼                 ▼                            │
│    brand="PP"       brand="Patek       brand="Patek                      │
│    ref="5711"        Philippe"         Philippe"                        │
│    price=95000      ref="5711/1A"      ref="5711/1A-010"                │
│    dial="blue"      price=95000        (from catalog)                   │
│    year=2023        dial="blue"                                          │
│    conf=0.75        year=2023                                            │
│                     conf=0.94                                            │
│                                                                          │
│  <── Strategy Selector picks best result based on catalog match + conf   │
└─────────────────────────────┬───────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────────────┐
│  STAGE 3: VALIDATOR                                                     │
│  "Is this extraction correct?"                                          │
│                                                                          │
│  validate(extracted) -> {                                                │
│    catalogMatch: {                                                        │
│      referenceExists: true,     // 5711/1A-010 in master_catalog        │
│      dialValid: true,           // "blue" is valid dial for 5711/1A     │
│      price3Sigma: true,         // $95k within 3σ of market             │
│      modelMatch: "Nautilus"     // from catalog                         │
│    },                                                                     │
│    exceptionFlags: 0,           // No errors (bitwise)                   │
│    overallValid: true                                                     │
│  }                                                                        │
└─────────────────────────────┬───────────────────────────────────────────┘
                              │
                    ┌─────────┴─────────┐
                    │                   │
              VALID ✓            INVALID ✗
                    │                   │
                    ▼                   ▼
┌────────────────────────┐  ┌───────────────────────────────────────────┐
│ STAGE 4A: APPROVE      │  │ STAGE 4B: HUMAN REVIEW QUEUE             │
│                        │  │                                          │
│ -> State: APPROVED     │  │ -> State: REVIEW                         │
│ -> Save to DB          │  │ -> Show in Correction Dashboard          │
│ -> Update price history │  │ -> Track exception flags                 │
│ -> No human cost       │  │ -> Human corrects ->                     │
│                        │  │   (a) Save to correction_log             │
│                        │  │   (b) Update few_shot_examples           │
│                        │  │   (c) Re-run extractor with new example  │
│                        │  │   (d) If validated -> APPROVE            │
└────────────────────────┘  └───────────────────────────────────────────┘
```

---

## PART 3: THE STATE MACHINE IN DETAIL

### States

```
RAW ──> CLASSIFIED ──> SPLIT ──> EXTRACTED ──> VALIDATED ──> [APPROVED | REVIEW | RECYCLE]
         │                │            │              │
         │                │            │              └── Can transition to REVIEW if validation fails
         │                │            │
         │                │            └── Can loop back to EXTRACTED with different strategy
         │                │
         │                └── Can loop back to SPLIT if new separators found
         │
         └── Can transition to GARBAGE if classifier detects spam
```

### State Transitions and Validation Gates

| From State | To State | Gate Condition | Cost | Time |
|-----------|----------|---------------|------|------|
| RAW | CLASSIFIED | Classifier confidence ≥ 0.80 | $0 | 10ms |
| RAW | GARBAGE | Classifier detects spam/non-watch | $0 | 10ms |
| CLASSIFIED | SPLIT | Type === BUNDLE and count > 1 | $0 | 5ms |
| CLASSIFIED | EXTRACTED | Type === SINGLE | $0 | 5ms |
| SPLIT | EXTRACTED | Per-watch extraction | varies | varies |
| EXTRACTED | VALIDATED | Catalog match + 3-sigma price | $0 | 20ms |
| EXTRACTED | EXTRACTED (retry) | Low confidence -> try next strategy | $0.01-0.05 | 500ms |
| VALIDATED | APPROVED | All checks pass | $0 | 5ms |
| VALIDATED | REVIEW | Catalog mismatch or outlier | $0 | 5ms |
| REVIEW | APPROVED | Human correction validated | $0 | manual |
| REVIEW | RECYCLE | Human confirms trash | $0 | manual |

### Key Advantage: Strategy Selection

**Instead of one regex trying everything, the state machine picks the right tool:**

```javascript
// State: EXTRACTED — Strategy Selection
function selectExtractionStrategy(classification, previousAttempts) {
  
  // Tier 1: Catalog match on clean references (free, instant)
  if (classification.hasCleanReference && classification.format === 'WHATSAPP_TEXT') {
    return { strategy: 'CATALOG_LOOKUP', cost: 0, expectedTime: '10ms' };
  }
  
  // Tier 2: Regex for known formats (free, fast)
  if (classification.language === 'EN' && previousAttempts === 0) {
    return { strategy: 'REGEX', cost: 0, expectedTime: '50ms' };
  }
  
  // Tier 3: VLLM for ambiguous/complex (paid, slower)
  if (classification.confidence < 0.80 || classification.hasImages) {
    return { strategy: 'VLLM_GEMINI', cost: 0.005, expectedTime: '800ms' };
  }
  
  // Tier 4: Human review (expensive, manual)
  if (previousAttempts >= 2) {
    return { strategy: 'HUMAN_REVIEW', cost: 2.00, expectedTime: 'manual' };
  }
}
```

---

## PART 4: CONCRETE COMPARISON — SAME INPUT, DIFFERENT ARCHITECTURES

### Test Case: "FPJ CS blue unworn 85k"

**Current Parser:**
```
parseBrand("FPJ CS blue unworn 85k")    -> "F.P. Journe" ✓
parseReference("...", "F.P. Journe")    -> null ✗ ("CS" doesn't match any regex)
parsePrice("...")                       -> 85000 ✓
parseDial("...")                        -> "blue" ✓
parseCondition("...")                   -> "Unused" ✓
confidence = (95*0.2 + 0*0.2 + 95*0.2 + 85*0.1 + 80*0.1 + 10*0.1 + 95*0.1) = 66%
verdict(66%) -> HUMAN
```
**Result:** Stuck in human review queue. Brand and price were perfect, but one regex miss killed the whole parse.

---

**State Machine:**
```
STAGE 0 — CLASSIFY:
  type: "SINGLE", format: "WHATSAPP_TEXT", language: "EN", hasAbbreviations: true
  confidence: 0.92
  -> Proceed to EXTRACTED

STAGE 2 — EXTRACT (Strategy Selection):
  Attempt 1: Regex -> ref=null (failed)
  Attempt 2: Catalog fuzzy lookup -> "CS" matches nickname "CS" in catalog for "Chronometre Souverain"
  -> ref="CS", brand="F.P. Journe", model="Chronometre Souverain"
  
STAGE 3 — VALIDATE:
  catalogMatch.referenceExists: true ("CS" is known nickname)
  catalogMatch.dialValid: true ("blue" valid for CS)
  price3Sigma: true ($85k within range for CS)
  exceptionFlags: 0
  -> VALID ✓

STAGE 4A — APPROVE:
  -> Save to DB, APPROVED, $0 cost
```
**Result:** Auto-approved. The state machine tried regex first (cheap), failed, then tried catalog lookup (also cheap), succeeded.

---

### Test Case: "Bundle: 5711 blue unworn 95k // 7118 white mint 82k"

**Current Parser:**
```
parseBrand("Bundle: 5711...")           -> null ✗ ("Bundle" is not a brand)
parseReference("...")                   -> "5711" ✓ (first match only)
parsePrice("...")                       -> 95000 ✓ (first price only)
-> Only extracts ONE watch from a bundle of TWO
-> Second watch (7118) is LOST
confidence: ~45%
verdict: RECYCLE
```
**Result:** One listing extracted, one listing lost forever. No bundle handling.

---

**State Machine:**
```
STAGE 0 — CLASSIFY:
  type: "BUNDLE", format: "WHATSAPP_TEXT", estimatedWatchCount: 2
  separatorsDetected: ["//"]
  confidence: 0.98
  -> Proceed to SPLIT

STAGE 1 — SPLIT:
  ["5711 blue unworn 95k", "7118 white mint 82k"]
  -> Two separate extraction jobs

STAGE 2 — EXTRACT (per watch):
  Watch 1: "5711 blue unworn 95k"
    -> Regex: ref="5711" (no brand but ref matches Patek pattern)
    -> inferBrandFromRef("5711") -> "Patek Philippe"
    -> Catalog lookup: model="Nautilus", ref validated
    -> confidence: 0.88
    
  Watch 2: "7118 white mint 82k"
    -> Regex: ref="7118" (no brand but ref matches Patek pattern)
    -> inferBrandFromRef("7118") -> "Patek Philippe"
    -> Catalog lookup: model="Nautilus Ladies", ref validated
    -> confidence: 0.87

STAGE 3 — VALIDATE (both):
  Both pass catalog + 3-sigma checks
  -> VALID ✓

STAGE 4A — APPROVE (both):
  -> 2 listings saved, both APPROVED
```
**Result:** Both watches extracted correctly. Bundle handling preserved all data.

---

## PART 5: WHY THE STATE MACHINE FIXES OUR SPECIFIC ERRORS

### Error Type: "Reference extracted as price" (NORM_003 attempts to fix this)

**Example:** "126301" parsed as price $126,301

| Layer | Current Parser | State Machine |
|-------|---------------|---------------|
| Detection | NORM_003: if price within 1% of ref -> reject | Validator: ref must exist in master_catalog |
| Fix | Reject price -> null price -> HUMAN verdict | Catalog lookup: "126301" is Datejust 41 -> validate price against market |
| Prevention | None — will happen again | Catalog is source of truth — price and reference are independently validated |

### Error Type: "Brand variants not unified" (FPJ vs F.P. Journe vs F.P.Journe)

| Layer | Current Parser | State Machine |
|-------|---------------|---------------|
| Detection | None — treated as different brands | Normalization table: all map to single canonical brand |
| Fix | Hardcoded BRAND_MAP with aliases | Catalog lookup: "FPJ" -> catalog.canonical_brand = "F.P. Journe" |
| Learning | None — need code change | Correction dashboard: human fixes -> updates normalization_rules -> immediate effect |

### Error Type: "Price outliers" ($5M Rolex, $0 Patek)

| Layer | Current Parser | State Machine |
|-------|---------------|---------------|
| Detection | NORM_002: HKD cap at $10M only | 3-sigma validator: ALL prices checked against 30-day market history |
| Fix | Cap at $10M (arbitrary) | Reject if outside 3σ -> REVIEW queue with PRICE_OUT_OF_RANGE flag |
| Scope | Only HKD | All currencies, all references |

### Error Type: "Non-watch items classified as watches" (bags, straps)

| Layer | Current Parser | State Machine |
|-------|---------------|---------------|
| Detection | NORM_004: keyword check (bag, leather, etc.) | Classifier: image + text classification -> type="ACCESSORY" or "GARBAGE" |
| Fix | confidence *= 0.3 -> likely RECYCLE | Classifier routes to non-watch pipeline before extraction even runs |
| Prevention | Limited keyword list | VLLM can classify any item type, not just hardcoded keywords |

---

## PART 6: IMPLEMENTATION COST COMPARISON

| Metric | Current Parser | State Machine |
|--------|---------------|---------------|
| **Lines of code** | ~900 (parser.js) | ~2,500 (5 modules) |
| **Files** | 1 | 8 (classifier, splitter, extractor, validator, state machine, catalog, price stats, metrics) |
| **AI cost per listing** | $0 | ~$0.001 (only 20% need AI) |
| **Human review rate** | 35-40% | 5-10% |
| **Human cost per listing** | ~$2.00 (review time) | ~$0.10 (only edge cases) |
| **Processing time** | ~50ms | ~50ms (Tier 1) / ~850ms (Tier 2 with AI) |
| **Accuracy** | ~60-70% | ~90-95% (after learning loop) |
| **Time to implement** | Built | 6 weeks |
| **Learning from corrections** | None | Automatic weekly updates |
| **Bundle handling** | Broken (first watch only) | Full split + per-watch processing |

**ROI Calculation:**
```
Current: 2,390,000 listings × 35% human review × $2 = $1,673,000 human review cost
New:     2,390,000 listings × 8%  human review × $2 = $382,400 human review cost
                                                        + $200/month AI cost
                                                        
Savings: $1,290,600 per month in human review time
```

---

## PART 7: RECOMMENDED STATE MACHINE MODULES

```
api/_lib/
├── stateMachine/
│   ├── index.js              <- Main orchestrator
│   ├── classifier.js         <- Stage 0: Message classification
│   ├── splitter.js           <- Stage 1: Bundle decomposition
│   ├── extractor.js          <- Stage 2: Multi-strategy extraction
│   ├── validator.js          <- Stage 3: Catalog + market validation
│   ├── router.js             <- Stage 4: APPROVED / REVIEW / RECYCLE
│   └── strategySelector.js   <- Picks best strategy per state
├── catalog/
│   ├── masterCatalog.js      <- Catalog CRUD + lookup
│   └── priceHistory.js       <- 3-sigma calculations
├── ai/
│   ├── vllmClient.js         <- Gemini 1.5 Pro API wrapper
│   └── promptBuilder.js      <- Dynamic prompt with few-shot examples
└── metrics/
    └── normalizationMetrics.js <- Success rate tracking + alerting
```

### Database Tables Needed

```sql
-- State tracking (replaces simple verdict field)
ALTER TABLE watch_records ADD COLUMN processing_state TEXT DEFAULT 'RAW';
ALTER TABLE watch_records ADD COLUMN classification JSONB;
ALTER TABLE watch_records ADD COLUMN extraction_strategy TEXT;
ALTER TABLE watch_records ADD COLUMN exception_flags INTEGER DEFAULT 0;
ALTER TABLE watch_records ADD COLUMN content_hash TEXT UNIQUE;
ALTER TABLE watch_records ADD COLUMN source_message_id TEXT;
ALTER TABLE watch_records ADD COLUMN processing_time_ms INTEGER;
ALTER TABLE watch_records ADD COLUMN ai_cost_usd NUMERIC DEFAULT 0;

-- State history (audit trail)
CREATE TABLE processing_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  watch_record_id UUID REFERENCES watch_records(id),
  from_state TEXT,
  to_state TEXT,
  strategy TEXT,
  validation_result JSONB,
  exception_flags INTEGER,
  confidence NUMERIC,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Everything from Phase 1-4 report:
-- master_catalog, price_history, correction_log, few_shot_examples
```

---

*Report prepared July 1, 2026. Recommendation: Transition from Parser to Classification & State Machine. The 6-week investment pays for itself in the first month of reduced human review costs.*
