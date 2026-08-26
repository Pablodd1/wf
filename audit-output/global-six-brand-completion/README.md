# Global six-brand completion

This directory is the aggregate, customer-safe output for the shared WatchFacts
evidence contract covering Rolex, Patek Philippe, Tudor, Zenith, Cartier, and
TAG Heuer.

- `completion-summary.json` records cross-brand gates and checksums.
- `catalog-census-reconciliation.json` enumerates every catalog/reference source,
  retains every non-authoritative value in an explicit classification bucket,
  and fixes the catalog source-of-truth semantics used by every output.
- `ledgers/*.json` records exact canonical model/reference coverage per brand.
- `phase7b-rolex-patek-authoritative/` contains the sanitized, completed
  canonical-QNSA Phase 7B audit and per-reference report artifact from GitHub
  Actions run `32839980179`. It contains aggregate/reference evidence only and
  no raw customer-message payloads.
- live Price Research and Trading Floor checkpoints are intentionally ignored;
  they are resumable local audit inputs and are not repository evidence.

Generate the aggregate ledgers with:

```text
npm run audit:global-catalog-census
npm run report:global-six-brand-completion
npm run report:global-six-brand-technical
```

The generator fails closed: an incomplete source snapshot produces `NOT_READY`
and preserves unknown Price Research values as `null`. It never reads or emits
raw messages and never writes production data.

Reference metrics are intentionally separate. `catalog_reference_count` means
distinct exact brand/reference identities in the accepted authoritative source
after alias collapse and explicit partial/component/invalid exclusion. Catalog
nonconflicting count removes catalog identity conflicts, and customer-safe canonical count requires an exact customer-eligible
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

Rolex and Patek Philippe use the accepted completed Phase 7B catalog. Tudor,
Zenith, Cartier, and TAG Heuer use the approved local canonical catalog. The
larger deployed browse totals for Tudor (534), Cartier (1,461), and TAG Heuer
(183) are release/workbook-enriched production-observed universes, not silently
promoted canonical catalogs. Their additional values remain fully enumerated
and classified in the reconciliation artifact. Zenith is 113 in both sources.

Phase 7B remains private and `CANARY_READY`; its evidence in these ledgers does
not switch a customer source, deploy a cohort, or authorize a production change.
