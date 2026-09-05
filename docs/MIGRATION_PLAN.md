# Migration Plan

## Principle

Copy raw evidence first. Normalize later.

## Phase A: Inventory Only

Run from a controlled machine that has source access:

```sql
SELECT VERSION();
SELECT DATABASE();
SHOW TABLES;
```

Then inventory `information_schema` tables, columns, indexes, and counts.

## Phase B: Raw Import

Source MySQL/MariaDB is read-only.

Requirements:

- batch by primary key or stable cursor
- tunable batch size
- independent commits
- checkpoint/high-water mark
- retries with backoff
- idempotent unique source identity
- no LLM
- no normalization
- no user-facing Vercel route

Unique identity:

```text
source_system + source_table + source_primary_key
```

## Phase C: Media Manifest

Copy media separately from text and verify counts, size, and hash where practical.

## Phase D: Reconciliation

Verify:

- exact row counts
- missing IDs
- duplicate source identities
- date ranges
- null/truncated text
- random sample equality
- media object counts
- orphan and missing media
- relationship integrity

## Current Risk

Existing import scripts filter source rows, normalize values, infer currency, compute USD, and write directly to `watch_records`.

