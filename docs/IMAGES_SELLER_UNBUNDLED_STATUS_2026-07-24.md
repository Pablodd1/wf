# Images, seller contact, and unbundled status - 2026-07-24

## Executive status

The three data streams are preserved and reviewable, but they are not equally
ready for customer publication.

| Stream | Current decision | Verified result |
| --- | --- | ---: |
| Listing images | Partially live | 1,523 manifest objects linked; 100 reachable objects still unlinked |
| Seller/contact lineage | Private review only | 16,094 exact candidates staged; 0 public contacts |
| Unbundled listings | Human review only | 70,194 staged; 0 approved or published |

No seller identity was inferred. No phone number was published. No unbundled
child was automatically promoted.

## Images

Live production readback:

| Check | Rows |
| --- | ---: |
| `watch_records` with images | 1,531 |
| `media_manifest` total | 1,623 |
| Linked manifest objects | 1,523 |
| Discovered, not linked | 100 |
| Matched but not linked | 0 |
| Orphaned | 0 |
| Failed | 0 |
| URL reachable | 1,623 |

The difference between 1,531 image-backed records and 1,523 linked watch
manifest rows includes the separate non-watch luxury pilot. A reachable URL is
not sufficient evidence that an image belongs to a listing.

An additional 83-image canary was attached after scanning 5,000 exact filename
lineage candidates. Every attached row passed structured raw/listing
brand-reference agreement, was a non-bundle and non-recycled listing, had no
existing image, and returned a reachable object URL. The audited RPC reported
83 linked and 0 unchanged.

A second 100-image Audemars Piguet batch was applied from a fixed candidate
ledger. Its SHA-256 was
`382c060b58d6ca18727b4d07cfffca1988541445c8844a56a8cc20a18267609f`.
Ten samples distributed from the beginning through the end of the ledger were
visually reviewed. A production dry run then revalidated all 100 current watch
rows and all 100 object URLs before the write. The audited RPC reported 100
linked and 0 unchanged; independent readback confirmed 100 exact listing
matches and 100 exact manifest matches.

A final residual scan found 63 structurally exact candidates. All 63 source
objects were downloaded and reviewed on four contact sheets. Five were
rejected: one definite brand mismatch, two multi-watch collages, one
product-page screenshot, and one unusably low-resolution image. The remaining
58 were applied from the immutable ledger
`outputs/image-lineage/visually-approved-residual-58-ledger.json`, SHA-256
`599a6631c85ab028119bdc6b304594ddc8274a5e75ac2abb3d3555563020d1dd`.
The audited RPC reported 58 linked and 0 unchanged. Independent readback
confirmed 58 exact watch-row matches and 58 exact manifest-row matches with
zero failures. The public Trading Floor API returned the exact linked image
for AP reference `26252OR`, the object returned HTTP 200 as JPEG, and the image
URL was present in the rendered production marketplace DOM.

The rejected candidate counts overlap because one row may fail several gates:

- 4,204 source/listing identity disagreements;
- 1,127 invalid references;
- 1,031 missing or unknown brands;
- 789 listings that already had images;
- 754 recycled listings.

No rejected image was forced onto a listing.

The Patek child-image audit contains 418 candidates:

- 372 have no child mapping to the image-bearing parent;
- 46 share one parent image across multiple children;
- 0 are safe for automatic child assignment.

Those images remain blocked. The evidence artifact is
`outputs/image-lineage/patek-philippe-child-image-lineage.csv`.

## Seller and full contact

The source CSV contains 1,293,376 rows. It was reconciled against 761,489
unbundled parent messages.

| Reconciliation result | Rows |
| --- | ---: |
| Exact match ready | 16,094 |
| Review required because intent conflicts | 288 |
| Unmatched | 745,107 |
| Matched rows missing a seller name | 449 |
| Matched rows with a front-image filename | 16,381 |

The complete 16,094-row match-ready manifest was written to the private
`seller_listing_lineage_staging` table and read back:

| Private staging check | Rows |
| --- | ---: |
| Total | 16,094 |
| `MATCH_READY` | 16,094 |
| With phone identity | 16,094 |
| With seller name | 15,657 |
| With original posting date | 16,094 |
| With front-image filename | 16,093 |
| Source sale intent | 11,878 |
| Source search intent | 4,216 |
| Linked to a verified dealer | 0 |
| Applied | 0 |

The 15,657 rows with name, phone, and original date are available to the
authenticated admin/reviewer workflow. The remaining 437 have phone and date
evidence but no seller name and must not be filled by inference.

