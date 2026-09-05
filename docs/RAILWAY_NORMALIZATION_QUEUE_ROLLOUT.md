# Queue-Based Shadow Normalization Rollout

## Why this replaces the checkpoint

`watch_records.id` is text and contains UUIDs, legacy MySQL IDs, and synthetic
test IDs. A worker that resumes with `id > last_source_record_id` can falsely
report completion and skip valid records. The queue migration assigns explicit
work state to each source record instead.

This rollout remains **shadow-only**. It writes `normalization_shadow_v4` and
`normalization_shadow_work_queue`; it never updates, deletes, or hides a live
Trading Floor record.

## Safe rollout conditions

- The migration has been reviewed and applied successfully.
- One Railway replica only.
- The Vercel cursor cron is disabled or kept inactive while queue mode runs.
- A database backup/point-in-time recovery window is available.
- The initial queue seed is run once in a quiet write window.

## 1. Apply the schema migration

Apply:

```text
supabase/migrations/20260717193000_normalization_shadow_work_queue.sql
```

Confirm the table and RPCs exist:

```sql
select to_regclass('public.normalization_shadow_work_queue') as queue_table;
select routine_name
from information_schema.routines
where routine_schema = 'public'
  and routine_name in (
    'claim_normalization_shadow_work',
    'complete_normalization_shadow_work',
    'release_normalization_shadow_work'
  )
order by routine_name;
```

## 2. Seed historical rows once

Run this exact idempotent statement in the Supabase SQL Editor. It deliberately
uses a set-based insert rather than a text ID cursor. It can take time on the
archive, but it is safe to rerun and does not modify `watch_records`.

```sql
insert into public.normalization_shadow_work_queue (source_record_id)
select id
from public.watch_records
where raw_message is not null
  and length(trim(raw_message)) > 0
on conflict (source_record_id) do nothing;
```

If the dashboard statement timeout interrupts the seed, run it from a direct
Postgres session with a temporary elevated statement timeout. Do not replace it
with `id > ...` pagination.

## 3. Turn on queue mode in Railway

Set the Railway service variable, then redeploy the single existing worker:

```text
SHADOW_WORKER_MODE=queue
SHADOW_BATCH_SIZE=250
SHADOW_ROWS_PER_LEASE=5000
SHADOW_IDLE_DELAY_MS=5000
```

Do not change the existing Supabase URL/key or the job name. Queue mode does
not use the bad checkpoint, but preserves the worker lease so parallel runners
cannot contend.

## 4. Monitor safely

```sql
select state, count(*)
from public.normalization_shadow_work_queue
group by state
order by state;

select count(*) as stale_leases
from public.normalization_shadow_work_queue
where state = 'LEASED'
  and lease_expires_at < now();
```

Railway should log `workerMode:"queue"` followed by `lease_complete`. A
temporary failed row is retried after 60 seconds and becomes `FAILED` only
after eight attempts. Review `FAILED` rows; do not silently discard them.

## Rollback

Set `SHADOW_WORKER_MODE=cursor` and redeploy to stop queue consumption. This
does not remove queue rows or change live records. Do not drop the queue until
the migration is superseded by a reviewed replacement.
