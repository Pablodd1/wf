# Unbundled collection intake - 2026-07-21

## Executive decision

All 16 manually unbundled CSV trios are preserved and pass the collection
lineage gate. They are suitable for checkpointed normalization, but they are
not suitable for a direct public import. A uniform 10,000-row cohort from each
batch was normalized, validated, and written only to private `watch_staging`.

No row was approved, published to `watch_records`, added to Price Research, or
used to suppress a parent bundle during this intake.

## Full collection evidence

| Check | Result |
| --- | ---: |
| Batch trios | 16 of 16 |
| Parent raw messages | 761,489 |
| Unique parent IDs | 761,489 |
| Child listing rows | 32,307,467 |
| Mapping rows | 32,307,467 |
| Declared child total | 32,307,467 |
| Exact child-to-parent raw lineage | 32,307,467 (100%) |
| Cross-batch duplicate parent IDs | 0 |
| Source-date agreement | 100% |
| Parent/child intent conflicts | 675,636 |
| Unusable parent intents | 254,298 |
| Missing exported brand | 7,751 |
| Seller name coverage | 351 |
| Seller phone coverage | 351 |
| Image URL coverage | 0 |

The 32.3 million child count is not a public-listing count. It is the declared
output of manually splitting 761,489 inventory-style parent messages, averaging
about 42 children per parent. Duplicate review, seller attribution, and catalog
validation must occur before publication decisions.

The reproducible collection check is:

```text
npm run audit:unbundled-collection
```

Its local audit artifact is `unbundled-collection-audit.json` beside the source
CSV files. The command streams the parent files, verifies all prior intake and
lineage reports, checks cross-batch parent uniqueness, and performs no database
writes.

## Normalization cohort

A uniform 10,000-row cohort was generated from every batch, for 160,000 rows
total.

| Disposition | Rows |
| --- | ---: |
| Ready for Human Review | 6,067 |
| Requires Human Correction | 4,725 |
| Held by catalog gate | 99,792 |
| Held by price/currency gate | 47,835 |
| Held by lineage/context gate | 1,185 |
| Still detected as multi-watch | 396 |
| WTS | 149,831 |
| WTB | 8,984 |
| Unresolved intent | 1,185 |

All 16 normalized cohorts passed these validations:

- zero duplicate child listing IDs;
- zero missing child listing IDs;
- zero invalid review buckets;
- zero lineage failures outside the lineage hold;
- zero production-approved rows;
- zero review-ready WTS rows missing price or currency;
- zero review-ready catalog failures.

## Staging result

Only the `review-ready` and `human-correction` rows were converted into private
staging manifests. Each manifest carries its actual source label,
`MANUAL_UNBUNDLE_BATCH_NNN`, rather than the historical batch-002 label.

| Check | Result |
| --- | ---: |
| Private staging rows processed | 10,792 |
| Private staging rows persisted/read back | 10,792 |
| Pending | 10,792 |
| Approved | 0 |
| Rejected | 0 |
| Protected completed decisions overwritten | 0 |
| Public `watch_records` mutations | 0 |

The staging writer preserves non-pending human decisions and refuses rows that
arrive approved, have nonzero confidence, or lack exact lineage.

## Defect found during intake

Some preserved raw source lines contain Unicode line-separator characters
(`U+2028` or `U+2029`). The prior JSONL serializer left them literal, causing a
line reader to split a valid record into invalid fragments. The serializer now
escapes those separators at the JSONL boundary while restoring the exact source
text after parsing. Batch 011 exposed the issue; batches 011-016 were regenerated
as needed and all 16 subsequently passed validation.

The checkpoint writer also now retries transient Windows `EPERM`, `EBUSY`, and
`EACCES` rename failures. This prevents antivirus/indexing locks from aborting a
resumable dry run or staging pass.

## Deliberate holds

1. Do not normalize and stage all 32.3 million children in one operation. The
   cohort shows that most rows require catalog or price/currency remediation,
   and a full expansion would overload the review queue without improving the
   customer dataset.
2. Do not publish seller phone or dealer identity from these files. Only 351
   rows contain seller evidence; enrich from the separate seller/source lineage
   workflow and apply consent/verification gates.
3. Do not attach images from these files. Image coverage is zero; exact source
   and attachment lineage remains a separate final-stage gate.
4. Do not suppress bundle parents until each child set is reconciled and the
   reviewer has resolved duplicate/repost candidates.
5. Do not allow WTB rows into asking-price analytics.

## Next controlled expansion

1. Review the new 10,792-row staging cohort and measure approval, correction,
   duplicate, and catalog-failure rates by batch.
2. Prioritize the 6,067 catalog-confirmed rows, while requiring explicit
   duplicate acknowledgement before approval.
3. Repair deterministic high-volume blockers: price/currency evidence, parent
   intent inheritance, exported/raw dial conflicts, missing brand, and remaining
   multi-watch rows.
4. Join seller and original-post evidence through exact private lineage; do not
   infer missing identities.
5. Expand in checkpointed 50,000-row source cohorts only after the prior cohort
   reconciles in `watch_staging` and customer-facing totals remain unchanged.
