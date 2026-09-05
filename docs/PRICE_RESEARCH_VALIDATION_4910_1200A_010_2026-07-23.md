# Price Research Validation: Patek Philippe 4910/1200A-010

**Verified at:** 2026-07-23 UTC

**Scope:** Grey dial, selected through the live production Price Research API.
**Decision status:** Share with caveats. The Grey / All Conditions cohort is correctly calculated, but it is provisional evidence and has no usable historical series.

## Evidence Source

Live, read-only request:

```text
GET https://watchfacts-poc.vercel.app/api/price-research?brand=Patek%20Philippe&reference=4910%2F1200A-010&dial=Grey&condition=All
```

The request returned `success: true` and the following verified values:

| Metric | Verified value |
| --- | ---: |
| Qualified observations | 5 |
| Average | $14,890 |
| Median | $14,968 |
| Minimum | $14,516 |
| Maximum | $15,226 |
| IQR lower / upper fence | $13,451 / $16,291 |
| Statistical outliers removed | 0 |
| Reposts excluded | 2 |
| Required-field exclusions | 396 |
| Unsplit bundle parents excluded | 374 |
| Qualified WTB observations | 0 |
| Forecast | Not available (`CONDITION_REQUIRED`) |

The qualifying source IDs returned by the API are retained in the API response and must remain the evidence for any human correction. No source record was changed during this validation.

## Grain Correction

The narrative "403 initial raw rows" needs a precise label. It is the API's bounded sample of **403 approved WTS records** for this brand/reference, before Price Research eligibility filtering. It is not every raw record that happens to carry the reference.

A separate, read-only primary-key export of `watch_records` for the exact reference produced **547 rows**. That wider export includes WTB records, HUMAN-verdict records, and records with other dial values. It is useful for audit/reconciliation, not a comparable-price cohort.

Export artifact (local, not committed):

```text
C:\Users\jasme\Documents\Codex\2026-07-12\review\outputs\live-audit-4910-1200A-010.csv
```

## Eligibility Applied by the Live API

The live handler in `api/price-research.js` applies these controls before statistics:

1. Approved, visible WTS records for the selected brand and exact normalized reference.
2. Explicit price/currency evidence on the reference line, using `normalizeMarketRow`.
3. Catalog and required-field eligibility through `classifyResearchEligibility`.
4. Exclusion of unsplit bundle parents.
5. Suppression of reviewed duplicates and dealer repost deduplication.
6. A cohort plausibility floor, then 1.5x IQR fences.
7. A minimum of five valid observations before statistics are shown.

## Condition Checks

Each condition was queried with the same reference and Grey dial.

| Selection | Qualified rows | Statistics shown? | Forecast shown? | Result |
| --- | ---: | --- | --- | --- |
| Grey + All | 5 | Yes | No | Provisional cohort; historical-only behavior is correct. |
| Grey + New | 0 | No | No | Insufficient evidence. |
| Grey + Used | 2 | No | No | Insufficient evidence. |
| Grey + Unspecified | 3 | No | No | Insufficient evidence. |

The page must not carry the All-conditions price into New, Used, or Unspecified views. It should show the existing insufficient-data state for those selections.

## Caveats Required in Client-Facing Copy

- Five observations meets the display threshold but is not a stable market conclusion; label it **provisional evidence**.
- "0 WTB" means no **qualified** WTB records matched the selected cohort. It is not proof of zero market demand.
- Three observations have Unspecified condition. They may be visible as evidence, but cannot support a condition-specific price statistic.
- `monthly` was empty in the verified API response because the five included records have no usable original posting date. Do not show a historical chart or forecast until dated eligible observations exist.
- The `currency_data_quality.corrected_count` was 4. The API derived those amounts from explicit USD evidence in the raw reference line; it did not accept their stored `price_usd` values blindly.

## Verification Commands

```powershell
# Read-only source export. Railway injects the production credentials.
$env:LIVE_AUDIT_REFERENCE = '4910/1200A-010'
$env:LIVE_AUDIT_MAX_ROWS = '1000'
railway run node tools/external-audit/export-live-price-audit-input.cjs

# Live cohort request
Invoke-WebRequest -UseBasicParsing `
  'https://watchfacts-poc.vercel.app/api/price-research?brand=Patek%20Philippe&reference=4910%2F1200A-010&dial=Grey&condition=All'
```

## Next Safe Action

Use the source-backed export tool to provide an external auditor only immutable `watch_records.id` values and raw evidence. Do not bulk apply the Kimi candidate file: its synthetic identifiers did not join to the live table in the 609-row no-write canary.
