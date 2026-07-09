# WatchFacts Price Normalization — CTO Repair Plan

## Problem Summary (from live feed analysis)

The price data for 52506 shows THREE distinct failure modes:

### Failure Mode 1: HKD prices stored unconverted
  Raw: "295,000hkd or 37,900usdt"
  Stored: $295,000  (should be $37,760 via ×0.128)
  Root: Parser picks first number (295,000hkd) but doesn't convert to USD

### Failure Mode 2: HK$ format not recognized  
  Raw: "HK$ 355,000 without box Ready In HK"
  Stored: $5,796  (parser grabs a random sub-number from the text)
  Root: "HK$ " with space after dollar sign doesn't match any price regex

### Failure Mode 3: Model number "1908" picked as price
  Raw: "52506, 1908 39mm Platinum, Ice Blue Dial, ... USD 52,700"
  Stored: $1,908  (parser grabbed "1908" — the model name — as price)
  Root: Old parser no price-guard for model numbers that look like prices

### Failure Mode 4: Multi-watch broadcasts leaking wrong prices through
  Raw: dealer stock list with 20+ watches, each with their own price
  Stored: random price from the list assigned to ref 52506
  Root: Multi-watch detection failing — these should be HUMAN verdict

### Failure Mode 5: "k" suffix not parsed
  Raw: "52506 N2 $298000"  (dealer shorthand: 298k = 298,000 HKD)
  Stored: $298,000 USD  (not converted, treated as USD)
  Root: No "k" marker → parser treats as USD instead of HKD

## Current State
- 136 of 220 records updated by reprocess-prices
- 84 unchanged — these are the broken ones still showing bad prices
- Median $40,320 is correct (IQR filters outliers)
- But individual listing prices are WRONG on ~80 records

## Fix Plan (4 phases)

### Phase 1: Fix HK$ parser regex (parser.js)
  — Add `HK$` with optional space to price patterns
  — Add `"hkd or usdt"` dual-currency detection → pick USD when both present
  — Add model-number guard (1908, 52506, etc. are NOT prices)
  — Add HKD conversion for $NNNNNN without "k" (dealer shorthand)

### Phase 2: Re-process all 52506 records through fixed parser  
  — Re-run /api/reprocess-prices for 52506 with improved parser
  — Verify: 0 records showing $1,908, $5,143, $5,796
  — Expected: all records show $34K–$45K USD or null

### Phase 3: Full Rolex price audit
  — Scan top 20 Rolex references for sub-$5K / over-$500K anomalies
  — Re-process any reference with >10% anomalous prices
  — Verify medians match market reality

### Phase 4: Multi-watch broadcast cleanup
  — Detect records with 3+ price mentions in raw_message
  — Set verdict=HUMAN for multi-watch broadcasts
  — These should not auto-approve per your rule

## Pre-requisites before starting
- [ ] Read parser.js price extraction section (lines 1058-1130)
- [ ] Map all price regex patterns currently active
- [ ] Test each Failure Mode against current parser
- [ ] Fix parser regexes one at a time
- [ ] Test fix → deploy → re-process → verify
