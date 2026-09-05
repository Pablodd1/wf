# CTO Data Canary Report - 2026-07-19

## Dealer and original-date correction

- Production has 1,580 staged source-company candidates, but zero verified dealers and zero dealer-linked listings.
- Only approximately 23,684 of 2,631,583 records have an original `listing_date`; import `created_at` must not be displayed as the original posting date.
- Customer dealer ratings/contact remain blocked until an authenticated Rated Dealers export is reconciled and contact consent is verified.
- The branch adds an original-date-only dealer statistics view and removes import-date fallbacks from Trading Floor and Price Research.
- Full evidence: `docs/DEALER_AND_SOURCE_DATE_STATUS_2026-07-19.md`.

## Executive decision

The customer-facing Trading Floor and Price Research APIs are available and the
owner-critical Patek/Rolex references return auditable analytics. No production
listing, dealer, bundle parent, bundle child, or image relationship was changed
during this review.

The remaining remediation is not one bulk update. Price corrections, dial
corrections, bundle splitting, dealer identity, duplicate suppression, and image
lineage have separate evidence and release gates. Combining them would make the
result impossible to audit or roll back.

## Price normalization canary

A read-only keyset scan evaluated the first 100,000 priced records against the
exact raw-message block containing each reference.

| Metric | Result |
| --- | ---: |
| Rows scanned | 100,000 |
| Stored/normalized mismatches >= 5% | 18,427 |
| Explicit HKD line corrections | 16,058 |
| Explicit USD line corrections | 2,369 |
| Eligible single-listing WTS corrections after reference-context gate | 4,768 |
| Blocked as bundle/multi-listing context | 12,182 |
| Blocked repeated-reference evidence | 374 |
| Blocked normalized values below $500 | 460 |
| Blocked non-WTS observations | 120 |
| Blocked reference-context mismatches | 1,321 |

The v2 release canary is capped at 100 proposals. It is a local report only. Each
candidate carries its source ID, old/new value, normalization reason, exact
evidence line, candidate count, and exclusion decision.

The branch also includes a dedicated `price_remediation_review` migration and
`npm run stage:price-canary`. Its refreshed dry run accepted exactly 100 gated
proposals and confirmed `watchRecordsMutated = false`. The command defaults to dry-run, is hard-capped at
100 rows, ignores existing source/version pairs so a rerun cannot reset a human
decision, and never updates `watch_records`. The migration is prepared for code
review and was not applied to production during this audit.

### Required release gate

1. Review all 100 evidence lines against the preserved source message.
2. Store approved corrections in a dedicated price-remediation review table;
   do not overwrite a shared dial/bundle shadow row.
3. Preserve source ID, previous value, proposed value, operator, and timestamp.
4. Re-run the affected Price Research cohorts and compare included/excluded
   evidence before promotion.
5. Promote only reversible, human-approved rows. Bundles remain blocked.

## John-reference dial review

The original unknown-dial audit remains reproducible:

| Reference | Unknown rows reviewed | Deterministic proposals | Blocked |
| --- | ---: | ---: | ---: |
| Patek Philippe 3712/1A | 33 | 32 Blue from exact single-dial catalog | 1 bundle/unresolved |
| Patek Philippe 5712/1A family | 394 | 319 Blue from exact single-dial catalog | 75 bundle rows |
| Rolex 116500LN | 25 | 13 from explicit raw text (12 Black, 1 White) | 9 unresolved, 3 catalog-ambiguous |
| Rolex 52506 | 1 | 1 Blue from explicit raw text | 0 |
| **Total** | **453** | **365** | **88** |

Newer source state leaves 337 current dry-run proposals: 15 Patek 3712/1A, 314
Patek 5712/1A-family, 7 Rolex 116500LN Black, and 1 Rolex 52506 Blue. These are
already review items, not customer-published automatic edits. Rolex 116500LN
must continue to require explicit text or human review because multiple catalog
dials are valid.

## Price Research production verification

Production endpoint checked: `https://watchfacts-poc.vercel.app/api/price-research`.

| Reference | Sampled | Included | Excluded evidence | Statistical outliers | Clean average | Clean range |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Patek 3712/1A | 1,291 | 9 | 1,282 | 1 | $130,482 | $106,650-$145,897 |
| Patek 5712/1A | 5,000 capped | 533 | 4,467 | 124 | $120,399 | $68,077-$189,744 |
| Patek 5712/1R | 5,000 capped | 11 | 4,989 | 4 | $244,258 | $229,487-$262,000 |
| Rolex 116500LN | 5,000 capped | 922 | 4,078 | 225 | $27,049 | $19,800-$34,999 |
| Rolex 52506 | 1,657 | 213 | 1,444 | 43 | $45,432 | $34,000-$62,500 |

All five cohorts are analytics-ready. They use WTS-only observations, require at
least five comparable rows, apply a deterministic plausibility floor before
standard 1.5-IQR fences, retain excluded evidence, and do not use database import
time as the market-posting date. The former Patek 5712/1R `$31,917` error and
Rolex 52506 `$244` evidence do not affect the displayed market averages.

## Trading Floor publication verification

