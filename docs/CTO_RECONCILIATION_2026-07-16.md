# CTO Reconciliation - 2026-07-16

## Completed In This Pass

### Production media pilot

- Confirmed `media_manifest` contained 100 discovered rows but zero linked rows.
- Confirmed only eight image-backed records existed before this pass, all from the intentionally unnormalized `OTHER` luxury pilot.
- Identified the failed assumption in the original watch-image matcher: DigitalOcean image filenames are stored in `raw_records.raw_data`, while normalized watch IDs are derived from `source_table + source_id`.
- Added an exact-lineage streaming matcher that reads the 500 MB inventory CSV without loading it into memory.
- Excluded unknown brands, malformed/year-like references, `MULTI`, `OTHER`, and `RECYCLE` records.
- Verified every selected public URL with an HTTP `HEAD` request.
- Linked exactly 100 customer-safe watch records. Supabase returned `linked_count=100`, `unchanged_count=0`.

### Trading Floor

- Added an `images=true` server filter.
- Added a bounded horizontal source-linked image rail above the first Trading Floor page.
- The rail fetches at most 100 image-backed records and does not alter the normal 50-row server pagination, search, eligibility, or total counts.
- Promotion into the rail is stricter than image linkage: approved WTS, complete brand/reference/dial, confidence 85-100, and plausible USD pricing. Image lineage alone does not imply normalization approval.
- Current pilot result: 39 of 100 linked rows pass the automated promotion gate; 61 are withheld. A human visual/catalog agreement check remains mandatory before production release because field completeness cannot prove that the image, brand, reference, and dial agree.
- Listings without media continue using stable placeholders.

### Confidence safety

- Added a single UI boundary that accepts legacy `0-1` and current `0-100` confidence values.
- Every displayed confidence is clamped to `0-100%`.
- Corrected Detail Modal, pipeline output cards, and pipeline activity messages.

## Verified Workflow

```text
DigitalOcean inventory CSV
-> exact filename stored in raw_records.raw_data
-> raw source_table + source_id
-> imported watch_records primary key
-> reachable public image URL
-> media_manifest audit row
-> watch_records image_urls / thumbnail_url / has_images
-> bounded Trading Floor showcase
```

No image is attached by visual similarity or filename guesswork.

## Tests

- 24 focused tests passed: media lineage, featured-listing promotion, confidence capping, price outliers, five-observation analytics threshold, configuration cohorts, catalog/dial eligibility, and WTS/WTB requirements.
- Production build passed.
- Existing repository-wide lint debt remains separate from this change.

## Current Product Truth

- Trading Floor: live Supabase, server-paginated, broad inventory except recycle.
- Price Research: live Supabase, stricter comparable-data eligibility, minimum five observations, visible outlier evidence.
- Owner Admin: live protected API with planner estimates and a recent 1,000-row quality sample.
- Normalization dashboard/workbench: parts still use the historical 117,744-row static dataset.
- Legacy Analytics Dashboard: generates demonstration metrics with `Math.random`; it is not production evidence.

## Pending Work In Priority Order

### P0 - Security

1. Rotate all credentials exposed during development.
2. Remove tracked `.env.prod`, `.env.production`, and `.env.vercel` from Git history and deployment workflows.
3. Run repository and deployment secret scans.

### P0 - Data correctness

1. Restore dealer/poster lineage. Historical `watch_records` contains `seller_name` and `seller_phone`, but imported rows do not reliably populate them. Add a `dealers` entity and immutable `dealer_id` linkage from source company/channel/message identity; never infer or expose a dealer from unverified text.
2. Backfill historical poster identity from `raw_records.raw_data.company_id` and other verified source keys, recording unresolved rows instead of guessing. Preserve live sender/channel identity in the same contract and report WTS/WTB activity per verified dealer.
3. Apply the `(brand, id)` concurrent index required by the duplicate auditor.
4. Complete the Patek duplicate/repost report, review false positives, then scan brand by brand.
5. Add reversible duplicate cluster/member tables; do not delete raw evidence.
6. Continue bundle segmentation before trusting normalized columns from multi-watch messages.
7. Complete the currency evidence/rate/variance audit, including `HDK` aliases and ambiguous `$` context.

### P1 - Catalog and normalization

1. Review catalog-confirmed promotion canaries before bulk approval.
2. Work the unknown-dial and catalog-mismatch queues globally.
3. Reconcile critical owner references: `3712/1A`, `5712/1A`, `116500LN`, and Rolex `52506`/1908 cohorts.
4. Keep WTS and WTB required-field policies separate.

### P1 - Product consistency

1. Retire or relabel the random legacy Analytics Dashboard.
2. Replace remaining `parsedWatches.json` dependencies with live APIs or clearly isolate them as a normalization workbench.
3. Add exact, reconciled counts for raw observations, unique offers, active offers, reposts, and review candidates.
4. Complete dealer authentication: provisioned accounts, MFA, recovery, audit events, then remove beta skip.

### P2 - Media expansion

1. Human-review the 100-image pilot for visual/reference agreement.
2. Measure incorrect-link and unusable-image rates.
3. Expand in controlled batches only after the labeled pilot meets the acceptance threshold.
4. Add multi-image/collage association after message-level lineage is stable.

## Release Condition

Deploy the showcase after branch build/tests and preview smoke testing. The 100 linked records are additive and reversible through `media_manifest`; no normalized identity, price, verdict, or raw evidence was modified.
