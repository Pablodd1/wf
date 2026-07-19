# Price and source-date correction plan

## Customer contract

- A WTS listing is customer-visible only when it has a positive original or
  normalized price. A missing WTS price is a normalization/review condition,
  not an "Ask" offer.
- WTB and NTQ records may omit price because they represent buyer demand. The
  interface labels these as buyer requests, never as sale inventory.
- Price Research uses positive, deterministic USD values only. Missing-price
  rows remain immutable evidence but do not appear as comparables or price
  outliers.
- Customer-facing posting dates use the original source observation in
  `listing_date`. `created_at` is an import timestamp and must not be presented
  as the WhatsApp, Green API, or legacy-database posting date.

## Deterministic recovery order

1. Explicit USD or USDT on the exact reference line/block.
2. Explicit HKD/HDK/HK$ on the exact reference line/block, converted to USD.
3. Structured `price_raw` plus a recognized original currency.
4. Existing positive `price_usd` when no stronger source evidence is present.
5. Otherwise keep the price null and route it outside customer WTS/research.

No value is inferred from a bare number or `$` without currency evidence.

## Performance constraints

- Trading Floor pagination remains server-side and uses the existing indexed
  import ordering while the source date remains a text column.
- Source-date display is corrected immediately. A later migration should add a
  typed `source_observed_at timestamptz` column and a partial descending index
  before changing the default database ordering.
- Query-time normalization is limited to the returned page, never the full
  multi-million-row archive.

## Verification

- Regression tests cover null stored USD with explicit USD/HKD evidence and
  structured price fallback.
- Trading Floor UI must distinguish WTS, WTB/NTQ, MULTI, and OTHER when price is
  absent.
- Price Research monthly charts must omit records without an original source
  date rather than substitute import time.
