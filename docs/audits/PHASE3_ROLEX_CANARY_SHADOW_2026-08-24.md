# Phase 3 Rolex five-reference correction canary — read-only shadow report

Generated 2026-08-24. Production project: canonical QNSA. Scope is limited to Rolex references `126334`, `126300`, `228235`, `228238`, and `126333`.

## Technical summary

P3-RLX-001 is now fully audited and may advance from `BLOCKED` to `CANARY_READY`. The immutable missing-USD cohort remains exactly 49 rows, matching Phase 3 with zero drift. Parser-v5 admits only 3 rows to the proposed null-only lane; 46 require review and none are unresolved. All three safe rows are WTB target prices, so they do not add WTS observations to Price Research analytics.

Trading Floor parity is complete for the five references: 33,396 active staging rows, 33,396 eligible rows, and 33,396 published rows. The public Price Research contract is materially narrower: 40 tracked WTS rows, 3 reference-qualified WTS observations, and only reference `228238` is reference-level analytics-ready.

The global `565,620` versus `580,325` Trading Floor discrepancy is exactly `-14,705` rows and is caused by mixed publication sources and brand routing. It is not a separately applied duplicate, bundle, or category subtraction.

No correction was executed. No production data, UI/UX, publication state, raw message, or existing valid field was modified.

## The immutable cohort is unchanged and only three rows are safe

| Reference | Cohort | SAFE_NULL_ONLY | REVIEW_REQUIRED | UNRESOLVED |
|---|---:|---:|---:|---:|
| 126334 | 11 | 1 | 10 | 0 |
| 126300 | 6 | 0 | 6 | 0 |
| 228235 | 7 | 1 | 6 | 0 |
| 228238 | 13 | 1 | 12 | 0 |
| 126333 | 12 | 0 | 12 | 0 |
| **Total** | **49** | **3** | **46** | **0** |

Parser-v5 classifications are `SAFE_VERIFIED_FX: 3`, `REVIEW_CURRENCY: 45`, and `REVIEW_BUNDLE: 1`. No row qualified as `SAFE_EXPLICIT_USD`, `SAFE_EXPLICIT_USDT`, `REVIEW_MULTIPLE_PRICE`, or `UNRESOLVED`.

The three safe candidates retain exact immutable IDs and hashes in the sanitized shadow artifact. Their human-readable price evidence is:

| Reference | Intent | Exact span | Source amount | Source currency | Dated rate | Proposed USD |
|---|---|---|---:|---|---:|---:|
| 126334 | WTB | `€10K` | 10,000 | EUR | 1.1664 | 11,664 |
| 228235 | WTB | `£37,950` | 37,950 | GBP | 1.3634132086499124 | 51,742 |
| 228238 | WTB | `52k€` | 52,000 | EUR | 1.1664 | 60,653 |

Rates are the European Central Bank reference-rate snapshot observed on 2026-08-24. Because all three rows are WTB, activation would populate target-price fields only; it would not make them Price Research WTS comparables.

## All five identities are exact catalog references

| Reference | Canonical Rolex model | Classification | Evidence | Confidence |
|---|---|---|---|---|
| 126334 | Datejust | VALID_EXACT_REFERENCE | Rolex Final Catalog.xlsx / local_catalog_v1 | High (0.99) |
| 126300 | Datejust | VALID_EXACT_REFERENCE | Rolex Final Catalog.xlsx / local_catalog_v1 | High (0.99) |
| 228235 | Day-Date | VALID_EXACT_REFERENCE | Rolex Final Catalog.xlsx / local_catalog_v1 | High (0.99) |
| 228238 | Day-Date | VALID_EXACT_REFERENCE | Rolex Final Catalog.xlsx / local_catalog_v1 | High (0.99) |
| 126333 | Datejust | VALID_EXACT_REFERENCE | Rolex Final Catalog.xlsx / local_catalog_v1 | High (0.99) |

This mapping is reference-derived audit evidence only. It does not replace source listing evidence and was not written to production staging.

Across the Phase 3 set of 4,592 distinct nonblank Rolex staging reference values, the deterministic taxonomy produced:

| Taxonomy | Distinct values | Listings |
|---|---:|---:|
| VALID_EXACT_REFERENCE | 287 | 187,576 |
| VALID_REFERENCE_VARIANT | 0 | 0 |
| MODEL_OR_FAMILY_TOKEN | 0 | 0 |
| COMPONENT_ACCESSORY | 6 | 10,031 |
| FREE_TEXT | 18 | 212 |
| AMBIGUOUS | 4,260 | 83,609 |
| INVALID | 21 | 52 |
| **Total** | **4,592** | **281,480** |

Contract tests explicitly cover `BRACELET`, strap/component terms, dial terms, model-family names, partial references, valid variants, free text, malformed values, and year-like tokens. `BRACELET` is classified as `COMPONENT_ACCESSORY`, never as a watch reference.

## Trading Floor is complete; Price Research is intentionally and operationally narrower

