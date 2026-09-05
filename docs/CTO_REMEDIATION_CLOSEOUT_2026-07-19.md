# CTO remediation closeout - 2026-07-19

## Completed safely

### Price corrections

- Deployed the final field-scoped `apply_price_review_decision` function through
  the signed-in production SQL editor.
- Applied 89 reviewed price corrections serially.
- Verified ledger state: 94 `APPLIED` total (the earlier five plus 89) and six
  `PENDING` blocked rows.
- No brand, reference, dial, condition, intent, raw message, or source timestamp
  fields were changed by the price function.

### High-volume dial sampling

- Replaced the single newest-first cohort assumption with a bounded supplement
  for catalog dials absent from the first 5,000 rows.
- The supplemental query remains reference-indexed and is capped at 1,000 rows
  per missing dial.
- Production Rolex `116500LN` verification after deployment:
  - 5,485 sampled rows
  - White: 922 included observations
  - Black: 357 included observations
  - the endpoint still reports that the base sample reached its cap

### Blocked dial decisions

Reviewed all 13 blocked rows against preserved source lines:

- Twelve Rolex `116500LN` rows resolve to White. Eleven explicitly say Panda or
  White Panda; one proposed Black row explicitly says White dial.
- One Rolex `52506` row explicitly says Ice Blue and must retain that specific
  source color instead of being degraded to generic Blue.
- These decisions are review outcomes only. They require corrected shadow
  proposals and a fresh catalog confirmation before a dial-only write.

### Bundle children

Catalog-reviewed all 329 staged children from 25 parents:

- 68 are catalog-clean.
- 14 currently meet all promotion fields.
- 315 remain blocked.
- Blocking evidence includes 172 partial catalog matches, 53 catalog misses,
  104 missing prices/currencies, 63 raw/source dial conflicts, 41 currency
  reviews, 36 catalog dial conflicts, 33 dial ambiguities, two implausible
  prices, and two missing dials. Counts overlap where one row has several gates.
- No child was published and no parent was suppressed.

The earlier 145 figure represented structural completeness, not catalog
approval. It must not be used as a publishable count.

### Supabase resource pressure

- Stopped the completed Railway worker by scaling the production service to zero.
- Identified expensive repeated PostgREST reads and one 113-second
  `refresh_all_analytics()` call.
- Refreshed planner statistics with bounded `ANALYZE`, restoring estimates for
  2,645,395 `watch_records`, 2,625,382 shadow rows, and 1,423 staging rows.
- Exact count requests still time out under load. Planned counts succeed and
  currently estimate 2,645,395 total records, 2,319,482 WTS, and 310,658 WTB.
- Large write batches remain paused.

### Migration deployment

- Added a protected GitHub workflow for production Supabase migrations.
- The workflow is manual until its three secrets are configured and the first
  migration-ledger reconciliation succeeds.
- Automatic execution on `main` is gated by
  `ENABLE_PRODUCTION_MIGRATIONS=true`.

## Critical-reference verification

| Reference | Sampled | Included | Outliers | Dial cohorts | Clean range |
| --- | ---: | ---: | ---: | --- | --- |
| Patek 5712/1A | 5,000 | 531 | 123 | Blue 531 | $68,077-$192,308 |
| Patek 5712/1R | 5,000 | 10 | 4 | Black 10 | $229,487-$262,000 |
| Patek 3712/1A | 1,291 | 8 | 1 | Blue 8 | $106,650-$145,897 |
| Rolex 116500LN | 5,485 | 922 selected White | 225 | White 922, Black 357 | $19,800-$34,999 |
| Rolex 52506 | 1,657 | 222 | 33 | Blue 222 | $34,000-$62,500 |

## Remaining release gates

1. Stage the 13 corrected dial proposals and re-run catalog confirmation.
2. Resolve bundle child evidence; do not promote the 14 currently eligible rows
   until their complete 25-parent cohorts reconcile.
3. Configure GitHub production migration secrets and reconcile the remote
   migration ledger before enabling automatic deployment.
4. Observe Supabase usage after `ANALYZE`; schedule heavy analytics refreshes
   away from customer traffic.
5. Run a formal project review covering architecture, security, data contracts,
   migrations, observability, test gaps, and production capacity.

