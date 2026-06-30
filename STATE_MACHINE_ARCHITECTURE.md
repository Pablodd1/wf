# WatchFacts: Parser → Classification & State Machine Architecture
**Date:** June 30, 2026
**For:** Development Team
**Based on:** Production data analysis (1,206,011 auctions, 8 databases)

---

## WHY A STATE MACHINE

The current system uses a **single-pass regex parser** that tries to extract all fields (brand, reference, dial color, price) from each line simultaneously. This fails because:

1. **Context is lost.** A line like `🌟5167A black 2012Y HKD514k` only makes sense if the parser knows the message header was `🍉🍉PP Used Full Set🍉🍉` (Patek Philippe). The current parser treats each line in isolation.

2. **State doesn't persist.** When a dealer writes `🌟5712G 2013Y HKD591k` followed by `🌟5712G 2014Y HKD616k`, the second line inherits brand=Patek, model=Nautilus, material=Gold from the first. The parser re-derives everything from scratch.

3. **Multiple fields per token.** `126233VI` encodes reference (126233) + dial variant (VI = grey). `5167/1A` encodes collection (5167) + strap variant (/1A). These aren't separate fields to extract — they're encoded composites that must be decoded against the catalog.

4. **Price is contextual.** `HKD 514k` means $65,900 USD. `💰57200` might mean $57,200 USD. The currency unit changes per dealer and sometimes per message. Without tracking which currency context is active, you get $514 stored instead of $65,900.

5. **1,038,280 individual listings are trapped** inside 200,420 messages that are longer than 1000 characters. These are multi-watch dealer dumps. They must be segmented before classification.

---

## THE STATE MACHINE: 7 STATES, 4 CONTEXT TRACKERS

### Architecture Overview

```
WhatsApp Message
       │
       ▼
┌──────────────────┐
│  S0: INTAKE      │  ← Raw message arrives
└──────┬───────────┘
       │
       ▼
┌──────────────────┐
│  S1: SEGMENT     │  ← Split into individual listing lines
│  (Splitter)      │
└──────┬───────────┘
       │
       ▼
┌──────────────────┐
│  S2: CLASSIFY    │  ← Brand + Reference + Material extraction
│  (Core Engine)   │
└──────┬───────────┘
       │
       ▼
┌──────────────────┐
│  S3: NORMALIZE   │  ← Canonical reference + dial color mapping
│  (Catalog Match) │
└──────┬───────────┘
       │
       ▼
┌──────────────────┐
│  S4: PRICE       │  ← Currency detection + conversion to USD
│  (Price Engine)  │
└──────┬───────────┘
       │
       ▼
┌──────────────────┐
│  S5: VALIDATE    │  ← Outlier check against market indicators
│  (Quality Gate)  │
└──────┬───────────┘
       │
       ▼
┌──────────────────┐
│  S6: ROUTE       │  → TIER 1: Auto-approve (catalog match + price valid)
│  (Decision)      │ → TIER 2: AI extraction (confidence < 0.90)
│                  │ → TIER 3: Human review (confidence < 0.50)
│                  │ → TIER 4: Reject (no watch identified)
└──────────────────┘
```

### The 4 Context Trackers (State that persists across lines within a message)

These are the key insight. Within a single dealer message, these values cascade from line to line:

```
ContextTracker {
    active_brand:        "Patek Philippe"  ← Set by header, inherited by all lines
    active_model:        "Nautilus"        ← Inferred from reference, cached
    active_currency:     "HKD"             ← Set by header or first price token
    active_condition:    "Used Full Set"   ← Set by header, overridden per-line
}
```

---

## STATE-BY-STATE SPECIFICATION

### S0: INTAKE

**Input:** Raw WhatsApp message (text block, possibly with images)

**Action:**
1. Compute `content_hash = MD5(message_text + sender_phone + timestamp)`
2. Check if `content_hash` already exists in `auctions.title_hash`
3. If duplicate → **SKIP entirely** (do not re-process)
4. If new → Store raw message, create parent auction record, proceed to S1

**Table:** `auctions` (parent record, `is_bundle = 1` if multi-line)

**Production evidence:** 136,624 duplicate title hashes exist because dedup is not enforced here.

---

