# JASS-6 NORMALIZATION SPECIFICATION
# WatchFacts Unified Normalization Pipeline v6.0
# Saved: 2026-07-09 — for Hermes reset
#
# Full spec reviewed by CTO. See JASS6_CTO_REVIEW.md for analysis.

=== TABLE OF CONTENTS ===
1. Pre-Processing
2. Brand Detection (5-tier)
3. Reference Extraction (10+ patterns)
4. Reference Normalization
5. Catalog Auto-Fill
6. Currency Detection (HKD-first, rewritten)
7. Price Extraction
8. Currency Conversion
9. Dial Color (5-tier)
10. Condition & Year
11. Intent & Red Flags
12. Multi-Listing Detection
13. Confidence Scoring
14. Verdict Gate (4-tier decision tree)
15. State Machine (Audit Trail)

=== 1. PRE-PROCESSING ===

WF_NORM_PREPASS:
  1a. Strip NBSP, zero-width chars, invisible unicode
      /[\u00A0\u2000-\u200B\u2028\u2029]/g → ' '
  1b. Full-width → ASCII
      0-9 fullwidth digits → ASCII
  1c. WF_GLUE_FIX — unstick glued tokens:
      "HKD2.09m" → "HKD 2.09m"
      "45500USD" → "45500 USD"
      "152000hkd" → "152000 hkd"
      "2013Full" → "2013 Full"
      Pattern: /\b(HKD|USDT|USD|EUR|CHF|GBP|SGD|JPY|AED)(\d)/
      Pattern: /(\d)(HKD|USDT|USD|EUR|CHF|GBP|SGD|JPY|AED)\b/
      Pattern: /(\d)([A-Z][a-z]{2,})/g → "$1 $2"
  1d. Normalize whitespace: \s+ → ' ', \r\n → \n

WF_SPLIT (Multi-watch split):
  DO NOT SPLIT IF: ≤1 strong reference line
  DO NOT SPLIT IF: comma-separated with only ONE part having ref
    → Guard: replace \d,\d with placeholder before splitting on commas
  SPLIT ON EMOTICON IF: ≥2 parts contain ref-like tokens
  SPLIT ON COMMA/PIPE IF: ≥2 parts each have OWN ref (WF_COMMA_REFREQ)
  SPLIT ON MID-LINE SECOND REF IF:
    → 2+ DISTINCT strong refs + price between them

=== 2. BRAND DETECTION (5-tier, stops at first match) ===

TIER 1 — EMOJI BRAND MARKERS: 25 emoji→brand mappings
TIER 2 — EXPLICIT TEXT: 30+ brand mappings, case-insensitive
TIER 3 — REF PREFIX INFERENCE: RMxx, IWxxxx, 11xxxx, 15xxx, 5xxx, etc.
TIER 4 — LEVENSHTEIN FUZZY: distance ≤2 for ≥5 char tokens
TIER 5 — AI FALLBACK (DeepSeek): if brand Unknown + ref found

=== 3. REFERENCE EXTRACTION ===

P1  Omega dotted       \b\d{3}\.\d{2}\.\d{2}\.\d{2}\.\d{2}\.\d{3}\b
P2  Richard Mille       \bRM\s?\d{2}[-\s]?\d{2}\b
P3  Patek + suffix      \b\d{4}[A-Z]{1,3}-\d{2,3}\b
P4  Patek slash+suffix  \b\d{4}[A-Z]?\/\d{1,4}[A-Z]{1,2}(-\d{3})?\b
P5  Patek slash         \b\d{4}\/\d{1,4}[A-Z]{0,2}(-\d{3})?\b
P6  IWC                 \bIW\d{4,6}\b
P7  Rolex 6-digit       \b(116|126|114|124|226|228|279|128|336|268)\d{3}[A-Z]{0,4}\b
P8  Rolex 5-digit       \b\d{5}[A-Z]{0,4}\b (if Rolex prefixes)
P9  PP/AP 4-5+letter    \b\d{4,5}[A-Z]{1,4}\b
P10 Blancpain dash      \b\d{4}-\d{2,4}-[A-Z0-9]{2,4}\b
P11 Bare 6-digit        \b\d{6}[A-Z]{0,4}\b (last resort)
P12 Bare 4-digit        \b\d{4}\b (exclude 1900-2030)

PRICE GUARD: reject candidates matching price+currency suffix, bare 6-digit with currency context, year-like patterns
CATALOG PREFERENCE (WF_REF_SELECT): prefer catalog hit, pick longest

=== 4. REFERENCE NORMALIZATION ===

Richard Mille: "Rm11-01ti" → "RM 11-01 TI"
Patek: "5712/1a" → "5712/1A", "5980/1400g" → "5980/1400G"
Rolex: "116610lv" → "116610LV"
AP: "15500st" → "15500ST"
VC dial codes: drop -Bxxx variant suffix
Common: strip \t\r\n, uppercase final letter, uppercase suffix after slash

=== 5. CATALOG AUTO-FILL ===

REFERENCE_CATALOG table:
  reference (PK), brand, family, dial_colors[], case_materials[],
  bezel, year_introduced, year_discontinued, msrp_usd

MATCH RULES:
  1. Exact → FULL AUTO-FILL (brand, family, dial, materials, MSRP)
  2. Prefix → PARTIAL (brand, family, materials — NOT dial)
  3. Canonical ref update: "5712/1A" → catalog says "5712/1A-010"
  4. Brand disagreement → FLAG + human review