Production endpoint checked: `https://watchfacts-poc.vercel.app/api/ingest`.

| View | Estimated total | First-page verification |
| --- | ---: | --- |
| All customer-visible inventory | 1,977,442 | WTS/WTB only; no RECYCLE |
| WTS | 1,736,640 | All sampled rows WTS; no price-less WTS |
| WTB/NTQ demand | 229,530 | Returned through the WTB customer filter |
| Other luxury | 8 | Returned as OTHER |
| MULTI | 0 | Bundle parents are not published as customer MULTI listings |

The endpoint uses server-side pagination. The 50 visible cards are one page, not
the size of the database. Historical rows without a proven source posting date
return `listing_date = null`; the UI must not substitute import time.

## Bundle and multi-listing review

The 1,000-parent integrity canary exported all source rows with zero missing
lineage and contained 11,287 proposed child listings. A fresh re-analysis found:

| Metric | Result |
| --- | ---: |
| Exact raw-lineage children | 11,287 |
| Missing raw-lineage children | 0 |
| Children without resolved price/currency | 2,875 |
| Children below $500 | 107 |
| Children at or above $1M | 233 |
| Changed candidate-count parents | 0 |

A separate 25-parent dry-run generated 329 staging children; all 329 had exact
raw lineage and 184 required additional review. No staging or live write was made
in this run. Parents remain immutable and duplicates must be evaluated only after
approved children exist.

The full export is checkpointed in two ignored partitions under
`audit-output/multilistings-full-20260719*/` and can resume by source ID after
interruption. The exporter now uses bounded retries, indexed client-side flag
filtering when the server containment plan times out, 100-ID detail batches,
five-way bounded concurrency, missing-source accounting, an exclusive PID lock,
and durable append/checkpoint writes.

The final streaming reconciliation parsed every physical JSONL record and
verified strict source-ID ordering, non-overlapping lexical boundaries, exact
checkpoint/line counts, immutable-parent review policy, and source lineage:

| Metric | Result |
| --- | ---: |
| Exported bundle parents | 761,489 |
| Proposed child candidates preserved | 32,307,467 |
| Missing source rows | 0 |
| Partition overlap or duplicate IDs | 0 |
| JSONL bytes | 23,242,912,643 |

The earlier 757,433 queue figure was a prior snapshot; the completed current
range contains 4,056 additional shadow parents. An interrupted local process
left a zero-filled tail, which was truncated to the last complete LF-delimited
JSON record before resuming from the recovered ID. The validator was also fixed
to preserve valid Unicode `U+2028` characters inside raw messages instead of
treating them as JSONL row separators. A discarded local bad-splice artifact is
ignored and is not part of this evidence set.

## Dealer identity and contact

| Metric | Current result |
| --- | ---: |
| Source-company candidates staged | 1,580 |
| Pending comparison | 1,580 |
| Matched to a dealer | 0 |
| Verified dealers | 0 |
| Verified phone/WhatsApp identities | 0 |

An indexed `dealer_id IS NOT NULL ORDER BY dealer_id LIMIT 1` presence query
returned no rows, confirming zero currently attributed listings without running
an expensive full-table count.
No customer phone/name should be inferred from raw text. Contact requires a
verified dealer, immutable source identity, contact consent, and a verified
phone/WhatsApp identity. The authoritative Rated Dealers export remains the
required input to complete reconciliation.

## Image lineage

The existing pilot was revalidated in dry-run mode:

| Metric | Result |
| --- | ---: |
| Production object-inventory rows streamed | 1,813,407 |
| Raw image filenames indexed | 16,989 |
| Immutable filename-lineage matches | 500 |
| Customer-safe reachable matches | 100 |
| New database writes | 0 |

The 100 pilot images remain proven and idempotent. Expansion stays paused until
bundle children and dealer/source relationships are approved; filenames alone
must never assign an image to an unrelated listing.

## Verification and isolated technical debt

- Current normalization/publication regression suite: 102 passed, 0 failed.
- Production build: passed.
- Price-audit release-gate tests: 8 passed, 0 failed.
- Multi-listing export-validator tests: 2 passed, 0 failed.
- Repository-wide lint: 154 errors and 2 warnings, the same legacy baseline.
- Largest production chunks: charts ~427 KB and XLSX ~429 KB before gzip.

The lint and bundle-size backlog is intentionally separate from data promotion.
It must be handled in a dedicated branch so cosmetic/type refactoring cannot
change normalization evidence during rollout.

## Next controlled actions

1. Human-review the 100-row price correction canary and create the reversible
   remediation ledger/table.
2. Approve or reject the 337 current dial proposals in Admin Review.
3. Completed: export and reconcile all 761,489 current bundle parents with zero
   missing lineage. Keep the artifacts outside Git and browser memory.
4. Review risky child prices and unresolved fields; promote a staging-only child
   canary before any parent suppression or duplicate decision.
5. Import the authenticated Rated Dealers directory into staging, review all
   identity conflicts, then backfill approved `dealer_id` links.
6. Expand image lineage only for approved single listings or approved children.
7. Address the 154 legacy lint errors and heavy optional chunks in a separate PR.