### S1: SEGMENT (The Splitter)

**Input:** Raw message text

**Action:** Split the message into individual listing lines using these rules:

```
SEGMENTATION RULES (priority order):

1. SECTION BREAKS (emoji walls):
   🌼🌼🌼3️⃣0️⃣🔆0️⃣6️⃣🌼🌼🌼  →  Date marker, do NOT split here
   ─────────────────────────    →  Visual divider, split here
   
2. BRAND HEADERS (set context, don't create listing):
   🏆Patek Philippe New 📆in Hk    →  Set active_brand = "Patek Philippe"
   ⚜️PP Brand New Hk Stock         →  Set active_brand = "Patek Philippe"  
   🍉🍉PP Used Full Set🍉🍉         →  Set active_brand = "Patek Philippe", condition = "Used"
   🔥🔥PP Used Full Set🔥🔥         →  Set active_brand = "Patek Philippe", condition = "Used"
   🏆Rolex New in HK               →  Set active_brand = "Rolex"
   
3. LISTING LINES (create one record each):
   🌟4910/1200A Green 5/2026 HKD 118K   →  1 listing
   🌟4910/1201R purple 6/2026 HKD 310K  →  1 listing
   
4. INLINE LISTINGS (no emoji marker, but has reference pattern):
   Rm67-01 rose gold 4300000 hkd / 550000u 2026   →  1 listing
   126500 white 6/2026 HKD 283K                   →  1 listing

5. CONTINUATION LINES (append to previous, don't create new):
   Full set, never worn   →  Append to previous listing's description
   Box and papers         →  Append condition info
```

**Output:** Array of `ListingLine` objects, each with:
- `raw_text`: the original line
- `line_number`: position in message
- `parent_message_id`: the source auction UUID
- `inherited_brand`: from context tracker
- `inherited_currency`: from context tracker
- `inherited_condition`: from context tracker

**Table:** `auction_watches` (one row per listing line)

**Production evidence:** 1,038,280 🌟 markers exist across messages, but only 1,162,680 rows in auction_watches — many lines were never properly split.

---

### S2: CLASSIFY (Core Extraction Engine)

**Input:** A single `ListingLine` with inherited context

**Action:** Extract the watch identity using brand-specific extractors.

#### Brand-Specific Reference Patterns

Each brand encodes reference numbers differently. The classifier must apply the correct pattern based on `inherited_brand`:

```
ROLEX:
  Pattern: \d{6}[A-Z]{0,6}
  Examples:
    "126500"         → ref=126500
    "126233VI"       → ref=126233, variant=VI (Grey/Ivory dial)
    "126710BLRO"     → ref=126710, variant=BLRO (Blue-Red bezel = Pepsi)
    "126711CHNR"     → ref=126711, variant=CHNR (Chocolate)
  Material suffix: last 1-2 chars (A=Steel, J=Gold, O=Everose, W=WhiteGold, P=Platinum)
  
PATEK PHILIPPE:
  Pattern: \d{4}[/\d{0,2}][A-Z]{0,2}
  Examples:
    "4910/1200A"     → ref=4910, sub=1200, material=A (Steel)
    "5712/1A"        → ref=5712, sub=1, material=A
    "5712G"          → ref=5712, material=G (Gold)
    "5712GR"         → ref=5712, material=GR (Gold-Rose)
    "5167/1A"        → ref=5167, sub=1, material=A
  Material: A=Steel, G=Gold, R=Rose Gold, J=Yellow Gold, P=Platinum

AUDEMARS PIGUET:
  Pattern: \d{5}[A-Z]{2}
  Examples:
    "26240OR"        → ref=26240, material=OR (Rose Gold)
    "15500OR"        → ref=15500, material=OR
    "15500ST"        → ref=15500, material=ST (Steel)
  Material: ST=Steel, OR=Rose Gold, BA=Yellow Gold, BB=Pink Gold

RICHARD MILLE:
  Pattern: [Rr]M\d{2}-\d{2}
  Examples:
    "RM67-01"        → ref=RM67-01
    "rm07-04"        → ref=RM07-04
    "RM35-03"        → ref=RM35-03

TUDOR:
  Pattern: [Mm]?\d{5}[A-Z]\d[A-Z]\d[A-Z]{0,2}
  Examples:
    "7941A1A0RU"     → ref=7941A1A0RU
    "M79083-0008"    → ref=M79083-0008

CARTIER:
  Pattern: (WHSA|WGBB|HPI|WGNM|WHRR)\d{4,5}
  Examples:
    "WHSA0028"       → ref=WHSA0028
    "WGBB0039"       → ref=WGBB0039
    "HPI01518"       → ref=HPI01518

IWC:
  Pattern: IW\d{6,7}
  Examples:
    "IW357417"       → ref=IW357417

VACHERON CONSTANTIN:
  Pattern: \d{4}[A-Z][/0-9A-Z-]+
  Examples:
    "4300V/000R-B509"  → ref=4300V/000R-B509

HUBLOT:
  Pattern: \d{3}\.[A-Z]{2}\.\d{4}\.[A-Z]{2}(\.[A-Z]{2})?
  Examples:
    "411.CF.8513.RX"   → ref=411.CF.8513.RX
```

