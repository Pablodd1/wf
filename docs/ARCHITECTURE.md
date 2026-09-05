# Architecture

## Current Architecture Observed

```text
Static frontend (Vite/React)
-> Vercel API routes in api/
-> Supabase REST/client calls
-> local JSON datasets in public/
-> file catalogs/dictionaries
-> AI provider routes
-> MySQL import scripts
```

## Current Data Entry Points

- `/api/ingest`: live raw message parser and Supabase writer.
- `/api/pipeline-parse`: alternate parsing pipeline.
- `/api/reprocess`: batch reprocessing path.
- `whatsapp-listener/index.js`: WhatsApp listener parser.
- `scripts/import-mysql-*`: historical import paths.
- static `public/parsedWatches.json`: local dataset used by Admin and other legacy flows.

## Target Architecture

```text
Historical MySQL/MariaDB
  -> raw import staging
  -> raw_messages

Green API
  -> webhook verification
  -> raw_messages

raw_messages
  -> context_blocks
  -> listing_candidates
  -> deterministic extraction
  -> catalog reconciliation
  -> AI review for ambiguity
  -> human review for unresolved records
  -> approved listings
  -> analytics/materialized views
```

## Architectural Risks

- Multiple parser implementations.
- Static JSON remains part of operational Admin path.
- Service-role API calls are broad and need route-level authorization.
- Historical migration bypasses raw-message-first architecture.
- Browser-facing pages do not consistently use server-side pagination.

