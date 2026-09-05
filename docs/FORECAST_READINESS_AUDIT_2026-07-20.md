# Three-month forecast readiness audit

**Date:** July 20, 2026

**Source:** live `watchfacts-poc.vercel.app` read APIs

**Writes:** none

## CTO decision

Keep public numeric forecasts disabled. The current data supports descriptive
Price Research for qualified cohorts, but it does not yet support defensible
three-month projections.

The audited release rule remains exact reference + dial + condition. WTB
budgets, unresolved bundles, reposts, required-field exclusions, implausible
prices, and statistical outliers are excluded before a forecast candidate is
evaluated.

## Live evidence

The audit included the five recurring John references plus 50 references
stratified across 11 brands and listing-volume levels.

| Measure | Result |
| --- | ---: |
| Exact cohorts requested | 55 |
| Stratified references | 50 |
| John references | 5 |
| Successful cohort responses | 47 |
| Forecast-ready cohorts | 0 |
| Release candidates | 0 |
| Missing 12 monthly periods | 47 |
| Missing five verified dealers | 47 |
| Missing recent dated evidence | 47 |
| Also below 30 clean offers | 44 |
| Supabase statement timeouts under bounded concurrent load | 5 |
| Client request timeouts | 1 |
| No exact New/Used cohort | 2 |

No expected future price, lower bound, or upper bound was published by the
audit. `ENABLE_PRICE_FORECASTS` must remain unset/false.

## John-reference check

Each John cohort was also queried sequentially before the stratified load test.
All five returned HTTP 200 and correctly withheld forecasts.

| Cohort | Clean offers | Verified dealers | Monthly periods | Primary blockers |
| --- | ---: | ---: | ---: | --- |
| Patek 5712/1A, Blue, Used | 368 | 0 | 0 | months, dealers, recency |
| Patek 5712/1R, Black, Used | 1 | 0 | 0 | offers, months, dealers, recency |
| Patek 3712/1A, Blue, Used | 8 | 0 | 0 | offers, months, dealers, recency |
| Rolex 116500LN, White, Used | 143 | 0 | 1 | months, dealers, recency |
| Rolex 52506, Blue, New | 152 | 0 | 0 | months, dealers, recency |

The concurrent audit later timed out on three Patek calls even though those
same cohorts passed sequentially. This is evidence of query-load sensitivity,
not evidence that their underlying market cohorts disappeared.

## Performance finding

One Price Research request fans out into several bounded PostgREST reads. Four
concurrent audit workers therefore created substantially more than four active
database statements and exposed statement-timeout pressure. The audit tool now:

- defaults to two concurrent cohort requests;
- caps concurrency at four;
- writes a progress checkpoint after each completed cohort;
- never changes customer data or the forecast release flag.

A production-scale backtest should ultimately read from a dedicated analytics
table, materialized view, or replica instead of repeatedly invoking the
customer-facing endpoint.

## Required path to release

1. Preserve original listing timestamps for eligible observations.
2. Complete verified dealer lineage and seller-aware repost review.
3. Materialize exact comparable cohorts with dated monthly medians.
4. Rerun the five John cohorts and the same 50-reference stratified audit.
5. Require rolling-origin error to beat the naive last-median baseline by at
   least 5% and display the measured error interval.
6. Obtain John approval before setting `ENABLE_PRICE_FORECASTS=true`.

External market research may be added later only from licensed, attributed
sources. It must be shown separately from WatchFacts dealer-chat observations
and must never be blended invisibly into listing prices or historical charts.
