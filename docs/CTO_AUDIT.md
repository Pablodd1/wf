# CTO Audit

Date: 2026-07-12
Branch: `audit/cto-full-review`

## Executive Summary

WatchFacts has a useful foundation, but production readiness is blocked by security exposure, inconsistent normalization paths, fragile historical migration, and large-dataset UI/API limits.

The repo builds successfully, but lint currently fails. The repository-managed dataset contains 117,744 rows in `public/parsedWatches.json`; the approximately 2.4 million historical raw messages are not confirmed in repo-managed files.

## Scores

- Security score: 3/10
- Migration readiness: 4/10
- Normalization reliability: 5/10
- Scalability: 4/10
- UI/UX large-data readiness: 5/10
- Build reproducibility: 7/10

## Confirmed Findings

### Critical: Secrets and environment files are committed

- Classification: Confirmed defect
- Evidence: `.env.prod`, `.env.production`, `.env.vercel` are tracked by Git even though `.gitignore` excludes `.env*`.
- Impact: Production/staging credentials may be exposed. Rotate secrets and purge them from Git history.
- Correction: Rotate credentials, remove files from tracking, use Vercel/Codex/runner secret stores, and scan history.
- Tests: Add secret-scanning CI.

### Critical: MySQL credentials are hardcoded in migration scripts

- Classification: Confirmed defect
- Evidence: `scripts/import-mysql-auctions.cjs`, `scripts/import-mysql-run.sh`, and `scripts/import-mysql-auctions.sh` contain direct source DB host/user/password patterns.
- Impact: Source data is exposed and scripts cannot be safely shared or run in CI.
- Correction: Rotate credentials and move all access to environment variables or local config outside Git.
- Tests: Secret scanner and migration dry-run with env-only credentials.

### Critical: Migration normalizes while copying

- Classification: Design risk
- Evidence: `scripts/import-mysql-auctions.cjs` reads source rows, infers currency, computes USD, scores confidence, and writes directly to `watch_records`.
- Impact: Raw evidence can be lost or distorted; reruns are not a clean immutable import.
- Correction: Build a migration control plane that first copies raw rows into staging/raw tables, then verifies, then normalizes later.
- Tests: Checkpoint, idempotency, count reconciliation, raw equality samples.

### High: Trading Floor only loads 50 rows and filters client-side

- Classification: Confirmed defect
- Evidence: `api/ingest.js` GET uses `watch_records?order=created_at.desc&limit=50`; `src/pages/TradingFloor.tsx` filters the downloaded array.
- Impact: It cannot display or search millions of records. Header counts are loaded-row counts, not database totals.
- Correction: Add authenticated server-side search, filters, counts, and cursor pagination.
- Tests: API pagination/count tests and UI integration tests.

### High: Admin totals come from local JSON, not live database

- Classification: Confirmed defect
- Evidence: `src/pages/AdminPage.tsx` fetches `/parsedWatches.json`; the file has 117,744 rows.
- Impact: Admin totals do not prove production database state or the 2.4 million source count.
- Correction: Add protected aggregate endpoints and remove production reliance on static JSON.
- Tests: Admin count endpoint tests with fixtures.

### High: `$` and missing currency can resolve to USD

- Classification: Confirmed defect
- Evidence: `src/utils/parseEngine.ts` maps `$` to USD and defaults missing currency to USD unless a phone-country pattern appears.
- Impact: HKD dealer inventory can be mispriced by roughly 7.8x in USD analytics.
- Correction: Introduce inherited currency context and require ambiguity handling.
- Tests: HKD section fixtures and dual-currency fixtures.

### High: Server ingest has partial context but misses currency inheritance

- Classification: Probable defect
- Evidence: `api/ingest.js` inherits brand/condition headers but not section currency; `extractPrices` only recognizes explicit currency tokens.
- Impact: `HKD ~ Without Box` followed by `$283000` may fail or misclassify depending on dictionary entries.
- Correction: Context block parser must carry brand, condition, package, intent, availability, and currency.
- Tests: Multi-line HK inventory fixture.

### High: Price Research caps reference rows at 5000 and uses non-canonical IQR

- Classification: Confirmed design risk
- Evidence: `api/price-research.js` limits rows to 5000 and uses 1.0 * IQR with analytics ready at 4 records.
- Impact: Results may not use full history and may over-remove outliers.
- Correction: Query precomputed/reference-indexed analytics or paginated cohorts; use 1.5 * IQR and sample warnings.
- Tests: Outlier and low-sample tests.

### Medium: Multiple parser pipelines conflict

- Classification: Design risk
- Evidence: Parsing logic exists in `src/utils/parseEngine.ts`, `api/ingest.js`, `api/pipeline-parse.js`, `api/reprocess.js`, `whatsapp-listener/index.js`, and migration scripts.
- Impact: Same raw message can produce different currency, price, confidence, and state depending on path.
- Correction: Establish one canonical normalization contract and regression suite.
- Tests: Same fixture through every entrypoint.

### Medium: Build passes but lint fails

- Classification: Confirmed defect
- Evidence: `npm ci` passed; `npm run build` passed; `npm run lint` failed with 171 issues.
- Impact: CI quality gate cannot pass if lint is enforced.
- Correction: Fix lint on a separate PR after audit.
- Tests: CI lint gate.

## Positive Findings

- Supabase schema includes indexes on verdict, brand, and reference.
- Server ingest stores raw messages before creating listing records.
- Server ingest has an initial state-machine concept, assertions, listing prices, and field evidence.
- Price Research avoids invented liquidity values and tries to use real indicators.
- React build succeeds.
- `react-virtuoso` is available for future virtualized UI.

## Explicit Confirm/Deny

- 2.4 million source messages in repo-managed dataset: not confirmed.
- Trading Floor can display/search 2.4 million records: denied for current `/api/ingest` path.
- Admin total is live database count: denied for current `AdminPage`.
- Price Research uses full normalized dataset: not confirmed; current API caps matched rows at 5000.
- Current migration is safely resumable/idempotent raw import: denied for existing scripts.
- Images can be reliably linked to original messages and candidates: not confirmed from current audit.

