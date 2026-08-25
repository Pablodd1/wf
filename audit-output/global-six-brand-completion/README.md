# Global six-brand completion

This directory is the aggregate, customer-safe output for the shared WatchFacts
evidence contract covering Rolex, Patek Philippe, Tudor, Zenith, Cartier, and
TAG Heuer.

- `completion-summary.json` records cross-brand gates and checksums.
- `ledgers/*.json` records exact canonical model/reference coverage per brand.
- `phase7b-rolex-patek-authoritative/` contains the sanitized, completed
  canonical-QNSA Phase 7B audit and per-reference report artifact from GitHub
  Actions run `32839980179`. It contains aggregate/reference evidence only and
  no raw customer-message payloads.
- live Price Research and Trading Floor checkpoints are intentionally ignored;
  they are resumable local audit inputs and are not repository evidence.

Generate the aggregate ledgers with:

```text
npm run report:global-six-brand-completion
```

The generator fails closed: an incomplete source snapshot produces `NOT_READY`
and preserves unknown Price Research values as `null`. It never reads or emits
raw messages and never writes production data.

Reference metrics are intentionally separate: catalog count measures the
approved catalog, catalog nonconflicting count removes catalog identity
conflicts, and customer-safe canonical count requires an exact customer-eligible
production observation after publication/reference safety gates. When a brand's
production census is incomplete, the authoritative customer-safe count is
`null` and only the bounded observed count is reported.

For Rolex and Patek Philippe, the completed Phase 7B publication census now
supplies the authoritative customer-safe count. This is the number of canonical
references with at least one published single-watch WTS/WTB observation under
`QNSA_GENERAL_MARKET_FEED_V1_SINGLE_WATCH_WTS_WTB`. The Phase 7B native
"represented safe references" metric is retained separately because it means
references represented in legacy Price Research, not total publication
coverage. Neither value is inferred from catalog size.

Phase 7B remains private and `CANARY_READY`; its evidence in these ledgers does
not switch a customer source, deploy a cohort, or authorize a production change.
