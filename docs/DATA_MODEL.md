# Data Model

## Current Repo Schema

`supabase-watchfacts-schema.sql` defines:

- `watch_records`
- `live_ingest`
- indexes on verdict, brand, reference, and live received time
- RLS enabled with service-role policies
- `upsert_watch_records(records JSONB)`

## Gaps Against Target Contract

The current `watch_records` schema is too narrow for full lineage and analytics. It lacks first-class fields/tables for:

- immutable raw source identity
- source system/table/primary key
- source line/block
- context blocks
- listing candidates
- multiple price types
- FX rate/source/date
- currency evidence/confidence
- catalog candidates
- image/media relationship
- review reason codes as a normalized queue
- parser/normalization versioning
- migration batch/checkpoint IDs

## Target Tables

```text
raw_messages
message_media
context_blocks
listing_candidates
normalized_listings
listing_prices
listing_field_assertions
catalog_candidates
review_queue
review_actions
migration_batches
migration_checkpoints
media_manifest
market_reference_indicators
```

