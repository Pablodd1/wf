# Source Price Audit Run - 2026-07-23

## Purpose

Read-only verification of Price Research source rows before any broad price
publication or correction. The runner never writes to `watch_records`.

## Durable checkpoint

- Rows scanned: `994,000` and advancing
- Source-backed eligible rows: `78,118`
- Withheld rows: `915,882`
- Distinct source cohorts observed: `66,241`
- Output directory: local, ignored `outputs/source-price-cohorts-canary/`

## Important exclusions observed

The largest gates at the latest report were unsplit bundle parents, ambiguous
or unverified currency, catalog model/dial mismatches, and ambiguous reference
segmentation. These records remain excluded rather than being assigned a price
or included in market analytics.

At the `994,000`-row checkpoint, the principal review backlog was:

| Priority | Gate | Rows | Required action |
| --- | --- | ---: | --- |
| P0 | `REFERENCE_TOKEN_AS_PRICE` | 2 | Keep withheld; split and duplicate-review the exact source rows below. |
| P1 | `BUNDLE_SOURCE_UNSPLIT` | 353,167 | Split source messages before catalog correction or duplicate suppression. |
| P1 | Currency ambiguous/unverified/rate-unverified | 292,844 | Resolve only from explicit source currency and dated FX evidence. |
| P1 | `CATALOG_DIAL_MISMATCH` | 48,121 | Review raw dial evidence and exact catalog reference; do not bulk overwrite. |

The highest-volume currency-review cohorts were Rolex `126710BLNR`,
`126234`, `126710GRNR`, `228235`, `126710BLRO`, and `126610LN`. The
highest-volume dial-review cohorts included Patek `5712R`, `5712/1R`,
`5711/1A`, `5726/1A`, `5168G`, and Rolex `116610`. These are review
priorities, not automatic correction instructions.

## Verified reference-as-price exclusions

The audit isolated two `Rolex 116508 / Green / Unspecified` source rows with
`price_usd = 500000`:

- `mysql_auction_watches_5b43e4aa-d3ae-4aad-b193-6c0e7c28aa40`
- `mysql_auctions_41b5ef56-6a54-4527-9f11-e9055463b468`

Both preserve the same multi-watch raw message. The message contains two
offers, one at `64K USD` and one at `65.2K USD`, plus their HKD values. The
stored `500000 USD` is not a valid single-listing observation. Both rows are
currently excluded by `REFERENCE_TOKEN_AS_PRICE`; neither contributes to
Price Research. Required disposition: split the source bundle first, retain
one canonical source lineage, and review the duplicate before suppressing the
non-canonical parent. Do not rewrite either parent into a single watch.

## Execution behavior

Larger Railway/Supabase audit batches timed out or returned `fetch failed`.
The stable runner uses bounded 250-row runs with 25-row source pages and a
five-second pause. It has continued from the persisted checkpoint without
mutating `watch_records`. Do not increase concurrency while Supabase remains
load-sensitive.

An exact source-universe count request failed once through Supabase. The
planner estimate is stale and lower than the already scanned keyset count, so
it must not be used as a completion percentage. Completion is proven only when
the ordered keyset scan returns no additional rows.

## Live publication spot checks

The highest-volume currency and dial-review references were queried through
the production Price Research API after the Patek reference-family fix:

| Cohort | Included / pre-outlier | Median | Range | Result |
| --- | ---: | ---: | ---: | --- |
| Rolex `126710BLNR`, Black | 138 / 153 | $17,001 | $14,300-$18,974 | Plausible; 4,862 source rows withheld. |
| Rolex `126234`, Blue | 288 / 304 | $11,600 | $8,846-$14,679 | Plausible; 4,555 source rows withheld. |
| Rolex `126710GRNR`, Black | 146 / 150 | $19,487 | $15,833-$22,800 | Plausible after one transient database failure. |
| Rolex `126610LN`, Black | 95 / 104 | $13,800 | $11,538-$15,400 | Plausible; 4,905 source rows withheld. |
| Patek `5712R`, Brown | 33 / 37 | $106,410 | $89,487-$123,500 | Plausible; dial coverage remains incomplete. |
| Patek `5711/1A`, Blue | 9 / 16 | $110,000 | $92,500-$117,949 | Provisional; seven statistical outliers removed. |
| Rolex `116610`, Green | 121 / 141 | $10,400 | $9,700-$11,026 | Plausible; 3,378 source rows withheld. |

Rolex `126710GRNR` first returned HTTP 500 (`Failed to fetch from database`)
while the source audit was running, then succeeded after a 20-second pause.
Treat this as evidence of load sensitivity. It is not evidence that the
cohort logic is wrong, but it blocks aggressive parallel audit traffic.

## Release implication

This audit is evidence gathering only. It does not approve corrections. Source
rows remain withheld until their exact gate is resolved and reviewed.
