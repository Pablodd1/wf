# CTO Data Rollout - 2026-07-18

## Release state

- The homepage rollback and HKD/HDK multiplier corrections are merged into `main`.
- The merged tree passes the normalization suite and production build.
- No duplicate row has been deleted or hidden by this rollout.
- Dial corrections are stored only in `normalization_shadow_v4` with
  `review_status=PENDING` until a human approves them.

## Deterministic dial review batch

The original reference audit identified 365 deterministic dial corrections:

| Brand | Reference | Original findings | Current pending proposals |
| --- | --- | ---: | ---: |
| Patek Philippe | 3712/1A | 32 Blue | 15 Blue |
| Patek Philippe | 5712/1A family | 319 Blue | 314 Blue |
| Rolex | 116500LN | 13 Black/White | 7 Black |
| Rolex | 52506 | 1 Blue | 1 Blue |
| **Total** | | **365** | **337** |

The 28-row difference reflects source rows whose dial state changed after the
original audit. The idempotent writer intentionally did not overwrite newer
source state. The 337 current proposals were written to shadow review and no
`watch_records` row was changed.

## Bundle-first duplicate policy

The duplicate scanner now:

1. Segments a bundle source message into line-level candidates.
2. Builds signatures from each candidate rather than the collapsed source row.
3. Excludes unresolved bundle envelopes from duplicate comparison.
4. Keeps every match involving split lineage review-only.
5. Persists the in-memory signature index to a durable checkpoint during the scan.

A 1,000-row Patek validation produced 3,018 bundle child candidates. It kept
210 unresolved bundle envelopes out of suppression and classified all 1,518
duplicate matches as review-only.

## Live customer totals

Validated against `https://watchfacts-poc.vercel.app`:

| Surface | Current result |
| --- | ---: |
| Trading Floor recent-market estimate | 2,391,989 |
| Trading Floor archive estimate | 2,393,186 |
| WTB + historical NTQ demand estimate | 277,788 |
| Page size used for validation | 10 |

The totals are planner estimates by design. Rows remain server-paginated and
the browser receives only the requested page.

## Price Research canaries

| Reference | Sampled | Eligible | Unique offers | Reposts | Included | Outliers removed | Median | Range |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| Patek 3712/1A | 1,291 | 23 | 10 | 13 | 9 | 1 | $133,000 | $106,650-$145,897 |
| Patek 5712/1A | 5,000 capped | 1,048 | 657 | 391 | 370 | 76 | $111,141 | $81,500-$162,000 |
| Rolex 116500LN | 5,000 capped | 2,913 | 1,147 | 1,766 | 527 | 168 | $27,000 | $20,600-$34,100 |
| Rolex 52506 | 1,657 | 672 | 254 | 418 | 151 | 8 | $42,240 | $34,000-$60,500 |

The Rolex 52506 `$244` observation is not included in its market range or
median. Excluded evidence and outlier rows remain visible for audit.

## Five smallest populated brands

| Brand | Rows | Catalog confirmed | Analytics eligible | Demand eligible | Unknown dial | Bundle rows | Exact raw repeats |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Bell & Ross | 47 | 25 | 3 | 2 | 13 | 3 | 9 |
| Grand Seiko | 70 | 32 | 12 | 4 | 24 | 0 | 16 |
| MB&F | 79 | 0 | 0 | 0 | 64 | 5 | 22 |
| F.P. Journe | 924 | 46 | 13 | 4 | 640 | 76 | 170 |
| TAG Heuer | 1,232 | 74 | 27 | 1 | 268 | 325 | 211 |

Priority corrections are catalog/reference coverage for MB&F and F.P. Journe,
then bundle segmentation and catalog reconciliation for TAG Heuer. None of
these brands should receive broader Price Research coverage by relaxing the
five-point or catalog-consistency gates.

## 100-image lineage pilot

- Indexed raw lineage: 16,989 image filenames.
- Inventory CSV rows scanned: 1,813,407.
- Exact raw-record lineage matches: 500.
- Customer-safe, reachable pilot records: 100.
- Apply verification: 0 newly linked, 100 unchanged.

The apply result confirms the RPC is idempotent and the selected 100 images
were already linked. The pilot matches by raw-record filename lineage, not by
visual guessing.

## Remaining approval gates

- Review and approve/reject the 337 current dial proposals in Admin Review.
- Complete the candidate-aware Patek and Rolex full scans from their durable
  checkpoints and review clusters before any analytics suppression.
- Materialize approved bundle candidates as child listings before suppression.
- Add catalog aliases and reference mappings for the smallest-brand defects.
- Expand media beyond the first 100 only after lineage and customer-safety QA.
