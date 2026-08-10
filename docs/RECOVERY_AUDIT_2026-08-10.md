# WF Recovery — Declared Clean Baseline & Read-Only Audit

**Date:** 2026-08-10
**Repo:** Pablodd1/wf
**Clean recovery branch:** `recovery/2026-08-10-readonly-audit`
**Base commit (verified origin/main):** `1a0a80186a254088e51f4027400770ecdfef52ea`
> Merge pull request #267 — `codex/pipeline-reader-api-alignment` — 2026-08-09 09:32:45 -0500

## Scope of this phase (read-only only)

No AI normalization. No historical migration. No database writes. No delete / replay /
publish / overwrite. This document records a declared baseline and a read-only live audit
for the purpose of reconciling source → cursor → job → staging evidence.

## Frozen / off-limits

- **Antigravity dirty workspace**: `/mnt/c/Users/jasme/.gemini/antigravity` (and `-backup`).
  Do not run, push, or migrate from it. It is a reference source only.
- All production-writing / replay / publish / migration processes are frozen until this
  audit is accepted.
- `.env*` files, `scripts/migrate_offset.txt`, `whatsapp-listener/`, and untracked local
  artifacts are NOT committed and MUST NOT be committed (they contain credentials/cursors).

## Verified green items (clean repo)

- `continuous-worker.cjs` (tools/mariadb-live/) uses **correct keyset cursor pagination**:
  `WHERE created_on > ? OR (created_on = ? AND id > ?) ORDER BY created_on ASC, id ASC`.
  Not offset-based.
- Worker is **read-only on source** (`SET SESSION TRANSACTION READ ONLY`,
  `assertReadOnlyGrants`), shadow-writes to local `JSONL.gz`, publishes accountability to
  `source_pipeline_accountability`, and enforces reconciliation
  (source_input = raw + collection_errors; raw = normalized + normalization_errors).
- `/api/health` lives: HTTP 200, `database: reachable` (2026-08-10T01:09Z).

## ⚠️ RECONCILIATION STOP — "~3.87M fabricated 5.0 ratings" does NOT reconcile to DB evidence

The recovery directive listed "Removal of fabricated defaults, especially the
approximately 3.87 million 5.0 ratings" as a target. A read-only audit of the actual
source and Supabase evidence does NOT support that figure.

### MySQL source (`thecollective_inventory`, read-only SELECT)

| Table | Row count | rating note |
| --- | ---: | --- |
| auctions | 1,390,454 | `dealer_rating` int, DEFAULT `0` |
| auction_watches | 1,162,680 | no rating column |
| auctions_listings | 833,845 | no rating column |
| auction_exceptions | 195,341 | no rating column |
| auction_ratings | 0 | — |
| TOTAL (auction/watch/listing) | 4,020,366 | — |

`auctions.dealer_rating` distribution (top of 20 distinct values):
- `0` (default): **1,284,178**
- `2`: 35,869
- `1`: 17,043
- `5`: **10,273** (0.7%)
- remaining lower counts, max distinct value observed ~18/20

There is **no column anywhere that defaults to 5.0**, no table with ~3.87M rows of
rating=5, and no 3.87M-value occurrence. The "3.87M fabricated 5.0 ratings" figure matches
a *report* claim, not database evidence — consistent with the known pattern that
Antigravity's reports "conflict with the actual code and database evidence."

### Supabase staging/accounting

| Table | Count |
| --- | ---: |
| watch_records | unfiltered count HTTP 500 (known full-table timeout; bounded queries only) |
| raw_messages | 0 |
| source_pipeline_accountability | 0 |
| price_remediation_review | 194 |
| dealer_directory_import_staging | 1,624 (1621 rating NULL, 3 rating=5) |
| listing_candidates / normalization_jobs / review_queue / candidate_listings | 404 (table not exposed by that name) |

### Accounting gaps observed (no repair performed)

1. `source_pipeline_accountability` is **empty (0 rows)** even though the continuous worker
   publishes to it — either the collector hasn't run against this DB, or accountability
   writes are not reaching production. Needs: are these the same Supabase project the
   worker writes to?
2. `raw_messages` (0) while the July 27 handoff cites 2,631,476 shadow-analyzed records —
   raw evidence lives elsewhere (shadows/JSONL) or under a different table name.
3. Full-table `watch_records` count times out under PostgREST (HTTP 500) — bounded/keyset
   counting is required; no total asserted here.
4. `listing_candidates`, `normalization_jobs`, `review_queue` are not exposed as public
   PostgREST tables by those exact names — schema names differ.

## Recommended next step (after this report is accepted)

1. Confirm the intended Supabase project URL for `source_pipeline_accountability` writes and
   re-run a bounded read of the accounting ledger.
2. Identify the true "fabricated rating" source (likely a **catalog/review/staging default**
   or the Antigravity migration's insert default) by diffing a raw migrated row against the
   source `auctions.dealer_rating`. Do NOT change data.
3. Then proceed to: repair Trading Floor 503 → Price Research dial/duplicate accuracy →
   AI normalization adapter (GLM 5.2 primary / DeepSeek v4 escalation) → 100/1000/10K gates.

## No writes performed

Explicit: no production/MySQL/Supabase write, no replay, no publish, no delete was executed
during this phase.