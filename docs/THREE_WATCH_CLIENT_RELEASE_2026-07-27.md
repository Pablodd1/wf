# Three-Watch Client Release

> Superseded for active customer scope by
> [`FULL_ROLEX_PATEK_RELEASE_2026-07-27.md`](FULL_ROLEX_PATEK_RELEASE_2026-07-27.md).
> This document remains the rollback baseline and canary evidence.

**Control date:** July 27, 2026  
**Release cohorts:** Rolex 116610LN, Patek Philippe 5712/1A-001,
Rolex 126710BLNR  
**Database audit mode:** read-only; zero production record writes

## Decision

Publish exactly three reference cohorts through a reversible application
allowlist:

```text
PUBLICATION_BRANDS=Rolex|Patek Philippe
PUBLICATION_REFERENCES=Rolex::116610LN|Patek Philippe::5712/1A|Patek Philippe::5712/1A-001|Rolex::126710BLNR
STRICT_VERIFIED_PUBLICATION=true
```

The exact reference list is also the code-level fail-closed default. A missing
deployment variable therefore cannot reopen unrelated references; a later
reviewed release must replace the list explicitly.

The two Patek reference spellings are one catalog-equivalent release cohort,
not two watches.

Market analytics use one cohort for each exact brand, reference, and dial.
Condition is not an analytics dimension. New, Used, and Unspecified records
are combined in the statistics and charts. The condition stated by the source
remains visible on each individual listing.

## Evidence-based third-watch selection

The first automated rank was Rolex 228235 because it had the most source-linked
image candidates. A raw-evidence canary rejected it for this release: approved
rows labeled the canonical dial Green while immutable messages included
Sundust and Chocolate dials. That conflict is not safe for customer analytics
or image publication.

Rolex 126710BLNR was selected instead:

- exact identity: GMT-Master II;
- canonical dial: Black;
- raw canary messages state 126710BLNR and, where named, Batman/Batgirl;
- source-linked canary images show the expected black dial and blue/black GMT
  bezel;
- 502 approved identity rows and 280 strict Price Research WTS rows provide a
  substantially larger evidence base than the minimum five observations.

## Exact release readiness

The read-only audit is reproducible with:

```text
node tools/data-quality/audit-three-watch-candidates.cjs
```

Local output:

```text
audit-output/three-watch-release/candidate-ranking.json
```

| Exact cohort | Approved identity rows | Strict Price Research WTS | Source-linked image candidates | Signed visual approvals | Exact seller-review candidates |
| --- | ---: | ---: | ---: | ---: | ---: |
| Rolex 116610LN | 125 | 91 | 7 | 0 | 0 |
| Patek Philippe 5712/1A-001 (including 5712/1A source alias) | 182 | 88 | 1 | 0 | 0 |
| Rolex 126710BLNR | 502 | 280 | 17 | 0 | 0 |
| **Total** | **809** | **459** | **25** | **0** | **0** |

These counts mean the three watch cohorts are ready for fail-closed identity
and price publication. They do not authorize images or seller contacts.

## Approved-90 evidence expansion

The July 27 continuation screens every exact-release WTS row for the private
review queue, but public Price Research remains limited to canonical-identity-
reviewed rows. A customer-facing observation must pass:

1. stored verdict `APPROVED`;
2. finite parser confidence at least 90 (the score is not a probability);
3. exact allowed brand/reference pair;
4. canonical identity status `CATALOG_CONFIRMED` or `HUMAN_APPROVED`;
5. explicit USD/USDT evidence, or explicit currency plus retained verified FX
   rate source and date;
6. catalog-confirmed model and compatible dial;
7. no unsplit bundle;
8. no reviewed duplicate suppression; and
9. one observation per deterministic dealer repost group.

The same `APPROVED` and confidence-90 release gate now applies to Trading
Floor, direct listing detail, contact, featured listing, Price Research,
image-review queue, and image-review decision routes. Deployment environment
configuration may restrict the reviewed references but cannot add another
reference or fail open.

Read-only cohort audit before deployment:

| Exact cohort | APPROVED WTS | 90+ with reference, dial and parsed positive price | Deterministic review candidates before repost/outlier gates | Candidate comparables before mandatory identity/FX public gates |
| --- | ---: | ---: | ---: | ---: |
| Rolex 116610LN | 3,363 | 2,723 | 219 | 84 |
| Patek Philippe 5712/1A-001 and 5712/1A | 5,413 | 4,309 | 662 | 393 |
| Rolex 126710BLNR | 11,731 | 8,946 | 582 | 212 |
| **Total** | **20,507** | **15,978** | **1,463** | **689** |

