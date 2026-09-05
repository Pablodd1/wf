# Five-brand raw-only publication foundation

This foundation covers IWC, Hublot, Seiko, Bell & Ross, and Tissot. It does not read, match, or enrich from catalog data.

## Immutable source contract

Each customer candidate must retain the original raw message through:

- raw parent message ID;
- raw message-version ID;
- source record ID;
- exact child occurrence key and exact child-text hash;
- source timestamp and source-poster evidence key.

Only a valid unique child in `CURRENT_ACTIVE` or `CURRENT_LATEST_STATE` can become a current listing. Exact reposts, malformed fragments, ambiguous child boundaries, and unsplittable parents are parked and never enter Trading Floor or Price Research.

## Customer card mapping

| Card area | Evidence requirement | Safe state |
| --- | --- | --- |
| Image | Exact single-watch seller/listing image | `NO IMAGE` |
| Category and intent | Exact child WTS/WTB evidence | Park for review |
| Title | Raw posted brand, model when explicit, and observed reference | Brand + observed reference; `Model requires review` |
| Raw message | Parent/version lineage | `Original message requires review` |
| Price | Explicit USD/USDT or dated verified FX | `Price requires review` |
| Price Rating | Two or more unique qualified WTS offers for the exact observed reference | `Open for rating` |
| Location and date | Raw source evidence | `Location not provided` / `Posting date requires review` |
| Poster/dealer and rating | Raw source poster or exact approved dealer evidence | `Posting identity requires review` / `Not rated` |
| Availability | Current state from source-backed offer family | `CHECK AVAILABILITY` for latest observed |

## Prepared data path

`npm run audit:five-brand-raw-only` performs a read-only source census and writes private source artifacts, one immutable observation shard per target brand, a summary, and a manifest hash. It does not make production writes.

Before a census, an operator can produce a dated ECB evidence file with `tools/audit/fetch-ecb-card-fx-rates.cjs` and pass its path as `FIVE_BRAND_RAW_ONLY_FX_FILE`. The batch accepts a foreign source amount only when its exact source date has an ECB rate (maximum seven-day official-market lookback). It always retains the original amount and currency. The append-only price-evidence sidecar retains the ECB provider, effective/applicable dates, rate, source URL, and checksum for every verified foreign USD conversion.

`npm run load:five-brand-raw-only` is an explicit operator-only loader for the resulting append-only shadow tables. It is fail-closed, requires canonical QNSA plus an exact confirmation, and does not change raw/source data or customer selectors.

The loader stores direct USD/USDT as verified customer USD. Foreign amounts remain original source evidence until a dated verified-FX sidecar is present; they cannot affect Price Research or ratings first.

## Release gate

Do not publish a target brand until its census is complete and the loaded shadow reconciliation proves unique current listing keys, unique offer families, non-null immutable lineage, valid availability states, source-backed cards, repost-safe Price Research, and customer/API canaries. A customer source switch remains a separate explicit release action.
