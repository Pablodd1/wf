# Performance Plan

## Objective

Make the public application responsive with a multi-million-row archive without loading the archive into a browser, while keeping raw-message lineage and normalisation work out of user-facing requests.

## Completed Locally

- Trading Floor requests one bounded page from the API (10-100 records, default 50).
- Search and type filtering are passed to PostgREST instead of filtering a downloaded array.
- Requests are debounced and cancelled when the filter changes.
- The API returns an estimated matching count from the `Content-Range` header.
- Routes are loaded with React lazy loading, so charts, spreadsheet export, review, and demo code do not ship on the first page load.
- `supabase-performance-migration.sql` supplies the indexes required for the new access path.
- The live `idx_watch_records_listing_type_created_at_desc` index and an `ANALYZE` refresh were applied successfully on 2026-07-12.
- `EXPLAIN (ANALYZE, BUFFERS)` verified an index scan for the WTS newest-first page: 50 rows returned in 41.455 ms with no sort step.

## Deployment Gate: Schema Reconciliation

The live `watch_records` table was inventoried on 2026-07-12 and contains the fields below. The Trading Floor API now uses this live contract. The checked-in base schema and newer ingestion path still need a separate reconciliation before historical migration or Green API release.

- `id`, `brand`, `reference`, `price_usd`, `price_raw`, `currency`
- `dial_color`, `condition`, `year`, `confidence`, `created_at`
- `listing_type`, `is_multi`, `multi_group_id`, `multi_total`
- `raw_message` or a joinable raw-message preview

## Release Sequence

1. Rotate all credentials exposed outside the secret manager and remove tracked `.env*` files from Git history.
2. Export the live Supabase schema, indexes, row estimates, and query plans for the Trading Floor path.
3. Test the applied composite listing-type/date index with a query plan before adding the larger trigram text-search indexes.
4. Deploy this branch to a staging environment and test pagination, filters, empty results, and search on realistic data.
5. Inspect `EXPLAIN (ANALYZE, BUFFERS)` for the first page, a type filter, a reference search, and a raw-text search.
6. Release to production with error-rate, p95 endpoint latency, and database CPU monitoring enabled.

## Next Performance Work

- Replace `parsedWatches.json` Admin reporting with protected aggregate endpoints.
- Move Price Research cohort and IQR calculation into database-side queries/materialized aggregates.
- Use keyset pagination for deep archive navigation after the UI has a product decision for it.
- Add image/media manifests and object metadata, never scanning a bucket during user requests.
- Run historical migration raw-first with checkpoints; normalisation, image analysis, and LLM review run asynchronously.
