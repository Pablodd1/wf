# WatchFacts v4.2 Bundle Canary - CTO Release Report

Date: 2026-07-18

## Executive decision

The v4.2 bundle parser changes passed the 10,000-parent release gate. The exact cohort has now been persisted to the shadow table and reconciled, and a 25-parent child canary has been written to staging. Automatic bulk child materialization, live promotion, and duplicate suppression remain unapproved.

The initial release-gate validation was read-only. The later rollout changed only `normalization_shadow_v4` and `watch_staging`; it did not change `watch_records`, Trading Floor records, Price Research records, or production review decisions.

## Scope

- 10,000 existing production shadow rows flagged `BUNDLE_SPLIT_REQUIRED`
- 10,000 matching immutable source records
- 115,486 extracted watch candidates
- Comparison against the existing `v4.1-dial-context` shadow output
- Local re-analysis with `v4.2-line-condition`

The repeatable audit command is:

```powershell
$env:BUNDLE_CANARY_ROWS="10000"
$env:BUNDLE_CANARY_PAGE_SIZE="500"
$env:BUNDLE_CANARY_CONCURRENCY="5"
railway run node tools/shadow-reprocess/bundle-canary-report.cjs
```

The final detailed JSON was written locally to `audit-output/bundle-canary-v42-10k-final-gate/report.json` and remains ignored by Git. The report records the last source ID so a later cohort can continue without re-auditing this range.

## Verified results

| Check | Result |
| --- | ---: |
| Source records requested/found | 10,000 / 10,000 |
| Missing source records | 0 |
| Existing candidates | 115,486 |
| v4.2 candidates | 115,486 |
| Rows with changed candidate count | 0 |
| Candidates with exact raw-line lineage | 115,486 (100%) |
| Candidates missing raw-line lineage | 0 |
| Candidates with references | 115,486 (100%) |
| Explicit-condition candidates checked | 24,475 |
| Condition corrections proposed | 20,136 |
| Candidates with price and currency resolved | 83,305 (72.1%) |
| Candidates left unresolved instead of guessed | 32,181 (27.9%) |
| Suspicious sub-$500 candidates before fixes | 1,558 |
| Suspicious sub-$500 candidates after final 10k gate | 1,154 (1.0% of candidates) |
| Million-plus candidates after final 10k gate | 2,933 (2.5% of candidates) |

The remaining sub-$500 values are explicit malformed or scale-less source text such as `$1.25`, `hkd368`, `810HKD`, or `1.42k HKD`. The parser must not silently add a missing `K` or `M`. These values remain attached to their raw lines and must be excluded by the plausibility/review gates.

Price provenance is now part of the audit. Of the 1,154 low values, 799 came from explicit line currency, 320 from an existing structured source currency, and 35 from section currency. Of the 2,933 million-plus values, 545 came from explicit line currency, 2,341 from an existing structured source currency, and 47 from section currency. Million-plus values are not automatically errors in this market. They include explicit rare-watch asks and must be evaluated by reference/configuration cohorts rather than a global ceiling.

All 32,181 unresolved candidates are intentionally withheld from Price Research. No multiplier is invented and no ambiguous dollar sign is silently converted to USD.

## Defects corrected

1. A collapsed bundle's structured parent price could be copied into children that had no line-level price. Source-price fallback is now allowed only for a single-candidate message.
2. `HK` beside an amount is recognized as HKD, while location phrases such as `arrive HK` do not establish currency context.
3. Alphanumeric certificate tokens such as `SC330` no longer merge into a nearby price.
4. Shared currency tokens no longer turn years or limited-edition counts into prices, for example `2018 HKD 720,000`.
5. Dual-currency bridges preserve outward pairs, for example `498k USDT 3.85m HKD`.
6. Chained pairs select the correct sides, for example `2024 HKD 1.545M USDT 200,000`.
7. Punctuation such as `HKD:1340000` is accepted.
8. Month/year fragments following a price no longer replace it, for example `$225,000hkd 5/2025`.
9. Explicit line-level `New` or `Used` overrides inherited section condition. Missing condition remains unresolved and is never changed to `Used` by default.
10. A comma-delimited date can no longer merge with a following price, for example `N12/2024,3.1M hkd` now resolves to `3.1M HKD`, not `20.2431B HKD`.
11. A following word can no longer donate its first letter as a multiplier, for example `HKD 20,000 White Tag` remains `20,000 HKD`.
12. Reference suffixes are protected from section-level multiplier inference, for example Rolex `14060M` is not interpreted as `14.06B HKD`. With no explicit price evidence, the candidate remains unresolved.