| Reference | Active | WTS | WTB | TF eligible | TF published | Explicit source price | Normalized price | PR source rows | PR qualified WTS | PR analytics-ready |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|
| 126334 | 12,985 | 10,525 | 2,460 | 12,985 | 12,985 | 2,217 | 6,872 | 2,215 | 0 | No |
| 126300 | 5,778 | 5,113 | 665 | 5,778 | 5,778 | 1,194 | 3,190 | 1,194 | 0 | No |
| 228235 | 5,162 | 3,772 | 1,390 | 5,162 | 5,162 | 790 | 2,479 | 788 | 1 | No |
| 228238 | 4,464 | 3,133 | 1,331 | 4,464 | 4,464 | 715 | 2,153 | 714 | 2 | Yes |
| 126333 | 5,007 | 4,336 | 671 | 5,007 | 5,007 | 672 | 2,902 | 672 | 0 | No |
| **Total** | **33,396** | **26,879** | **6,517** | **33,396** | **33,396** | **5,588** | **17,596** | **5,583** | **3** | **1 of 5** |

`PR source rows` counts the dedicated database source view. `PR qualified WTS` is the stricter customer endpoint metric and is the value recorded in the ledger. The endpoint currently selects the reviewed-workbook evidence path when that evidence exists, so it does not expose all 5,583 source-view rows as analytics candidates.

The customer contract loaded 40 WTS rows in total. It excluded 38: 34 required-field failures, 2 unpriced rows, 1 unsplit bundle, and 1 other-dial cohort. Reference `228235` has one qualified observation, below the minimum sample. Reference `228238` has two reference-qualified observations and is reference-level analytics-ready, although the selected cohort contains only one included observation after dial selection. The other three references have no qualified WTS observation under the current public contract.

## The 14,705-row global difference is source composition, not row-level deduplication

The live-release endpoint returns 565,620 WATCH listings. The count-snapshot endpoint returns 580,325. Their exact difference is `565,620 - 580,325 = -14,705`.

The source-composition bridge is:

| Structural reason | Delta versus snapshot |
|---|---:|
| Vacheron omitted from live-summary routing | -9,008 |
| Cartier, Omega, and Tudor controlled-release replacements | -9,491 |
| Panerai omitted from reviewed-workbook admission list | -5,533 |
| Other reviewed-workbook substitutions/additions, net | +9,327 |
| **Exact total** | **-14,705** |

The complete 26-brand delta table is preserved in `trading-floor-total-reconciliation.json`; its sum is exactly `-14,705`.

Both totals are WATCH-category totals, so category contributes zero. The snapshot contract already excludes exact suppressed duplicates, bundle parents, deferred bundle children, and inactive/withdrawn states. The live endpoint does not obtain 565,620 by applying a second 14,705-row duplicate/bundle/suppression filter; it composes different per-brand sources. Review-only state remains a separate contract defect because the snapshot permits `PENDING_REVIEW`, but it is not an exact explanation for the observed 14,705 difference.

The recommended canonical definition is therefore validated with one refinement: `Total Listings = COUNT(DISTINCT canonical_listing_observation_id)` over currently published single-watch observations, including WTS and WTB but exposing those counts separately, and excluding bundle parents, deferred bundle children, exact duplicates, withdrawn/deleted/superseded versions, suppressed rows, and review-only candidates. Neither current endpoint fully implements this single versioned contract.

## Proposed correction lane and rollback plan

The proposed canary contains exactly 3 rows. Activation requires separate authorization and must:

1. Snapshot each target row and its current price fields before activation.
2. Bind the candidate manifest to `listing_id`, `source_record_id`, `raw_message_version_id`, `source_hash`, and `source_candidate_hash`.
3. Revalidate that all immutable IDs/hashes are unchanged and all target normalized USD fields remain null.
4. Update only the null USD value and its dated FX provenance fields; do not modify reference, model, intent, raw evidence, dealer data, or publication state.
5. Read back exactly three rows and append before/after evidence under one correction batch token.
6. Roll back by the same immutable IDs and batch token to the captured null state; refuse rollback or activation if any row has drifted.

The 46 review-required rows are excluded from the canary. Existing non-null values are never eligible for this lane.

## Status and limitations

`P3-RLX-001` is updated to `CANARY_READY`, not `CANARY_PASSED`. The prerequisites are satisfied: exact bounded cohort, immutable lineage, complete parser classification, exact-reference identity, exact TF/PR counts, source-backed safe set, and a reversible null-only plan. No correction has run.

The global count contract remains a structural recommendation, not an endpoint change. Price Research readiness reflects the live public endpoint at the recorded snapshot time and may change if its reviewed-workbook source or eligibility gates change.

## Reproducibility checksums

| Artifact | SHA-256 |
|---|---|
| summary.json | `2d55994fd8730cb6f1748b67a150c57fced404e14dea854b957ebb8993d4ecd9` |
| five-reference-staging-counts.json | `9a729b863f8aa780436eb09c75016edae8ccc005864d2fe92be0d72fece98cea` |
| reference-taxonomy-summary.json | `8a7cd3c089145845c4724fceeab98ea8b057c02d59bedfdbf9c168461543143d` |
| price-research-customer-contract.json | `ad0de54756c4a1d97f58a4628f73356083487fbfaabe6e3e2a40ec498bd57fa3` |
| trading-floor-total-reconciliation.json | `73c82891b8736a2823ebdb8259a0fd29d2b94b861c1c8aa18501f4c72d28f059` |

NO PRODUCTION DATA WAS MODIFIED. NO UI/UX WAS MODIFIED. NO PUBLICATION STATE WAS MODIFIED. NO EXISTING VALID FIELD WAS OVERWRITTEN.
