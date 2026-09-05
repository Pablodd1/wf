# Supabase post-upgrade normalization canary

**Date:** July 25, 2026
**Mode:** bounded production shadow canaries
**Release decision:** two queue workers at batch 250 passed the bounded gate;
do not begin a full-dataset run.

## Scope and safety

The owner explicitly approved implementation and continuation after reporting a
Supabase compute upgrade. The exact Supabase tier was not read from the
dashboard, so this report relies on measured behavior rather than a tier claim.

Allowed writes were limited to:

- `normalization_shadow_work_queue`;
- `normalization_shadow_v4`;
- the short-lived normalization lease used by the legacy one-worker canaries.

No `watch_records` row was updated, deleted, hidden, or promoted. The Railway
service remained stopped; the canaries ran from the review branch with
production environment variables through `railway run`.

## Preflight

- Railway project: `satisfied-vibrancy`, production service `wf`.
- Deployed service: one replica, stopped after its completed cursor run.
- Production worker variables had batch size 250 and rows per lease 5,000.
- `SHADOW_WORKER_MODE` was unset, so the deployed default remained `cursor`.
- No active normalization lease existed.
- The production queue existed but contained zero rows.
- Planner estimate for `normalization_shadow_v4`: 2,631,468 rows.
- Planner estimate for source rows with a raw message: 2,631,144 rows.
- An exact full-table shadow count returned HTTP 500; the canaries used bounded
  exact queue and ID readbacks instead.

## Canary results

| Gate | Cohort | Workers | Batch | Runtime | Rows/sec | Changed proposals | Result |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| Baseline | 10,000 | 1 | 250 | 125.4 s | 79.74 | 7,405 | Passed |
| Batch-size test | 25,000 | 1 | 500 | 305.4 s | 81.86 | 18,749 | Passed |
| Concurrency test | 50,000 | 2 | 250 | 279.42 s | 178.94 | 37,530 | Passed |

Batch 500 improved throughput by only 2.65% over batch 250. That gain does not
justify larger transactions, so batch 250 remains the recommended size.

Two workers improved throughput by 124.39% over the one-worker batch-250
baseline. This is the first measured evidence that the upgraded database path
can benefit from bounded queue concurrency.

## Cohort evidence

### 10,000-row baseline

```text
Selection: first 10,000 raw-message watch rows ordered by id
SHA-256: d3971ea691a52ddb79714f9353983a713925b19720eed7c55f9dbba06e4c48e4
Queue: 10,000 COMPLETE; 0 PENDING; 0 LEASED; 0 FAILED
Shadow: 10,000 unique; 0 missing; 10,000 v4.2
Attempts: 10,000 exactly once
Errors: 0
```

### 25,000-row batch-size test

```text
Selection: next 25,000 raw-message watch rows ordered by id
SHA-256: 6af954323970685df7a9e121bef1325726c49ce3e6522a89bc89ca37d8b8f9d0
Queue: 25,000 COMPLETE; 0 PENDING; 0 LEASED; 0 FAILED
Shadow: 25,000 unique; 0 missing; 25,000 v4.2
Attempts: 25,000 exactly once
Errors: 0
```

### 50,000-row two-worker test

```text
Selection: next 50,000 raw-message watch rows ordered by id
SHA-256: e9e0cd9f90e4d3b61652176505d793741cd5bdb63be616d952377be1d737c724
Worker A: 25,000 processed; 18,711 changed
Worker B: 25,000 processed; 18,819 changed
Queue: 50,000 COMPLETE; 0 PENDING; 0 LEASED; 0 FAILED
Shadow: 50,000 unique; 0 missing; 50,000 v4.2
Attempts: 50,000 exactly once
Errors: 0
Active leases after completion: 0
```

Across all three gates, the private queue now contains 85,000 completed rows,
zero pending rows, zero leased rows, and zero failed rows. The shadow proposals
contain 63,684 changed rows. These are proposals, not approvals or customer
publication.

## Implementation finding

- **Severity:** High
- **Classification:** worker concurrency and throughput
- **Files:** `tools/shadow-reprocess/railway-worker.cjs`;
  `tests/normalization-work-queue.test.cjs`
- **Current behavior before correction:** queue mode used row-level
  `FOR UPDATE SKIP LOCKED` claims but also acquired one global job lease, so
  multiple replicas serialized.
- **Evidence:** the one-worker batch-500 test gained only 2.65%; after removing
  the redundant global lease only for queue mode, two workers processed
  separate 25,000-row claims and reconciled 50,000/50,000.
- **Business/data impact:** bounded queue work can now scale without changing
  parser behavior or touching customer rows.
- **Security/operational impact:** cursor mode retains its global lease.
  Queue claims remain service-role-only, bounded to 1,000 rows per RPC, leased,
  retryable, and fail-closed.
- **Recommended correction:** merge the reviewed queue-only lease change, then
  deploy queue mode with two replicas and batch 250 for the next bounded
  shadow cohort.
- **Regression tests required:** queue mode bypasses the global lease; cursor
  mode retains it; queue RPC uses `SKIP LOCKED`; failed claims are released and
  bounded by retry limits.
- **Migration/dependency risk:** no schema migration is required. The existing
  queue migration and RPCs must be present. The current deployed worker remains
  the old stopped build until this branch is reviewed and merged.

## Capacity estimate

At the measured two-worker rate:

| Scope | Rows | Compute plus current shadow I/O estimate |
| --- | ---: | ---: |
| All watch records | 2,631,583 | 4.09 hours |
| Current pending proposals | 1,988,995 | 3.09 hours |

These estimates exclude queue seeding, retries outside the clean canary,
operator monitoring, catalog repair, human review, promotion, images, sellers,
bundles, and duplicates.

## Next safe gate

1. Review and merge the queue-only global-lease change.
2. Deploy with `SHADOW_WORKER_MODE=queue`, two replicas, batch 250.
3. Seed only the next explicitly bounded cohort.
4. Monitor queue states, error/retry rate, database latency, connections, and
   I/O.
5. Reconcile the complete cohort before any expansion.

Do not seed the entire archive, start four replicas, or promote shadow rows
under this gate.