The `689` count is a private review-screening figure produced under the
historical fixed-HKD-rate analysis; it is not the public comparable count.
Fixed-rate HKD conversions without an FX source date are now marked
`CURRENCY_RATE_UNVERIFIED` and withheld from public analytics. The audit
classified 109 true statistical outliers after its deterministic screening
(7, 81, and 21 by cohort). The much larger excluded population was not "all
outliers": it was primarily ambiguous or unverified currency and unsplit
bundle evidence. The reviewer UI now names this table
`Excluded evidence for human review` and explains each correction reason.

## Images

The release image queue is filtered to the configured references. It shows the
actual source image beside the immutable raw listing and requires an
authenticated reviewer to inspect, choose MATCH or NO MATCH, and provide a
reason.

Three representative source-linked candidates were inspected during the CTO
canary:

- Rolex 116610LN: the image includes a Rolex card visibly stating model
  116610LN and a black-dial Submariner Date.
- Patek Philippe 5712/1A: the image shows the expected Nautilus 5712
  complication layout, but no signed reviewer decision exists.
- Rolex 126710BLNR: the image shows a black-dial GMT-Master II with the expected
  blue/black bezel and Jubilee bracelet.

This inspection is advisory evidence, not a signed human review. Public image
fields remain empty until an authenticated human submits the exact decisions.
After a MATCH, the existing verified media view exposes only that reviewed
image for that exact record.

The latest independent production read at 2026-07-27 14:45-14:47 UTC found 29
source-linked exact-reference images: 11 for 116610LN, 1 for 5712/1A, and 17
for 126710BLNR. Twenty-four were actionable in the authenticated review API:
7, 0, and 17 respectively. The Patek item is blocked by missing dial evidence;
four additional 116610LN items remain identity-unverified. Signed visual
approvals remain exactly zero, so no image is auto-published.

## Sellers and users

No exact seller-lineage item currently passes all release gates. Public seller
data therefore remains unavailable for all three cohorts.

The supplied `watches_only_report.csv` contains observed names and phone
values, but those private values are not permission to publish. A seller may
appear only after:

1. exact source-record lineage;
2. exact verified dealer identity mapping;
3. an applied seller-lineage decision;
4. dealer status `VERIFIED`;
5. contact consent; and
6. a verified contact method.

The UI displays the safe dealer profile and contact action only when those
gates pass. Dealer activity metrics remain unavailable until an
applied-lineage aggregate exists; the UI says so instead of inventing zero
activity.

An independent local read of `watches_only_report.csv` found 27 private
exact-reference seller seeds and 26 possible image rows, but all 27 CSV rows
lack an immutable live source record ID. They may enter only a private,
contact-masked review packet. Verified/applied dealers, consented public
contacts, and production-ready seller matches remain exactly zero.

## Customer behavior

- Trading Floor, Price Research, catalog browsing, featured inventory, listing
  detail, and contact APIs all enforce the same three-reference allowlist.
- Trading Floor globally deduplicates the current reviewed cohort before
  pagination and fails closed if it grows beyond the 999-row bounded release
  window.
- Search uses exact reference predicates; the browser never receives the full
  archive.
- Price charts combine all listing conditions for the selected exact dial.
- Individual listing cards and detail descriptions retain condition.
- Raw source text is contact-redacted in the public Price Research detail.
- Trading Floor does not expose raw contact-bearing source text.
- Images are loaded only from signed `VISUALLY_VERIFIED` review evidence.
- Seller profiles and WhatsApp links are loaded only from applied, consented,
  verified lineage.

## Release and rollback

Preview must pass:

1. the three allowed references return customer records;
2. a fourth reference returns 404 or a release-scope error;
3. condition query parameters do not change analytics counts or statistics;
4. Trading Floor and Price Research show identical dial-based comparisons;
5. unreviewed images remain withheld;
6. unresolved seller contacts remain withheld; and
7. build and contract tests pass.

Rollback is application-only: remove or change `PUBLICATION_REFERENCES`, or
roll back the deployment. No `watch_records` rollback is needed because this
release does not modify production records.
