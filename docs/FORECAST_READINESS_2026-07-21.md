# Price Research forecast readiness - 2026-07-21

## Decision

Keep `ENABLE_PRICE_FORECASTS=false`. The production read-only audit found no
cohort that satisfies the existing release gates. Historical charts, medians,
IQR fences, excluded outliers, supply counts, and directional evidence may
remain visible. Numeric three-month projections must remain withheld.

## Live audit result

| Metric | Result |
| --- | ---: |
| Owner-reviewed cohorts | 5 |
| Stratified reference cohorts | 50 |
| Successful Price Research responses | 53 |
| Forecast-ready cohorts | 0 |
| Public release candidates | 0 |

Withholding evidence across the 53 successful responses:

- 53 did not meet the minimum monthly-history gate;
- 53 did not meet verified-dealer diversity;
- 52 did not meet the recent-evidence gate;
- 46 did not meet the minimum clean-offer gate;
- 2 Bvlgari references had no usable New or Used dial cohort.

## John reference cohorts

| Brand | Reference | Dial | Condition | Clean offers | Verified dealers | Monthly periods | Result |
| --- | --- | --- | --- | ---: | ---: | ---: | --- |
| Patek Philippe | 5712/1A | Blue | Used | 368 | 0 | 0 | Withheld |
| Patek Philippe | 5712/1R | Black | Used | 1 | 0 | 0 | Withheld |
| Patek Philippe | 3712/1A | Blue | Used | 8 | 0 | 0 | Withheld |
| Rolex | 116500LN | White | Used | 143 | 0 | 1 | Withheld |
| Rolex | 52506 | Blue | New | 152 | 0 | 0 | Withheld |

## Interpretation

The archive contains useful asking-price evidence, but a large row count is not
the same as a forecastable time series. A public projection needs source-backed
posting dates, exact reference + dial/configuration + condition grouping,
verified seller diversity, duplicate/repost controls, and enough recent monthly
periods to backtest the trend against a naive baseline.

WTB budgets, unresolved bundles, ambiguous currencies, reference-shaped prices,
catalog conflicts, and statistical outliers remain outside the training cohort.
No missing period, seller, or future value may be inferred.

## Next release gate

1. Stage reviewed source-date and seller lineage privately.
2. Materialize exact monthly comparable cohorts without changing raw records.
3. Rerun these five references and the same stratified 50-reference sample.
4. Have John review the report and historical charts.
5. Enable projections only for individually passing cohorts; all others retain
   `Insufficient evidence` or directional-trend states.

Local row-level output is retained only under ignored `audit-output/`.
