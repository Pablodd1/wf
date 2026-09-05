# Known Issues

## Critical

- Tracked `.env*` files.
- Hardcoded MySQL credentials in scripts.
- Historical import scripts normalize while copying.
- Trading Floor retrieves only 50 rows from `/api/ingest`.
- Admin reads static `parsedWatches.json`.
- Older parser defaults unresolved currency to USD.

## High

- Multiple parser pipelines can disagree.
- Price Research limits rows to 5000.
- Price Research uses 1.0 * IQR and analytics threshold of 4.
- Server ingest lacks confirmed inherited currency context.
- API routes need authentication/idempotency audit.

## Medium

- Lint fails with 171 issues.
- Build has large chunk warnings.
- Supabase schema is narrower than target lineage model.
- Image-to-message-to-candidate linkage is not confirmed.

