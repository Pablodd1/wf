# MariaDB Live Scoped Reconciliation Report

## Scope & Contract
- **Contract**: `wf-mariadb-scoped-reconciliation-v1`
- **Run Key**: `full-capture-auctions-1788028958313`
- **Source Namespace**:
  - System: `OceanDigital MariaDB`
  - Database: `thecollective_inventory`
  - Table: `auctions`
- **Frozen Tuple Boundary**:
  - Lower: `(2025-01-08 13:28:49, 7534d09b-28b9-4052-8005-228c32f972df)`
  - Upper: `(2026-08-29 14:42:32, f1bdf67a-3723-41c6-a1e3-35c5ca9138b0)`

## Reconciliation Metrics
| Metric | Count | Description |
| :--- | :--- | :--- |
| **Distinct Scoped Staged Listings** | **1,487,325** | Valid distinct source listings in authoritative cohort |
| **Distinct Scoped Error IDs** | **8** | Losslessly recorded malformed/corrupt JSON error rows |
| **Total Unique Source Inputs** | **1,487,333** | Distinct valid listings ($1,487,325$) + capture errors ($8$) |
| **Current MariaDB Boundary Count** | **1,486,554** | Live active source rows in MariaDB within frozen boundary |
| **Captured IDs Absent from Current MariaDB** | **779** | Historical listings captured prior to source hard-deletions (retained) |
| **Current MariaDB IDs Absent from Capture** | **0** | **Zero missing rows** ($100.00\%$ capture completeness) |
| **Exact Capture Completeness Rate** | **100.00%** | $\frac{1,486,554 - 0}{1,486,554} = 1.0000$ |
| **Retained Alternate Versions** | **5,000** | Duplicate historical snapshots preserved in `mariadb_raw_source_alternate_versions` (not additional source listings) |

## Artifact Checksum
- `audit-output/mariadb-live/strict_scoped_source_reconciliation.json` SHA-256:
  `08d184e056d37b8058502b4d6c08d8385afa105cb7da659dd1729f1e7dbec729`
