# CTO Reviewed Promotions Status - 2026-07-19

## Completed

- Stopped the completed Railway normalization worker by scaling `wf` to zero replicas.
- Rebased, tested, merged, and deployed the Admin dial-review workflow.
- Reviewed 350 current Patek/Rolex dial proposals.
- Applied 337 field-scoped dial corrections with before/after audit rows:
  - Patek Philippe 3712/1A: 12 Blue
  - Patek Philippe 5712/1A: 1 Blue
  - Patek Philippe 5712/1A-001: 313 Blue
  - Rolex 116500LN: 10 Black
  - Rolex 52506: 1 Blue
- Kept 13 dial rows blocked: 11 Panda/catalog-conflict rows and 2 dial-ambiguous rows.
- Staged the bounded 100-row price canary without overwriting source evidence.
- Applied 5 price-only corrections before pausing the batch at an evidence-guard defect.
- Revalidated the 25-parent bundle canary and owner-critical Price Research references.

## Price canary decision

The 100 proposals contain 78 explicit HKD reference-line corrections and 22
explicit USD/USDT reference-line corrections. Five rows are applied with exact
before/after audit records. Of the remaining 95 rows, the application reviewer
approved 89 and blocked 6 because the normalized source reference could not be
proven in the preserved raw message. The 89 approved rows remain pending until
the corrected price-only database function is deployed through a stable SQL
execution path. No blocked row will be applied.

## Critical-reference verification

| Reference | Included | Raw comparable | Statistical outliers | Clean average | Clean range |
| --- | ---: | ---: | ---: | ---: | ---: |
| Patek 5712/1A | 531 | 654 | 123 | $120,451 | $68,077-$192,308 |
| Patek 5712/1R | 10 | 14 | 4 | $244,184 | $229,487-$262,000 |
| Patek 3712/1A | 8 | 9 | 1 | $130,447 | $106,650-$145,897 |
| Rolex 116500LN | 922 | 1,147 | 225 | $27,045 | $19,800-$34,999 |
| Rolex 52506 | 222 | 255 | 33 | $45,304 | $34,000-$62,500 |

All five endpoints return successfully and remain analytics-ready. Price
Research continues to expose excluded evidence and outlier reasons.

## New defect found

Rolex 116500LN has at least 1,029 Black and 6,721 White source rows, but the
newest-5,000 Price Research sample currently contains only White observations.
The API therefore hides the valid Black dial cohort. Sampling must become
dial-stratified (or keyset-complete) before claiming complete per-dial coverage.

## Bundle canary decision

The 25 immutable parents produced 329 deterministic staging children.

- 329/329 preserve exact raw-line lineage.
- 329/329 remain `PENDING` at confidence 0.
- 145 pass structural checks but still require catalog/human approval.
- 184 remain review-required:
  - 104 price required
  - 33 dial ambiguous
  - 63 raw/source dial conflicts
  - 41 source-currency review required
  - 2 price plausibility review
  - 2 dial required
- No child was promoted and no parent was suppressed.

## Trading Floor verification

- All customer-visible: 2,389,550
- WTS: 2,098,423
- WTB/NTQ: 277,347

Server-side pagination remains active; the first visible cards are not the
database total.

## Remaining release work

1. Deploy the corrected price-only function through a stable SQL path, apply
   the 89 approved rows, and leave the 6 blocked rows pending.
2. Fix Price Research sampling so high-volume references preserve every valid
   dial cohort, starting with Rolex 116500LN.
3. Review the 13 blocked Patek/Rolex dial rows; canonicalize Panda to White only
   where raw/catalog evidence supports it.
4. Catalog/human-review the 145 structurally clean bundle children, then review
   the 184 flagged children. Promote children before suppressing parents or
   evaluating duplicates.
5. Repair production migration automation. Main-branch SQL migrations were not
   automatically present in production and required manual application.
6. Address Supabase resource saturation before resuming large write batches.
