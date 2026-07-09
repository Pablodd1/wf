# JASS-6 CTO REVIEW
# Hermes reset safe — all decisions logged here
# 2026-07-09

=== OVERALL ASSESSMENT ===

This spec is excellent as a TARGET ARCHITECTURE. It fixes every known 
parser bug, adds catalog auto-fill, state machine audit trail, and 
proper multi-currency handling. The HKD-first currency detection alone 
would eliminate 80% of our remaining data quality issues.

However, this is a 2-4 week implementation, not a single push. We need 
to sequence it so each phase delivers value independently, and the 
current production pipeline keeps working during the transition.

=== WHAT'S ALREADY COVERED BY OUR EXISTING FIXES ===

Section 1 (Pre-Processing):
  - 1d (whitespace normalize): ✅ Already in parser
  - 1a (unicode strip): ❌ Not yet — the ???? noise problem
  - 1b (fullwidth→ASCII): ❌ Not yet
  - 1c (glue fix): ✅ Partially done (HKD prefix/suffix patterns handle 
    glued forms at match-time, not pre-process)
  - WF_SPLIT: ⚠️ Partially done (detectMultiWatchStockList exists but is 
    detection-only, not splitting)

Section 2 (Brand Detection):
  - Tier 2 (explicit text): ✅ Already in parser
  - Tier 3 (ref prefix): ✅ Already in parser (REF_PATTERNS with brandHint)
  - Tier 1 (emoji): ❌ Not yet
  - Tier 4 (fuzzy): ❌ Not yet
  - Tier 5 (AI fallback): ❌ Needs DeepSeek integration

Section 3 (Reference Extraction):
  - P1-P12 patterns: ✅ Already in parser (REF_PATTERNS array)
  - Price guard: ✅ Added this session (year-stripping, currency-stripping)
  - Catalog preference (WF_REF_SELECT): ❌ Not yet — picks first valid, 
    not the catalog-matching one

Section 4 (Reference Normalization):
  - ✅ All four brand normalizers exist in normalizeRefFormat()
  - Missing: VC dial code stripping (-Bxxx suffix)

Section 5 (Catalog Auto-Fill):
  - ❌ Entirely new. Current catalog is a flat JSON file used for lookup.
  - reference_catalog table with family/materials/MSRP is new infrastructure.
  - Catalog 100% approval rule is the killer feature — eliminates human 
    review for catalog-matched records.

Section 6 (Currency Detection):
  - ✅ HKD-first detection deployed this session (priority-based system)
  - Missing: context inference (Chinese characters → HKD, HK dealer → HKD)
  - Missing: "128万" (Chinese numeral + HKD inference)

Section 7-8 (Price + Conversion):
  - ✅ k/m/M suffixes deployed
  - ✅ All currency rates in RATES table
  - Missing: PRICE_HIGH_OUTLIER / PRICE_LOW_OUTLIER flags
  - Missing: priceOriginal / currencyOriginal audit fields

Section 9 (Dial Color):
  - ✅ Tier 1-2 deployed
  - Missing: Tier 3 (emoji), Tier 4 (catalog lookup for dial)

Section 10 (Condition & Year):
  - ✅ Mostly deployed (N-prefix, standard keywords)
  - Missing: Like New condition bucket

Section 11 (Intent & Red Flags):
  - ✅ classifyListingType() handles WTB/WTS/WTT/GARBAGE
  - ❌ Red flags not implemented
  - ❌ INQUIRY intent not detected

Section 12 (Multi-Listing):
  - ✅ detectMultiWatchStockList() deployed (with fixes this session)
  - Current implementation uses ref count only — spec adds price count 
    and emoji detection as additional signals

Section 13-14 (Confidence + Verdict):
  - ⚠️ Current confidence is simpler (catalog match=100, otherwise heuristic)
  - Catalog 100% rule (all 6 fields) is new
  - AI_REVIEW tier is new (current: APPROVED / HUMAN / RECYCLE only)

Section 15 (State Machine):
  - ❌ Entirely new. Current parser has no audit trail.
  - This is the most valuable infrastructure piece — every bug we debugged 
    this session would have taken 5 minutes with the state machine.

=== WHAT'S SAFE TO IMPLEMENT IMMEDIATELY ===

