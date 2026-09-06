# Frozen private normalization

This worker operates only on an already created, verified staging job. It does
not capture MariaDB rows or publish listings. Do not use the historical scripts'
hard-coded source counts or cursor values as a current boundary.

After production discovery, verify the capture checkpoint, manifest hash,
namespace, committed cursor, staged count, and capture error/identical totals.
Create a job using the service-only `create_frozen_normalization_job_v2` RPC with
those explicit values. Its count must match the UUID/hash membership selected
from committed raw staging at that checkpoint. A changed boundary requires a
new job; reusing a job name with changed parameters is rejected. Null source
timestamps stay accounted for. Capture errors remain in the capture ledger and
must be included separately in final source reconciliation.

Run `tools/mariadb-live/run-frozen-normalization-v2.cjs` with:

- `WF_NORMALIZATION_EXECUTE=true`
- `WF_NORMALIZATION_JOB`: the verified job name
- `WF_NORMALIZATION_PROGRESS_FILE`: a private local progress output path
- `WF_NORMALIZATION_BATCH_SIZE`: optional, 1–500 (default 100)
- `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`: the reviewed destination

The worker claims bounded batches using 120-second leases. It verifies and
normalizes each source, then commits proposals, row outcomes and checkpoint
counts together. Network retries reuse the same claim or completion payload.
Changed replays are refused. Abandoned leases can be reclaimed; after three
attempts the row receives `WORKER_RETRY_EXHAUSTED` and a durable error outcome.
Progress files and logs contain aggregate counts, not source messages or contacts.

Outcomes are mutually exclusive: `NORMALIZED`, `REVIEW`, `BUNDLE_HELD`,
`QUARANTINE`, or `ERROR`. Trading Floor and Price Research eligibility are
separate counters. A normalized unpriced single can be Trading Floor eligible.
Bundles remain held under the current singles-only scope. Completion means all
members have a durable normalization outcome, **not** that all members were
published or that errors/review have been resolved.

The service-only status RPC reports exact processed/remaining counts. A completed
job rerun makes no changes. Prior proposal versions remain in the existing
private version ledger. Candidate materialization, verified FX/image admission,
publication generations, final outcome reconciliation and production release
are subsequent gates and are not implemented by this worker.

Validation: `tools/canary-e2e/verify-normalization-jobs.cjs` requires the owned
loopback disposable Supabase marker and existing 50 synthetic public fixtures.
It exercises actual Kong/PostgREST requests, disjoint concurrent claims, atomic
invalid-proposal rejection, no-op replay, an exhausted lease, mixed durable
outcomes, stored proposal hash readback and unchanged public counts. Its private
synthetic evidence is retained. PostgreSQL 15/18 migration replay and its known
historical compatibility overlays are documented in the execution progress log.
