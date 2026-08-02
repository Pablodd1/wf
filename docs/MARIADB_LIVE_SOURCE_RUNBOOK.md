# MariaDB Live Source Runbook

## Decision

`thecollective_inventory.auctions` is the immediate live upstream for WhatsApp
and the small Telegram stream already reaching the legacy system. It is always
read-only from WatchFacts. It does not write directly to `watch_records`.

## Required sequence

```text
MariaDB SELECT-only source
-> immutable local or shadow raw collection
-> exact reconciliation
-> deterministic v4.2 normalization
-> catalog/image/review gates
-> separately approved publication
```

Historical capture and normalization are intentionally separate. AI and image
vision are not permitted during raw capture. Vision may later propose identity
or configuration only when an exact source UUID and reachable media key already
link the image to the raw record.

## Secrets

Set these only in a local process environment or Railway secret store:

```text
MARIADB_HOST
MARIADB_PORT
MARIADB_USER
MARIADB_PASSWORD
MARIADB_DATABASE
```

Never commit them. The collector verifies `SHOW GRANTS` and refuses accounts
with privileges beyond `USAGE`, `SELECT`, and `SHOW VIEW`.

## Bounded collection canary

```powershell
$env:MARIADB_IMPORT_MAX_ROWS='1000'
$env:MARIADB_IMPORT_BATCH_SIZE='250'
$env:MARIADB_IMPORT_OUTPUT='audit-output/mariadb-live/canary-001'
npm run mariadb:collect
```

The collector writes only:

```text
raw-records.jsonl
errors.csv
checkpoint.json
run-manifest.json
reconciliation.json
```

It must report `input_rows = output_rows + error_rows` and both
`production_writes` and `watch_records_writes` as zero.

## Local deterministic normalization

```powershell
$env:MARIADB_NORMALIZE_INPUT='audit-output/mariadb-live/canary-001/raw-records.jsonl'
$env:MARIADB_NORMALIZE_OUTPUT='audit-output/mariadb-live/canary-001-normalized'
$env:MARIADB_NORMALIZE_MAX_ROWS='1000'
npm run mariadb:normalize-local
```

This produces proposals and review dispositions only. It does not approve or
publish a record.

## Continuous freshness monitor

```powershell
$env:MARIADB_STALE_SECONDS='900'
$env:MARIADB_SOURCE_UTC_OFFSET='-04:00'
npm run mariadb:monitor
```

Run the monitor every five minutes. A stale source, missing clock evidence, or
execution failure returns a non-zero exit code and a structured declared error.
Adjust the source UTC offset when Eastern daylight saving time changes.

## Continuous Railway shadow worker

Run this as a dedicated Railway service with one replica and a persistent
volume mounted at `/data`. Do not reuse the customer API service. Configure the
MariaDB secrets in Railway, then set:

```text
NIXPACKS_START_CMD=npm run mariadb:continuous-worker
MARIADB_CONTINUOUS_OUTPUT=/data/mariadb-live
MARIADB_CONTINUOUS_START_AT=1970-01-01 00:00:00
MARIADB_CONTINUOUS_BATCH_SIZE=1000
MARIADB_CONTINUOUS_POLL_MS=30000
```

After applying `20260802160000_source_pipeline_accountability.sql`, the same
service may publish counts and reconciliation only to the owner dashboard:

```text
PIPELINE_ACCOUNTABILITY_ENABLED=true
SUPABASE_URL=<server secret>
SUPABASE_SERVICE_ROLE_KEY=<server secret>
```

These values belong only in Railway's secret store. The status payload contains
no raw message, media, seller, price, or listing row and always declares zero
customer-record writes.

The worker copies immutable source rows and writes deterministic normalization
proposals to the volume. Its checkpoint records exact source and normalization
reconciliation. It never publishes, calls vision, or writes to `watch_records`.
When the optional accountability bridge is enabled, its only Supabase write is
an upsert of counts, cursor, freshness, and errors to
`source_pipeline_accountability`. When caught up it polls for new listings
every 30 seconds.

Only one replica may write to a given volume. Scale normalization later through
the existing four-worker Supabase shadow queue after the raw-volume checkpoint
has been imported and verified.

## Publication boundary

- Trading Floor requires a single listing, supported brand/reference, approved
  verdict, sufficient confidence, safe status, and exact seller/media lineage.
- Price Research additionally requires explicit source currency and asking
  price evidence. A bare dollar sign is ambiguous.
- Bundle parents remain out of analytics until accepted children reconcile.
- Contact fields remain private unless publication approval is explicit.
- Images remain hidden unless exact source-image lineage is recorded.