#### Classification Algorithm

```python
def classify(line, context):
    brand = context.active_brand
    
    # Step 1: Apply brand-specific reference extractor
    ref_pattern = BRAND_PATTERNS.get(brand, FALLBACK_PATTERN)
    ref_match = ref_pattern.search(line.raw_text)
    
    if ref_match:
        # Decode the match into ref + variant + material
        decoded = decode_reference(ref_match.group(), brand)
        return ClassificationResult(
            brand=brand,
            reference=decoded.base_ref,
            variant_code=decoded.variant,
            material_code=decoded.material,
            confidence=0.95  # High confidence on direct pattern match
        )
    
    # Step 2: Try nickname matching (98.4% success rate in production)
    nickname = match_nickname(line.raw_text, brand)
    if nickname:
        return ClassificationResult(
            brand=brand,
            reference=nickname.canonical_ref,
            dial_color=nickname.dial_color,
            nickname=nickname.name,
            confidence=0.90
        )
    
    # Step 3: Try fuzzy reference match (Levenshtein ≤ 2)
    possible_refs = fuzzy_match_refs(line.raw_text, brand)
    if possible_refs and possible_refs[0].distance <= 2:
        return ClassificationResult(
            brand=brand,
            reference=possible_refs[0].ref,
            confidence=0.80 - (possible_refs[0].distance * 0.10)
        )
    
    # Step 4: Cannot classify — route to AI
    return ClassificationResult(
        brand=brand,
        reference=None,
        confidence=0.0,
        route_to='AI'
    )
```

---

### S3: NORMALIZE (Catalog Match)

**Input:** ClassificationResult with brand + reference + variant_code

**Action:** Map to canonical catalog entry.

**The normalization pipeline:**

```
STEP 3a: REFERENCE NORMALIZATION
  "126710"          + nickname "Pepsi"     → "126710BLRO"
  "126711"          + nickname "Root Beer"  → "126711CHNR"
  "116719BRLO"      (typo)                  → "116719BLRO"
  "126720VNTR"      (transposition)         → "126720VTNR"
  "5712G"           (Patek, no sub)         → "5712/1G-001"
  
  Source: auctions_normalization_rules (51,071 rules already exist)
  
STEP 3b: DIAL COLOR NORMALIZATION
  "Blk"     → "Black"
  "Cho"     → "Chocolate"
  "Champ"   → "Champagne"
  "Wim"     → "Wimbledon" (green)
  "Burple"  → "Blue Purple"
  "silver"  → "Silver"
  
  Source: watch_dial_colors (807 entries), reference_color_catalog (19,024 entries)

STEP 3c: FULL CATALOG MATCH
  normalized_ref + dial_color → master_catalog lookup
  If exact match found:
    confidence = 0.98
    catalog_confirmed = true
    Set model, nickname, image from catalog
  
  If no exact match but ref exists with different dial:
    confidence = 0.75
    Log to reference_color_catalog for review
  
  If ref not in catalog:
    confidence = 0.40
    Route to AI for extraction
```

**Tables used:**
- `master_catalog` (target: expand from 755 → 10,000+ refs)
- `auctions_normalization_rules` (51,071 existing rules)
- `reference_color_catalog` (19,024 entries with confidence + color distribution)
- `thecollective_catalogs.watch_dial_colors` (807 color variants)

