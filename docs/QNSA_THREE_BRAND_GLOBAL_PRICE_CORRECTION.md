# QNSA Three-Brand Global Price Correction

This is a price-provenance correction over existing rows in the completed QNSA normalized staging run. Its scope is Rolex, Patek Philippe, and Audemars Piguet single-watch WTS records that either lack a usable USD price or lack complete non-USD conversion provenance.

It does not create or delete listings, change identity, seller, media, bundle state, intent, or raw evidence, or publish a previously excluded row. WTB remains a demand signal and is not assigned an asking price.

## Supported currency contract

The fixed conversion set is USD, USDT, EUR, HKD, GBP, CHF, CNY, JPY, SGD, KRW, THB, CAD, AUD, NZD, MYR, IDR, INR, PHP, BRL, MXN, ZAR, SEK, NOK, and DKK. USD and USDT use rate 1. Every other currency must use the exact rate, observation timestamp, and named source stored in the correction run's immutable `wf-dated-fx-snapshot-v1` snapshot. Missing currencies fail the run before paging.

The parser also recognizes AED, SAR, TWD, and VND. The ECB daily reference-rate dataset does not provide the configured evidence for these currencies, so the snapshot names them in `recognized_but_withheld` and their prices remain unconverted. They may be added only through a later forward contract backed by a dated authoritative source; no peg or guessed rate is permitted.

## Required preflight

1. Target project is exactly `qnsafosakvonzgfcsphh`.
2. The requested normalization checkpoint is `NORMALIZATION_STAGED`, has zero errors, and reconciles `input_rows = staged_rows + existing_rows + deferred_rows`.
3. Database headroom passes, live normalization writers are paused, and pending/failed processing jobs are zero. This prevents a legitimate concurrent insert from being mistaken for a correction-created row.
4. Exact raw-version lineage exists for every selected row.
5. Scope excludes parents, children, bundles, duplicates, rejected/hidden/deleted/archived records, non-watches, WTB, and missing references.
6. Run `AUDIT` first. It performs no schema or data writes.

## Execution sequence

1. Dispatch `AUDIT` with `AUDIT_THREE_BRAND_FX` and review the sanitized artifact.
2. Dispatch `CANARY` with `APPLY_THREE_BRAND_FX_CANARY`. It installs the forward contract and processes one bounded 100-row page.
3. Confirm staging and raw-version row deltas are zero, currencies are supported, and `scanned = corrected + skipped`.
4. Reuse the same correction run key with `RESUME_THREE_BRAND_FX`. Each dispatch is bounded by `max_batches`, and the durable UUID cursor resumes without rescanning earlier pages.
5. Completion is valid only when `status = COMPLETE`, `scanned_rows = census_rows`, and staging/raw row deltas remain zero.

No production dispatch is part of the code change. A human must provide the explicit mode confirmation and verified capacity limit.
