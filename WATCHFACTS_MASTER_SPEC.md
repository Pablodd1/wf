# WatchFacts Master Specification

Date: 2026-07-12

## Product Objective

WatchFacts turns noisy dealer chat data into a traceable watch-market intelligence system. It must support historical backfill, live Green API ingestion, robust watch normalization, Trading Floor browsing, Price Research, demand/supply analytics, liquidity indicators, and human review.

## Core Surfaces

- Trading Floor: current and historical WTS/WTB listings with server-side search and filters.
- Price Research: comparable cohort analytics by reference/configuration.
- Admin: live counts, queues, migration status, reprocess controls, and operator review.
- Review queues: AI review, human review, recycle/reprocess, and unresolved media/configuration cases.

## Source Systems

- Historical MySQL/MariaDB source, currently accessed through DBeaver or scripts.
- Supabase/PostgreSQL as target application database.
- DigitalOcean Spaces or S3-compatible object storage for media.
- WhatsApp/Telegram and future Green API for live events.
- AI providers used only after deterministic parsing and catalog checks.

## Immutable Evidence

Every incoming message and media attachment must be preserved before normalization. No parser, AI provider, or human edit may overwrite source evidence.

Required raw-message fields:

```text
source_system
source_table
source_primary_key
external_message_id
source_platform
group_id
sender_id
sender_phone
received_at
raw_text
raw_payload
media_count
ingest_batch_id
processing_status
created_at
```

## Normalization Contract

Each candidate listing must preserve:

```text
raw_message_id
context_block_id
candidate_id
source_line_start
source_line_end
brand_claimed
brand_normalized
reference_claimed
reference_normalized
model_claimed
model_normalized
dial_claimed
dial_normalized
condition_claimed
condition_normalized
set_status_claimed
set_status_normalized
price_raw_text
asking_price_original
currency_original
currency_evidence
currency_confidence
price_usd
fx_rate
fx_rate_date
fx_source
intent
intent_confidence
catalog_match_status
catalog_candidate_ids
text_confidence
image_confidence
final_confidence
approval_state
review_reason_codes
parser_version
normalization_version
```

## Currency Principles

- `$` alone is ambiguous.
- HKD section context applies to following listing rows until replaced.
- Explicit line currency wins over section context.
- Dealer geography is supporting evidence only.
- Preserve original currency and amount.
- Convert to USD with recorded FX metadata.
- Use asking price for analytics.

## Migration Principles

The 2.4 million historical message count is not confirmed by repository files. It must be verified from the source database with exact counts. Initial migration must copy raw evidence only; normalization happens afterward inside Supabase.

## Green API Principle

Green API must not write directly to final normalized tables. It must write immutable raw events, then enqueue the same normalization pipeline used for historical data.

## Current Phase 1 Status

Repository evidence confirms a 117,744-row `public/parsedWatches.json` dataset and a Trading Floor endpoint limited to 50 records. The larger historical archive is not confirmed by repository-managed data.

