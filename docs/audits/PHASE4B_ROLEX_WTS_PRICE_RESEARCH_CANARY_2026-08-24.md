# Phase 4B Rolex WTS Price Research recovery canary

## Executive conclusion

Phase 4B did **not** execute a production correction because the complete five-reference discovery population contained zero safe WTS rows. The correct status is `BLOCKED_NO_SAFE_COHORT`, not `PASSED`.

The read-only census inspected 9,333 unique Rolex WTS listings with `price_usd = NULL` across references `126334`, `126300`, `228235`, `228238`, and `126333`. Every row had exact immutable raw-version lineage, was non-bundle at the structured row level, and was not suppressed. Parser-v5 classified 7,001 as review-required and 2,332 as unresolved. No row qualified as `SAFE_EXPLICIT_USD`, `SAFE_EXPLICIT_USDT`, or `SAFE_VERIFIED_FX`.

Because the safe population is zero, the selected write cohort is zero. No correction run, proposal, snapshot, activation, rollback, Trading Floor change, Price Research change, or analytics change occurred.

## Discovery and classification

| Classification | Rows |
|---|---:|
| SAFE_EXPLICIT_USD | 0 |
| SAFE_EXPLICIT_USDT | 0 |
| SAFE_VERIFIED_FX | 0 |
| REVIEW_REQUIRED | 7,001 |
| UNRESOLVED | 2,332 |
| **Total** | **9,333** |

The complete population reconciles exactly: `7,001 + 2,332 = 9,333`.

| Reference | Discovery | Safe | Review required | Unresolved |
|---|---:|---:|---:|---:|
| 126300 | 1,929 | 0 | 1,181 | 748 |
| 126333 | 1,446 | 0 | 1,132 | 314 |
| 126334 | 3,665 | 0 | 2,851 | 814 |
| 228235 | 1,300 | 0 | 1,055 | 245 |
| 228238 | 993 | 0 | 782 | 211 |
| **Total** | **9,333** | **0** | **7,001** | **2,332** |

The principal blocking reasons were:

- 6,369 price/currency candidates required review.
- 2,332 rows had no exact auto-approved price observation.
- 408 otherwise exact observations lacked an approved usable FX conversion: 402 were AED, a recognized-but-withheld currency in the current dated snapshot; six were implausible HKD 1–3 observations whose converted value rounded to zero USD.
- 114 contained multiple price candidates.
- 105 had multiple/bundle source context.
- 5 triggered parser bundle-price ambiguity, including the previously known structured HKD row for reference `228235`.

No bare-dollar observation was promoted to USD. No unsupported currency was converted by inference.

## Price Research eligibility

Safe-price and Price Research eligibility were evaluated separately. With zero safe-price rows:

| Eligibility classification | Rows |
|---|---:|
| EXPECTED_PR_QUALIFIED | 0 |
| SAFE_PRICE_BUT_NOT_PR_QUALIFIED | 0 |
| Selected write cohort | 0 |

There is therefore no authorized row-level chain to prove for `RAW SOURCE → NORMALIZED PRICE → TRADING FLOOR → PRICE RESEARCH`. Expanding scope or weakening currency/parser gates merely to reach ten rows is prohibited.

| Write outcome | Rows |
|---|---:|
| CORRECTED_AND_PR_QUALIFIED | 0 |
| CORRECTED_NOT_PR_QUALIFIED | 0 |
| ABORTED | 0 |
| REVIEW_REQUIRED | 7,001 |
| UNRESOLVED | 2,332 |

There is no before/after row table because no row entered the frozen write cohort. The discovery run ID is `p4b-rolex-wts-discovery-20260824T162407Z`; no correction run ID was created.

## Trading Floor and Price Research remain unchanged

| Reference | TF before/after | WTS before/after | WTB before/after | PR source before/after | Qualified WTS before/after | Analytics ready |
|---|---:|---:|---:|---:|---:|---|
| 126300 | 5,778 / 5,778 | 5,113 / 5,113 | 665 / 665 | 1,194 / 1,194 | 0 / 0 | No / No |
| 126333 | 5,007 / 5,007 | 4,336 / 4,336 | 671 / 671 | 672 / 672 | 0 / 0 | No / No |
| 126334 | 12,985 / 12,985 | 10,525 / 10,525 | 2,460 / 2,460 | 2,215 / 2,215 | 0 / 0 | No / No |
| 228235 | 5,162 / 5,162 | 3,772 / 3,772 | 1,390 / 1,390 | 788 / 788 | 1 / 1 | No / No |
| 228238 | 4,464 / 4,464 | 3,133 / 3,133 | 1,331 / 1,331 | 714 / 714 | 2 / 2 | Yes / Yes |
| **Total** | **33,396 / 33,396** | **26,879 / 26,879** | **6,517 / 6,517** | **5,583 / 5,583** | **3 / 3** | **1 / 1** |

The customer endpoint still tracks 40 WTS rows and qualifies three across the five references. Reference `228238` remains the only reference-level analytics-ready cohort. Its statistics remain mean/median USD 55,300, minimum USD 43,100, maximum USD 67,500, and 3.0x-IQR fences USD 12,600–98,000. All other references have no qualified benchmark statistics. No price rating changed because no listing was corrected.

## No-write and rollback boundary

Production verification at 2026-08-24 16:28:56 UTC returned zero Phase 4B runs, zero proposals, and zero snapshots. The Phase 4A run remains active with all three authorized values still matching their proposals.

Rollback was not exercised because no mutation or snapshot was authorized. This is not a Phase 4B rollback pass; it is a stronger no-write result. The customer-impacting canary remains unproven until a future bounded discovery identifies at least one source-backed safe WTS row within the authorized references.

## Ledger status

- `P3-RLX-001`: remains `CANARY_PASSED` from Phase 4A.
- `WTS_PRICE_RESEARCH_CANARY`: `BLOCKED_NO_SAFE_COHORT`.
- The five references remain not `VERIFIED`.

No Patek work or additional Rolex-reference expansion was performed.

**NO RAW DATA WAS MODIFIED.**

**NO EXISTING VALID NON-NULL VALUE WAS OVERWRITTEN.**

**NO UNAUTHORIZED ROW WAS MODIFIED.**

**NO UI/UX WAS MODIFIED.**