**Output:** `normalized_reference`, `dial_color` (canonical), `catalog_confirmed` flag

---

### S4: PRICE ENGINE

**Input:** Raw price text from listing line + currency context

**Action:** Detect currency, parse value, convert to USD.

```
PRICE FORMAT DETECTION (try in order):

1. EXPLICIT CURRENCY + MULTIPLIER:
   "HKD 118K"     → currency=HKD, value=118000, → USD = 118000/7.8 = $15,128
   "HKD 1.006m"   → currency=HKD, value=1006000, → USD = $128,974
   "HKD 1,68M"    → currency=HKD, value=1680000, → USD = $215,385 (EURO decimal!)
   "$392K"        → currency=USD, value=392000
   "550000u"      → currency=USD, value=550000

2. EMOJI PRICE (no currency marker):
   "💰134000"     → currency=INFERRED from context, value=134000
   "💰57200-40%"  → value=57200, discount=40%, final = 57200*0.6 = $34,320
   
3. INLINE PRICE:
   "$101500"      → currency=USD, value=101500
   "90k usdt"     → currency=USDT (≈USD), value=90000
   "4300000 hkd / 550000u" → DUAL currency listed. Store both.

4. CURRENCY CONTEXT INFERENCE:
   If active_currency == "HKD" (set by message header or region):
     "687k"  → assumed HKD → 687000 HKD → $88,077 USD
   If region == "Asia":
     Default unknown prices to HKD
   If region == "North America":
     Default unknown prices to USD

5. DISCARD RULES:
   Price < $50       → Likely parsing artifact, DISCARD, set price=NULL
   Price > $5,000,000 → Flag for human review (possible RM but verify)
   Price contains "%" → Apply discount to base, store both
```

**Tables:**
- `thecollective_catalogs.exchange_rates` (166 rates — already exists)
- Store: `price` (USD), `original_price`, `original_currency`, `price_confidence`

---

### S5: VALIDATE (Quality Gate)

**Input:** Fully classified listing (brand, ref, dial, price, condition)

**Action:** Cross-validate against market data before accepting.

```
VALIDATION CHECKS:

1. PRICE OUTLIER CHECK:
   Lookup market_reference_indicators for this normalized_reference + dial_color
   Get 30-day avg_fs_price_recent and sigma range
   
   If price within 1-sigma:  PASS (confidence=0.95)
   If price within 2-sigma:  PASS (confidence=0.80, flag for monitoring)  
   If price within 3-sigma:  WARN (confidence=0.60, route to review)
   If price outside 3-sigma: FAIL (confidence=0.20, route to human review)
   
   SPECIAL: If no indicators exist for this ref yet, skip (new watch)

2. FIELD CONSISTENCY CHECK:
   If brand == "Rolex" AND ref starts with "5712":
     FAIL — 5712 is Patek Philippe Nautilus, not Rolex
   
   If dial_color == "Green" AND reference_color_catalog says 
   this ref only comes in "Black" or "Blue":
     WARN — possible misidentification, flag for review

3. DUPLICATE CHECK:
   Hash = MD5(brand + normalized_ref + dial_color + price + sender + date)
   If hash exists in last 7 days from SAME sender:
     SKIP — exact repost
   If hash exists from DIFFERENT sender:
     KEEP — legitimate cross-posting (same watch, different dealer)
```

---

### S6: ROUTE (Final Decision)

**The 4-Tier Routing:**

```
TIER 1: AUTO-APPROVE
  Conditions: catalog_confirmed=true AND price_validated=true AND confidence ≥ 0.90
  Action: INSERT into auction_watches, set identification_status='identified'
  Cost: $0 (no AI)
  Expected volume: ~60% of listings after catalog expansion
  
TIER 2: AI EXTRACTION  
  Conditions: confidence < 0.90 AND has_partial_match=true
  Action: Route to LLM with:
    - The raw listing line
    - The inherited brand context
    - The top-3 catalog matches (fuzzy)
    - Instruction: "Extract reference, dial_color, material. Return JSON."
  On success: INSERT with identification_status='identified'
  Expected volume: ~25% of listings
  
TIER 3: HUMAN REVIEW
  Conditions: confidence < 0.50 OR price_outlier=true OR field_inconsistency=true
  Action: INSERT into auction_exceptions with status='pending'
  Expected volume: ~10% of listings
  
TIER 4: REJECT
  Conditions: no brand AND no reference AND no price (pure noise)
  Action: Mark identification_status='rejected', do not insert into auction_watches
  Expected volume: ~5% of listings
```

