# CTO Continuation and Image AI Handoff

**Control date:** July 27, 2026
**Status:** implementation prepared on a review branch; no production records,
image links, seller links, parser rules, catalog rules, or deployment settings
were changed by this work.

## Executive decision

The next safe acceleration is a **bounded reviewer assistant**, not a bulk AI
image matcher. It must show an independent, blind observation of one source
image alongside the immutable listing and current canonical identity. A human
reviewer remains the only actor who can create the signed image decision.

The current customer mission is therefore split into two tracks:

1. Deliver all Rolex and Patek Philippe records which already satisfy the
   independent public-release gates to Trading Floor and Price Research.
2. Move blocked records through small, evidence-backed review lanes for
   identity, images, seller lineage, currency, bundles, and duplicates. An AI
   may make those lanes faster, but it cannot turn uncertainty into approval.

This is the saved continuation point for the previous discussions about
normalization speed, two-brand availability, image/listing correspondence,
seller display, review assistance, bundled listings, duplicates, and
client-ready review.

## What is verified versus still pending

The following is a dated readback from the current control center, not a live
production query made by this document.

| Area | Verified state | Consequence |
| --- | --- | --- |
| Deterministic normalization | 2,631,476 raw-evidence-eligible records shadow analyzed; 0 analyzer errors; 107 rows lack immutable raw message | The broad analysis run is complete. Do not rerun it or invent values for the 107 blocked rows. |
| Catalog identity | 22,976 catalog-confirmed; 82,111 conflicts; 38,595 unverified; no automatic human-approval claim | A reference/model/dial can reach review only with evidence; conflicting identity remains off the public floor. |
| Images | 1,531 audited input/output rows; 1,523 manifest-linked; 1,359 require visual decision; 172 structural rejects; 0 visually verified | An image URL or manifest link is not customer display permission. |
| Seller lineage | 16,094 private candidates; 0 public seller links | Do not display a poster, contact, or dealer stats until exact lineage and consent are applied. |
| Bundles | 761,489 parent messages; 70,194 staged children; 0 approved/published | A parent bundle must never appear as one child listing. |
| Currency and price | Explicit message evidence and retained FX provenance required | Bare `$`, geography, phone, dealer, reference, or price magnitude never creates a currency. |
| Duplicates / multilisting | Separate review gate | A duplicate is not deleted or suppressed just because it looks similar. |

The exact count authority and historical evidence are in
[`CTO_CONTROL_CENTER.md`](CTO_CONTROL_CENTER.md),
[`DATA_RECOVERY_STATUS_2026-07-25.md`](DATA_RECOVERY_STATUS_2026-07-25.md),
and [`IMAGE_RECONCILIATION.md`](IMAGE_RECONCILIATION.md).

### July 27 live read-only image-release check

An additional read-only Supabase check completed at `2026-07-27T18:21:56Z`.
It is the current operational image release view and is narrower than the
historical 1,359-row all-brand visual-review audit above:

| Live image-release measure | Exact count |
| --- | ---: |
| Source-linked image records | 1,523 |
| Visually verified images | 0 |
| Catalog-confirmed identity | 595 |
| Identity unverified | 764 |
| Identity conflict | 164 |
| Source-linked Rolex/Patek candidates | 580 |
| Passing approved/confidence release gates | 383 |
| Complete-evidence records ready for human image review | 371 |
| Ready Rolex records | 371 |
| Ready Patek Philippe records | 0 |
| Structurally blocked candidate records | 12 |
| Ready under the old three-reference default | 21 |

This means images cannot yet display on either public floor: each needs an
explicit signed `MATCH` and must pass the other release gates. The 371-record
queue is the first useful bounded canary; it is not proof that all Rolex/Patek
records have matching images. Patek currently has no complete image-evidence
records ready for this lane and requires a prior lineage/identity correction.

Before reviewers start, verify the deployed API environment uses
`PUBLICATION_REFERENCES=ALL_REVIEWED` and
`PUBLICATION_BRANDS=Rolex|Patek Philippe`. If the first value is absent, the
older three-reference default restricts the review release to 21 records. The
review UI must also be verified in the deployed preview for working keyset
pagination; local source contains Previous/Next controls, but deployment must
be checked rather than assumed.

### July 27 live customer-page check

The deployed Trading Floor and Price Research pages were read without changing
data. The release scope reports `ALL_REVIEWED`, not the former three-reference
canary. Evidence includes:

