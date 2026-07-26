# WatchFacts CTO Control Center

**Control date:** July 26, 2026
**Assignment mode:** read-only stabilization
**Current release decision:** do not bulk-promote normalization, bundles, images,
sellers, or duplicates.

**Infrastructure update:** Supabase was upgraded and Railway scaling was
verified through bounded shadow-only canaries. A July 26 cohort started with two
workers, scaled through three to four, and reconciled exactly at 500,000 outputs
and zero errors. Four workers and batch 250 are the measured ceiling for the
next bounded cohort; do not add replicas without another measured gate.

This is the single navigation and decision index for the current project state.
It does not replace immutable evidence, code, migrations, or dated readbacks.
When documents conflict, use the authority order below and record the conflict;
do not choose the more optimistic number.

## Authority order

1. [`AGENTS.md`](../AGENTS.md) — repository-wide safety and evidence rules.
2. [`DATA_RECOVERY_STATUS_2026-07-25.md`](DATA_RECOVERY_STATUS_2026-07-25.md) —
   newest exact production snapshot and release gates.
3. [`DATA_IDENTITY_INCIDENT_2026-07-24.md`](DATA_IDENTITY_INCIDENT_2026-07-24.md) —
   fail-closed identity and image containment.
4. [`EXTERNAL_AI_ASSISTANCE_HANDOFF_2026-07-22.md`](EXTERNAL_AI_ASSISTANCE_HANDOFF_2026-07-22.md) —
   safe external-assistance and zero-hallucination contract.
5. [`RESET_HANDOFF_AND_CLIENT_EXECUTIVE_SUMMARY_2026-07-18.md`](RESET_HANDOFF_AND_CLIENT_EXECUTIVE_SUMMARY_2026-07-18.md) —
   historical restart handoff; newer verified findings override its counts.
6. Repository code, tests, and migrations for exact implemented behavior.
7. Older plans and rollout reports as historical evidence only.

The current deterministic archive analyzer is
`tools/shadow-reprocess/shadow-reprocess.cjs`, version
`v4.2-line-condition`, backed by `api/_lib/normalization-v4.cjs`.
Catalog confirmation is fail-closed through
`api/_lib/catalog-confirmation.cjs`, and review disposition is controlled by
`tools/shadow-reprocess/promotion-policy.cjs`.

## Current exact operating snapshot

The following counts are from the July 25 production readback. “Analyzed” or
“normalized” is not the same as human-approved, published, or correct.

| Control measure | Exact count | Decision meaning |
| --- | ---: | --- |
| Raw records | 17,000 | Immutable source layer; preserve |
| Watch records | 2,631,583 | Live legacy inventory; do not bulk rewrite |
| Shadow rows analyzed | 2,631,468 | Deterministic coverage, not approval |
| Normalization pending | 1,988,995 | Proposed changes still pending |
| Catalog-confirmed identities | 22,976 | Eligible for later bounded review |
| Identity conflicts | 82,111 | Block |
| Identity unverified | 38,595 | Block |
| Human-approved identities | 0 | No automatic promotion claim |
| Verified Trading Floor candidates | 10,864 | Preview canary source only |
| Bundle parents requiring split | 761,489 | Parent must not display as a child |
| Image-backed listings | 1,531 | Source-linked does not mean visually verified |
| Visually verified images | 0 | Customer image release remains blocked |
| Private seller candidates | 16,094 | Identity/consent review only |
| Seller-linked listings | 0 | Do not publish seller/contact data |
| Unbundled staged children | 70,194 | Review lanes only |
| Unbundled approved/published | 0 | No bulk publication |

Queue processing has advanced beyond the July 25 snapshot. As of the completed
July 26 reconciliation, 1,395,000 queue rows were `COMPLETE`, with zero
`PENDING`, `LEASED`, or `FAILED` before the next bounded cohort was seeded.
This is shadow analysis coverage, not human approval or customer publication.

## Workstream controls

| Workstream | Authoritative contract | Current disposition | Next bounded gate |
| --- | --- | --- | --- |
| Normalization | [`NORMALIZATION_CONTRACT.md`](NORMALIZATION_CONTRACT.md) | Shadow/reports only | Reproducible local 100,000-row benchmark |
| Promotion | [`SHADOW_PROMOTION_POLICY.md`](SHADOW_PROMOTION_POLICY.md) | Human approval required | Review a bounded catalog-confirmed cohort |
| Currency | [`CURRENCY_RULES.md`](CURRENCY_RULES.md) | Explicit evidence only; bare `$` is ambiguous | Audit exact-line evidence and FX provenance |
| Catalog identity | [`DATA_IDENTITY_INCIDENT_2026-07-24.md`](DATA_IDENTITY_INCIDENT_2026-07-24.md) | Fail closed | Continue bounded identity staging/readback |
| Bundles | [`BUNDLE_CANARY_V42_2026-07-18.md`](BUNDLE_CANARY_V42_2026-07-18.md) | Split and review before parent suppression | Work priority children in small review batches |
| Images | [`IMAGE_RECONCILIATION.md`](IMAGE_RECONCILIATION.md) | Exact lineage plus visual review | Signed 50-image review packet |
| Seller/dealer | [`IMAGES_SELLER_UNBUNDLED_STATUS_2026-07-24.md`](IMAGES_SELLER_UNBUNDLED_STATUS_2026-07-24.md) | Private evidence; no consent/verification | Owner review of exact identity groups |
| Duplicates | [`DUPLICATE_AUDIT_PROTOCOL.md`](DUPLICATE_AUDIT_PROTOCOL.md) | No suppression before bundle decisions | Human review only |
| Green API | [`GREEN_API_INTEGRATION.md`](GREEN_API_INTEGRATION.md) | Converge into immutable raw pipeline | Preserve event/message/media lineage |
| Railway | [`RAILWAY_NORMALIZATION_WORKER.md`](RAILWAY_NORMALIZATION_WORKER.md) | One replica, batch 250 while constrained | Change only after measured DB/lease gate |

