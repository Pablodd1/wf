# Review C — Analytics Correctness Audit
`api/price-research.js` and `src/pages/PriceResearch.tsx`

## Executive Summary

The core statistics (IQR outlier removal, min-5 bucket gate, median/Q1/Q3)
are **mathematically correct** — verified with a real test dataset. Two real
bugs found: the "Unknown Model" display issue has a simple, confirmed root
cause (a hardcoded `null` in client-side bridging code, not a data or catalog
problem), and the buyers/sellers keyword classifier has a false-positive path
that misclassifies negated phrases ("**not** looking for trades").

---

## Finding 1 (Resolved — verified correct): IQR outlier removal + SANITY_FLOOR

Test data: `[500, 600, 700, 30000, 35000, 40000, 45000, 50000, 300000]`

```
Q1 (25th pct, idx=2) = 700
Q3 (75th pct, idx=6) = 45000
IQR = 44300
Lower bound = max(700 - 1.5*44300, 500) = max(-65750, 500) = 500  ✅ SANITY_FLOOR correctly engages
Upper bound = 45000 + 1.5*44300 = 111450
Filter: keep 500 <= p <= 111450
Result: [500, 600, 700, 30000, 35000, 40000, 45000, 50000] — 300000 removed
```

This is exactly the expected behavior: without SANITY_FLOOR, the negative
lower bound would have let through the $300K outlier being irrelevant (it's
already excluded by the upper bound in this case) — but more importantly, on
skewed real data (as documented in a prior session for Patek 5711/1A) the
floor is what prevents sub-$500 noise (unconverted HKD remnants, dealer
shorthand) from surviving when Q1 is itself very low. Implementation matches
spec. **No bug.**

---

## Finding 2 (P0 — confirmed root cause): "Unknown Model" is a client bridging bug, not missing data

Traced end-to-end:

1. Server (`api/price-research.js`) response JSON has **no `model` field at
   all** — confirmed by reading the full `res.status(200).json({...})` object
   (lines 230-248): `brand, reference, count, filtered_count,
   outliers_removed, prices, monthly, dial_colors, conditions,
   buyers_sellers, rows, stats, meta`. No `model`, no `collection`.

2. Client (`src/pages/PriceResearch.tsx` line 126) explicitly does:
   ```js
   const bridged: PriceData = {
     ...d,
     model: null,   // ← hardcoded literal, not derived from anything
     collection: null,
     ...
   };
   ```

3. Display (line 319): `<h2>{data.model || 'Unknown Model'}</h2>` — since
   `model` is always `null`, this **always** renders "Unknown Model" for
   every single reference, regardless of whether the reference exists in the
   catalog.

**This is NOT a missing-catalog-data problem.** `public/catalog.json` DOES
have a `model` field per entry (confirmed in a prior session: reference 52506
maps to `model: "1908"` in the catalog). The bridging code in `fetchData()`
simply never looks it up — it was written to hardcode `null` rather than call
the existing `/api/catalog` endpoint or embed a catalog lookup client-side.

**Fix**: either (a) have `api/price-research.js` do a catalog lookup
server-side and include `model` in its response, or (b) have the client call
`/api/catalog?reference=X&brand=Y` alongside the price-research fetch and
merge the `model` field into `bridged`. Either is a small, contained fix —
this is not a data quality issue, it's an unwired field.

---

## Finding 3 (P1): Buyers/sellers keyword classifier has a negation blind spot

Location: `api/price-research.js` lines 206-216.
```js
if (lt === 'WTB' || msg.includes('wtb') || msg.includes('want to buy') || msg.includes('looking for')) {
  buyers++;
} else {
  sellers++;
}
```

Confirmed false positive:
```js
msg = "Not looking for trades, cash only. Selling my 5711/1A $95000"
// classified as: BUYER (because msg.includes('looking for') is true)
// should be: SELLER (this is clearly a WTS listing)
```

