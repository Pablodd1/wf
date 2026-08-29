# Owner Business Policy: Maximum Valid Display

This document is the authoritative customer-publication contract for Trading
Floor and Price Research. It does not change immutable raw evidence.

## Trading Floor

- Publish every evidence-backed individual watch even when optional fields are
  absent.
- Explicit raw WTS or WTB wins.
- An approved individual watch with no explicit intent is classified as
  `INFERRED_WTS_PRICE_PRESENT` only when one valid price-shaped amount exists,
  or `INFERRED_WTB_PRICE_ABSENT` when none exists.
- Watch evidence that cannot safely be classified as an individual WTS or WTB
  is `OTHER`/`UNCLASSIFIED` and sorts after WTS and WTB.
- Multi-watch, accessory, discussion, conflicting, or malformed evidence is
  never forced into WTS or WTB.

## Price display and analytics

- Explicit USD/USDT is verified USD.
- Named foreign currency requires a dated FX rate and preserves original
  amount, currency, rate, source, and date.
- One unambiguous price-shaped amount without currency may be displayed and
  tracked as `OWNER_ASSUMED_USD`. It is not silently relabeled verified USD.
- References, years, dimensions, weights, quantities, serials, model numbers,
  and competing amounts never become prices.
- Every priced WTS is tracked in Price Research. Only independently qualified
  observations enter averages, graphs, dial analytics, trends, or forecasts.
  All other observations remain visible with an exact exclusion reason.

## Images, unbundling, and dealers

- A valid child listing is publishable without an image.
- An image requires immutable exact-child lineage. Parent, adjacent-child,
  catalog, reference, and stock images are never inherited.
- Verified children take precedence over a compact MULTI parent. A retained
  MULTI parent has no fabricated singular identity, price, image, condition,
  or Price Research observation.
- Dealer enrichment requires an exact verified canonical identity. Public
  profile, source-backed feedback, group count, and explicitly published
  business channels may then be shown. Ratings are never invented.

## Reconciliation and UI freeze

- Missing optional fields do not remove a legitimate watch.
- Every withheld record receives a machine-readable reason and must reconcile
  in the final report.
- Card dimensions, frames, grid, navigation, typography, spacing, colors,
  filter placement, and responsive layout are frozen. Only API integration,
  binding, filtering, pagination, evidence, analytics, and missing-field
  behavior may change under this policy.
