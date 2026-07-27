# Three-Watch Client Release

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

The UI already displays the full safe dealer profile, history metrics, and
contact action when those gates pass. It displays a truthful pending message
otherwise.

## Customer behavior

- Trading Floor, Price Research, catalog browsing, featured inventory, listing
  detail, and contact APIs all enforce the same three-reference allowlist.
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