---

## CONTEXT TRACKER: Detailed Specification

The context tracker is what makes this a STATE MACHINE instead of a parser. It maintains state across listing lines within a single message.

```python
class MessageContext:
    """State that persists across lines within a single dealer message."""
    
    # Brand context — set by headers, inherited by lines
    active_brand: str = None           # "Patek Philippe", "Rolex", "Richard Mille"
    brand_confidence: float = 0.0      # How confident we are in the brand
    
    # Currency context — set by region, header, or first price token
    active_currency: str = None        # "HKD", "USD", "USDT"
    
    # Condition context — set by headers
    active_condition: str = None       # "New", "Used", "Used Full Set"
    
    # Model cache — once we identify a model from a ref, cache it
    model_cache: dict = {}             # {"5712": "Nautilus", "126500": "Daytona"}
    
    def process_header(self, line: str):
        """Parse brand/section headers and update context."""
        
        # Trophy + brand name
        if line.contains('🏆') or line.contains('⚜️'):
            brand = extract_brand_name(line)
            self.active_brand = brand
            self.brand_confidence = 1.0
            
        # Watermelon/fire with "PP" abbreviation
        if line.contains('🍉') or line.contains('🔥'):
            if line.upper().contains('PP'):
                self.active_brand = "Patek Philippe"
            if line.upper().contains('AP'):
                self.active_brand = "Audemars Piguet"
                
        # Condition markers
        if line.contains('New') or line.contains('🆕'):
            self.active_condition = "New"
        if line.contains('Used') or line.contains('Full Set'):
            self.active_condition = "Used Full Set"
    
    def infer_currency(self, region: str, first_price_text: str):
        """Set currency context from region or explicit price."""
        if 'HKD' in first_price_text or 'hkd' in first_price_text:
            self.active_currency = "HKD"
        elif '$' in first_price_text or 'usd' in first_price_text.lower():
            self.active_currency = "USD"
        elif 'usdt' in first_price_text.lower():
            self.active_currency = "USDT"
        elif region == "Asia":
            self.active_currency = "HKD"  # Default for Asian dealers
        else:
            self.active_currency = "USD"
```

---

## PRODUCTION DATA: HOW THE STATE MACHINE WOULD HAVE PREVENTED CURRENT FAILURES

### Failure 1: The $25 Daytona (Currency Bug)
```
RAW:    "🌟126598RBOW black 6/2026 HKD 25K"
PARSER: price = 25 (stored the K multiplier as noise)

STATE MACHINE:
  S1: Segment → "🌟126598RBOW black 6/2026 HKD 25K"
  S2: Classify → brand=Rolex (inherited), ref=126598, variant=RBOW
  S3: Normalize → 126598RBOW → catalog match → Daytona Rainbow
  S4: Price → "HKD 25K" → context.active_currency=HKD → 25000 HKD → $3,205 USD
  S5: Validate → market avg for 126598RBOW = $180K-$250K → price WAY below sigma
       → WARN: route to human review (possible scam or parsing error)
  
RESULT: Price correctly stored as $3,205 instead of $25, flagged for review
```

### Failure 2: Brand Inheritance Missed
```
RAW MESSAGE:
  🍉🍉PP Used Full Set🍉🍉
  🌟5164R 2018Y HKD903k 
  🌟5712G 2013Y HKD591k

PARSER: Each line processed independently. 
  Line 1: "5164R" → no brand header on this line → brand=NULL
  Line 2: "5712G" → no brand header on this line → brand=NULL

STATE MACHINE:
  S1: Segment → Header detected → active_brand = "Patek Philippe"
  S2: Classify → both lines inherit brand="Patek Philippe"
  
RESULT: Both lines correctly identified as Patek Philippe
```

