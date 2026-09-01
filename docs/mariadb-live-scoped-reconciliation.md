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
| Metric | Count |
| :--- | :--- |
| **Current MariaDB Boundary Count** | **1,486,554** |
| **Distinct Scoped Staged IDs** | **1,487,325** |
| **Distinct Scoped Error IDs** | **8** |
| **Overlap (Staged ∩ Errors)** | **0** |
| **Union (Staged ∪ Errors)** | **1,487,333** |
| **Captured IDs Absent from Current MariaDB** (Historical source drift deletions retained) | **779** |
| **Current MariaDB IDs Absent from Capture** (Capture skips) | **0** |
| **Exact Capture Completeness Rate** | **100.00%** |

## Artifact Checksum
- `audit-output/mariadb-live/strict_scoped_source_reconciliation.json` SHA-256:
  `08d184e056d37b8058502b4d6c08d8385afa105cb7da659dd1729f1e7dbec729`
