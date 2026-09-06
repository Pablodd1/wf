# Deployed and main lineage reconciliation

Release baseline: `b9c0145c2e153dd82c936b7b4e02361f1f3e5fd9`. Main: `f936270b1a2027c7e6a5e83cf3b2ff5f6fbb4649`.

Main has one squash commit versus 114 deployed-side commits. Every differing tree path was assessed; no unrelated history was merged. The applicable stricter behavior is already on the deployed lineage. Historical capture constants are not authorized inputs to the current run.

| File | Main change | Decision |
|---|---|---|
| `audit-output/mariadb-live/authoritative_cohort_census.json` | D | Preserve deployed-side evidence and reports. Main removes or replaces historical evidence with older scoped results; neither represents current source state. |
| `audit-output/mariadb-live/launch-preflight/launch-preflight-report.json` | M | Preserve deployed-side evidence and reports. Main removes or replaces historical evidence with older scoped results; neither represents current source state. |
| `audit-output/mariadb-live/normalization-canary-10k/canary-10k-authoritative-manifest.json` | M | Preserve deployed-side evidence and reports. Main removes or replaces historical evidence with older scoped results; neither represents current source state. |
| `audit-output/mariadb-live/normalization-canary-10k/canary-10k-cross-tab-analysis.json` | D | Preserve deployed-side evidence and reports. Main removes or replaces historical evidence with older scoped results; neither represents current source state. |
| `audit-output/mariadb-live/normalization-canary-10k/canary-10k-normalization-report.json` | D | Preserve deployed-side evidence and reports. Main removes or replaces historical evidence with older scoped results; neither represents current source state. |
| `audit-output/mariadb-live/normalization-canary-10k/image-reachability-sample.json` | M | Preserve deployed-side evidence and reports. Main removes or replaces historical evidence with older scoped results; neither represents current source state. |
| `audit-output/mariadb-live/normalization-canary-10k/proposals.jsonl` | M | Preserve deployed-side evidence and reports. Main removes or replaces historical evidence with older scoped results; neither represents current source state. |
| `audit-output/mariadb-live/normalization-canary-10k/stratified-image-reachability.json` | D | Preserve deployed-side evidence and reports. Main removes or replaces historical evidence with older scoped results; neither represents current source state. |
| `audit-output/mariadb-live/strict_scoped_source_reconciliation.json` | D | Preserve deployed-side evidence and reports. Main removes or replaces historical evidence with older scoped results; neither represents current source state. |
| `docs/authoritative-cohort-and-canary-evidence.md` | D | Preserve deployed-side evidence and reports. Main removes or replaces historical evidence with older scoped results; neither represents current source state. |
| `docs/intent-provenance-and-unknown-safe-proposal.md` | D | Preserve deployed-side evidence and reports. Main removes or replaces historical evidence with older scoped results; neither represents current source state. |
| `docs/mariadb-live-scoped-reconciliation.md` | D | Preserve deployed-side evidence and reports. Main removes or replaces historical evidence with older scoped results; neither represents current source state. |
| `docs/railway-worker-stop-state-2026-09-01.md` | D | Preserve deployed-side evidence and reports. Main removes or replaces historical evidence with older scoped results; neither represents current source state. |
| `railway.json` | M | Retain deployed explicit capture configuration. Main changes worker defaults and conflicts between JSON/TOML. Future execution will use a reviewed service-specific command and exact checkpoint; no automatic generic worker switch. |
| `railway.toml` | M | Retain deployed explicit capture configuration. Main changes worker defaults and conflicts between JSON/TOML. Future execution will use a reviewed service-specific command and exact checkpoint; no automatic generic worker switch. |
| `supabase/migrations/20260901213000_allow_partial_checkpoint_status.sql` | D | Preserve deployed-side reconciliation, checkpoint migration and validation tools. Removing them would discard deployed functionality or evidence. |
| `tests/authoritative-cohort-materialization.test.cjs` | D | Preserve deployed-side reconciliation, checkpoint migration and validation tools. Removing them would discard deployed functionality or evidence. |
| `tests/canonical-parent-child-normalization.test.cjs` | M | Keep deployed test of the effective forward FX status constraint; main validates an obsolete definition. |
| `tests/launch-preflight-contract.test.cjs` | D | Preserve deployed-side reconciliation, checkpoint migration and validation tools. Removing them would discard deployed functionality or evidence. |
| `tests/railway-start-command.test.cjs` | M | Retain deployed explicit capture configuration. Main changes worker defaults and conflicts between JSON/TOML. Future execution will use a reviewed service-specific command and exact checkpoint; no automatic generic worker switch. |
| `tests/scoped-source-reconciliation.test.cjs` | D | Preserve deployed-side reconciliation, checkpoint migration and validation tools. Removing them would discard deployed functionality or evidence. |
| `tests/test_authoritative_materialization_postgres.py` | D | Preserve deployed-side reconciliation, checkpoint migration and validation tools. Removing them would discard deployed functionality or evidence. |
| `tests/test_scoped_canonical_reconciliation.py` | M | Keep deployed UTC and authoritative-view checks. Main weakens these and reintroduces a lexical date boundary; historical constants are not used for this rollout. |
| `tools/mariadb-live/Dockerfile.shadow-capture` | M | Retain deployed explicit capture configuration. Main changes worker defaults and conflicts between JSON/TOML. Future execution will use a reviewed service-specific command and exact checkpoint; no automatic generic worker switch. |
| `tools/mariadb-live/audit_cohort_children_and_distribution.py` | D | Preserve deployed-side reconciliation, checkpoint migration and validation tools. Removing them would discard deployed functionality or evidence. |
| `tools/mariadb-live/audit_strict_nonpermissive_cohort.py` | D | Preserve deployed-side reconciliation, checkpoint migration and validation tools. Removing them would discard deployed functionality or evidence. |
| `tools/mariadb-live/authoritative-evidence-normalizer.cjs` | M | Reject permissive identity and bundle image inheritance regressions. Keep stricter deployed identity requirement and independent child lineage, superseded by content-bound v10 normalization. |
| `tools/mariadb-live/authoritative_cohort_census.py` | D | Preserve deployed-side reconciliation, checkpoint migration and validation tools. Removing them would discard deployed functionality or evidence. |
| `tools/mariadb-live/build_10k_cross_tab_analysis.py` | D | Preserve deployed-side reconciliation, checkpoint migration and validation tools. Removing them would discard deployed functionality or evidence. |
| `tools/mariadb-live/inspect_202b.py` | D | Preserve deployed-side reconciliation, checkpoint migration and validation tools. Removing them would discard deployed functionality or evidence. |
| `tools/mariadb-live/inspect_5_ref_mismatches.py` | D | Preserve deployed-side reconciliation, checkpoint migration and validation tools. Removing them would discard deployed functionality or evidence. |
| `tools/mariadb-live/inspect_strict_failures.py` | D | Preserve deployed-side reconciliation, checkpoint migration and validation tools. Removing them would discard deployed functionality or evidence. |
| `tools/mariadb-live/materialize_full_authoritative_cohort.py` | D | Preserve deployed-side reconciliation, checkpoint migration and validation tools. Removing them would discard deployed functionality or evidence. |
| `tools/mariadb-live/run-authoritative-10k-canary.cjs` | M | Keep historical deployed file. Main changes frozen boundary backward and changes cohort source; current rollout must derive its checkpoint from verified discovery instead of either historical constant. |
| `tools/mariadb-live/run-full-private-capture.cjs` | M | Keep deployed bounded readback chunks. Main removes chunking and can exceed PostgREST row limits. |
| `tools/mariadb-live/run-launch-preflight.cjs` | M | Keep stricter deployed manifest/error checks. Main reverts to older counts and removes manifest validation. Neither historical expected count is a current execution input. |
| `tools/mariadb-live/run-scoped-source-reconciliation.cjs` | D | Preserve deployed-side reconciliation, checkpoint migration and validation tools. Removing them would discard deployed functionality or evidence. |
| `tools/mariadb-live/run_10k_canary_direct.py` | D | Preserve deployed-side reconciliation, checkpoint migration and validation tools. Removing them would discard deployed functionality or evidence. |
| `tools/mariadb-live/run_10k_canary_from_file.cjs` | D | Preserve deployed-side reconciliation, checkpoint migration and validation tools. Removing them would discard deployed functionality or evidence. |
| `tools/mariadb-live/run_global_authoritative_reconciliation.py` | D | Preserve deployed-side reconciliation, checkpoint migration and validation tools. Removing them would discard deployed functionality or evidence. |
| `tools/mariadb-live/stratified_image_reachability_audit.py` | D | Preserve deployed-side reconciliation, checkpoint migration and validation tools. Removing them would discard deployed functionality or evidence. |
| `tools/mariadb-live/tls_select1_probe.cjs` | D | Preserve deployed-side reconciliation, checkpoint migration and validation tools. Removing them would discard deployed functionality or evidence. |