### Failure 3: Price Bleed Between Lines
```
RAW:
  126500 white 6/2026
  126508 green n6 687k

PARSER: No price on line 1, pulls "687k" from line 2, stores both wrong.

STATE MACHINE:
  S1: Segment → 2 separate ListingLine objects
  S2: Classify → Line 1: ref=126500, Line 2: ref=126508
  S4: Price → Line 1: no price token → price=NULL (correct!)
         Line 2: "687k" + active_currency=HKD → 687000 HKD → $88,077
  
RESULT: Line 1 has no fake price. Line 2 has correct $88K.
```

---

## IMPLEMENTATION NOTES

### What Already Exists (Do Not Rebuild)

| Component | Table | Status |
|---|---|---|
| Message dedup hash | `auctions.title_hash` | ✅ Exists, needs enforcement |
| Split mechanism | `auction_watches` | ✅ Exists, needs proper population |
| Normalization rules | `auctions_normalization_rules` (51K) | ✅ Exists, needs expansion |
| Color catalog | `reference_color_catalog` (19K) | ✅ Exists, has confidence + JSON |
| Exception workflow | `auction_exceptions` (188K) | ✅ Exists, needs clearing |
| Market indicators | `market_reference_indicators` (4.2M) | ✅ Exists, ready for validation |
| Exchange rates | `exchange_rates` (166) | ✅ Exists, needs scheduled updates |
| Dial color dictionary | `watch_dial_colors` (807) | ✅ Exists, needs dealer-slang mapping |
| Brands catalog | `brands` (360) | ✅ Exists, needs full utilization |
| References catalog | `references` (73K) | ✅ Exists, NOT used for matching |

### What Needs To Be Built

1. **ContextTracker class** — ~200 lines of PHP/Python. Tracks brand/currency/condition across lines.

2. **Brand-specific reference decoders** — ~500 lines. One function per brand (Rolex, Patek, AP, RM, Tudor, Cartier, IWC, VC, Hublot, JLC, Omega, Panerai, Lange). Each decodes the brand-specific ref format into base_ref + variant + material.

3. **Price normalizer** — ~300 lines. Handles HKD/USD/USDT/emoji/raw formats, K/M multipliers, decimal notation (period vs comma), discount suffixes, currency inference.

4. **Dial color slang dictionary** — ~100 entries. Maps dealer abbreviations to canonical colors.

5. **State machine orchestrator** — ~400 lines. Runs S0→S6 for each message, manages context.

6. **Backfill processor** — Runs the state machine retroactively on the 1.2M existing auctions to fix prices, brands, and identification.

### Estimated Total: ~1,500 lines of new code

No new infrastructure. No database migration. No new services. Pure logic improvement on the existing stack.

---

## MIGRATION STRATEGY

Do NOT do a big-bang replacement. Run both systems in parallel:

```
Week 1: Build ContextTracker + Price normalizer + Rolex/Patek decoders
        Run on NEW incoming messages only. Compare results to old parser.
        
Week 2: Add AP, RM, Cartier, Tudor decoders. Add dial slang dictionary.
        Start backfill on oldest 100K auctions. Compare price accuracy.
        
Week 3: Expand master catalog (755 → 10K refs from catalogs.references).
        Backfill 500K more auctions.
        
Week 4: Full backfill of remaining auctions. Decommission old parser.
        Clear exception backlog using new pipeline.
        
Week 5+: Build reporting dashboard on clean data.
```

---

## SUMMARY FOR THE DEVELOPER

The move from "Parser" to "State Machine" is not about new infrastructure. It is about:

1. **Context persistence** — Track brand/currency/condition across lines
2. **Brand-specific decoding** — Each brand encodes references differently
3. **Sequential states** — Segment → Classify → Normalize → Price → Validate → Route
4. **Tiered routing** — Auto-approve (60%), AI (25%), Human (10%), Reject (5%)
5. **Catalog-first matching** — Check your 73K-reference catalog BEFORE trying regex/AI

The existing database already has the tables, the normalization rules, the exception workflow, and the analytics engine. The state machine is the missing LOGIC LAYER that connects them properly.

Estimated effort: 2-3 weeks for a single developer. No new infrastructure required.
