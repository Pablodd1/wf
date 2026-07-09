# CTO Review — Normalization Pipeline — Synthesis & Recommendations
Date: 2026-07-09 | Reviewer: CTO (direct review, subagent delegation failed at infra level)

## Bottom Line

Today's session made real progress (theme restore, dial-fallback fix, price
artifact fixes, browse-by-model endpoints) but also **introduced two new P0
bugs while fixing others**, and the review surfaced **one live, exploitable
security issue** that predates today. None of this is unusual for rapid
iteration against live prod with no test suite — but it means we stop patching
ad-hoc and fix the P0s properly before running any more reprocess batches.

**Do not run `reprocess-prices` or `reprocess-null-dial` again until Fix #1
below is deployed.** Every batch run since the AED bug was introduced risks
silently corrupting more records the same way it corrupted 52506.

---

## P0 — Fix Before Anything Else Touches Production Data

### 1. Currency selection bug (Review A, Findings 1-2)
**Impact**: any dealer message containing BOTH a foreign-currency price and an
explicit USD price can pick the wrong one — confirmed on live data (52506:
$43,500 true price stored as $176,000). Not AED-specific; EUR/GBP/CNY/SGD are
provably exposed to the same class of bug.

**Root cause**: `parsePrice()`'s pattern array picks the first pattern that
produces ANY valid number, with no priority given to explicit currency
authority (a stated `$X USD` should always beat an ambiguous foreign-currency
figure). Compounded by a tokenization gap: `/-` separators (`"176,000/-
AED"`) and `$` + space (`"$ 43,500"`) aren't recognized by the currency-aware
patterns, so both fall through to a currency-blind catchall.

**Recommended fix** (structural, not another regex patch):
1. Normalize dealer punctuation (`/-`, `-`, extra spaces) before pattern
   matching.
2. Rewrite price selection to collect ALL candidate matches from the full
   pattern array, then apply a priority rule: explicit `$`/USD wins over any
   other currency if both are present; otherwise take the highest-confidence
   single match.
3. Add regression tests for this specific case (dual-currency, `/-`
   separator, `$` + space) before deploying — this is exactly the kind of bug
   that will recur if fixed by intuition alone.

### 2. ADMIN_KEY hardcoded and confirmed shipped in the public JS bundle (Review B, Finding 1)
**Impact**: confirmed live — `wf-admin-2026` is extractable from
`https://watchfacts-poc.vercel.app`'s JS bundle right now. Anyone can call
`reprocess-prices`, `reprocess-null-dial`, `update-record` directly against
production with no further auth.

**Recommended fix**: rotate the key immediately (assume it's already
compromised since it's public), remove hardcoded references from all client
`.tsx` files, remove the `|| 'wf-admin-2026'` fallback in
`api/update-record.js` (fail closed, not open, if env var is unset).

### 3. No dry-run, no history table, no rollback path (Review B, Finding 2)
**Impact**: this is why we can't cleanly undo the AED corruption right now —
there's no record of what `price_usd` was before this session's
`reprocess-prices` calls overwrote it.

**Recommended fix**: add `?dry_run=true` to both mutation endpoints before
using them again; add a minimal `price_history` table (even just
`record_id, old_value, new_value, changed_at`) so future runs are undoable.

### 4. "Unknown Model" — confirmed root cause, trivial fix, zero risk (Review C, Finding 2)
**Impact**: cosmetic but visible on every single Price Research page load.

**Root cause**: `src/pages/PriceResearch.tsx` line 126 hardcodes `model:
null` in the client-side bridging code — never looks it up, even though
`public/catalog.json` has the model name for every catalog-matched reference.

**Recommended fix**: wire the existing `/api/catalog` lookup (already built,
already deployed) into either the price-research response or the client
fetch. Fully decoupled from the P0s above — safe to fix independently and
immediately.

---

## P1 — Fix Soon, Not Blocking

| # | Finding | Source |
|---|---|---|
| 5 | `ambiguousCurrency` guard has a co-location blind spot — doesn't catch the dual-currency wrong-selection case, only the "no currency at all" case | Review A #3 |
| 6 | `RATES` constant missing AED (ad-hoc inline fallback instead) — fragile, will silently break again for the next currency someone adds a pattern for | Review A #5 |
| 7 | Unfixable NULL-dial records get re-scanned every batch call with no "already tried" marker — wastes cycles, not a correctness bug | Review B #3 |
| 8 | No concurrency protection if two reprocess runs overlap on the same brand+reference | Review B #4 |
| 9 | Buyers/sellers keyword classifier misclassifies negated phrases ("not looking for trades" → wrongly counted as buyer); should trust `listing_type` first, keyword-match only as fallback | Review C #3 |

## P2 — Low Priority / Technical Debt

| # | Finding | Source |
|---|---|---|
| 10 | Vercel warm-instance catalog staleness during rolling deploys (theoretical, low practical risk) | Review B #5 |
| 11 | Two independent currency-conversion code paths (parser.js at ingest time, price-research.js at read time for legacy records) — works today, but should eventually consolidate to one path | Review C #4 |
| 12 | Price Research listings capped at 200 rows with no pagination cursor | Review C #6 |

## Verified Correct — No Action Needed

- `validatePriceNotReference` 0.05% collision tolerance (Review A #4) — tested at
  boundary, correctly calibrated after this session's earlier fix
- IQR outlier removal + SANITY_FLOOR math (Review C #1) — verified against
  test dataset, matches spec exactly
- Currency double-conversion guard in `convertLegacyPrices` (Review C #4) —
  intact and correctly ordered
- min-5 bucket gate scoping — correctly excludes low-count buckets from
  breakdowns while keeping overall stats inclusive of all non-outlier data
  (Review C #5)
- `reprocess-prices.js` always uses the current parser version, no stale-code
  risk from caching (Review B #6) — though this also means the P0 bug above
  is live in its behavior right now

---

## Recommended Sequencing

1. **Now**: rotate ADMIN_KEY, strip hardcoded references from client code (P0 #2) — pure security fix, zero interaction with the price logic, do it first and separately.
2. **Next**: fix "Unknown Model" (P0 #4) — trivial, isolated, ships a visible improvement immediately.
3. **Then**: the parser currency-selection rewrite (P0 #1) — this is the one that needs care. Write the regression test cases from Review A first, THEN implement, THEN verify all pass before touching prod data again.
4. **Before any further reprocess runs**: add dry-run mode (P0 #3) so the next batch against 52506 (to actually fix the AED-corrupted records) can be previewed before writing.
5. **Then**: re-run reprocess-prices against 52506 specifically to fix the AED-corrupted records, verify manually against the raw messages, THEN consider broader batches.
6. **P1s** as time allows — none are blocking, none are actively corrupting data.

## Process Note

Subagent delegation was attempted for this review (3 parallel tasks) but
failed at the infra/API-key level with zero actual review work done — this
review was performed directly instead. Flagging this so it's not
mistaken for a completed subagent review if referenced later; there are no
subagent artifacts to distrust, but there's also no independent second-model
verification of these findings — normal single-review caveats apply.
