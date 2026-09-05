# Image Lineage Batch 2 - 2026-07-19

## Result

- 55 additional listing images linked atomically.
- 155 total rows now recorded in the linked-media manifest.
- 0 ambiguous source filenames detected.
- 0 failed or unchanged writes in this batch.
- The customer API returns the newly linked records with `has_images=true` and the expected DigitalOcean Spaces URL.

The requested batch size was 100. The job deliberately stopped at 55 because no more candidates passed every safety gate. It did not weaken matching rules to reach a quota.

## Required evidence

Every linked image passed all of these checks:

1. The inventory filename matched an image field on one structured raw-source record.
2. The source record mapped to the imported listing's deterministic source ID.
3. The normalized listing brand exactly matched the structured source brand.
4. The normalized listing reference exactly matched the structured source reference or normalized reference.
5. The target listing had no existing image assignment.
6. The listing was not `MULTI`, `OTHER`, or `RECYCLE`.
7. The DigitalOcean object URL was reachable.
8. Duplicate filenames mapped to different source records would have been rejected.

## Visual sample

Four linked images were downloaded and inspected:

- Rolex `116688`: warranty card visibly identifies model 116688 and the watch is consistent with the Yacht-Master II family.
- Rolex `178274`: warranty card visibly identifies model 178274.
- Rolex `178240`: warranty card visibly identifies model 178240.
- Rolex `136660`: image is consistent with the expected Deepsea configuration.

This is a provenance and listing-lineage check. It does not certify a watch as authentic or replace specialist authentication.

## Production verification

The customer endpoint returned the newly linked `116688` record when queried with image-only filtering:

```text
/api/ingest?q=116688&images=true&pageSize=100
```

Verified record:

```text
mysql_auction_watches_0d7d6cb1-dc92-4338-b018-d2c418cb28d9
```

Its API response included `has_images=true` and the expected public thumbnail URL.

## Next batch condition

Expand only when additional candidates meet the same source identity gates. Filename similarity, catalog resemblance, or AI visual similarity alone must not attach media to a listing. Vision comparison may add a review signal after source lineage is proven, but it must not override contradictory source data.
