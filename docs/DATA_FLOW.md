# Data Flow

## Current Flow Examples

### Trading Floor

```text
TradingFloor.tsx
-> GET /api/ingest
-> Supabase REST watch_records limit 50
-> client-side filter/search/count
```

This is not full-dataset search.

### Admin

```text
AdminPage.tsx
-> GET /parsedWatches.json
-> compute local counts in browser
```

This is not a live database total.

### Server Ingest

```text
POST /api/ingest
-> save raw_messages
-> split candidates
-> parse JASS-5
-> optional DeepSeek fallback
-> insert watch_records, listing_prices, listing_field_assertions
```

This is closer to the target but still needs authentication, idempotency, context handling, and stronger contracts.

### Historical Import

```text
MySQL scripts
-> query filtered auctions
-> infer normalized fields
-> insert watch_records
```

This should be replaced by raw-message import first.