## 100,000-row benchmark

The benchmark is a local-file analysis tool. It has no network or database
client and cannot write to `watch_records`. Each worker loads the local
catalog, enriched references, catalog source, curation aliases, and dial aliases
once at worker initialization.

Default immutable evidence:

```text
public/parsedWatches.json
```

This tracked snapshot contains 117,744 rows. The benchmark selects the first
100,000 in source order and records the source SHA-256, implementation hashes,
catalog hashes, Git commit, adapter version, worker count, and batch size in
`run-manifest.json`. The snapshot IDs are not live `watch_records.id` values;
results measure deterministic behavior and capacity, not production
promotion eligibility.

Run:

```powershell
npm run benchmark:normalization-100k
```

Explicit reproducible run:

```powershell
node tools/normalization-benchmark/benchmark-100k.cjs `
  --input public/parsedWatches.json `
  --output audit-output/normalization-benchmark-100k `
  --rows 100000 `
  --workers 4 `
  --batch-size 250
```

Required local outputs:

```text
run-manifest.json
coverage-report.json
coverage-report.csv
blockers-by-reason.csv
changed-records.csv
errors.csv
benchmark.json
reconciliation.json
```

`reconciliation.json` must prove:

```text
input_rows = output_rows + error_rows
```

`output_rows` is every successfully analyzed source row. `changed-records.csv`
contains only successful rows with one or more change flags; unchanged rows are
counted in the coverage and reconciliation reports.

## Completed benchmark result

The final local run completed on July 25, 2026 using four workers and batches
of 250:

| Measure | Result |
| --- | ---: |
| Input rows | 100,000 |
| Successfully analyzed output rows | 100,000 |
| Errors | 0 |
| Reconciliation difference | 0 |
| Rows with one or more proposed changes | 62,054 |
| Rows with no proposed change | 37,946 |
| Processing runtime | 99.234 seconds |
| Total runtime including local artifacts | 100.261 seconds |
| Throughput | 1,007.72 rows/second |
| Peak process RSS | 919.54 MiB |
| Catalog confirmed | 18,163 |
| Human review disposition | 82,671 |
| Ready for human approval | 17,329 |
| Explicit currency evidence | 87,950 |
| Currency ambiguous | 2,766 |
| Currency missing | 1,146 |
| Bundle split required | 30 |
| No candidate | 799 |

The 62,054 changed rows are deterministic proposals, not approved
normalizations. The smaller 17,329 “ready for human approval” cohort still
requires a reviewer decision; it is not safe for automatic publication.

At the measured local-file rate, compute-only extrapolations are:

| Scope | Rows | Estimated time |
| --- | ---: | ---: |
| All current watch records | 2,631,583 | 43.52 minutes |
| Current normalization-pending count | 1,988,995 | 32.90 minutes |

These estimates exclude database transfer, shadow writes, retries, worker
leases, Supabase contention, catalog corrections, image/seller correlation,
bundle materialization, and human review. They must not be presented as the
time to make the Trading Floor fully accurate.

Human time must be modeled separately. At an illustrative 30 seconds per
decision:

| Review scope | One reviewer | Four reviewers | Eight reviewers |
| --- | ---: | ---: | ---: |
| First 100 rows | 50 minutes | 13 minutes | 6 minutes |
| First 1,000 rows | 8.33 hours | 2.08 hours | 1.04 hours |
| 17,329 ready-for-approval rows | 144.41 hours | 36.10 hours | 18.05 hours |

These are uninterrupted handling-time estimates, not staffing commitments.
The 82,671 human-review dispositions should not all be sent to people: most
must first be reduced by catalog/evidence repair and then re-benchmarked.

The largest human-review blockers in this static snapshot are:

| Blocker | Rows |
| --- | ---: |
| Catalog partial match | 52,218 |
| Catalog not found | 15,529 |
| Currency evidence insufficient | 7,535 |
| Dial ambiguous | 3,659 |
| Emoji price ambiguous | 2,766 |
| No candidate | 799 |
| Asking price incomplete | 341 |
| Catalog brand conflict | 193 |
| Bundle split required | 30 |

The benchmark artifacts are local and ignored by Git at:

```text
audit-output/normalization-benchmark-100k/
```

## Benchmark acceptance gates

A benchmark is decision-grade only when all of these are true:

- input path, byte size, row count, selection rule, and SHA-256 are recorded;
- normalizer version and implementation hashes are recorded;
- every requested worker reports the same catalog counts;
- all eight required files exist and no `.partial` file remains;
- input rows reconcile exactly to successful output rows plus errors;
- errors are preserved in `errors.csv`, never silently dropped;
- catalog, currency, bundle, and review statuses cover every successful row;
- production connections, database writes, and `watch_records` writes are zero;
- throughput and memory are reported from the same run;
- estimated full-run duration is labeled as a compute estimate, excluding
  database I/O, retries, review, and promotion.

Any failed gate stops expansion. Do not start a full-dataset run from a partial
or unreconciled benchmark.

## Railway decision

Railway can remain the worker platform, but adding replicas today is not the
safe first action without a bounded test. The post-upgrade canaries are now
complete and recorded in
[`SUPABASE_POST_UPGRADE_NORMALIZATION_CANARY_2026-07-25.md`](SUPABASE_POST_UPGRADE_NORMALIZATION_CANARY_2026-07-25.md).
Queue mode passed with two workers after removing its redundant global lease;
legacy cursor mode retains the global lease.

Current safe operating point:

```text
Railway replicas: 4 maximum for a bounded cohort
SHADOW_BATCH_SIZE: 250
SHADOW_WORKER_MODE: queue
Bounded cohorts only
```

Measured production shadow results:

| Gate | Rows/sec | Reconciliation |
| --- | ---: | --- |
| 1 worker, batch 250 | 79.74 | 10,000/10,000; 0 errors |
| 1 worker, batch 500 | 81.86 | 25,000/25,000; 0 errors |
| 2 workers, batch 250 | 178.94 | 50,000/50,000; 0 errors |

Batch 500 added only 2.65%, so 250 remains safer. Two workers added 124.39%
over the original baseline.

The July 26 500,000-row cohort then measured the production database path at
larger scale:

| Measure | Result |
| --- | ---: |
| Input / output / errors | 500,000 / 500,000 / 0 |
| Missing / extra shadow rows | 0 / 0 |
| Queue and shadow ID hashes | Match |
| Worker scale | 2 -> 3 -> 4 |
| Whole-cohort operational rate | 115.53 rows/second |
| Stable four-worker checkpoint rate | 146.84-151.02 rows/second |
| Batch size | 250 |
| `watch_records` writes | 0 |

The full cohort includes two-worker startup time, scale transitions, and a
four-worker UI-release restart, so 115.53 rows/second is the conservative
planning rate. The late four-worker intervals are capacity evidence, not a
promise for every source range. Railway CPU and memory remained well below
limits; Supabase reads/writes and row complexity are the current bottleneck.

## Fastest accurate next move

1. Complete the local 100,000-row benchmark and freeze its output directory.
2. Review the largest blocker categories and representative changed rows.
3. Convert stable repeated corrections into tests before changing parser or
   catalog behavior on a separately approved branch.
4. Route uncertain rows to the existing human-review lanes in small cohorts;
   do not create a second source of truth.
5. Use corrections as labeled fixtures for deterministic rules first and ML
   suggestions second. ML suggestions never auto-approve price, currency,
   identity, seller, bundle, or image relationships.
6. After the infrastructure gates pass, run a bounded shadow-only live-ID
   canary. Reconcile it before considering a larger run.

## Human correction and learning loop

The fastest safe design is one queue with deterministic dispositions:

```text
immutable source
-> deterministic v4.2 proposal
-> catalog/currency/bundle gates
-> ready for human approval | human correction | blocked/error
-> signed reviewer decision
-> regression fixture and rule/model evaluation
-> new versioned shadow canary
```

Corrections should include source ID, exact raw evidence, proposed value,
reviewer decision, reason, reviewer, timestamp, parser/catalog version, and
image/seller/bundle lineage where applicable. Learning data must be split by
source message so near-duplicate listings do not leak between training and
evaluation. A model may rank or suggest; deterministic publication gates and a
human remain authoritative.

## Explicit holds

- Do not begin a full-dataset normalization run.
- Do not write benchmark output to `watch_records`.
- Do not change parser, catalog, UI, schema, deployment, or production records
  under this stabilization assignment.
- Do not display bundle parents as normalized child listings.
- Do not attach images by brand/reference resemblance or filename proximity.
- Do not expose seller identity/contact without verified lineage and consent.
- Do not treat shadow completion, catalog match, or “review ready” as human
  approval.

## Related decision record

The infrastructure and acceleration assessment is in
[`CTO_NORMALIZATION_EXPEDITE_DECISION_2026-07-25.md`](CTO_NORMALIZATION_EXPEDITE_DECISION_2026-07-25.md).
Its implementation plan requires separate approval and is not authorized by
this read-only assignment. This control center remains the entrypoint.
