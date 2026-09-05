# WatchFacts Data Recovery Status

Generated from production read-only counts and bounded private-ledger writes on
2026-07-25. No source listing, duplicate, seller, image, or bundle parent was
deleted or suppressed during this work.

## Release decision

**Conditionally ready for a strict-publication preview canary. Not ready to
enable strict verified publication in production.**

The verified Trading Floor source is non-empty and all bounded readbacks passed,
but images still require human visual review, sellers have no approved consent
lineage, and bundle children are not ready for bulk promotion.

## Exact production snapshot

| Area | Exact count |
| --- | ---: |
| Raw records | 17,000 |
| Watch records | 2,631,583 |
| Total normalized | 2,631,468 |
| Normalization pending | 1,988,995 |
| Catalog-confirmed identities | 22,976 |
| Identity conflicts | 82,111 |
| Identity unverified | 38,595 |
| Human-approved identities | 0 |
| Verified Trading Floor candidates | 10,864 |
| Verified WTS candidates | 9,716 |
| Bundle parents requiring split | 761,489 |
| Image-backed listings | 1,531 |
| Visually verified images | 0 |
| Private seller candidates | 16,094 |
| Seller-linked listings | 0 |
| Suppressed duplicates | 0 |

Source: `global_data_quality_blocker_counts`, generated at
`2026-07-25T02:42:14.724121+00:00`.

## Completed controls

1. Deployed private identity, image, bundle, checkpoint, and verified-publication
   controls.
2. Hardened publication to accept only `CATALOG_CONFIRMED` or
   `HUMAN_APPROVED` identity when `STRICT_VERIFIED_PUBLICATION=true`.
3. Preserved canonical identity corrections in verified customer views.
4. Required exact human evidence for image approval.
5. Required applied seller lineage, verified dealer status, and consent before
   exposing dealer contact or activity.
6. Prevented duplicate suppression while either bundle indicator remains.
7. Replaced oversized PostgREST readbacks with 100-ID chunks.

## RM contradiction remediation

The original 83,365 estimate was stale. The checkpointed ordered pass exhausted
92,175 rows:

| Decision | Count |
| --- | ---: |
| Catalog confirmed | 8,548 |
| Conflict | 77,800 |
| Unverified | 5,827 |

The next batch returned zero rows. Every tranche used at most 1,000 rows per
database write. Repeated 1,000-ID readbacks and the final 975-ID readback found:

- zero missing identity rows;
- zero conflicted rows in verified publication;
- zero unverified identity leaks;
- zero unverified image leaks.

## General inventory canary

The first 50,000 ordered records were classified in five 10,000-row tranches:

| Decision | Count |
| --- | ---: |
| Catalog confirmed | 13,833 |
| Conflict | 4,151 |
| Unverified | 32,016 |

Every tranche passed a bounded 1,000-ID production readback with zero leaks.

## Images

All 1,531 image-backed listings were identity-staged:

| Identity decision | Count |
| --- | ---: |
| Catalog confirmed | 595 |
| Conflict | 164 |
| Unverified | 772 |

The prior structural audit classified 1,346 rows as
`VISUAL_REVIEW_REQUIRED` and rejected 185 structurally. That status is not a
visual approval. No image is currently `VISUALLY_VERIFIED`.

A 50-row human review packet was generated outside the repository at:

`work/wf-data-canary/audit-output/image-review-20260725/`

It includes the image URL, canonical identity, and preserved raw message.
Reviewer decisions must remain external until completed with operator, reason,
and exact `MATCH` or `NO_MATCH` evidence.

## Bundles

All 16 supplied unbundled batches passed the collection lineage gate:

| Measure | Count |
| --- | ---: |
| Parent rows | 761,489 |
| Declared child rows | 32,307,467 |
| Exact raw-line children | 32,307,467 |
| Parent/child intent conflicts | 675,636 |
| Unusable parent intents | 254,298 |
| Rows with seller name | 351 |
| Rows with seller phone | 351 |
| Rows with image coverage | 0 |

The collection is suitable for bounded private normalization, not bulk
publication. A 1,000-child normalization canary produced:

- 85 ready for human review;
- 46 requiring human correction;
- 869 blocked;
- zero production writes.

The current database bundle-child canary contains 329 children from 25 parents:

- 15 promotion-ready by automated gates;
- 314 blocked;
- zero parent suppressions.

No duplicate suppression may occur before a child is individually reviewed and
approved.

## Remaining release gates

### P0

1. Human-review the 50-image packet; apply only signed `MATCH`/`NO_MATCH`
   decisions and run a production readback.
2. Review bundle children; do not promote the 15 automated candidates without
   an individual reviewer decision.
3. Validate strict-publication behavior in a preview environment against the
   10,864-row verified source before changing production.
4. Recheck Trading Floor, listing detail, featured listings, and Price Research
   totals in strict preview mode.

### P1

1. Continue general identity staging in bounded tranches.
2. Normalize unbundled children by review-priority cohort, not all 32.3 million
   rows at once.
3. Resolve seller identities privately, capture consent, then apply lineage.
4. Fix the full-view count statement-timeout path before using it for live
   dashboards.

### Explicit holds

- `STRICT_VERIFIED_PUBLICATION` remains disabled in production.
- No image restoration without human visual evidence.
- No seller contact publication without verified identity and consent.
- No duplicate suppression before bundle split and child review.
- No bulk import of the 32.3 million child export.

## Rollback

All remediation writes are confined to review/checkpoint tables. Customer
publication can be rolled back by disabling `STRICT_VERIFIED_PUBLICATION`.
Source `watch_records` and raw messages remain immutable.
