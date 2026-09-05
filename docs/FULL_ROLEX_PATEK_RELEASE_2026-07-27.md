# Full Rolex and Patek Release

**Control date:** July 27, 2026  
**Customer scope:** all currently publishable Rolex and Patek Philippe references  
**Normalization policy:** evidence first; no inferred price, currency, identity, image, or seller  
**Production record policy:** no `watch_records` writes

## CTO decision

Expand the prior three-reference client release to every Rolex and Patek
Philippe listing that already passes the reviewed publication contract. Route
unresolved identities to one authenticated human-review lane. A signed identity
decision may change only `listing_identity_reviews`; it never changes the
immutable raw listing.

“Full” means complete coverage of both brands through an explicit disposition:

- customer-publishable now;
- pending identity review;
- pending price/currency review;
- pending image review;
- pending seller-lineage review;
- bundle review required;
- reviewed duplicate suppression; or
- missing immutable evidence.

It does not mean relabeling blocked or incomplete records as approved.

## Customer publication gate

A Trading Floor row must satisfy every applicable gate:

1. canonical brand is exactly Rolex or Patek Philippe;
2. identity status is `CATALOG_CONFIRMED` or `HUMAN_APPROVED`;
3. canonical model, reference, and dial are present;
4. verdict is `APPROVED`;
5. parser confidence is finite and at least 90;
6. the listing is WTS, WTB, or NTQ;
7. the record is not an unsplit bundle parent;
8. the record is not a currently suppressed reviewed duplicate;
9. WTS records pass the existing market plausibility floor;
10. customer identity passes the application catalog-safety check; and
11. deterministic reposts are represented once.

The database view `two_brand_verified_trading_release` performs the bounded
release selection and global repost ranking directly from immutable raw-backed
records plus the separate reviewed canonical identity. This allows a signed
human identity correction to become publishable without rewriting the raw
record. The API uses created-at/record-ID keyset pagination and never loads the
full reviewed brand population into Railway or Vercel memory.

## Price Research

Price Research may discover every allowed Rolex/Patek reference, but a listing
affects statistics only when the immutable raw reference line proves its asking
price and currency. A bare `$`, unverified fixed-rate conversion, missing FX
provenance, bundle parent, catalog conflict, reviewed duplicate, or required
field failure stays excluded with its actual reason.

Condition remains visible on the listing description. New, Used, and
Unspecified are one analytics cohort for the exact brand/reference/dial.
Statistical outliers are retained and labeled; they are not deleted.

## Human identity review

The authenticated `Rolex + Patek identity` lane shows:

- immutable raw listing;
- current structured identity;
- proposed brand, model, reference, and dial;
- observed seller evidence for the reviewer only;
- source-linked candidate image with an explicit unverified warning;
- every other current release blocker; and
- the prior identity evidence/status.

The interactive queue defaults to `READY_FOR_IDENTITY_REVIEW`: records where
normalization, market-data eligibility, raw evidence, bundle handling, and
duplicate policy already pass, so the signed identity decision is the final
customer-publication blocker. The service-only queue also reports the other
routed dispositions for census and operations, but it does not ask a reviewer
to make a wasted identity decision before those prerequisite lanes are
complete.

Human approval requires:

- reviewer or administrator session;
- same-origin request;
- explicit inspection checkbox;
- reason of at least 12 characters;
- complete Rolex/Patek canonical identity;
- the exact canonical reference token in the raw listing; and
- catalog confirmation without a dial conflict.

The server records the reviewer identity, reason, raw-message SHA-256, catalog
result, prior evidence, and blocker snapshot through
`apply_listing_identity_review`. A conflict is also an explicit signed
decision. Neither decision writes to `watch_records`.

## Images and sellers

Identity approval does not approve an image. An image appears to customers only
after the existing exact source-object ownership check and a signed
`VISUALLY_VERIFIED` decision whose identity snapshot still matches the current
listing.

Observed seller names and phone values are private review evidence. Public
seller data still requires exact applied listing lineage, a verified dealer,
contact consent, and a verified contact method. Full brand scope does not
bypass those gates.

## Deployment sequence

1. Merge the reviewed application, migration, workflow, UI, and tests.
2. Run `Apply full Rolex and Patek release` with confirmation
   `APPLY_FULL_TWO_BRAND_RELEASE`.
3. Accept only a successful schema/privacy check and the exact two-brand census.
4. Deploy the application while the three-reference environment gate remains in
   place.
5. Set production `PUBLICATION_REFERENCES=ALL_REVIEWED`.
6. Redeploy and verify:
   - Rolex and Patek pages return HTTP 200;
   - references outside the former three cohorts are present;
   - keyset page two has no repeated IDs;
   - a third brand remains blocked;
   - Price Research keeps unverified currency out of statistics;
   - unreviewed images remain absent;
   - reviewer identity queue is authenticated; and
   - no raw seller contact appears publicly.

The expected deployment and verification window is 20–45 minutes after merge,
assuming the indexed view census completes inside its 120-second database
timeout. Human review continues incrementally and does not block already
publishable listings.

## Deterministic bulk catalog confirmation

The manual workflow `Confirm exact Rolex and Patek catalog matches` scans a
frozen two-brand snapshot through four disjoint record-ID shards. Each worker
uses the validated batch size of 250 and writes only `CATALOG_CONFIRMED`
decisions. It requires the parsed reference to appear in immutable raw
evidence, an exact or explicitly curated catalog configuration, a catalog
model, and an agreeing catalog dial. Explicit model or dial conflicts and
incomplete evidence remain in review.

The workflow runs a read-only canary first, preserves signed human decisions,
atomically checkpoints every batch, and reconciles every input row to a
classification or error. It never writes `watch_records`. Newly confirmed rows
flow automatically to Trading Floor when the remaining publication gates pass
and to Price Research only when source-backed price and currency gates also
pass. Existing images and seller evidence remain governed by independent
signed lineage, visual-review, dealer-verification, and consent controls.

## Exact release census

The targeted production workflow publishes the authoritative census grouped by
brand:

- globally deduplicated customer release rows;
- visually verified image rows;
- human-approved identity rows;
- deterministic catalog-confirmed rows; and
- unresolved identity rows by status.

Do not synchronously recompute a global disposition count across the unresolved
universe. It exceeds the 120-second production audit budget. The reviewer API
builds `READY_FOR_IDENTITY_REVIEW` pages through record-ID keyset scans of 100
unresolved rows at a time, checks bundle and duplicate ledgers only for those
IDs, returns at most 50 actionable records, and scans no more than 1,000 raw
queue rows per request. It reports an opaque `nextCursor`; a checkpointed queue
snapshot may add a durable global count later without blocking reviewers or
customer reads.

Do not copy older two-brand or three-reference counts into this section. Use the
new workflow summary because it measures the actual deployed view.

## Rollback

Set `PUBLICATION_REFERENCES` back to the previous exact three-reference value
and redeploy. The new views, indexes, and queue may remain unused. No source
record rollback is required because this release does not modify
`watch_records`, image decisions, seller decisions, bundle decisions, duplicate
decisions, or existing identity decisions.
