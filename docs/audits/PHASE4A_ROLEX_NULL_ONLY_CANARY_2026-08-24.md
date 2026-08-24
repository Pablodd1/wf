# Phase 4A Rolex production null-only canary

## Technical summary

Phase 4A passed. Production run `p4a-rolex-null-only-20260824T153651Z` committed exactly three authorized WTB corrections at 2026-08-24 15:43:22 UTC. Each row changed only `price_usd`, `conversion_rate`, `conversion_timestamp`, and `conversion_source`, all from null to exact source-backed values. No row was added, removed, replaced, inferred, or promoted into Price Research WTS analytics.

The run produced three immutable proposals and three reversible snapshots. Raw-message hashes and full non-target-field hashes are identical before and after for every row. Trading Floor, WTS, WTB, Price Research source, qualified-WTS, and analytics-ready counts are unchanged. A transaction-scoped rollback simulation restored all three exact snapshots and then rolled itself back, leaving the canary active.

`P3-RLX-001` advances from `CANARY_READY` to `CANARY_PASSED`. The five references are not marked `VERIFIED`.

## Exact authorized and successful rows

| Listing ID | Reference | Intent | Before USD | Source evidence | Persisted FX rate | After USD | Result |
|---|---|---|---:|---|---:|---:|---|
| `ac6840bb-0195-45aa-a3ad-5b536dd6fd7b` | 126334 | WTB | null | EUR 10,000; ECB 2026-08-24 | 1.166400 | 11,664 | PASS |
| `42e491b1-b1a4-44f8-99e8-0ef38b1c5973` | 228235 | WTB | null | GBP 37,950; ECB 2026-08-24 | 1.363413 | 51,742 | PASS |
| `fb45c058-f100-4798-b662-6054be07b2c9` | 228238 | WTB | null | EUR 52,000; ECB 2026-08-24 | 1.166400 | 60,653 | PASS |

Authorized rows: **3**. Successful rows: **3**. Aborted rows for invariant drift: **0**. Unauthorized writes: **0**.

The GBP observed ECB rate was `1.3634132086499124`; `staging.listings.conversion_rate` persists six decimal places, so the checksum-bound stored proposal uses `1.363413`. The rounded product still resolves to the authorized USD value within the existing conversion contract.

## Before/after proof

For all three rows:

`BEFORE NULL → exact immutable source evidence + dated ECB FX → authorized AFTER value`

The fields changed were exactly:

- `price_usd`
- `conversion_rate`
- `conversion_timestamp`
- `conversion_source`

Existing `price_original`, `price_normalized`, `currency_original`, `currency_normalized`, and `currency_evidence` values were already valid and remained byte-equivalent at the JSONB row level. The SHA-256 of every non-target staging field was identical before and after for each row. The immutable raw-text SHA-256 was also identical before and after.

## Customer-facing regression checks are clean

| Reference | TF before | TF after | WTS before | WTS after | WTB before | WTB after | PR source before | PR source after | Qualified WTS before | Qualified WTS after |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 126334 | 12,985 | 12,985 | 10,525 | 10,525 | 2,460 | 2,460 | 2,215 | 2,215 | 0 | 0 |
| 228235 | 5,162 | 5,162 | 3,772 | 3,772 | 1,390 | 1,390 | 788 | 788 | 1 | 1 |
| 228238 | 4,464 | 4,464 | 3,133 | 3,133 | 1,331 | 1,331 | 714 | 714 | 2 | 2 |
| **Total** | **22,611** | **22,611** | **17,430** | **17,430** | **5,181** | **5,181** | **3,717** | **3,717** | **3** | **3** |

Price Research reference-level analytics readiness also remained unchanged: `126334 = false`, `228235 = false`, and `228238 = true`. Because the corrected rows are WTB, they did not become WTS comparables.

## Rollback is exact and reversible

The persisted production snapshot contains three rows. In an uncommitted transaction, the rollback mapping restored all snapshot-controlled price, currency, FX, image, and media fields for all three listings. Exact equality returned `true` for three of three rows. The transaction was then rolled back, so the production canary remained `ACTIVE`; all three active values still match their proposals.

Rollback proof: **PASS**.

## Fail-safe execution notes

Two pre-commit attempts were automatically and completely rolled back:

1. PostgreSQL rejected an ambiguous PL/pgSQL variable/table alias in the snapshot statement.
2. Post-write verification initially compared the full ECB GBP rate with the database column's six-decimal stored representation.

After each event, read-only checks proved zero runs, zero proposals, zero snapshots, and zero target changes. The final transaction was first proven end-to-end with `ROLLBACK`, then executed identically with `COMMIT` after binding the manifest to the exact stored precision.

## Acceptance and next boundary

| Criterion | Result |
|---|---|
| Authorized rows attempted | 3 |
| Successful corrections | 3 |
| Unauthorized writes | 0 |
| Non-null overwrites | 0 |
| Raw mutations | 0 |
| Unrelated field changes | 0 |
| TF regression | 0 |
| Price Research WTS change | 0 |
| Rollback proof | PASS |
| Ledger | CANARY_PASSED |

This canary validates only the three authorized WTB rows and the null-only correction mechanism. It does not authorize expansion, mark the five references verified, or change any publication/analytics rule.

**NO RAW DATA WAS MODIFIED.**

**NO EXISTING VALID NON-NULL VALUE WAS OVERWRITTEN.**

**NO UNAUTHORIZED ROW WAS MODIFIED.**

**NO UI/UX WAS MODIFIED.**