## Test evidence

- 33 targeted parser tests pass.
- The full normalization contract suite passes: 94/94 tests after the final reference-suffix regression was added.
- Targeted ESLint checks pass.
- The production frontend build passes.
- The final canary completed against production source evidence in read-only mode.
- Raw messages remain immutable.

Repository-wide lint still reports the previously documented baseline of 154 errors and 2 warnings in unrelated legacy modules. This branch adds no targeted lint errors. The legacy lint backlog remains a separate cleanup workstream and should not be mixed into the bundle parser rollout.

## Railway status

The prior Railway job `normalization-v4-dial-production` remains complete at its existing cursor and was not reused.

A new one-shot shadow job, `normalization-v42-bundle-canary`, completed successfully after PR #41 merged:

| Persisted shadow check | Result |
| --- | ---: |
| Rows analyzed | 10,000 |
| Rows with proposed changes | 7,401 |
| Last source record ID | `042bf015-795f-4dfe-a232-9d0cdb558255` |
| Live rows promoted or mutated | 0 |
| Bounded evidence sample | 1,000 rows |
| Sample WTS / WTB | 843 / 157 |
| Sample no-change / pending | 246 / 754 |
| Sample dial-ambiguous rows | 22 |

The cursor worker scans the archive by source ID. Therefore, this persisted run validates the v4.2 deployment, lease, checkpoint, and shadow-write path over the first 10,000 archive rows; it is not the same bundle-only cohort used by the read-only release gate. The archive-cursor run is separate from the exact bundle cohort evidence below.

## Exact bundle persistence and staging evidence

The bundle-targeted tool selected the same first 10,000 ordered bundle parents, reran v4.2 from immutable source messages, persisted only to `normalization_shadow_v4`, refetched the cohort, and compared stable hashes:

| Exact cohort check | Result |
| --- | ---: |
| Parents selected / sources found | 10,000 / 10,000 |
| Child candidates | 115,486 |
| Exact raw-line lineage | 115,486 (100%) |
| Persisted shadow rows / exact matches | 10,000 / 10,000 |
| Persisted mismatches | 0 |
| Live rows promoted or mutated | 0 |

A bounded 25-parent canary then generated 329 deterministic children and wrote them only to `watch_staging`:

| Staging check | Result |
| --- | ---: |
| Parents / source rows | 25 / 25 |
| Children generated and persisted | 329 / 329 |
| Missing lineage / persisted rows | 0 / 0 |
| Persisted mismatches | 0 |
| Explicitly review-required children | 184 |
| Verdict / confidence | `PENDING` / `0` |

The dry run caught source-level dial leakage (`15202BC salmon ...` inheriting `Black`). The staging guard now recognizes a known dial term only when it immediately follows the exact reference, preserves the inherited value as evidence, and adds `DIAL_RAW_SOURCE_CONFLICT`. The corrected row stages as `Salmon`; it is not silently approved.

## Safe rollout sequence

1. Parser/test changes are merged and the separately named shadow worker completed.
2. The 10,000-parent read-only gate and exact shadow reconciliation are complete; preserve their reports as release evidence.
3. Continue to keep `watch_records` immutable during bundle review.
4. Bundle-targeted selection and exact 10,000-parent reconciliation are complete.
5. Confirm Price Research excludes plausibility failures, unresolved prices/currencies, and unsplit parents.
6. The first 25-parent staging canary is complete; human/catalog review is required before any promotion.
7. Suppress duplicate parents only after child lineage and counts reconcile.

## Release condition

Code merge: approved after CI.

Live production promotion: not approved in this report. Shadow reconciliation and the staging-only canary passed, but bulk materialization and customer-facing promotion require human/catalog review evidence.
