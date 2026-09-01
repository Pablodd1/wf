## 1. Global Authoritative Cohort Census
- **Contract**: `wf-mariadb-authoritative-cohort-census-v1`
- **Total Authoritative Listings**: **1,487,325** (100.00% strictly unique, zero duplicate IDs)
- **Lossless Capture Errors**: **8** (malformed JSON / control-character errors)
- **Total Unique Source Inputs**: **1,487,333** ($1,487,325 + 8$)
- **Source Namespace**: `OceanDigital MariaDB / thecollective_inventory / auctions`
- **Frozen Date Range**: `2025-01-08T13:28:49.000Z` to `2026-08-29T14:42:32.000Z`
- **Listing Type Intent**: `sale` (1,238,777 rows), `search` (248,548 rows)
- **Provenance Ledgers**:
  - `mariadb_authoritative_raw_source_rows`: **1,487,325** distinct source listings
  - `mariadb_raw_source_alternate_versions`: **5,000** duplicate historical snapshots retained for auditing (not additional source listings)
  - `mariadb_raw_import_errors`: **8** lossless error rows
  - Total Raw Database Staging Records: **1,492,333** ($1,487,325\text{ authoritative} + 5,000\text{ alternate versions} + 8\text{ errors}$)

## 2. 10,000-Row Normalization Canary Validation & 2D Matrix
- **Run Key**: `authoritative-10k-canary-1788301198244`
- **Cohort Size**: 10,000 authoritative records
- **Text-Derived Intent vs Raw Payload Type Matrix**:
  ```json
  {
    "WTS":            { "sale": 207,  "search": 2,    "<NULL>": 0, "total": 209 },
    "WTB":            { "sale": 0,    "search": 1838, "<NULL>": 0, "total": 1838 },
    "UNKNOWN_INTENT": { "sale": 7268, "search": 685,  "<NULL>": 0, "total": 7953 }
  }
  ```
- **Reconciliation**:
  - Total Authoritative Inputs: **10,000**
  - Normalized Proposals: **1,768**
  - Review Required: **8,232**
  - Normalization Errors: **0**
  - Exact Reconciliation Formula: $1,768 + 8,232 + 0 = 10,000$ (**100.00%**)
- **Business Eligibility Breakdown**:
  - **Trading Floor Eligible**: **1,933** (19.33%)
    - `ELIGIBLE_WTB`: 1,766
    - `ELIGIBLE_WTS`: 167
    - `HELD_INTENT_UNKNOWN`: 7,624
    - `HELD_IDENTITY_INCOMPLETE`: 303
    - `HELD_BUNDLE_UNSPLIT`: 140
  - **Price Research Eligible**: **2** (0.02%)
    - `ELIGIBLE_VERIFIED_USD`: 2
    - `INELIGIBLE_TRADING_FLOOR_HOLD`: 8,067
    - `INELIGIBLE_NOT_WTS`: 1,766
    - `INELIGIBLE_AMBIGUOUS_CURRENCY`: 143
    - `INELIGIBLE_MISSING_PRICE`: 16
    - `INELIGIBLE_FX_UNRESOLVED`: 6
- **Currency Evidence & Guardrails**:
  - `VERIFIED_EXPLICIT_USD`: 136 (2 Price Research eligible, 121 held for unknown intent, 13 held for incomplete identity)
  - `VERIFIED_EXPLICIT_USDT_HELD_FOR_FX`: 1,082
  - `VERIFIED_EXPLICIT_HKD_HELD_FOR_FX`: 333
  - `AMBIGUOUS_BARE_DOLLAR_HELD`: 3,898 (strictly held from Price Research)
  - `MISSING_PRICE`: 4,411
- **Image Lineage & Canonical Path Contract Reachability**:
  - Images Present: 10,000 (100.00%)
  - Canonical Resolver Template: `https://thecollective-prod.nyc3.digitaloceanspaces.com/listings/full/{key}`
  - Bounded reachability sample: **15/15 reachable** across Early 2025, Mid 2025, and Recent 2026 strata.
  - Both request modes passed: **15/15 HEAD** (`200 image/jpeg`) and **15/15 bounded GET** (`206 image/jpeg`).
  - All sampled keys were bare filenames resolved through `/listings/full/{key}`. This bounded sample does not prove global archive reachability.

## 3. Artifact Checksums (SHA-256)
- `authoritative_cohort_census.json`: `659ecf02fef972a912567ea348981fcae1346387ca7ea03eef5ea2aeb8095697`
- `canary-10k-normalization-report.json`: `3d5483fbe2e92c256087522d992fcaefd5e4a83424168c83a746a782e44f0b2f`
- `canary-10k-authoritative-manifest.json`: `8df67145780a1575454641662fbff049ff63a4ba81f574d6c2ceba6a5eec591b`
- `canary-10k-cross-tab-analysis.json`: `21743442056f6ff5009040b9c1d02a52a80b40be7f432000c375d843a5be944e`
- `stratified-image-reachability.json`: `c2875f44fb2b78ebfad2cf282691bbb8c1931d264765f1f99d33889e9151b316`
