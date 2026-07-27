# Rolex and Patek Client Release

> Superseded for customer scope by
> [`THREE_WATCH_CLIENT_RELEASE_2026-07-27.md`](THREE_WATCH_CLIENT_RELEASE_2026-07-27.md).
> This document remains the two-brand infrastructure baseline.

**Control date:** July 27, 2026
**Release brands:** Rolex and Patek Philippe
**Database mode:** read-only audit; zero production record writes

## Decision

Release the already verified Rolex and Patek cohorts first. Do not wait for
every normalized child candidate to clear catalog, currency, image, duplicate,
seller, and human-review gates.

`PUBLICATION_BRANDS=Rolex|Patek Philippe` is the reversible application
restriction for the client preview. It limits Trading Floor, Price Research,
catalog browsing, listing detail, and featured inventory to the two brands.

Images remain fail-closed. A customer image is returned only through
`trading_floor_verified_listings`, which requires exact listing ownership,
verified listing identity, a signed `VISUALLY_VERIFIED` decision, and a matching
identity snapshot. Raw `watch_records` image fields are never used as customer
media.

Seller identity and contact also remain fail-closed. Private exact seller
lineage is not a public dealer assignment. Publication still requires an
applied listing/dealer link, a verified dealer, contact consent, and a verified
contact method.

## Verified release inventory

Current Supabase readback:

| Gate | Rolex | Patek Philippe | Combined |
| --- | ---: | ---: | ---: |
| Strict Trading Floor identities | 7,544 | 632 | 8,176 |
| Strict Trading Floor WTS identities | 6,732 | 498 | 7,230 |
| Strict Price Research WTS source rows | 7,231 | 548 | 7,779 |
| Exact image-review-ready rows | 495 | 4 | 499 |
| Visually verified customer images | 0 | 0 | 0 |
| Verified/applied public dealer links | 0 | 0 | 0 |

The exact Trading Floor counts above come from a controlled readback. The
interactive cursor feed intentionally omits a total because forcing Postgres
to recount the complete verified view on every page request caused intermittent
Supabase 500 responses. It reads a bounded indexed market batch and verifies
only those IDs against the strict identity/media view. Pagination continues
through the full eligible cohort and fails closed if the verification read is
unavailable.

The deterministic unbundled export is much larger, but it is not the public
inventory:

| Measure | Rolex | Patek Philippe |
| --- | ---: | ---: |
| Unique normalized child candidates | 9,991,297 | 13,615,524 |
| WTS price/currency eligible | 3,560,904 | 11,540,764 |
| Review-ready WTS candidates | 550,550 | 309,165 |
| Private exact seller-linked children | 32,166 | 22,872 |

Those child counts have exact raw parent lineage, but still require review,
deduplication, and controlled staging before publication. “Review-ready” is not
human-approved and is not a customer-visible count.

## Client behavior in this release

- Trading Floor has Rolex, Patek Philippe, and combined brand filters.
- Trading Floor and Price Research use the same listing-detail evidence route.
- Trading Floor cards publish verified identity first. A clicked detail shows a
  price only after the exact source line verifies USD or HKD; unresolved
  currency is labeled as under review instead of displaying a stored guess.
- Price Research reads bounded exact brand/reference rows through indexed
  `watch_records` predicates, then retains only IDs with approved identity
  reviews before currency, bundle, duplicate, outlier, and cohort analysis.
- Customer detail cards omit record IDs, parser confidence, internal source
  names, and internal status fields.
- Both detail experiences compare the posted price with the monthly average for
  the exact selected dial cohort. New, Used, and Unspecified are combined for
  analytics; condition remains visible on the individual listing.
- Only visually verified image URLs are rendered.
- Original source evidence remains preserved but public contact-bearing text is
  withheld; reviewer access stays authenticated.
- Seller data appears only after the full verified-dealer and consent gate.

## Deadline path

1. Deploy this branch to a protected preview with
   `PUBLICATION_BRANDS=Rolex|Patek Philippe`.
2. Confirm the two-brand catalog, Trading Floor, Price Research, exact listing
   click-through, and empty-image fail-closed state.
3. Have a human reviewer decide the first bounded image packet. At 45–90
   seconds per decision, 50 images take about 38–75 minutes.
4. Apply only the signed MATCH/NO_MATCH ledger, then run strict readback.
5. Promote the preview only when every shown image resolves to its exact
   listing and zero unapproved seller contacts are returned.

Reviewing all 499 current image-ready rows is approximately 6–13 reviewer-hours
for one reviewer, or about 1.5–3.5 hours with four reviewers. Images become
visible incrementally after approved decisions; the 8,176 strict listings do
not need to wait for all image decisions.

## Rollback

Remove or change `PUBLICATION_BRANDS` to end the two-brand restriction. Disable
the deployment to roll back the UI/API change. No production row rollback is
required because this release does not mutate `watch_records` or review data.
