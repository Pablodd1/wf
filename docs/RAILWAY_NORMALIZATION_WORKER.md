# Railway Shadow Normalization Worker

This worker accelerates the archive scan without exposing Supabase credentials
to the browser or changing `watch_records`. It writes only:

- `normalization_shadow_v4`
- `normalization_shadow_checkpoints`
- `normalization_worker_leases`

## Before deployment

Apply this migration in the **WatchFacts production Supabase SQL Editor**:

```text
supabase/migrations/20260713030000_normalization_worker_lease.sql
```

The lease prevents the Railway worker and Vercel cron from advancing the same
checkpoint simultaneously.

## Railway configuration

1. Create a new Railway service from `Pablodd1/wf`.
2. Railway detects `railway.json`; do not expose a public domain for this
   service.
3. Add these service environment variables from the existing WatchFacts Vercel
   Production configuration. For the active v4.1 dial rollout, keep the
   production checkpoint name and conservative lease sizing:

```text
SUPABASE_URL=<existing production value>
SUPABASE_SERVICE_ROLE_KEY=<existing production value>
SHADOW_JOB_NAME=normalization-v4-dial-production
SHADOW_BATCH_SIZE=250
SHADOW_ROWS_PER_LEASE=5000
SHADOW_IDLE_DELAY_MS=5000
```

4. Deploy one replica only. Do not configure multiple replicas.
5. Verify Railway logs show `worker_started`, then `lease_complete`.
6. Check production progress at:

```text
https://watchfacts-poc.vercel.app/api/shadow-status
```

## Throughput tuning

Do not tune the active `normalization-v4-dial-production` rollout upward while
Supabase statement timeouts are still appearing. Keep exactly one replica,
preserve the lease migration, and change only one setting at a time after a
measured clean window.

The Vercel shadow-normalize cron is removed once Railway has shown stable lease
cycles. Never run both without the lease.

## Read-only progress report

Use the local report to capture exact checkpoint progress, planner-estimated
change-flag counts, and a bounded evidence sample without scanning the full
archive:

```text
railway run npm run shadow:progress
```

The checkpoint values are exact and job-specific. Flag counts are PostgreSQL
planner estimates across `normalization_shadow_v4`; that table does not store
`job_name`, so these counts can include rows from earlier shadow passes.
Evidence breakdowns are sampled near the active checkpoint and are for rollout
monitoring only; they are not promotion evidence.
