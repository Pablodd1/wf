# Mission Images

Resumable mapping of the DigitalOcean Spaces inventory into WatchFacts. The
source CSV is streamed and never loaded into memory. This job does not need a
Spaces secret key because it consumes an existing inventory CSV and constructs
public URLs from object keys.

## Why staging is required

Bucket IDs are not uniformly `watch_records.id`:

- `auctions/chats/full/<uuid>_attachment1.png` identifies a chat attachment.
- `listings/full/<hex>_front_image.jpg` maps to `watch_records.flags.image`.
- `jewelryListings/...` belongs to jewelry inventory, not necessarily watches.
- `certifications/...` belongs to a report/certification record.

A direct `listings.update(...).eq('id', extractedId)` would therefore miss most
records and risks cross-linking unrelated media. Mission Images first stores an
auditable inventory, then links only deterministic `listings/` image matches.

Production lineage was sampled before this tool was saved. Imported records use
IDs such as `mysql_auction_watches_<uuid>`, while `flags.image` contains the
Spaces filename such as `68f3ab46252ac_front_image.jpg`. Five sampled filenames
were confirmed present under `listings/full/` in the supplied inventory CSV.

## Validation evidence

- Inventory file: 500,617,623 bytes.
- First 100,000 rows streamed without loading the file into memory.
- 99,998 identifiers extracted (99.998%).
- The two unparsed keys were non-media objects: `exports/orphans.csv` and the
  empty directory marker `farfetch/`.
- UUID, 13-24 character hexadecimal, and legacy numeric MySQL identifiers are
  covered by automated tests.

## Safe execution order

1. Run a bounded scan. No database variables are required.

```powershell
$env:MISSION_IMAGES_MODE='scan'
$env:MISSION_IMAGES_CSV='C:\Users\jasme\Downloads\thecollective-prod_inventory.csv'
$env:MISSION_IMAGES_MAX_ROWS='100000'
node tools/mission-images/index.js
```

2. Review the summary and `orphaned_images.log`.
3. Apply `sql/01_setup.sql` in Supabase.
4. Run `sql/02_watch_image_lineage_index.sql` separately during low traffic.
5. Apply `sql/03_link_and_promote_functions.sql`.
6. Stage the complete CSV with temporary service-role credentials.

```powershell
$env:MISSION_IMAGES_MODE='stage'
$env:MISSION_IMAGES_MAX_ROWS='0'
node tools/mission-images/index.js
```

7. Compare staged object counts, namespace counts, and extraction failures with
   the CSV before linking.
8. Run `link` first with `MISSION_IMAGES_MAX_ROWS=1000`; manually inspect random
   matched records and URLs. Then continue bounded batches.
9. Run `promote` first with 100 records, validate the Trading Floor, then finish.

## Modes

- `scan`: stream and classify; no database writes. This is the default.
- `stage`: idempotently upsert bucket metadata into `media_object_inventory`.
- `link`: call the server-side deterministic linker in bounded batches.
- `promote`: merge verified linked image URLs into `watch_records`.

Checkpoints are written only after successful batches. Rerunning with
`MISSION_IMAGES_RESUME=true` skips already processed CSV rows. Upserts use the
unique `(bucket, object_key)` key, so replaying a batch cannot duplicate media.

## Production guardrails

- Never place Spaces or Supabase secrets in this repository.
- Rotate the Spaces credentials previously shared in chat before this job.
- Use a temporary service-role key and revoke it afterward.
- Do not promote documents, videos, chat attachments, jewelry, or certificates
  into `watch_records`; each namespace needs its own validated relationship.
- Keep the inventory and mapping table after promotion as the audit trail.
