# MariaDB Copy-First Recovery Runbook

## Decision

The legacy `scripts/pipeline_do_reader.py` is retired. It fetched only the newest
100 source rows, could silently fall back to SQLite, coupled historical copying
to normalization, and did not provide immutable source versions or exact batch
accounting.

Historical recovery now has two separate gates:

1. Read-only MariaDB collection into immutable local evidence files.
2. Idempotent import of those exact snapshots into private Supabase raw tables.

Neither gate normalizes or publishes `watch_records`.

## Safety properties

- Source grants are inspected; any privilege beyond read-only SELECT/SHOW VIEW aborts.
- MariaDB runs in a read-only session.
- Keyset cursor is `(created_on, id)`; no OFFSET pagination is used.
- Title, description, comments, seller demographics, source attributes, prices,
  and media references remain together in `raw_data`.
- `raw_message` is the untouched description when present, then untouched title,
  then untouched comments. `raw_message_source` records which field was selected.
- A changed source snapshot creates a new `raw_message_versions` row.
- A repeated snapshot is counted as existing and does not duplicate evidence.
- Database batch receipts make a retry after a client/network interruption idempotent.
- The database checkpoint advances in the same transaction as the raw versions.
- Customer tables, Price Research, and Trading Floor are not mutated by raw copy.
- Bare `$` and missing currency never become USD.
- One collector process exclusively owns an output directory; a concurrent writer
  fails before opening MariaDB or appending evidence.
- JSONL readers split only on ASCII LF. Unicode line separators inside untouched
  source messages remain evidence, not accidental record boundaries.

## Review and deploy schema

Merge the recovery PR, then manually run the GitHub Actions workflow:

`Supabase immutable MariaDB raw import gate`

Enter the required confirmation:

`APPLY_IMMUTABLE_RAW_IMPORT_SCHEMA`

The workflow applies only
`20260810100000_immutable_mariadb_raw_import.sql`, verifies private grants and
RPC availability, and proves the `watch_records` count did not change.

## Bounded canary

Set secrets only in the operator/Railway environment. Never save them in this
repository or an output artifact.

```powershell
$env:MARIADB_IMPORT_MAX_ROWS='100'
$env:MARIADB_IMPORT_BATCH_SIZE='100'
$env:MARIADB_IMPORT_OUTPUT='audit-output/mariadb-live/canary-20260810'
npm run mariadb:collect

$env:MARIADB_RAW_IMPORT_INPUT='audit-output/mariadb-live/canary-20260810/raw-records.jsonl'
$env:MARIADB_RAW_IMPORT_RUN_KEY='mariadb-canary-20260810'
$env:MARIADB_RAW_IMPORT_OUTPUT='audit-output/mariadb-live/raw-import-canary-20260810'
npm run mariadb:import-raw
```

Required acceptance evidence:

- source input = raw output + collection errors;
- raw-import input = inserted versions + existing versions;
- error rows = 0;
- checkpoint status = `RAW_COPY_COMPLETE`;
- random source-to-version raw hashes match;
- media key counts reconcile;
- `watch_records_writes = 0` and `normalization_writes = 0`;
- no Trading Floor or Price Research row count changes.

## Historical copy

Only after the 100-row canary passes, run a 10,000-row copy and repeat all
acceptance checks. A full archive copy requires the explicit collector gate:

```powershell
$env:MARIADB_IMPORT_ALLOW_FULL='true'
```

Do not start normalization merely because raw copy finishes. Normalization is a
separate shadow job with its own benchmark, review, and publication gates.

## Non-watch audit

Count non-watch inventory from immutable raw snapshots, not from a narrow query
that assumes the source brand column is populated. Search title, description,
comments, category ID, structured brand/model fields, and source type. Report:

- source-backed handbag/bag candidates;
- jewelry candidates;
- accessories;
- watches;
- ambiguous luxury items;
- unclassified rows;
- 100 representative raw examples per non-watch/ambiguous cohort.

These counts are an audit result, not permission to auto-publish a category.