A separate child-lineage canary was also staged privately. The current private
child table contains 190 pending rows: today's signed 95-row cohort plus a
distinct prior 95-row cohort. All 190 have zero public-contact permission, zero
public-image permission, and zero dealer assignment. In today's cohort, 67
rows are review-ready and 28 require human correction; 58 are WTS and 37 are
WTB. Seller name, phone, source posting date, parent image evidence, and
parent-child linkage were present on all 95. `source_posted_at` is the
authoritative original date; the auxiliary child creation timestamp must not
be substituted.

Customer publication remains blocked because production currently has:

- 0 dealer entities;
- 0 verified dealers;
- 0 dealer contact-consent records;
- 0 public listings linked to a dealer.

The admin review API returns raw message, masked seller contact, original
posting date, and front-image filename when exact source lineage exists. Its
authorization is restricted to reviewer/admin roles. Full contact requires an
explicit reveal action; the action is denied unless its audit record can be
written. Queue responses use private no-store caching, and raw text is
contact-redacted before external AI review.

## Unbundled collection

The 16 CSV trios preserve:

| Full intake check | Rows |
| --- | ---: |
| Parent raw messages | 761,489 |
| Exported child candidates | 32,307,467 |
| Exact child-to-parent raw lineage | 32,307,467 |
| Parent/child intent conflicts | 675,636 |
| Unusable parent intents | 254,298 |
| Missing exported brand | 7,751 |
| Seller evidence in the original exports | 351 |
| Image evidence in the original exports | 0 |

The 32.3 million value is not curated inventory. It is the raw candidate
expansion produced by splitting inventory-style messages, averaging about 42
children per parent. Every batch is held for correction.

Live private `watch_staging` readback:

| Review state | Rows |
| --- | ---: |
| Manual unbundled staged | 70,194 |
| Pending | 64,036 |
| Blocked for renormalization | 6,158 |
| Review-ready lane | 42,359 |
| Human-correction lane | 27,835 |
| Approved | 0 |
| Rejected | 0 |

The review lanes describe routing, not approval. Review-ready rows still
require duplicate acknowledgement and a human decision before the audited
publication function can write a child to `watch_records`.

## Required next gates

1. Review the 288 seller intent conflicts, starting with the previously
   identified 98 WTS/WTB conflicts. Do not attach a seller to a child whose
   intent contradicts the source.
2. Reconcile the 16,094 private seller candidates to real dealer entities.
   An owner must verify each dealer and explicitly approve contact publication.
3. Work the 42,359 review-ready rows in bounded batches. Correct the 27,835
   human-correction rows and the 6,158 renormalization blocks before approval.
4. Suppress a bundle parent only after all accepted children are reconciled
   and duplicate review is complete.
5. Expand images only when one exact listing maps to one exact source image.
   Never reuse a parent image across multiple children without evidence.
6. Keep future schema changes forward-only. Production now verifies all 22
   audited migration contracts and reports zero unresolved ledger versions.
7. Preserve the ownership boundary: Trading Floor uses the customer-safe
   inventory view; Price Research applies catalog model and dial confirmation
   in `classifyResearchEligibility`. `watch_staging` is private under RLS.

## Reproducible evidence

- Full unbundled audit:
  `wf-data-canary/audit-output/unbundled/unbundled-collection-audit.json`
- Seller reconciliation:
  `wf-data-canary/audit-output/dealer-lineage/seller-lineage/run-2026-07-24/report.json`
- Seller private-write checkpoint:
  `wf-data-canary/audit-output/dealer-lineage/seller-lineage/run-2026-07-24/full-16094-write.checkpoint.json`
- Repository intake report:
  `docs/UNBUNDLED_COLLECTION_INTAKE_2026-07-21.md`
- Seller staging migration:
  `supabase/migrations/20260720220000_seller_listing_lineage_staging.sql`
- Admin review endpoint:
  `api/unbundled-review-queue.js`
- Residual image readback verifier:
  `tools/mission-images/verify-image-ledger-readback.cjs`

All live counts in this report were read through the Railway production
environment on 2026-07-24 using service-role access. The report contains
counts only; it does not contain seller names, phone numbers, or credentials.

Production schema evidence:

- Forward repair: GitHub Actions run `30136124476`, successful.
- Post-repair ledger inspection: run `30136164612`, 22/22 predicates verified.
- Ledger reconciliation: run `30136203508`, 22 verified versions repaired and
  0 unresolved; no historical schema SQL was replayed.
