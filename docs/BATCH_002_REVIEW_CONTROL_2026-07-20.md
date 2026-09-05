# Batch 002 review control

## Release state

- Batch ID: `f94506b0-17a9-4656-9b51-9e81ed052ab8`
- Pending staged children after v9 reconciliation: 54,170
- Review-ready: 32,532
- Human correction required: 21,638
- Superseded rows retained as blocked audit evidence: 6,158
- Published by this staging run: 0
- Dealer or seller attribution recovered: 0

The records remain in `watch_staging`. They are not returned by the public
Trading Floor or Price Research APIs until a reviewer approves an individual
row through the audited publication function.

The v9 staging writer checks the existing verdict before every upsert. It may
refresh `PENDING` rows and insert missing rows, but it never overwrites an
`APPROVED`, `REJECTED`, or blocked human decision. At rollout time this batch
had zero approved and zero rejected decisions. Exact live reconciliation
reported 54,170 pending, zero approved, zero rejected, and 6,158 blocked rows.

## Admin workflow

`/review-queue` now has two independent lanes:

1. **Unbundled batch 002** reads `watch_staging`, supports full-batch search and
   pagination, and separates review-ready rows from rows needing correction.
2. **Normalization corrections** keeps the existing
   `normalization_shadow_v4` workflow unchanged.

Approval of an unbundled child requires:

- reviewer or administrator authentication;
- an exact preserved raw-child line;
- catalog-confirmed brand and reference;
- a review-ready bucket;
- a valid WTS price and currency when the child is WTS;
- explicit duplicate review acknowledgment.

The transaction writes confidence as exactly `100`, records an immutable audit
snapshot, and publishes one child ID. Rejections require a reason and do not
publish. Rows in the correction lane cannot be approved.

## Duplicate audit

The full staging manifest was audited before enabling publication:

- 335 exact-repeat clusters within the same parent message, covering 715 rows.
- 8,016 normalized listing fingerprints appearing under more than one parent.

Exact repeats in one parent may mean repeated formatting, quantity, or duplicate
inventory and require human review. Cross-parent matches are only repost
candidates. They must not be deleted without seller identity and source-date
lineage.

## Special-dial remediation

The owner-reference audit found that standalone `Tiffany` shorthand could be
lost when a suffixed reference was canonicalized before dial extraction. The
raw-evidence parser now preserves that shorthand as `Tiffany Blue` globally.
All 207 pending batch rows containing exact Tiffany evidence were moved to the
human-correction lane with catalog-dial confirmation set to false. None were
published. A public Trading Floor lookup for a remediated staging ID returned
`404` after reconciliation.

The final v8 rollout repeated that isolation test with staged child
`badf785a-9c5b-5b39-80ba-feb8f15ad6cc`; the production Trading Floor detail
endpoint returned `404`. No `watch_records` row was created by staging or
reconciliation. After the v9 refresh, staged child
`1c591698-f743-5e8f-bcc2-11e8bda9ff18` also returned `404`, confirming the
new pending cohort remains isolated from the public floor.

The v14 normalization expanded the deterministic dial vocabulary for explicit
dealer shorthand and named dials, including Black (`BLK`), Champagne (`CHAMP`),
Meteorite (`METE`), Wimbledon (`WIM`), Candy Pink, Pistachio, Celebration,
Tiffany Blue, and Yellow Mother of Pearl (`YML`). Ambiguous structural tokens
such as bracelet or gemstone suffixes are not treated as dial evidence. A raw
`124200 Pistachio` row previously inherited Black from the catalog; v14 now
preserves Pistachio, marks the catalog conflict, and holds the row outside both
publication and analytics.

## Reference cleanup evidence

The supplied brand-by-brand cleanup examples are now represented in the shared
reference-quality gate and regression suite. Covered failure classes include:

- prices, dates, condition text, and item IDs captured as references;
- accessories such as straps, bracelets, links, boxes, and bags;
- brand-only or model-only values without a source-supported reference;
- wrong-brand references and mixed-brand child lines;
- multiple watch references in one purported child line;
- valid dotted, hyphenated, spaced, vintage, and six-digit brand formats that
  must not be destroyed by over-cleaning.

The gate extracts a correction only when one exact, brand-compatible reference
is visible in the preserved source. Ambiguous rows remain in human correction
with explicit reason codes. It does not select the first plausible reference
from a stock list and does not use catalog data to invent a missing reference.

## Price Research readiness

The reproducible `audit:unbundled-market` scan read all 571,031 normalized
children and found 9,611 distinct brand/reference combinations. Only 25,984
rows passed the strict review-candidate gate. After applying the live repost
deduplication rule, 11,749 independent observations remained. The live
plausibility floor excluded 103 malformed low-price observations before IQR;
IQR then excluded 873 statistical outliers. The final report contains 10,773
included observations across 1,060 dial cohorts. Of those cohorts, 470 meet the
minimum five-observation rule, covering 324 references.

The cohort key is brand + exact reference + normalized dial. New, Used, and
Unknown conditions are combined by default, while their counts remain visible
and the UI can filter a requested condition. Unsplit bundle rows are excluded.
These numbers are audit candidates only; no batch row is approved or published
by the report.

## Critical references in batch 002

The final full scan and live API checks cover the owner-tested references:

- Patek Philippe `5712/1A`: 3,057 normalized base-reference rows plus 216
  `5712/1A-001` rows; Blue analytics-ready cohorts exist for both spellings.
- Patek Philippe `5712/1R`: the base reference remains held; `5712/1R-001`
  has a provisional Black cohort with eight deduplicated observations.
- Patek Philippe `3712/1A`: 103 normalized base-reference rows and a robust
  Blue cohort; `3712/1A-001` remains below the five-observation threshold.
- Rolex `116500LN`: 542 normalized rows; Black is analytics-ready while White
  has only four deduplicated batch observations and remains observational.
- Rolex `52506`: 746 normalized rows; its Blue cohort is analytics-ready.

The sample review found repeated raw lines in the Patek cohorts and both
review-ready and human-correction rows in the Rolex cohorts. These references
should be searched first in the Admin queue and reviewed per dial before broad
publication. Production calls for all five references returned HTTP 200 and
analytics-ready responses. Clicking a comparable observation returned its
redacted preserved source in both Price Research and Trading Floor.

## Remaining blocker

All 50,000 parent records were recovered with their original timestamps, but
the available source export contains no seller name, seller phone, dealer ID,
region, or WhatsApp sender envelope for this batch. The Admin UI
shows `DEALER_ATTRIBUTION_MISSING`; it does not invent contact information.
Dealer lineage must be recovered from another source database/export before
dealer profiles and WhatsApp contact can be complete. Live detail calls return
`DEALER_UNRESOLVED` while still displaying the redacted source evidence.
