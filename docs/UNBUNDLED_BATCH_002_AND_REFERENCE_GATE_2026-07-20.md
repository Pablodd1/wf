# Unbundled Batch 002 and Reference Gate

## Production decision

Batch 002 is **not approved for automatic publication**. Its lineage is complete,
but identity, dial, intent, and catalog checks still require row-level review.

## Full streamed audit

- Child rows: 571,031
- Parent rows: 50,000
- Mapping rows: 571,031
- Parent join: 100%
- Exact raw-line lineage: 100%
- Mapping join: 100%
- Source-date agreement: 100% where both dates exist
- Missing source dates: 698
- Parent/child intent conflicts: 23,361

The intake audit examined every row for structural integrity and the first 1,000
rows for parser/catalog conflicts. That sample found 169 raw-source dial conflicts,
35 intent conflicts, 176 original-price conflicts, and 695 catalog identities that
were not confirmed by the current local catalog.

## Corrected 1,000-row canary

The bounded canary is stored under `audit-output/unbundled/batch-002-canary`
and is local-only. After the reference-quality gate was added it contained:

- 175 ready for human review
- 14 requiring human correction
- 811 catalog-blocked

The canary must be regenerated after every parser/reference-rule change. A row is
never production-approved by this script.

## Reference rules adopted

1. A reference column contains only the exact watch reference.
2. Prices, dates, condition text, stock IDs, brand-only labels, and model-only
   labels are not references.
3. A deterministic replacement is proposed only when the exact reference appears
   in that child row's raw line.
4. Multiple references in one child line remain `MULTI_WATCH_STOCK_LIST`.
5. Straps, bracelets, boxes, and links remain `ACCESSORY_NOT_WATCH`.
6. Bags and other non-watch objects remain `NON_WATCH_OR_WRONG_CATEGORY`.
7. A reference whose prefix proves a different brand remains
   `WRONG_BRAND_SUSPECT`.
8. When the raw line does not prove a replacement, the result is
   `NEEDS_MANUAL_REVIEW`; the system does not guess.

Representative deterministic examples include `20300USD -> 5296G` only when the
same raw line states `5296G`, `Ref-WSSA0030 -> WSSA0030`, and
`HKD111000 -> 310.32.42.50.02.001` only when that full Omega reference is present.

## Release sequence

`raw parent -> exact child lineage -> reference gate -> catalog confirmation ->`
`dial/intent/price review -> human approval -> individual WTS/WTB publication`

The unsplit parent remains excluded from Trading Floor and Price Research before,
during, and after child review. It may be suppressed only after every approved
child has been reconciled.
