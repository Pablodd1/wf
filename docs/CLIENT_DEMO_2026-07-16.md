# WatchFacts Client Demo - 2026-07-16

## Production entry points

- Home: `https://watchfacts-poc.vercel.app/`
- Trading Floor: `https://watchfacts-poc.vercel.app/#/trading`
- Price Research: `https://watchfacts-poc.vercel.app/#/price-research`

Use **Skip and enter beta** for the meeting. This grants only temporary customer
view access; it does not grant reviewer or administrator permissions.

## Recommended Price Research examples

| Brand | Reference | Expected demonstration |
| --- | --- | --- |
| Rolex | `116500LN` | Large sample, dial chart, monthly history, IQR fences, and auditable exclusions |
| Rolex | `116233` | Multiple catalog-valid dial cohorts and long monthly history |
| Patek Philippe | `5160/500R-001` | Small but qualified cohort; provisional analytics |
| Audemars Piguet | `26420CE.OO.A127CR.01` | Qualified reference with chart and outlier evidence |
| Richard Mille | `RM004` | Qualified reference with strong historical sample |
| Omega | `123.10.28.60.06.001` | Correct Omega resolution with analytics withheld because fewer than five qualified comparables exist |

## Meeting narrative

1. Trading Floor searches the server-side customer-visible inventory in pages of 50.
2. RECYCLE records and preview fixtures are excluded from customer results.
3. Review/incomplete records remain visible as listing evidence but cannot present as market-ready inventory.
4. Price Research first requires catalog-consistent brand, model, reference, dial, and price evidence.
5. A comparable cohort needs at least five qualified WTS observations.
6. Market statistics use a plausibility floor followed by standard 1.5x IQR fences.
7. Excluded rows remain visible for audit and human review; they are never silently deleted.
8. Dial cohorts have a visual price comparison and each selected cohort drives its own monthly graph.

## Do not promise during beta

- Do not describe asking-price activity as confirmed sales.
- Do not claim every historical record is fully normalized or catalog-confirmed.
- Do not describe shadow normalization proposals as promoted production truth.
- Do not promise image-to-listing matching until Mission Images is validated and merged.

## Feedback to collect

- Can a dealer find a known reference without assistance?
- Are low-sample and excluded-data explanations understandable?
- Are dial and condition cohort controls obvious?
- Does the Trading Floor distinguish market-ready inventory from evidence needing review?
- Which filters and listing details are essential for the next beta revision?