| Read-only live check | Result |
| --- | --- |
| Trading Floor first page | 48 customer-visible records and a working **Load more** control |
| Trading API Rolex first 100 | 0 verified images; 100 missing posting dates; 100 missing locations; more records available |
| Trading API Patek first 100 | 0 verified images; 97 missing posting dates; 99 missing locations; more records available |
| Price Research Rolex 116610LN | 71 eligible observations; analytics ready |
| Price Research Rolex 126500LN | 31 eligible observations; analytics ready |
| Current Patek Golden Ellipse selection | No approved listing evidence returned |

The page was rendering `Location not provided` and `Posted: Not listed` for
those source-null values. That wording is misleading to a customer: it is not
a claimed location or post date, it is a missing field. The continuation change
therefore omits the location/date block entirely unless the actual source value
exists. It also removes `Location not published` from seller panels when an
otherwise verified seller has no published city/country.

The public cards are deliberately bounded (48 on the observed desktop page,
up to 100 API records) and must use **Load more** to fetch the next page. The
API does not return a full total in cursor mode, so no honest public count of
all visible Rolex/Patek cards should be asserted without a dedicated counted
readback.

## Current user-facing request, captured

The requested client-ready experience is:

- Rolex and Patek Philippe availability should progress as far as their
  independent evidence permits, with unresolved records visibly routed to human
  review rather than silently discarded.
- An image must be shown only beside the correct listing; its source, listing,
  model/reference, and user/seller relationship must remain accountable.
- Price Research should show listing evidence, appropriate price analytics, and
  visible exclusions rather than making a price/currency or outlier decision
  disappear.
- Trading Floor must not display bundle parents as child listings or treat
  multilisting/duplicate candidates as independent confirmed inventory.
- A reviewer needs practical AI help to fill or inspect missing fields, but the
  system must not hallucinate, overwrite raw evidence, or auto-approve.

Some UI work and prior release work are described in the dated two-brand and
full Rolex/Patek release documents. This handoff does not claim a customer
page is complete unless its release gates have been independently verified.

## Material issue found in the prior visual helper

The prior `api/verify-image.js` comparison treated a brand-only visual
resemblance as `MATCH`; it also accepted prefix/shared-number reference
similarity and the browser helper could use a client-side Gemini key. Those
behaviors are too permissive for image-to-listing attribution. A Daytona
photograph, for example, cannot prove that it belongs to one particular
Daytona listing merely because the model recognizes Rolex or the dial color.

The prepared change removes that path. Vision calls are server-side,
same-origin, reviewer/admin authorized, quota-limited, and the model receives
only the image. The listing claim is compared *after* the blind observation is
returned. No image bytes or model key enter the browser.

## Image evidence contract

### What AI may do

For one already lineage-linked source image at a time, a vision model may
report only what is visibly observable:

- visible brand;
- visible reference text, if any;
- model-family guess;
- dial-color observation;
- legibility, confidence, and a short note.

The model does not receive the raw listing, listing text, claimed reference,
price, seller, or a proposed decision. This keeps the observation blind.

### What qualifies as an AI `MATCH` suggestion

All of the following are required:

1. the item entered the exact image queue through source object, raw-message,
   record, and current verified-identity lineage;
2. the source image is legible;
3. the model independently reads a complete visible reference; and
4. its normalized reference exactly equals the current canonical listing
   reference, with no visible brand conflict.

Formatting differences such as `5712/1A-001` versus `5712 1A 001` normalize
to the same exact reference. A prefix or cropped reference is **partial** and
remains `UNVERIFIED`; it is not a mismatch and it is never a match.

### What does not prove an image association

- same brand;
- same model family;
- same dial color;
- visual resemblance or an embedding score;
- filename/path proximity;
- a matching price, user, location, or posting time; or
- AI confidence alone.

Brand, model, and dial checks are displayed as reviewer aids. A contradictory
visible brand or a different complete reference is an `MISMATCH` alert, still
requiring a human adjudication. An unreadable image is `UNVERIFIED`.

### Human decision and audit

The existing exact image-review lane remains the only attachment decision.
The reviewer must inspect the source image beside the preserved raw listing,
select `MATCH` or `NO_MATCH`, and supply a reason. The signed decision RPC
records the current server-side identity snapshot and evidence; the visual
assistant does not pre-select a radio button, tick the inspection checkbox, or
write a decision.

## Fast, accurate review workflow

```text
source image + immutable source lineage + verified current identity
    -> blind visual observation (optional, one image)
    -> server-side exact-reference/brand comparison
    -> reviewer sees image, raw listing, observation, checks, and blockers
    -> signed MATCH / NO_MATCH decision
    -> separate public-release gate evaluates image + identity + price + seller + bundle + duplicate
```

