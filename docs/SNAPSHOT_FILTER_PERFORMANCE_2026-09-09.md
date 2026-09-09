# Snapshot filter counts

Filtering by a catalog-resolved model used a different expression from the existing raw brand/model index. Trading Floor also evaluated a redundant fallback branch for “Reference-only listings.” Cached generic query plans could scan far more snapshot rows than necessary for a selected model.

Migration 350 keeps parameter-specific plans inside the two count RPCs and removes that redundant branch. All other filter predicates, snapshot validation, security settings and grants remain unchanged. Migration 360 adds an index matching the existing published brand/model expressions. These changes do not edit source messages, candidate facts, publication rows, snapshot payloads or images.

Migration 360 must run outside a transaction. The operational installer builds it concurrently, checks its exact definition and valid/ready state, and verifies the unchanged publication boundary before recording both migrations. The index depends on the two immutable catalog/brand helpers; rebuilding it is required if their mappings change.

## Validation

The local PostgreSQL 17.6 fixture uses 4 GiB RAM and two CPU cores, matching the production compute configuration. Its 500,500 Trading Floor and 178,178 Price Research snapshot rows are typed copies of 500 real candidate shapes. These copies are performance evidence and have no source admission authority.

- All 18 Rolex Trading Floor model counts and 11 Price Research model counts matched the original snapshot counts across repeated calls.
- A concurrent build produced a valid, ready index of approximately 5.1 MB. Snapshot payload digests remained identical after the test and rollback.
- Monotonic measurements of the fixed model count calls were 5–126 ms. Deliberately forced generic plans for three models per surface took 2.3–11.3 seconds. These local timings are not a production latency guarantee.
- The actual shared 500-candidate stage/materialize/publication checks, replay and exact cohort rollback passed with unchanged raw evidence and child media assertions.
- The installer contract passed exact function/index scope, actual ACL tampering, pre-existing DML rejection and guarded rollback checks on PostgreSQL 17.
- All 7,230 values in the immutable catalog and alias maps were nonblank. Null, empty and whitespace model inputs retained their existing catalog fallback behavior.

The first follow-up test used wall-clock durations and observed a clock adjustment. Its count and integrity checks remain valid; the later monotonic measurements are the timing evidence.

Evidence SHA-256:

| Check | Digest |
| --- | --- |
| Actual seed and snapshot-only scale | `c5e2fe9cf8c6af6786094b7def419c5fec4f0458ed29e238dd435a106e4c57e1` |
| Monotonic forced-plan comparison | `f412dc9d81872c7c6bd321f06902a4e56e7cb03d52f1d6ab4674987e6fff01f1` |
| Exact installer contract and rollback, with production service-role-only ACLs | `ce8c672a5ccef85b25a25bf49d7c01f51c6c0fd06a12c35d55897fc738e90415` |

PostgreSQL documents the distinction between parameter-specific and generic cached plans in its [query planning settings](https://www.postgresql.org/docs/17/runtime-config-query.html#GUC-PLAN-CACHE-MODE).
