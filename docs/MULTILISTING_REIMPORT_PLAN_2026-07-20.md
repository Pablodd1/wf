# Multilisting Reimport And Lineage Plan

Date: 2026-07-20

## Decision

Accept the manually unbundled files as CSV, but never import them directly into `watch_records`. Load them into a staging table, validate lineage and normalization, enrich them from the legacy `auctions` source, then review and publish child listings through the existing shadow workflow.

## Confirmed evidence

- Production Supabase currently contains 17,000 `raw_records`.
- It contains zero `raw_records` with `source_table = auctions`.
- Therefore Supabase alone cannot recover `auctions.front_image`, seller/company identity, seller phone, or original auction posting date for the edited bundle files.
- The local production Spaces inventory CSV exists and contains about 3.9 million object rows.
- The repository already supports image lineage from legacy raw image fields, but it requires the missing legacy `auctions` rows or an equivalent export.

## Required CSV contract

Every manually split child row must preserve:

```text
source_record_id
child_index
raw_listing_line
```

Strongly preferred columns:

```text
source_table
source_id
raw_parent_message
brand_claimed
model_claimed
reference_claimed
dial_claimed
condition_claimed
year_claimed
price_raw
currency_claimed
listing_type_claimed
manual_notes
```

`source_record_id + child_index` must be unique and stable across all files. Do not renumber children after delivery.

## Legacy auctions export contract

Provide a read-only export with the database primary key and all available lineage fields. At minimum:

```text
id
title or raw_message
front_image
created_on or original_posted_at
from_number
from_name
company_id
brand
reference
price
dial_color
condition_id
region
```

Additional image/attachment columns should be retained. Do not remove null columns or transform phone numbers in the source export.

## File format

- UTF-8 CSV with one header row.
- Identical headers in every part.
- Prefer 100,000-250,000 child rows per file or no more than 500 MB uncompressed.
- Gzip each CSV independently for transfer.
- Include a manifest with filename, row count, byte size, and SHA-256 checksum.
- Excel workbooks are not the import format because of row limits and type coercion.

## Processing stages

1. **Intake audit:** schema consistency, row counts, encoding, required fields, stable child keys, and checksums.
2. **Staging load:** immutable upload into a dedicated staging schema. No customer visibility.
3. **Parent reconciliation:** join `source_record_id` to the exported parent and compare every child line with the preserved parent message.
4. **Legacy enrichment:** join legacy `auctions.id` to seller/company, original date, region, and `front_image`.
5. **Deterministic normalization:** brand/reference/dial/condition/intent and HKD/USD price parsing. Missing evidence remains null.
6. **Catalog validation:** exact reference and configuration checks. Conflicts go to review.
7. **Image lineage:** construct `https://thecollective-prod.nyc3.digitaloceanspaces.com/listings/full/<front_image>`, verify the object against the Spaces inventory, and retain parent-level evidence when child-image assignment is ambiguous.
8. **Duplicate review:** evaluate duplicates only after child splitting and lineage reconciliation.
9. **Canary:** publish a small, audited cohort; compare Trading Floor and Price Research behavior.
10. **Checkpointed rollout:** promote approved children in bounded batches, then suppress a parent only when its publishable children account for it.

## Publication rules

- Trading Floor may show a child when its listing identity and intent are usable, while clearly labeling unresolved review state.
- Price Research requires WTS, required identity/configuration, valid normalized USD price, catalog consistency, no unresolved duplicate inflation, and at least five comparable observations.
- WTB rows never enter asking-price averages.
- Seller contact is customer-visible only after dealer identity verification and contact consent.
- Original posting date comes from the source database/message timestamp. Import timestamps are never substituted.
- A parent image is not silently assigned to every child in a bundle.

## Confidence

- Deterministic normalization with intact source IDs and raw lines: **9/10**.
- Seller/date/image enrichment with a complete `auctions` export keyed by `id`: **8.5/10**.
- Seller/date/image recovery from the edited CSV alone when lineage IDs are missing: **2/10**.
- Exact child-to-image assignment for multi-watch posts without attachment/message mapping: **4/10**; parent-level evidence is safer.

## Go/no-go gate

Do not begin the full import until a 1,000-row sample from the edited files and a matching `auctions` export sample achieve:

- 100% stable child-key uniqueness.
- At least 99.9% parent join coverage.
- 100% preservation of raw child text.
- Reported seller/date/image coverage with no guessed values.
- Zero direct writes to production `watch_records` during validation.

## Image sequencing

Image enrichment is the final stage after parent/child lineage, seller identity,
original posting date, intent, catalog identity, and duplicate decisions are
proven. A bounded 200-record pilot was attempted on 2026-07-20 against the
production Spaces inventory. Only six records achieved exact source identity
and brand/reference agreement, so only those six were linked. The remaining
194 were not guessed and require the legacy `auctions.front_image` export.
