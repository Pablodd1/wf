# Seller Listing Lineage Import

**Date:** July 20, 2026
**Scope:** unbundled parent messages and the private seller listing export

## Decision

Seller identity is a separate evidence-reconciliation stage. It does not alter raw messages, normalize prices, verify dealers, expose phone numbers, or publish listings. The reusable importer accepts one parent CSV, several CSVs, or a directory, then streams the 1.29-million-row seller export once.

## Source profile

The private seller export contains 1,293,376 rows from 8,658 normalized phone identities. It includes source listing ID, origin, sale/search intent, observed name, phone, title SHA-1, front-image filename, and original posting time. A direct seller-ID to unbundled-parent-ID join produced no matches, so ID equality is prohibited.

For batch 002, prior read-only profiling found 5,541 unique phone matches using exact message text and exact preserved wall-clock time. Of those, 5,441 agreed on intent and 100 had an intent discrepancy requiring review. The manifest tool reruns this evidence test from source and records its own counts; this paragraph is not a substitute for the generated report.

The production implementation was then run against all 50,000 batch-002 parents and all 1,293,376 seller rows. Its stricter exact-raw-SHA-1 gate produced 5,350 `MATCH_READY`, 98 `REVIEW_REQUIRED`, and 44,552 unmatched parents. All 5,448 exact matches carried a front-image filename; 146 had a valid phone but no observed seller name. A 100-row dry run passed with zero database writes. The lower total than the normalized-text profile is intentional: 93 near-text matches were not silently promoted.

The subsequent private child-lineage reconciliation intersected those exact
parents with all 54,170 staged batch-002 children. It recovered seller and
source-date evidence for 2,781 children across 1,217 parents. All matched child
intents agree with their source-parent intents; 39 retain an exact phone identity
but no observed name. No dealer IDs, contacts, images, approvals, duplicate
suppression, or public rows were changed. Detailed evidence is in
`docs/SELLER_CHILD_LINEAGE_RECONCILIATION_2026-07-20.md`.

## Intent-conflict review

The 98 `REVIEW_REQUIRED` rows were rechecked against their exact parent raw
messages on July 20. Identity evidence is intact for every row, but intent is
not safe to inherit at parent level:

- 94 source `WTB` rows currently normalize as parent `WTS`.
- 4 source `WTS` rows currently normalize as parent `WTB`.
- 79 of the 98 raw messages contain an explicit English buyer marker such as
  `WTB`, `looking for`, or `need`.
- 15 of those also contain sale/stock language, confirming mixed-intent source
  messages rather than a single dealer intent.
- All 98 have an image filename; 96 have an observed seller name and 2 retain
  only the verified phone identity.

Decision: keep all 98 blocked until listing-line segmentation produces separate
children. Do not use the parent intent for dealer WTS/WTB counts and do not
publish the image against a single child before lineage is proven.

## Automatic staging gate

A row may enter private `seller_listing_lineage_staging` as `MATCH_READY` only when all are true:

1. The SHA-1 prefix in `title_hash` equals the SHA-1 of the immutable parent raw message.
2. The seller export and parent record have the same wall-clock second. This deliberately accounts for the historical import that retained local clock components while labeling them UTC.
3. The `title_hash` phone suffix equals a valid normalized source phone.
4. Exactly one phone identity remains for the parent.
5. Source `sale/search` intent agrees with normalized `WTS/WTB` intent.

Missing names or images are retained as evidence flags, not invented. Intent conflicts, multiple phones, time mismatches, and unmatched parents do not auto-stage.

## Commands

One batch:

```powershell
$env:SELLER_LISTING_CSV="C:\Users\jasme\Downloads\User list all details..csv"
$env:UNBUNDLED_PARENT_CSV_PATHS="audit-output\unbundled\unbundle_1_raw_messages_batch_002.csv"
$env:SELLER_LINEAGE_OUTPUT="audit-output\dealer-lineage\batch-002"
$env:SELLER_LINEAGE_RESET="true"
npm run build:seller-lineage
```

All files currently in the directory, including later files added by the user:

```powershell
$env:SELLER_LISTING_CSV="C:\Users\jasme\Downloads\User list all details..csv"
$env:UNBUNDLED_PARENT_DIR="audit-output\unbundled"
$env:SELLER_LINEAGE_OUTPUT="audit-output\dealer-lineage\all-batches"
$env:SELLER_LINEAGE_RESET="true"
npm run build:seller-lineage
```

The scan is checkpointed. After interruption, rerun without `SELLER_LINEAGE_RESET=true`. Generated files remain under ignored `audit-output/` because they contain private contact evidence.

Dry-run the first 100 safe rows without database credentials:

```powershell
$env:SELLER_LINEAGE_MANIFEST="audit-output\dealer-lineage\batch-002\canary-100.jsonl"
$env:SELLER_LINEAGE_STAGE_MAX_ROWS="100"
$env:APPLY_SELLER_LINEAGE_STAGING="false"
npm run stage:seller-lineage
```

Database writes require the migration to be deployed and an explicit `APPLY_SELLER_LINEAGE_STAGING=true`. This writes only the private staging table. A separate reviewed operation must reconcile staged phones to `dealer_source_identities`; it must never expose contact information or mark a dealer verified automatically.

## Outputs

- `report.json`: aggregate counts only, safe for operational review.
- `canary-100.jsonl`: deterministic first 100 `MATCH_READY` rows.
- `match-ready.jsonl`: exact matches that pass all five gates.
- `review-required.jsonl`: exact matches with identity or intent conflicts.
- `unmatched-parents.jsonl`: parent IDs and reason codes without raw messages.
- `seller-candidates.jsonl`: private intermediate evidence used for restart and classification.
- `scan-checkpoint.json`: resumable source scan cursor.

## Next approval boundary

After the 100-row canary is manually sampled against raw message, seller row, phone, posting time, intent, and image filename, stage the approved cohort privately. Only then reconcile phone identities to the authenticated dealer directory and backfill `watch_records.dealer_id` through a separately audited change.