The classifier has no negation awareness and no primary reliance on
`listing_type`/`verdict` — it treats a bare substring match as authoritative
even when it's inside a negated clause. Given the parser (Review A) already
computes `listing_type` (WTB/WTS) at ingestion time with much more context
than a runtime substring check, this endpoint should trust `listing_type`
first and only fall back to keyword matching when `listing_type` is genuinely
absent/null — currently it does the reverse priority in effect (the `||`
chain means ANY keyword match overrides regardless of a possibly-correct
`listing_type`).

**Fix**: reorder priority — `if (lt === 'WTB') buyers++; else if (lt === 'WTS')
sellers++; else if (msg keyword fallback)...` so a confidently-tagged
`listing_type` from the parser is never overridden by a naive substring match.

---

## Finding 4 (P1): Currency double-conversion guard — verified correct after this session's edits

Traced `convertLegacyPrices()` (lines 10-41):
- Line 14: `if (r.currency && r.currency.toUpperCase() === 'USD') return r;` —
  correctly short-circuits any record already marked USD, preventing
  re-conversion regardless of what `raw_message` mentions. This guard is
  intact and correctly ordered (checked before any HKD-detection logic runs).
- Lines 19-30: the "stored value matches raw HKD figure" check
  (`storedMatchesRawHKD`) is a sound heuristic — only converts when the
  currently-stored `price_usd` is suspiciously close to the raw HKD number
  (implying it was stored unconverted), not just because the text happens to
  mention HKD.
- Lines 35-37: the `< $500` fallback is conservative and matches the
  SANITY_FLOOR rationale documented elsewhere in the same file.

**No bug found here** — this logic was correctly hardened in an earlier
session and remains intact through this session's edits. Worth noting: this
client-side (well, server function-side) HKD-detection duplicates similar
logic that now lives in `parser.js`'s `parsePrice()` (Review A). Two
independent currency-conversion code paths for legacy vs. new records is
maintainable for now but is future technical debt — eventually all records
should go through one conversion path (the parser, at ingestion/reprocess
time), making this read-time fallback here obsolete.

---

## Finding 5 (P2): min-5 gate correctly scoped to buckets only, not overall stats

Confirmed: `aggregateWithMin5()` (lines 92-120) filters OUT buckets
(dial_color, condition) with `< 5` items from the returned array — but the
overall `stats` object (line 166, `computeStats(outlierRemoved)`) is computed
from `allPrices` (all non-outlier prices across ALL buckets, regardless of
individual bucket size). This matches the meeting requirement as documented
in the pipeline skill: "exclude low-significance dial/condition buckets from
analytics breakdowns, but the overall median/avg should reflect all real
listings." **Correctly implemented.**

---

## Finding 6 (P2): Server response includes raw listings without pagination cursor

`rows: cleanRows.slice(0, 200)` (line 219) hardcodes a 200-row cap with no
`offset`/cursor param for the client to request more. For references with
many more than 200 listings (e.g. 116500LN at 1000 rows per a prior session's
findings), the UI's "Recent Listings (200 of 220)" label is accurate but the
user has no way to see listings 201+. Not a correctness bug, but a UX
limitation worth flagging since it silently truncates data the user might
want (e.g. the oldest listings for historical trend-checking).

---

## Severity Summary

| # | Finding | Severity |
|---|---|---|
| 1 | IQR + SANITY_FLOOR math | — verified correct, no bug |
| 2 | "Unknown Model" — hardcoded `model: null` in client bridging code | **P0 — confirmed, easy fix** |
| 3 | Buyers/sellers keyword classifier ignores negation, overrides listing_type | P1 |
| 4 | Currency double-conversion guard | — verified correct, no bug |
| 5 | min-5 gate scoping (buckets vs overall stats) | — verified correct, no bug |
| 6 | 200-row listing cap has no pagination | P2 — UX limitation |

## Recommendation

Finding 2 is the highest-value, lowest-risk fix in this entire review — it's
a one-line-ish change (wire the existing catalog lookup into either the
server response or the client fetch) with no risk of touching price/currency
logic. Fix this independently of the Review A/B P0s since it's fully
decoupled from the currency-selection bug.
