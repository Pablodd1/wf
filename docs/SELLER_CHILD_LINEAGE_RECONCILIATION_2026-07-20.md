# Seller child-lineage reconciliation

**Date:** July 20, 2026  
**Scope:** batch 002 staged unbundled children  
**Execution:** local private artifact; zero production writes

## Decision

Exact seller evidence may be inherited from a parent raw message into a private
child-lineage manifest. It may not automatically verify a public dealer, expose
a phone number, publish an image, approve a child, suppress a parent, or delete
a repost.

The reconciliation tool is:

`tools/dealer-lineage/reconcile-child-lineage.cjs`

Run it with:

```powershell
$env:CHILD_LINEAGE_OUTPUT_DIR='audit-output/dealer-lineage/batch-002-child-reconciliation-full'
npm run reconcile:seller-child-lineage
```

The output directory is ignored by Git because it contains private observed
seller evidence and production record identifiers.

The run also creates two reviewer-friendly CSV files with blank decision and
notes columns. They contain only the seller pseudonym, listing fingerprints,
source dates, and private record IDs; raw phone numbers are never exported:

- `seller-aware-repost-review.csv`
- `seller-configuration-history-review.csv`

## Full-scan evidence

| Metric | Result |
| --- | ---: |
| Staged children read | 54,170 |
| Exact parent lineage rows loaded | 5,350 |
| Unsafe lineage rows skipped | 0 |
| Staged parents with exact lineage | 1,217 |
| Children with private seller/date lineage | 2,781 |
| Child coverage | 5.13% |
| WTS children matched | 1,495 |
| WTB children matched | 1,286 |
| Unresolved child intent | 0 |
| Child/parent intent conflicts | 0 |
| Matched children missing observed name | 39 |
| Review-ready children matched | 1,930 |
| Human-correction children matched | 851 |
| Parent image evidence rows | 2,781 |
| Production writes | 0 |
| Public contact changes | 0 |

The exact source-post range is June 26, 2025 through July 3, 2026. Of the
matched children, 1,284 are dated in 2025 and 1,497 in 2026. The source time is
stored as an absolute UTC timestamp while the original timestamp string remains
preserved for audit.

## Duplicate and repost evidence

The exact seller + intent + brand + reference + dial + condition + normalized
price signature produced:

- 345 seller-aware repost candidate clusters;
- 899 rows in those clusters;
- every cluster spans more than one source timestamp;
- the largest exact-signature cluster contains 12 rows.

A broader seller + intent + brand + reference + dial signature produced:

- 345 configuration-history clusters;
- 1,063 rows in those clusters;
- every cluster spans more than one source timestamp;
- the largest configuration cluster contains 19 rows.

These are not deletion decisions. A dealer may repost unsold inventory, revise
price/condition text, or hold several identical watches. Reviewers must decide
whether a cluster represents one listing history, multiple quantity, or distinct
inventory. Price Research may later collapse confirmed repost history to one
independent observation per policy while preserving every raw observation.

## Privacy and publication gates

Every private child-lineage row explicitly records:

- `dealer_id = null`;
- observed identity status, not verified dealer status;
- public contact ineligible;
- parent image as evidence only;
- child image publication ineligible;
- approval unchanged;
- publication unchanged;
- duplicate suppression not authorized.

All 2,781 matched child intents agree with the exact source parent intent. If a
future child differs, identity may remain observed but that child is excluded
from dealer WTS/WTB activity counts until reviewed.

## Why 4,133 exact-lineage parents have no staged child

The seller manifest covers all 50,000 imported parents, while `watch-staging`
contains only the 54,170 children that reached the current review staging gate.
Only 15,629 parent IDs appear in that staged subset. Therefore 4,133 of the
5,350 exact parent matches do not currently intersect `watch-staging`; this is
expected coverage loss from catalog/price/reference holds, not a failed join.

## Next controlled steps

1. Review the 345 strong repost clusters, beginning with the highest counts.
2. Keep the 851 human-correction children blocked.
3. Prepare a Preview-only private child-lineage staging table after review of
   its RLS and service-role boundary.
4. Link observed phone identities to public dealers only through an approved,
   immutable dealer-identity mapping and contact consent.
5. Use the source-post timestamp for display/order only after the child staging
   record is reviewed; preserve the original parent timestamp alongside it.
6. Do not attach the 2,781 parent image filenames to individual children until
   message-to-child image lineage is proven.

The additive migration `20260721120000_seller_child_lineage_staging.sql` now
defines that private staging boundary. It denies `anon` and `authenticated`,
requires the exact parent lineage foreign key, and cannot publish contact or
images. `npm run stage:seller-child-lineage` is dry-run by default; a write
requires `APPLY_CHILD_LINEAGE_STAGING=true` plus a service-role credential.

## Verification

- 11 focused seller-child-lineage tests pass.
- ESLint passes for the new tool and tests.
- The 1,000-child canary produced 80 matched children with no publication,
  dealer, contact, or image eligibility changes.
- The full scan completed with no unsafe input rows and no production writes.