CATALOG 100% APPROVAL:
  All 6 fields filled = confidence=100 = APPROVED_CATALOG

=== 6. CURRENCY DETECTION (HKD-first, rewritten) ===

WF_CURRENCY — replaces all existing extractors:
  PRIORITY 1 — EXPLICIT TEXT: HKD/HK$/HKS, USDT, EUR, GBP, CHF, SGD, JPY, CNY, AED, AUD, CAD
  PRIORITY 2 — CONTEXT: HKD markers anywhere, USDT text, HK dealer context, low price no currency → USD
  PRIORITY 3 — SYMBOL ONLY: $ → USD (only if no HKD detected), € → EUR, £ → GBP, ¥ → JPY

ANTI-BUG RULES:
  "128k HKD $16,000" → HKD (explicit HKD detected)
  "$128,000" (no HKD) → USD
  "128万" → HKD (Chinese character)
  No currency + price >50k → check HK markers

=== 7. PRICE EXTRACTION ===

P1 MILLION: "1.83m", "1.83M", "1.83 million" → ×1,000,000
P2 THOUSAND: "850k", "850K", "21.6k" → ×1,000
P3 CURRENCY+NUMBER: "HKD 850k", "USD 1.366M" (unstick if needed)
P4 HK$+NUMBER: "HK$ 970,000", "HK$ 128k"
P5 $+NUMBER: "$128,000", "$15k"
P6 SYMBOL+NUMBER: "€50,000", "¥1,200,000"
P7 BARE NUMBER+CURRENCY: "128000 HKD", "15000 USD"
P8 BARE NUMBER+SUFFIX: "850k", "1.2M" (last resort, assume USD)

VALIDATION: ≥100 AND <10B, reject NaN, flag outliers

=== 8. CURRENCY CONVERSION ===

WF_CONVERT — single source of truth:
  HKD→0.128, EUR→1.08, GBP→1.27, CHF→1.13, AED→0.272,
  SGD→0.74, JPY→0.0066, CNY→0.138, AUD→0.65, CAD→0.73, USDT→1.0

OUTPUT: price (USD), priceOriginal, currency, currencyOriginal

=== 9. DIAL COLOR (5-tier) ===

TIER 1 — EXPLICIT TEXT: WF_DIAL_ALIASES (25+ keywords)
TIER 2 — REFERENCE SUFFIX: Rolex 6-digit only (LN=Black, LV=Green, etc.)
TIER 3 — EMOJI HINT: green/blue/black/white circles
TIER 4 — CATALOG LOOKUP: catalog dial_colors[0]
TIER 5 — AI FALLBACK: "What dial color is reference XXXX?"

=== 10. CONDITION & YEAR ===

CONDITION: new/bnib/unworn/sealed/mint/NOS/NIB → New
           used/pre-owned/worn → Used
           like new/excellent → Like New
           N5/2026 → New (N-prefix)
           DEFAULT: Unknown

YEAR: N5/2026→2026, 20\d{2}→year, 2\dY→202x, \d{2}Y→20xx, DEFAULT: null

=== 11. INTENT & RED FLAGS ===

INTENT: WTB/looking for/ISO → BUY, NTQ → BUY, "how much"/price? → INQUIRY, DEFAULT → SELL

RED FLAGS → forced HUMAN_REVIEW:
  replica, aftermarket, custom, homage, franken, "genuine movement",
  fake, stolen, crosspost/cross posted

=== 12. MULTI-LISTING DETECTION ===

FLAG conditions:
  RULE A — reference-like tokens ≥3
  RULE B — price mentions ≥3
  RULE C — emoji list with different refs

When flagged: score=50, verdict=HUMAN_REVIEW, catalog DISABLED

=== 13. CONFIDENCE SCORING ===

BASE: ref(+40), brand(+25), dial(+15), price(+10), currency(+5), condition(+3), year(+2) = MAX 100
CATALOG BONUS: confirms brand(+5), ref(+5), dial(+5), all 6 fields(+10) = MAX 100
CROSS-VAL BONUS: image match(+12), web search(+8), 3+ signals(+8)
CATALOG 100% RULE: all 6 fields → confidence=100 → APPROVED_CATALOG

=== 14. VERDICT GATE ===

RED_FLAG → forced HUMAN_REVIEW
MULTI_WATCH → score=50, HUMAN_REVIEW
Catalog 100% → APPROVED_CATALOG
confidence ≥90 → APPROVED
confidence 60-89 → AI_REVIEW (AI fills ≤2 fields → re-score)
confidence <60 → HUMAN_REVIEW
confidence <35 → RECYCLE

=== 15. STATE MACHINE (Audit Trail) ===

Each listing gets full audit: PREPROCESS → SPLIT_CHECK → BRAND →
REFERENCE → CATALOG_LOOKUP → CURRENCY → PRICE → CONVERT → DIAL →
CONDITION → YEAR → VERDICT
Each step records: input, output, decisions[]
Final: confidence + verdict

=== IMPLEMENTATION PLAN ===
1. _lib/jass6-currency.js — single currency engine
2. reference_catalog Supabase table + JSON export
3. _lib/jass6-normalize.js — unified pipeline
4. _lib/jass6-audit.js — state machine
5. /api/jass6-reprocess — bulk reprocess 2.39M
6. BigQuery pull → JASS-6 → Supabase