Phase A — Parser module extraction (no behavior change, just refactor):
  1. Extract jass6-currency.js from parser.js (sections 6-8)
  2. Extract jass6-dial.js (section 9)
  3. Extract jass6-condition.js (section 10)
  4. Wrap existing parseFull() as jass6-normalize.js entry point
  → Risk: LOW. Just moving code. Existing tests must pass unchanged.

Phase B — Additive features (new capabilities, no removals):
  5. Add emoji brand detection (section 2, tier 1)
  6. Add WF_REF_SELECT catalog preference
  7. Add PRICE_HIGH/LOW_OUTLIER flags
  8. Add red flag detection (section 11)
  9. Add Unicode strip + fullwidth→ASCII (section 1a/1b)
  → Risk: LOW-MEDIUM. New code paths, guarded by feature flags.

Phase C — State machine (new infrastructure):
  10. Implement jass6-audit.js — wrap existing parseFull steps
  11. Store audit trail in watch_records.flags or new column
  → Risk: MEDIUM. Schema change optional (can store in JSONB flags).

Phase D — Catalog upgrade (new table):
  12. Create reference_catalog Supabase table
  13. Migrate catalog.json → reference_catalog with family/materials/MSRP
  14. Implement catalog 100% approval rule
  → Risk: MEDIUM-HIGH. New table, migration, backward compat required.

Phase E — AI integration:
  15. Wire DeepSeek for tier-5 brand fallback
  16. Wire AI for dial color fallback
  17. AI_REVIEW verdict tier
  → Risk: HIGH. External API dependency, cost, latency.

=== ARCHITECTURAL CONCERNS ===

1. REFERENCE_CATALOG TABLE vs JSON
   The spec proposes a Supabase table. This adds latency (network call 
   per parse) vs the current in-memory JSON (instant). Recommendation: 
   keep JSON for the hot path, use the table as the SOURCE OF TRUTH that 
   gets exported to JSON on deploy. Best of both worlds.

2. AI FALLBACK COST
   DeepSeek calls for brand/dial fallback could be $0.01-0.05 per call × 
   900K HUMAN records = $9,000-$45,000. Need to gate this: only fire AI 
   when ALL deterministic tiers fail AND confidence would otherwise be <60.

3. STATE MACHINE PERFORMANCE
   15-step audit trail per record × 2.39M records = 35M state entries. 
   This needs to be optional (debug mode) or sampled (1% of traffic). 
   Full audit for every record would blow up storage and parse latency.

4. CATALOG 100% RULE vs REALITY
   The spec says "all 6 fields from catalog → APPROVED_CATALOG." But: 
   if the dealer message has a WRONG condition or WRONG price, the 
   catalog auto-fill would override the dealer's actual data. Need a 
   guard: catalog fills MISSING fields, never overrides EXISTING fields 
   extracted from the message text.

5. WF_SPLIT vs detectMultiWatchStockList
   The spec proposes ACTIVE SPLITTING of multi-watch messages. Our 
   current approach is PASSIVE DETECTION (flag as multi-watch, move to 
   HUMAN). Active splitting is higher risk — a bad split creates 
   garbage records. Recommendation: keep detection as the default, 
   add splitting as an optional enhancement with dry-run validation.

=== RECOMMENDED EXECUTION ORDER ===

Week 1: Phase A (refactor) + Phase B items 5-7 (emoji, ref select, outlier flags)
Week 2: Phase B items 8-9 (red flags, unicode strip) + Phase C (state machine, debug mode only)
Week 3: Phase D (catalog table) + 100% approval rule + catalog-normalize run
Week 4: Phase E (AI fallback, gated) + AI_REVIEW tier + bulk reprocess

=== DECISIONS LOGGED FOR HERMES RESET ===

- JASS6_SPEC.md saved to /home/jasme/wf/JASS6_SPEC.md
- This review saved to /home/jasme/wf/JASS6_CTO_REVIEW.md
- Catalog merged: 9,719 entries, 25 brands (commit 71a58b5)
- All parser fixes deployed on preview-cleaner-theme branch
- Remaining Excel catalogs needed: Hublot, JLC (and Patek/RM for verification)
- Phase 1 (read-time filters) deferred — not yet executed
- Phase 2 (text sanitization) deferred — not yet executed
- Do NOT execute any new code without explicit Jasmel approval after reset
