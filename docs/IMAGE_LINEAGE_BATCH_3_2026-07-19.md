# Image Lineage Batch 3 - 2026-07-19

## Result

- 100 additional listing images linked atomically.
- 255 total `linked` rows now recorded in `media_manifest`.
- 0 ambiguous source filenames detected.
- 0 unchanged or failed writes in this batch.
- 1,200 lineage candidates were evaluated after streaming 1,825,125 inventory rows.

## Safety gates

The batch retained the Batch 2 requirements: deterministic source-record mapping, exact structured brand and reference agreement, no existing listing media, valid watch reference, non-bundle listing type, reachable DigitalOcean object URL, and rejection of filenames shared by different source records.

The only code change increased the configurable candidate scan window. It did not relax any identity or publication rule.

## Visual review

Ten dry-run images were inspected before applying the batch:

- Rolex `124300`
- Rolex `228235`
- Rolex `126710BLRO`
- Rolex `228236`
- Rolex `126334`
- Rolex `52508` (two source-distinct listings)
- Rolex `126201`
- Rolex `278273`
- Rolex `126234`

The visible watch families and configurations were consistent with the structured references. The `52508` card visible in one sample explicitly showed model `52508`. This is a source-lineage and configuration review, not physical-authenticity certification.

## Independent production verification

After the atomic RPC completed, an exact service-role count returned 255 manifest rows with `migration_status=linked`.

The public customer API returned image-backed records for:

```text
124300: 4
126710BLRO: 3
52508: 3
```

All returned records in those image-only queries had `has_images=true`.

## Next batch

The scanned segment was Rolex-heavy. A later batch should scan farther into the inventory and report brand distribution before applying, while retaining every current lineage gate.
