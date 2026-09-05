# John-Focused Patek and Rolex QA

Generated: 2026-07-18

This is a read-only production audit. No `watch_records` row was deleted,
modified, promoted, or hidden.

## Owner-Critical Price Research Cohorts

| Brand / reference | Sampled | Eligible | Unique offers | Reposts | Included | Outliers | Selected cohort | Average | Median | Included range |
|---|---:|---:|---:|---:|---:|---:|---|---:|---:|---:|
| Patek Philippe `3712/1A` | 1,291 | 23 | 10 | 13 | 9 | 1 | Used / Blue | $130,482 | $133,000 | $106,650-$145,897 |
| Patek Philippe `5712/1A` | 5,000 capped | 1,048 | 657 | 391 | 370 | 76 | Used / Blue | $114,106 | $111,141 | $81,500-$162,000 |
| Rolex `116500LN` | 5,000 capped | 2,913 | 1,147 | 1,766 | 527 | 168 | Unknown / White | $27,109 | $27,000 | $20,600-$34,100 |
| Rolex `52506` | 1,657 | 672 | 254 | 418 | 151 | 8 | New / Blue | $44,582 | $42,240 | $34,000-$60,500 |

All four cohorts currently report `analytics_ready=true` and `robust`. The
historical `$244`-class Rolex `52506` evidence is excluded before statistics;
the included minimum is `$34,000`.

## Unknown-Dial Audit

| Reference | Unknown rows sampled | Deterministic proposals | Unresolved / bundle | Ambiguous |
|---|---:|---:|---:|---:|
| Patek `3712/1A` | 33 | 32 Blue from exact single-dial catalog | 1 | 0 |
| Patek `5712/1A`, `5712/1A-001` | 394 | 319 Blue from exact single-dial catalog | 75 bundle rows | 0 |
| Rolex `116500LN` | 25 | 13 from explicit raw text (12 Black, 1 White) | 9 | 3 catalog-multiple-dial |
| Rolex `52506` | 1 | 1 Blue from explicit raw text | 0 | 0 |

Patek single-dial proposals may enter shadow review with catalog evidence.
Rolex `116500LN` must use explicit text or human review because its catalog has
multiple valid dial configurations.

## Duplicate Pilot

The first 10,000 rows of each brand were scanned using keyset pagination.

| Brand | Bundle-like rows | Duplicate candidates | Exact listing | Exact raw message | Date-shifted repost | Possible shared inventory | Safe auto-suppressions |
|---|---:|---:|---:|---:|---:|---:|---:|
| Patek Philippe | 4,530 | 7,380 | 1,771 | 491 | 29 | 5,089 | 0 |
| Rolex | 5,230 | 6,952 | 1,522 | 240 | 5 | 5,185 | 0 |

The high candidate rates do not mean those rows are proven duplicates. Bundle
contamination and shared dealer inventory dominate the matches. Different
dealers must not be collapsed, and date changes alone do not prove that two
posts describe the same physical watch.

## Safe Correction Order

1. Split bundle-like raw messages into source-linked listing candidates.
2. Resolve dealer/source identity where immutable evidence exists.
3. Promote only deterministic Patek dial proposals through shadow review.
4. Promote Rolex dial corrections only from explicit raw text or a human
   catalog decision.
5. Classify reposts separately from exact duplicate ingestion events.
6. Suppress reviewed duplicates from analytics while retaining immutable raw
   evidence and audit history.
7. Re-run Price Research cohorts and compare included/excluded counts before
   release.

## Release Conditions

- Raw message and source timestamp remain visible.
- Every USD value retains original amount, original currency, and conversion
  evidence.
- WTS requires brand, model, reference, dial, and price.
- WTB requires brand, model, reference, and dial.
- Price analytics require at least five comparable unique offers.
- Reposts count once in statistics but remain available as evidence.
- Plausibility failures and IQR outliers remain visible as excluded evidence.
- Confidence is constrained to 0-100; human approval is exactly 100.
