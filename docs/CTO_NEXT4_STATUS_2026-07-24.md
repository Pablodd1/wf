# CTO next-four gate status - 2026-07-24

## Scope

This checkpoint covers the next safe rollout gates after the verified seller-lineage canary. It is evidence-only: no public listing rows, analytics rows, dealer assignments, contacts, images, or duplicate suppressions were changed.

## Gate 1 - production migration ledger

**Status:** VERIFIED; migration replay remains blocked by ledger drift.

Evidence:

- `.github/workflows/supabase-migration-ledger-check.yml` is manual-only and requires `INSPECT_PRODUCTION_MIGRATION_LEDGER`.
- The workflow runs `supabase migration list` and explicitly does not apply migrations.
- The successful GitHub Action run was `30112570920`, job `89550558421`.
- The workflow reached the remote database and ran `supabase migration list` successfully.
- The exact `origin/main` commit used by the Action is `08700ea`; it contains **39 migration files**.
- The ledger contains **39 repository-side entries** and **2 remote-only migrations**; no migration is marked applied on both sides in the captured output.
- Remote-only migrations: `20260629194201`, `20260629224734`.
- Supabase identifies them as `reference_images_table` and `reprocessing_queue_table`.
- The remote SQL was inspected read-only. It creates catalog-image/reference tables,
  image-related listing columns, a reprocessing queue, and progress counters; it does
  not delete or transform listing data.
- The Supabase dashboard also reports that the project is exhausting multiple
  resources. Large writes and queue workers remain paused until that is addressed.
- Infrastructure evidence: Micro compute, 2 CPU cores, 1 GB RAM, 87 Mbps baseline
  disk I/O, 2,085 Mbps burst ceiling, and a 30-minute daily burst budget.
- Repository-side entries include `20200101000000` and the 2026-07-12 through 2026-07-22 migration sequence.
- No migration was replayed locally or remotely during this checkpoint.

Required next action: reconcile the two remote-only entries and the 39 repository-side entries with the migration history and deployment records. Do not run `supabase db push`, enable automatic migrations, or delete ledger rows until the owner confirms which side is authoritative.

The two reconciled repository files are:

- `supabase/migrations/20260629194201_reference_images_table.sql`
- `supabase/migrations/20260629224734_reprocessing_queue_table.sql`

They restore the original production versions for future ledger comparison; they
were not executed against production by this change.

## Gate 2 - seller-lineage canary handoff

**Status:** COMPLETE for private staging; owner review still required before expansion.

Evidence from `wf-data-canary/audit-output/dealer-lineage/seller-lineage/run-2026-07-24`:

| Measure | Result |
| --- | ---: |
| Manifest rows | 100 |
| Private staging rows read back | 100 |
| Matched | 100 |
| Unmatched/conflicting/orphaned | 0 / 0 / 0 |
| Field mismatches: phone/name/intent/date/linkage/title/image | 0 / 0 / 0 / 0 / 0 / 0 / 0 |
| Explicit consent | 0 |
| Public contacts/images/listings changed | 0 / 0 / 0 |

The canary is not public dealer verification. All 100 remain blocked pending approved dealer mapping and explicit contact consent. Expansion to the 16,094 match-ready rows is not authorized.

The 98 known intent conflicts remain blocked: 94 source WTB vs normalized WTS and 4 source WTS vs normalized WTB. Exact raw message, timestamp, and phone evidence exists for all 98, so they require child-level intent review rather than automatic correction.

## Gate 3 - seller-aware repost review

**Status:** READY FOR HUMAN REVIEW; no suppression applied.

The private reconciliation produced 345 seller-aware repost clusters containing 899 rows and 345 broader configuration-history clusters containing 1,063 rows. The reviewer CSV has 345 data rows plus its header and contains pseudonymous seller identity, fingerprints, dates, parent/child IDs, blank decision fields, and a `HUMAN_REPOST_REVIEW_REQUIRED` policy.

Rules remain:

- split bundle children before duplicate decisions;
- preserve all raw observations;
- do not merge different dealers automatically;
- treat changed dates as repost evidence, not proof of identical physical inventory;
- use only `SUPPRESS`, `KEEP_BOTH`, or `DEFER` after raw-message and seller-lineage review.

## Gate 4 - first duplicate-review selection

**Status:** SELECTED LOCALLY; live staging blocked until the migration/table access is verified.

Local command result:

```text
rows=100
scanned=317
bundleRiskSkipped=217
missingSourceIds=0
write=false
publicRowsMutated=0
```

Selection artifact: `audit-output/duplicates/review-selection-next-100.csv`.

The subsequent evidence audit requires live `watch_records` access to retrieve both source rows and compare raw message, seller identity, and intent. A live private-table probe returned HTTP 401 for the service credential used in this run. Therefore no candidate was staged to Supabase and no decision was inferred.

## Emoji-price regression coverage

No exact Alex raw-message fixtures were added because none were present in the repository inputs during this run. The existing `tools/price-quality/audit-emoji-prices.cjs` is read-only and explicitly distinguishes deterministic numeric keycaps from private pictographic codes; it never guesses a price. Exact raw examples must be supplied or re-exported before creating fixtures.

## Verification

- Duplicate-review workflow tests: 12 passed.
- Dealer-directory tests: 3 passed.
- Security tests: 22 passed.
- Full repository lint remains a separate legacy-debt issue; this checkpoint did not broaden that work.

## Remaining blockers

1. Authenticate GitHub CLI and run the read-only production migration ledger workflow.
2. Restore a valid, rotated Supabase service credential and verify the private duplicate-review table/migration.
3. Fetch and audit the first 100 duplicate pairs against raw messages and seller lineage.
4. Obtain owner decisions for the 100 duplicate candidates and the 345 seller-aware repost clusters.
5. Do not expand seller-lineage staging, publish contacts/images, suppress duplicates, or enable forecasts until those decisions are recorded.
