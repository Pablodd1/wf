# WatchFacts CTO Status - 2026-07-18

## Completed in this rollout

- Added admin-only Dashboard and Multi-listing routes.
- Provisioned the requested Supabase Auth administrator with an `admin` app role. The password is not stored in Git.
- Added verified dealer directory and profile surfaces with WTS, WTB/NTQ, active listing, review, rating, group, and posting-year metrics.
- Added protected raw-message access for authenticated listing review.
- Changed Hire Fi to `https://luxfi.ai/#add-fi`.
- Corrected Price Research navigation so a dial appears once; New, Used, and Unspecified are condition filters under the dial.
- Preserved Unspecified condition as unknown evidence. It is never silently converted to Used.
- Added admin multi-listing review with immutable raw parent evidence and proposed child candidates.
- Added a checkpointed JSONL exporter for the full multi-listing queue.
- Applied dealer lineage and profile schema to production.
- Scanned 17,000 raw source records and staged 1,580 explicit `company_id` candidates as `PENDING`.

## Verified evidence

- Deterministic normalization tests: 81 passed.
- Production build: passed.
- Admin authentication: login and session both returned HTTP 200 with role `admin`.
- Multi-listing evidence is held in shadow normalization, not the legacy `listing_type` field:
  - Explicit `listing_type=MULTI`: 1 observed row.
  - Planned `BUNDLE_SPLIT_REQUIRED` shadow queue: approximately 757,433 source records.
- Rated-dealer URL redirects to the legacy WatchFacts login. No directory records were guessed or imported from an unauthenticated page.

## Multi-listing separation policy

1. Keep the original raw parent message immutable.
2. Review proposed line-level child candidates against exact raw lines.
3. Confirm brand, reference, dial, condition, intent, price, and currency for each child.
4. Materialize approved children with parent and line lineage.
5. Suppress the parent from Price Research only after every accepted child is persisted.
6. Run duplicate review after splitting, never before.
7. Keep unresolved children and the parent in review; do not publish them as pricing observations.

## Pending and blocked

1. Import an authenticated export from `watchfacts.com/rated-dealers` into `dealer_directory_import_staging`.
2. Compare that directory with the 1,580 staged source company IDs and resolve verified identities.
3. Backfill `watch_records.dealer_id` only from approved identity matches.
4. Run the full checkpointed multi-listing export and begin reviewed child materialization in bounded batches.
5. Validate dealer profile counts after lineage backfill.
6. Run production browser smoke tests after the branch deployment completes.

The rated-dealer URL is an internal research source supplied to assist identity
reconciliation when a dealer cannot be resolved from WatchFacts data. It is not
a customer-facing partner link, must not appear in site navigation or dealer
profiles, and must not be imported as a verified dealer without independent
matching evidence and approval.

## Safety conditions

- No source raw message is overwritten.
- No Unspecified condition is guessed as Used.
- No source company ID is published as a verified dealer without directory evidence.
- No bundle parent is suppressed before approved children exist.
- No duplicate is deleted merely because dates differ.
