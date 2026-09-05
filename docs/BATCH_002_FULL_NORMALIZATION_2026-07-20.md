# Batch 002 full normalization report

Date: 2026-07-20

Input: `unbundle_1_listings_batch_002.csv`

Parents: `unbundle_1_raw_messages_batch_002.csv`
Staging batch: `f94506b0-17a9-4656-9b51-9e81ed052ab8`

## Result

The complete 571,031-row child export was streamed, normalized, classified, independently validated, and placed into explicit review buckets. The run made no writes to `watch_records`.

| Disposition | Rows | Meaning |
| --- | ---: | --- |
| Ready for human review | 37,344 | Exact lineage, usable intent and price rules, catalog confirmed |
| Deterministic correction review | 20,677 | Exact evidence exists, but a reviewer must accept the proposed correction |
| Held for catalog | 285,045 | Missing, partial, conflicting, or dial-incompatible catalog evidence |
| Held for price/currency | 226,275 | WTS price or original currency is not explicit enough to publish |
| Held as multi-watch stock list | 1,685 | More than one watch remains in the child line |
| Held as non-watch/accessory | 4 | Definite accessory/non-watch evidence |
| Held for lineage/intent | 1 | Parent/child context is unresolved |

These buckets sum to 571,031. No row was marked production-approved.

## Staging rollout

- 58,021 rows from the first two review cohorts were written to `watch_staging` only.
- Every staged row has `verdict = PENDING` and `confidence = 0`.
- Read-back count for the batch is exactly 58,021.
- A public Trading Floor lookup for a staged child returned HTTP 404.
- `watch_records`, Trading Floor, and Price Research were not changed by this staging operation.
- Images remain empty until source-message lineage is proven.

## Validation

The independent artifact validator read all 571,031 output rows and reported:

- 0 duplicate child IDs
- 0 missing child IDs
- 0 invalid buckets
- 0 lineage failures outside the lineage hold
- 0 production-approved rows
- 0 review-ready WTS rows missing price
- 0 review-ready WTS rows missing currency
- 0 review-ready rows without catalog confirmation

## Reference cleanup rules

The brand examples supplied on 2026-07-20 are encoded as evidence gates:

- A single exact reference in the raw child line may replace a price, brand, model, date, condition, or item ID captured as the reference.
- Brand-specific formatting is normalized only when the raw reference is exact, including Patek, Rolex, Richard Mille, Panerai, Cartier, Omega, Tudor, JLC, IWC, Piaget, Longines, and Bell & Ross examples.
- Multiple references in one line produce `MULTI_WATCH_STOCK_LIST`; the first reference is not guessed.
- Straps, bracelets, boxes, links, and non-watch Hermes objects are held outside watch publication.
- Cross-brand references produce `WRONG_BRAND_SUSPECT` and remain held.
- Unknown or brand/model-only values remain manual review; the catalog is not used to invent a reference.

## Currency behavior

- Explicit line currency wins.
- A preserved parent section header such as `HKD` is inherited by its exact child line.
- Bare `$` without line, section, or other preserved evidence remains ambiguous.
- Raw, exported, parsed, and USD-converted values remain separate for audit.

## Source and dealer lineage

All 50,000 parent source IDs were found in production. Original database timestamps exist for 49,943 parents and 58,015 staged children. The source rows contain no seller name, phone, dealer ID, region, listing date, or flag metadata for this cohort. Dealer/contact values therefore remain null; no identity was inferred from message text.

## Remaining release gates

1. Review the 20,677 deterministic correction rows, prioritizing reference and dial conflicts.
2. Enrich/curate the catalog for the 285,045 catalog-held rows.
3. Remediate the 226,275 price/currency-held rows using preserved parent context and human evidence; never default ambiguous `$` to USD.
4. Split the 1,685 remaining multi-watch lines before duplicate suppression.
5. Recover dealer identity from the original source database or a verified directory join.
6. Promote only individually approved rows; then revalidate Trading Floor and Price Research counts, five-point comparable sets, and outlier exclusions.
