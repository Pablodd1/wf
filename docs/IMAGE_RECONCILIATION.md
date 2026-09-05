# Image Reconciliation

## Target Behavior

Images attach first to raw messages and source attachments. Later, image analysis can associate one or more image regions with one or more listing candidates.

```text
raw_message
-> message_media
-> listing_candidates
-> optional image_candidate_assertions
```

## Rules

- Do not overwrite text claims with image guesses.
- Use image evidence to confirm or flag mismatch.
- Store image confidence separately from text confidence.
- Collage images may correspond to several listings.
- Missing image should not block raw text migration.

## Required Media Manifest

```text
source_message_id
source_attachment_id
source_group_id
source_timestamp
source_object_key
source_filename
mime_type
source_size
etag
sha256
target_bucket
target_object_key
migration_status
verification_status
error_code
```

## Current Risk

The audit did not confirm a complete media manifest or reliable message-to-image-to-candidate relationship.

## 100-Image Pilot

The pilot deliberately separates **media discovery** from **listing attachment**:

1. `npm run media:seed-manifest` streams the DigitalOcean inventory CSV, verifies public image URLs, and selects a bounded sample. It modifies no listing rows.
2. Set `APPLY_MEDIA_MANIFEST=true` only after the `media_manifest` migration is deployed. This registers reachable objects as `discovered` evidence.
3. `npm run media:pilot` attempts indexed source-ID matching. It defaults to dry-run and requires `APPLY_MEDIA_LINKS=true` before it can call the atomic attachment RPC.
4. A zero-match result is a data-contract finding, not permission to guess. The source database attachment/message relationship must be joined before images appear on customer listings.

Validated pilot evidence (2026-07-16):

- 100 real image objects were selected from the production inventory and returned successful HTTP checks.
- The first 25,001 inventory rows produced 94 image candidates but zero trustworthy direct `watch_records.id` matches.
- Therefore the 100-object pilot is manifest-only. Customer-facing listing attachment remains disabled until the legacy message/attachment lineage is proven.

Required local variables:

```text
MEDIA_INVENTORY_CSV=C:/Users/jasme/Downloads/thecollective-prod_inventory.csv
SUPABASE_URL=...
SUPABASE_SERVICE_ROLE_KEY=...
MEDIA_MANIFEST_LIMIT=100
```

## Child-lineage audit

For unbundled exports, run `npm run audit:child-image-lineage` before any
attachment write. The report permits only a single child whose brand and
reference exactly match the source parent. Shared parent images remain
review-only because an image attached to a multi-listing message cannot be
assigned to one child without additional evidence.

Patek audit evidence (2026-07-24):

- 418 source parents contain image filenames.
- 46 parents occur in the unbundled mappings.
- All 46 mapped parents contain multiple child listings (2 to 139 children;
  average 23.2).
- 372 image parents have no child mapping in the supplied export set.
- Zero child images qualify for automatic attachment.
- Sampled children include dates parsed as references (`2024/5`, `2025/6`)
  and mixed-brand parent messages. These remain review-only and must not enter
  customer image inventory or Price Research as exact-reference evidence.

The shared parser now rejects slash dates as references and recognizes attached
Patek shorthand such as `PP5269R`. A read-only batch-004 canary corrected
`2024/5 / 5 HKD / 1 USD` to `5269R / 449,000 HKD / 57,564 USD`. The row remains
blocked from publication because its catalog result is only a partial match.

