# Global six-brand completion

This directory is the aggregate, customer-safe output for the shared WatchFacts
evidence contract covering Rolex, Patek Philippe, Tudor, Zenith, Cartier, and
TAG Heuer.

- `completion-summary.json` records cross-brand gates and checksums.
- `ledgers/*.json` records exact canonical model/reference coverage per brand.
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
