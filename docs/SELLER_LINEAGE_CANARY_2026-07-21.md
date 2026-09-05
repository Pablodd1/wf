# Seller Lineage Canary Report

**Date:** 2026-07-21  
**Mode:** read-only local scan and dry-run staging  
**Production writes:** 0

## Schema status

The private staging schema is now deployed and verified through the controlled
Supabase workflow. The successful run is
[29873517110](https://github.com/Pablodd1/wf/actions/runs/29873517110).
This changed schema only. No seller rows were inserted and no public listing,
dealer, contact, approval, duplicate, or image state was changed.

## Scope

The seller export was reconciled against the 16 preserved unbundled parent raw-message files. The scan used exact raw-message SHA-1 evidence, phone identity, and source timestamp evidence. It did not infer dealers, publish contact information, attach images, or change listings.

## Results

| Measure | Count |
| --- | ---: |
| Parent raw messages scanned | 761,489 |
| Seller rows scanned | 1,293,376 |
| Exact match-ready parent rows | 16,094 |
| Review-required parent rows | 288 |
| Unmatched parents | 745,107 |
| Match-ready rows with a front image | 16,381 |
| Match-ready rows missing observed seller name | 449 |
| Canary rows selected | 100 |
| Canary rows dry-run staged | 100 |
| Canary rows privately persisted | 100 |
| Production writes | 0 |

## Reasons requiring caution

| Reason | Count |
| --- | ---: |
| No exact seller lineage | 318,374 |
| Seller name missing | 449 |
| Seller intent mismatch | 288 |
| Timestamp mismatch after title-hash match | 426,733 |
| Front image missing | 1 |

The high unmatched count is not evidence that the listings are invalid. It means the seller export does not provide enough exact identity/date evidence to attach a seller safely. Those parents remain unmatched and must not receive inferred dealer identity or public contact information.

## Private canary reconciliation

The 100-row canary was staged into `seller_listing_lineage_staging` through
Railway using the service-role key. The private audit compared the persisted
rows with the exact manifest and found:

| Check | Result |
| --- | ---: |
| Manifest rows | 100 |
| Persisted rows returned | 100 |
| Matched | 100 |
| Unmatched | 0 |
| Conflicting | 0 |
| Orphaned | 0 |
| Seller/name/phone/intent/date/linkage mismatches | 0 |
| Title-hash or image-evidence mismatches | 0 |
| Dealer assignments | 0 |
| Public contacts or consent grants | 0 |

Postgres returned timestamps in an equivalent UTC representation (`+00:00`)
instead of the manifest's millisecond `Z` form. The auditor compares the
instant and preserves the original timestamp string, so this is not a data
mismatch.

The machine-readable report is written to the ignored local path
`audit-output/dealer-lineage/seller-lineage/canary-100-reconciliation.json`.

## Safe next step

1. Run the read-only production migration-ledger check and reconcile any
   already-applied migration timestamps before enabling automatic migration
   pushes.
2. Owner-review the completed private canary using the reconciled raw message,
   seller phone,
   seller name, source date, intent, and image filename for every canary row.
3. Stage the reviewed 5,350 exact parent matches only after explicit approval.
4. Stage child lineage only after the parent canary passes and the owner
   approves the evidence report.
5. Keep dealer assignment, public contact, duplicate suppression, and image
   publication disabled until identity and consent gates pass.

The generated local artifacts are under `audit-output/dealer-lineage/seller-lineage/`; they are intentionally excluded from Git because they contain private contact evidence.
