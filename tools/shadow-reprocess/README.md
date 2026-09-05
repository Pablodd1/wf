# Normalization v4 shadow reprocessor

This worker reads existing `watch_records`, computes normalization v4 proposals,
and writes only to `normalization_shadow_v4`. It never updates live listings.

Start with:

```text
DRY_RUN=true
MAX_ROWS=1000
BATCH_SIZE=250
```

After reviewing dry-run output and applying the shadow migration, run with
`DRY_RUN=false`. The legacy script uses an ID checkpoint and is retained only
for historical diagnostics; do not use it for the live archive after the queue
rollout below.

Required secrets:

```text
SUPABASE_URL
SUPABASE_SECRET_KEY or SUPABASE_SERVICE_ROLE_KEY
```

This container can run as a Railway service, Render background worker, or Cloud
Run Job. Railway is the fastest operational path if the project is already connected.

## Production queue rollout

The production archive contains multiple ID formats, so a lexical `id > cursor`
checkpoint can skip rows. `20260717193000_normalization_shadow_work_queue.sql`
introduces a durable queue with transactional `FOR UPDATE SKIP LOCKED` claims.
It writes only shadow proposals.

1. Apply the migration during a quiet write window.
2. Run the reviewed one-time, idempotent historical enqueue statement from
   `docs/RAILWAY_NORMALIZATION_QUEUE_ROLLOUT.md`.
3. Set Railway `SHADOW_WORKER_MODE=queue` and redeploy exactly one worker.
4. Verify queue counts and Railway `lease_complete` logs before considering any
   promotion. Do not bulk-promote shadow rows.

Cursor mode is a finite historical scan and exits after it reaches the end of
the current archive. Queue mode remains alive by default so it can receive new
work. `SHADOW_EXIT_ON_COMPLETE=true|false` may override that behavior for an
explicit operational reason; do not force a completed cursor scan to poll every
few seconds.

## Targeted remediation

After a parser correction, re-evaluate one existing shadow-review bucket before
changing any live data. The remediation worker updates only
`normalization_shadow_v4`; it never writes `watch_records`.

Start with a bounded dry run:

```text
DRY_RUN=true
REMEDIATION_FLAG=PRICE_PARSE_FAILED
REMEDIATION_MAX_ROWS=1000
REMEDIATION_BATCH_SIZE=250
node tools/shadow-reprocess/remediate-shadow-flag.cjs
```

Review the `cleared` and `stillFlagged` totals. Only then run the same bounded
job with `DRY_RUN=false`. Increase the maximum gradually after each measured
result; do not run a full bucket blindly.