Run the assistant only on the existing 1,359 image-review candidates, in
25-50 item reviewer batches, after structural blockers are resolved. A single
Gemini 2.5 Flash image call per item is the cost/latency default; Kimi is a
server-side fallback only. This reduces reviewer search time while retaining a
strict stop condition.

Do not run visual AI across the multi-million-record archive. It adds cost
without creating source lineage or exact identity evidence.

## Learning loop without repeat mistakes

Use only signed human image decisions as labels. Store the image content hash,
source object key, raw-message/source identifier, current canonical identity
snapshot, reviewer decision, reason, policy version, and model observation.
Never use a model's own suggestion as a label.

Training and evaluation must split by source message and image hash so reposts
or near-duplicate images cannot leak across sets. The first learning product is
a ranking queue: prioritize likely mismatch, likely exact-reference evidence,
and repeated structural failures. It may not attach images, change canonical
identity, or publish a listing. Any later auto-decision proposal requires a
separate measured precision/recall canary and written approval.

## Priority sequence and realistic timing

| Order | Work | Completion signal | Indicative effort |
| ---: | --- | --- | --- |
| 1 | Merge/review the contained visual-assistant change | Tests/build pass; no production mutation | Same working session |
| 2 | Resolve 172 structural image blockers | Every item has a specific remediation or stays blocked | 3-8 reviewer hours initially |
| 3 | Review 1,359 lineage-safe image candidates | Signed decision or explicit `NO_MATCH` for every item | About 17-34 reviewer-hours; 4 trained reviewers: 4-9 elapsed hours |
| 4 | Continue Rolex/Patek identity review | Signed identity decision, then independent gates | Start in bounded 1,000-record canaries, not a bulk promotion |
| 5 | Apply verified seller lineage, duplicate, bundle, and price gates | Each required gate has auditable evidence | Separate workstreams; not a same-day safe bulk release |

The previously measured four Railway workers with batches of 250 are the
normalization ceiling. That job is I/O and record-complexity dominated; more
machines or Railway instances will not solve the present review and lineage
backlog. The fastest safe investment now is parallel, trained human review
using the bounded assistant and exact evidence packets.

## Additional release blockers saved for the next route-alignment change

A separate read-only review found that a newly canonical-confirmed row can be
listed but fail on detail/search because parts of the application still read
older stored identity before applying canonical identity. The exact gaps are:

- Trading Floor full-feed selection uses the canonical release view, while
  Trading detail/contact can still use stored identity; a canonical-only row
  can therefore list and return `404` when opened.
- Price Research searches stored brand/reference before canonical identity is
  applied, so corrected rows may not be found.
- Dealer profiles limit to 50 rows before identity/seller lineage gates, which
  can hide later valid rows.
- No Rolex/Patek WTS record with applied, consented, verified seller lineage
  has yet been demonstrated, so public poster/dealer display remains blocked.

The safest resolution is a bounded read-only seller reconciliation followed by
a small route-alignment release with a canonical-only listing and seller
regression test. It should be kept separate from the image-assistant change.

## Explicit non-actions

- No full-dataset normalization job is started.
- No `watch_records` write, image attachment, seller attachment, catalog
  mutation, or release/publish action is taken by the visual assistant.
- No raw historical archive or raw listing text is sent to the vision model.
- No currency, price, condition, intent, model, reference, or seller value is
  inferred from an image.
- No private dealer-directory URL or private contact is exposed.

## Next operator checklist

1. Review the code/test change on its branch and deploy only after normal
   preview validation.
2. Open Review Queue → Images as a reviewer/admin and select one lineage-safe
   record. Use **Compare image to listing identity**. Confirm the result does
   not change the decision controls.
3. For a `MATCH` suggestion, inspect the physical visual evidence and raw
   listing; write a specific reason before submitting the signed decision.
4. For `MISMATCH`, select `NO_MATCH` unless a separate source-lineage review
   proves the observation is wrong. For `UNVERIFIED`, leave it pending or
   reject with a reason; do not attach it by resemblance.
5. Export signed decisions as a private, source-grouped learning candidate set
   only after a reasonable initial reviewed cohort exists.

## Files changed by this continuation

- `api/_lib/image-visual-advisory.cjs` — pure exact-comparison policy;
- `api/verify-image.js` — authorized, quota-bounded blind vision advisory;
- `src/lib/verifyImage.ts` — removes direct browser vision/key behavior;
- `src/pages/ReviewQueue.tsx` — reviewer-only visual check panel;
- `tests/image-visual-advisory.test.cjs` and related review tests — regression
  coverage for no partial/brand-only match and no auto-decision.
