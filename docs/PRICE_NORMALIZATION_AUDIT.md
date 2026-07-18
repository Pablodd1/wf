# Price Normalization Audit

This audit exists for the failure class found in Price Research: a stored
`watch_records.price_usd` value can be stale while the raw listing line contains
explicit currency evidence for the same reference. The client-facing Price
Research endpoints already re-normalize those rows at read time; this tool finds
how widespread the issue is before any database remediation.

## Safety

- Read-only by default.
- Does not update `watch_records`.
- Pages through Supabase with keyset pagination.
- Writes local JSON and CSV reports under `audit-output/price-normalization/`.

## Run a Small Audit

```powershell
$env:PRICE_AUDIT_MAX_ROWS="5000"
$env:PRICE_AUDIT_PAGE_SIZE="500"
railway run npm run audit:price-normalization
```

## Run a Larger Audit

```powershell
$env:PRICE_AUDIT_MAX_ROWS="100000"
$env:PRICE_AUDIT_PAGE_SIZE="500"
$env:PRICE_AUDIT_SAMPLE_LIMIT="10000"
railway run npm run audit:price-normalization
```

## What It Flags

- `EXPLICIT_USD_FROM_REFERENCE_LINE`: the exact raw reference block contains USD,
  USDT, US$, or U$ evidence that disagrees with stored USD.
- `EXPLICIT_HKD_FROM_REFERENCE_LINE`: the exact raw reference block contains HKD
  or HK$ evidence and the converted USD disagrees with stored USD.
- `LIKELY_LEGACY_HKD_DOUBLE_CONVERSION`: the normalized/stored ratio is near the
  HKD exchange factor, usually meaning an HKD-derived USD was converted again.
- `STORED_PRICE_BELOW_LUXURY_FLOOR`: stored price is below $500 and likely unsafe
  for luxury-item analytics.
- `NORMALIZED_PRICE_BELOW_LUXURY_FLOOR`: raw-derived normalized price is below
  $500 and should remain excluded from comparable analytics.
- `REPEATED_REFERENCE_BLOCK_REVIEW`: the exact reference appears more than once
  in the extracted evidence block. These rows should stay review-first because
  they may represent repeated inventory or unsplit bundle/list rows.

## Interpretation

Rows in this report are candidates for review or future deterministic repair.
Only auto-apply a correction when the `evidence_line` contains explicit currency
evidence tied to the same reference block. Bundle rows and ambiguous reference
contexts should stay in human review until line splitting and lineage are
approved.
