# Phase 4C Rolex safe WTS cohort discovery

## Executive conclusion

Phase 4C completed in strict read-only/shadow-only mode and found **zero safe WTS rows**. The correct result is `BLOCKED_NO_SAFE_COHORT`; Phase 4D is not authorized.

The audit ranked 20 exact catalog references beyond the original Phase 4B five-reference set. Aggregate screening covered 11,946 Rolex WTS rows whose normalized USD price was missing. Only 285 bounded rows with an explicit supported currency marker were retrieved with exact immutable lineage and evaluated by parser-v5. Parser-v5 classified 254 rows as `REVIEW_REQUIRED`, 31 as `UNRESOLVED`, and none as `AUTO_APPROVED` safe price candidates.

No evidence rule was lowered to reach the requested cohort size. The frozen Phase 4D cohort is empty.

## Reference ranking

The ranking first used the Phase 3 authoritative exact-reference partition, then refreshed only 20 catalog-confirmed references with live QNSA aggregates. Raw payloads were not downloaded during ranking. `WTS missing USD` is the aggregate screening base; raw marker columns are server-side counts and may overlap.

| Rank | Reference | Canonical model | WTS missing USD | Raw USD/USDT markers | Potential verified FX | Review-heavy | Score |
|---:|---|---|---:|---:|---:|---:|---:|
| 1 | 116508 | Cosmograph Daytona | 373 | 38 | 14 | 373 | 180 |
| 2 | 228206 | Day-Date | 199 | 26 | 0 | 199 | 104 |
| 3 | 126234 | Datejust | 1,305 | 21 | 7 | 1,305 | 98 |
| 4 | 336934 | Sky-Dweller | 1,152 | 14 | 13 | 1,152 | 82 |
| 5 | 126508 | Cosmograph Daytona | 391 | 6 | 25 | 391 | 74 |
| 6 | 326934 | Sky-Dweller | 571 | 17 | 2 | 571 | 72 |
| 7 | 126610LN | Submariner | 983 | 15 | 5 | 983 | 70 |
| 8 | 126613LB | Submariner | 680 | 11 | 2 | 680 | 48 |
| 9 | 126622 | Yacht-Master | 377 | 8 | 8 | 377 | 48 |
| 10 | 116710LN | GMT-Master II | 404 | 11 | 0 | 404 | 44 |
| 11 | 126233 | Datejust | 760 | 8 | 4 | 760 | 40 |
| 12 | 126713GRNR | GMT-Master II | 412 | 9 | 2 | 412 | 40 |
| 13 | 126710BLNR | GMT-Master II | 1,402 | 8 | 1 | 1,402 | 34 |
| 14 | 126711CHNR | GMT-Master II | 574 | 7 | 2 | 574 | 32 |
| 15 | 116506 | Cosmograph Daytona | 177 | 6 | 1 | 177 | 26 |
| 16 | 126200 | Datejust | 466 | 4 | 4 | 466 | 24 |
| 17 | 126231 | Datejust | 358 | 3 | 5 | 358 | 22 |
| 18 | 116610LN | Submariner | 445 | 3 | 1 | 445 | 14 |
| 19 | 116500LN | Cosmograph Daytona | 467 | 3 | 0 | 467 | 12 |
| 20 | 124060 | Submariner | 450 | 2 | 2 | 450 | 12 |

Candidate score is deterministic and used only for discovery order: four points per USD/USDT marker row plus two points per supported-FX marker row. It is not an approval score.

## Row-level parser result

| Classification | Rows |
|---|---:|
| SAFE_EXPLICIT_USD | 0 |
| SAFE_EXPLICIT_USDT | 0 |
| SAFE_VERIFIED_FX | 0 |
| REVIEW_REQUIRED | 254 |
| UNRESOLVED | 31 |
| **Total** | **285** |

The result reconciles exactly: `254 + 31 = 285`.

| Blocking reason | Rows |
|---|---:|
| Price/currency requires review | 170 |
| Multiple price candidates | 67 |
| No exact auto-approved price | 31 |
| Implausible HKD amount 1-3 | 6 |
| Multiple or bundle source context | 6 |
| Parser bundle-price ambiguity | 5 |

The blocking-reason total is 285. No bare-dollar observation was treated as USD, no review-required row was converted into a safe candidate, and no non-null price would have been overwritten.

## Price Research pre-check

| Eligibility | Rows |
|---|---:|
| EXPECTED_PR_QUALIFIED | 0 |
| SAFE_PRICE_NOT_PR_QUALIFIED | 0 |
| Proposed Phase 4D cohort | 0 |

Price Research eligibility was evaluated only after the safe-price contract. Because no row passed the safe-price contract, there is no row to test through `source-backed normalized price → Trading Floor → Price Research` and no defensible exclusion-reason split beyond the price-evidence blockers above.

## AED and implausible-price findings

Phase 4C found 431 additional server-side rows with an AED marker across the 20 ranked references. These were counted but not downloaded for parser promotion because AED remains `recognized_but_withheld` in the repository's dated ECB snapshot. Phase 4B's 402 parser-confirmed AED observations remain preserved as a separate confirmed bucket; the 431 Phase 4C marker rows are not added to that exact-observation count because they were not row-level parsed.

There is no approved deterministic historical AED conversion path in the current repository. A future path could be safe only after an approved dated source is added, provenance fields are retained, and the same parser/null-only tests pass. No fixed or fabricated AED rate is authorized.

Aggregate screening found 11 HKD 1-3 marker rows. Row-level parser validation confirmed six implausible HKD observations of 1-3; all six remained review-required. The other five aggregate marker hits failed different source-context gates and were not reclassified.

## No-write proof and Phase 4D boundary

All production queries ran inside `BEGIN TRANSACTION READ ONLY` with `transaction_read_only = on`. The exact 285-row screened cohort had the same deterministic MD5 before and after discovery: `adc992271b8b60923c807819a48e3e79`.

- Production writes: 0
- Raw-message mutations: 0
- Publication changes: 0
- UI/UX changes: 0
- Schema or migration changes: 0
- Evidence-standard changes: 0
- Phase 4D rows proposed: 0

Ledger status: `ROLEX_SAFE_WTS_COHORT_DISCOVERY = BLOCKED_NO_SAFE_COHORT`. `P3-RLX-001` remains `CANARY_PASSED`; `WTS_PRICE_RESEARCH_CANARY` remains `BLOCKED_NO_SAFE_COHORT`.

**NO PRODUCTION DATA WAS MODIFIED.**

**NO RAW DATA WAS MODIFIED.**

**NO UI/UX WAS MODIFIED.**

**NO EVIDENCE STANDARD WAS RELAXED.**
