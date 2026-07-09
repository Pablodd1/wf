# Review B — Mutation Endpoint Safety Audit
`api/reprocess-prices.js` and `api/reprocess-null-dial.js`

## Executive Summary

Both endpoints write directly to the live 608K-row `watch_records` table with
**no dry-run mode, no history/audit table, and no rollback path**. Combined
with Review A's confirmed price-selection bug, this means bad parser logic can
silently overwrite good data with no way to detect or undo it after the fact
— which is exactly what happened this session (the AED-corrupted 52506
records are now live, and there's no "before" snapshot to restore from).
There is also a **live, exploitable P0 security finding**: the admin key is
hardcoded in the public JS bundle.

---

## Finding 1 (P0 — Security): ADMIN_KEY is hardcoded and shipped in the public bundle

```
src/pages/AdminListingsBrowser.tsx:28:  const ADMIN_KEY = 'wf-admin-2026';
src/pages/TradingFloor.tsx:251:      const ADMIN_KEY_WF = 'wf-admin-2026';
src/pages/WatchDetailReport.tsx:201:  headers: {'x-admin-key': 'wf-admin-2026'}
api/update-record.js:13:  const ADMIN_KEY = process.env.ADMIN_KEY || 'wf-admin-2026';
```

**Confirmed live**: fetched the production JS bundle
(`https://watchfacts-poc.vercel.app/assets/index-BS6qKbTh.js`) and the literal
string `wf-admin-2026` is present in it. Anyone who opens browser devtools on
the live site can extract this key and call `reprocess-prices`,
`reprocess-null-dial`, or `update-record` directly against the production
database with no further authentication.

`api/update-record.js` compounds this: even if `ADMIN_KEY` env var were
properly set on Vercel, the code has `|| 'wf-admin-2026'` as a fallback — so
if the env var is ever accidentally unset (deploy misconfiguration, wrong
environment scope), the server silently reverts to the same publicly-known key
instead of failing closed.

**Fix**: (a) remove the hardcoded key from all client files — admin actions
should go through an authenticated session, not a shared static string; (b)
remove the `|| 'wf-admin-2026'` fallback in `update-record.js` — if
`ADMIN_KEY` isn't set, the endpoint should refuse all requests, not fail open
to a known value; (c) rotate the key immediately since it's already public.

---

## Finding 2 (P0 — Data Safety): No dry-run, no history table, no rollback

Confirmed by direct code read: `reprocess-prices.js` and
`reprocess-null-dial.js` both call `.update()` directly with no prior write to
any audit/history table. The old value is only visible in the JSON response
(`old_price`, sample of 5-10 records) which is never persisted anywhere after
the HTTP response is read. Once a batch runs, the only record of "what it was
before" is whatever the terminal operator happened to capture in their own
scrollback.

This is the direct cause of tonight's incident: the 52506 AED-corrupted
records were written by a `reprocess-prices` call, and there is currently **no
way to know exactly which records were touched or what their prior values
were**, beyond re-deriving it by re-running the (buggy) parser against
`raw_message` and comparing — which only tells you what the OLD buggy code
would have computed, not the actual prior `price_usd` in the DB before this
session's edits.

**Fix**: 
1. Add a `?dry_run=true` param to both endpoints — return the diff without
   writing.
2. Add a lightweight `price_history` table (`record_id, old_price,
   new_price, old_verdict, new_verdict, changed_at, changed_by`) and insert a
   row on every mutation, even outside a dry-run. This is cheap and gives a
   real undo path.
3. Until (2) exists, treat every reprocess run as **irreversible** and require
   explicit human sign-off before running against anything beyond a single
   test reference.

---

## Finding 3 (P1): Idempotency is fine; "stuck records" waste cycles, not correctness

Traced the query logic: both endpoints use `ORDER BY id ASC LIMIT N` with a
`WHERE` filter (`dial_color IS NULL` / `brand+reference` match). This is
idempotent in the sense that re-running produces the same result for records
that CAN be fixed — no drift, no double-application, no corruption from
repeated runs on the same rows (a `null`→`value` transition just gets
re-detected as `null`→`same value`, and the `>$10 diff` guard in
reprocess-prices.js correctly no-ops on unchanged values).

**However**: confirmed the NULL-dial count is still 77,539 (matches last
session's ending count exactly — no batches were run in between, so this
doesn't yet prove decay resistance, but it does confirm the number wasn't a
one-off fluke). The real issue: records where `parseFull()` genuinely cannot
extract a dial color (no color word in text, reference not in catalog) will
**always** be re-fetched by every future call, because there's no "already
attempted, unfixable" marker. As the fixable records get progressively
resolved, an increasing share of every batch is wasted re-scanning permanently
NULL rows. This matches the observed pattern from the prior session
(343→248→177→...→1 fills per batch of 500) — not a bug, but a real
efficiency problem that will make future batches slower for zero gain.

**Fix**: add a `dial_lookup_attempted_at` timestamp column (or a
`dial_unfixable=true` flag) set when `parseFull()` returns no dial AND no
catalog match, and exclude those rows from the `WHERE` filter on subsequent
runs. Re-attempt only after a catalog update.

---

## Finding 4 (P1): No protection against concurrent/overlapping runs

`reprocess-prices.js` fetches records, then updates them one at a time in a
plain `for` loop with no locking, no `updated_at`-based optimistic check, and
no idempotency key on the request itself. If two terminal sessions (or a
retried curl due to timeout) run the same brand+reference concurrently, both
will fetch the same current DB state, both will compute updates from the same
(possibly stale) starting point, and whichever `.update()` call lands last
wins — silently discarding the other's work. Given today's session ran
multiple curl loops back-to-back across different references, this
specific interleaving didn't manifest, but it's a live risk for any future
multi-terminal or scripted-parallel run.

**Fix**: add a `WHERE parser_version != 'v4.7-reprocess' OR updated_at <
:batch_started_at` guard, or simpler — a lock row / advisory lock keyed by
brand+reference for the duration of a batch.

---

## Finding 5 (P2): Vercel warm-instance catalog staleness

Both endpoints `require('./_lib/parser')` which does a top-level
`fs.readFileSync` of `public/catalog.json` and `reference-catalog.json` once
per cold start (confirmed via the `[catalog-matcher] Loaded 5876 catalog
entries` log line that only prints once per process, not per request). On
Vercel, a warm serverless instance can persist across many requests. If
`catalog.json` is updated and redeployed, warm instances *will* pick up the
new file on their next cold start (Vercel deploys create fresh instances), but
during a rolling deploy there's a window where old and new instances serve
different catalog data simultaneously. Low risk in practice (deploys are
infrequent, catalog changes rarer still) but worth knowing if catalog-driven
inconsistencies are ever reported across near-simultaneous requests.

**Fix**: not urgent. If it matters later, add a catalog version/hash to the
response so inconsistencies are diagnosable.

---

## Finding 6 (Resolved — verified correct): reprocess-prices.js uses the current parser

Confirmed `reprocess-prices.js` line 14 does `const { parseFull } =
require('./_lib/parser')` — a direct require of the same file just patched
(commits 3c6ddfc, c16a79d, and my own uncommitted changes this session). No
version pinning issue; every deploy picks up the latest parser automatically.
This is actually a point of exposure, not comfort, given Review A's findings
— it means the currency-selection bug is live in this endpoint's behavior
right now.

---

## Severity Summary

| # | Finding | Severity |
|---|---|---|
| 1 | ADMIN_KEY hardcoded + confirmed shipped in public JS bundle | **P0 — Security, exploitable now** |
| 2 | No dry-run, no history table, no rollback path | **P0 — Data safety** |
| 3 | Unfixable NULL-dial rows re-scanned every batch (efficiency, not correctness) | P1 |
| 4 | No concurrency protection between overlapping reprocess runs | P1 |
| 5 | Warm-instance catalog staleness during rolling deploys | P2 |
| 6 | Parser version is always current (confirms Review A bug is live) | — informational |

## Recommendation

Before running reprocess-prices.js again on any reference: (a) fix Review A's
Findings 1-2 first (currency selection), (b) add dry-run mode so the next run
can be previewed before writing, (c) rotate ADMIN_KEY and stop shipping it
client-side. The mutation endpoints are architecturally reasonable for a
one-off remediation script but are not yet safe for repeated ad-hoc use
against production without those three changes.
