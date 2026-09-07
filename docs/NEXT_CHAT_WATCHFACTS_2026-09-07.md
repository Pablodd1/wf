# WatchFacts continuation — authoritative September 7, 2026, 21:55 UTC checkpoint

Read this first. It supersedes older checkpoint statements where they conflict. The owner requests uninterrupted completion of Trading Floor, Price Research, supported watch models, filter menus and display ordering. Full completion is NOT claimed.

## Scope and standing authorization

- Continue publishing every eligible, source-backed single listing to Trading Floor. Include WTS/WTB and priced/unpriced singles according to the established eligibility rules.
- Price Research admits qualified unique priced WTS with supported USD/FX evidence and exact comparable-cohort ratings. Preserve excluded prices and reasons. Never infer currency, listing facts, dates, identities or reviews.
- Validate all supported brands/models/references and filter options against the real published population. Make uncatalogued references searchable without inventing model names. Check filter combinations, reset, pagination, counts, selection races and desktop/mobile behavior.
- Preserve the existing frontend layout. Correct missing/broken API card fields and functional filter/order behavior without redesigning the UI. Retain immutable snapshot membership, totals and the documented five-field default ordering: priced rank, image rank, USD descending, source timestamp descending, listing ID ascending. Validate Discovery mix separately as an ordering mode, without changing eligibility or totals. Do not silently change sort precedence based on an older conflicting document.
- Original listing image URLs only. NO image generation, replacement stock images or bundle-image inheritance. Preserve private raw messages unchanged; public excerpts retain required contact redaction.
- Dealer/user work and contact-card enhancements are DEFERRED. Do not restart dealer import or link reconciliation. Do not expand consent. Preserve the existing opaque contact behavior.
- The owner has already acknowledged the dealer-contact incident. Do not ask again or repeatedly report its unchanged history. The corrective live implementation was verified after the older incident report; see the incident status document and fresh receipts. New security findings still require appropriate corrective action, but do not restart unrelated dealer work.
- Bundles and multilistings remain deferred. Unsupported other-luxury categories have durable review outcomes; do not claim they are already published.
- Existing production rollout and reviewed merges are authorized. No new paid resources, destructive cleanup or consent expansion. Supabase cleanup remains read-only evaluation.
- Ask only for a specific genuinely missing artifact/access, new paid-resource decision, unsafe production discrepancy or destructive action outside scope. Do not seek another general approval.

## Paths and identity

- Repository: https://github.com/Pablodd1/wf
- Existing integration worktree: `C:/Users/jasme/Documents/Codex/2026-09-05/wf-rc50-final-integration`
- Task workspace with durable helpers and evidence: `C:/Users/jasme/Documents/Codex/2026-09-05/files-mentioned-by-the-user-kimi`
- Separate history reconciliation worktree: `C:/Users/jasme/Documents/Codex/2026-09-05/wf-main-merge-review`, branch `codex/main-lineage-reconciliation-20260907`.
- Preserve unrelated checkout and edits at `C:/Users/jasme/Documents/Codex/2026-07-25/gh-repo-clone-pablodd1-wf-clone`.
- Existing integration worktree has seven historical audit/migration modifications and untracked disposable audit output. They were not staged. Do not overwrite or indiscriminately stage them.
- Read AGENTS.md and the handoff it references. The explicit production/fix authorization supersedes its older Phase 1-only restriction.

## Merges already performed and still pending

- PR #813 was MERGED into `review/mariadb-source-census-hardening-v2` at 21:53 UTC. Merge commit: `a9846af3216a898771730c5e567f53f00dde8a1c`.
- PR #811 goes from that review branch into `main`. Its history conflicts were corrected in `cf41c6ecbe551ef51bbb15fd23b7c17a7054a676`, pushed to the review branch. GitHub now reports MERGEABLE; new checks were running at this checkpoint. It is NOT yet merged into main.
- Reconciliation used the existing reviewed 42-file decision ledger: main `f936270b1a2027c7e6a5e83cf3b2ff5f6fbb4649` contains older/superseded changes relative to deployed baseline `b9c0145c2e153dd82c936b7b4e02361f1f3e5fd9`. All 42 decisions retain the stricter deployed/integrated versions and raw evidence. Main and the deployed lineage share ancestor `8649fea4b1c80f295fd590e245edf6770fa77b07`; unrelated histories were not merged.
- The history reconciliation preserves the exact tree before/after: `6e2fe83898cfda49348667cf8b2bdb70ad3f9175`, zero content changes. Receipts: `outputs/main-lineage-reconciliation.json` and `outputs/main-conflict-reconciliation-20260907.json`.
- The existing integration worktree was fast-forwarded through `cf41c6ec`; worker code remains unchanged. Later documentation commits may follow it; inspect actual local and remote heads.
- Vercel project `wf` has production branch `main` and automatic production domain assignment enabled. Therefore merging #811 triggers a production deployment. Complete exact candidate/release gates first; do not bypass them just because GitHub says MERGEABLE. User authorization to merge already exists when the gates pass.
- PR #232 is an older conflicting theme change; do not merge it into this frozen-UI assignment.

## Live production and rollback

- Live: https://wf-ecru.vercel.app/#/trading and https://wf-ecru.vercel.app/#/price-research
- Verified live commit: `ff7ec7dd4f70ae669b1d8e08ca8053952e9eba8c`.
- Deployment: `dpl_39M2N2sohpc9bmFZynG5cwAZEQov`; exact URL https://wf-ox9mpaukm-pablos-projects-0f79dff2.vercel.app
- Correct Vercel project: `wf`, ID `prj_2Cb6ZB6nfvs3dIJN3Uer9IAFVHZs`, scope `pablos-projects-0f79dff2`.
- IMPORTANT: the repository's existing `.vercel/project.json` points to the unrelated `watchfacts-poc` project. Use explicit project identity and the reviewed exact-source export flow. Do not accidentally deploy via that link.
- Rollback deployment: `dpl_uQi4CCDwTuiU2MsWLQPve2iftd5M`, commit `a77c5f54a0860f90c179e6db2c3a15264a421fc3`.
- Supabase project: `bptrvfncppbjnchsaxtb`; 66 reviewed forward migrations applied. Source capture is already complete; do not restart a historical capture or reapply RC50.

## Data progress and completed verification

- Frozen source: 1,527,898 inputs, all durably sealed in Supabase. Manifest SHA-256 `de3e2387d31e82dc87bad68d0c3128de010e13c86aee58567b0f0ce00803a426`.
- Normalization COMPLETE and independently audited: 104,160 preliminary singles; 923,888 review; 499,842 bundle-held; eight provenance quarantines; zero errors; no unexplained remainder.
- At 21:54 UTC, materialization had processed 1,213,500/1,527,898 inputs, with zero error outcomes. Read the latest checkpoint for current numbers.
- Live APIs at 21:54:37 UTC: 66,591 Trading Floor listings and 1,533 Price Research listings. These are different stages from source normalization totals.
- FULL Trading Floor snapshot audit PASS at 21:51:45 UTC: 66,591 rows across 666 pages; all 52 card fields checked; 66,191 source images; 2,197 supported USD prices; 7,985 WTS and 58,606 WTB; zero duplicate/missing IDs. Receipt: `outputs/live-trading-floor-snapshot-66591.json`.
- Last full Price Research audit PASS: 1,457 rows across 15 pages at 21:26:54 UTC. Newer 1,533 total needs a new final audit after rollout.
- Desktop 50-card/mobile 24-card source-message and original-image checks pass on live ff7ec7dd. Price Research selected-reference image display also passes. Receipt: `outputs/live-listing-cards-browser.json`.
- Actual disposable PostgreSQL 15/18 and Supabase/PostgREST tests cover the forward migrations and release invariants. Repository-wide baseline tests still have documented failures; do not claim an entirely green full suite.
- Database storage was approximately 107.5 GB against 135 GB provisioned. Capacity guards stop at 110 GiB. Nothing was deleted. Four legacy non-unique index candidates total approximately 4.96 GB but are not approved for blind deletion.

## Active workers and safe resumption

At this checkpoint these owned Windows Node processes were active:

- PID 10068: `work/run_production_frozen_materialization.cjs`, advisory lock `(724051,9013)`.
- PID 23456: `work/run_production_verified_singles_stream.cjs`, advisory lock `(724051,9014)`.

Verify actual command lines and durable database state before starting anything. Do not start duplicate workers. Both use `WF_AUTHORIZED_PRODUCTION_WRITE=bptrvfncppbjnchsaxtb`; private credentials are read from local ignored files through `work/production_writer_client.cjs`. Never print or commit credentials. PostgreSQL CA verification stays enabled. Source remains read-only.

The publisher prepares 5,000-input cohorts and atomically stages them in 500-input chunks, then finalizes both publication snapshots. A cohort can take several minutes with no new public count until its commit. Inspect progress and database activity before assuming a hang. Individual errors retain durable checkpoints; bounded recovery must inspect actual state rather than blindly restart.

Supavisor can retain an advisory lock after abrupt laptop/process loss. Only terminate an exact owned stale idle/no-transaction holder after verifying its lock, PID, backend start, query timestamp and absence of the local worker. Do not terminate generic Supabase sessions.

Dealer import is paused after 3,075 committed identities; 128 remain unimported. Link reconciliation stopped at a local 15,000/44,682 checkpoint. Guards: `outputs/dealer-consent-expansion-paused.json` and `outputs/dealer-work-deferred.json`. Never run the generic resume helper without checking it would not restart forbidden or already completed workers.

An earlier partial dealer-link batch changed the publication revision without prewarming snapshots, causing first-page timeouts and publisher lock contention. Dealer work was stopped. `work/restore_current_publication_snapshots.cjs` restored both surfaces under one revision lock, without changing listings/dealers/raw rows; subsequent full API audits passed. Do not repeat the deferred batch pattern. Future dealer work needs atomic revision/snapshot handling before resumption.

## Continue in this order

1. Verify repo heads, live version, actual workers and latest compact progress. Keep existing healthy workers running.
2. Finish the full materialization boundary and every eligible single publication. Do not stop at 50 or at a prepared batch.
3. Run `work/verify_final_frozen_reconciliation.cjs` after materialization is complete. It is prepared, syntax-checked and NOT yet executed; review it before use. It checks source-to-materialization hashes/outcomes in 5,000-row read-only batches.
4. Run final all-page Trading Floor and Price Research audits with `WF_EXPECTED_APP_COMMIT` set to the actual verified live commit. `work/verify_live_trading_floor_snapshot.cjs` now uses an indexed ID oracle plus at-most-100 payload reads per page; the earlier full-payload sort timed out. Do not restore that unbounded oracle query.
5. Complete focused all-brand/model/reference, filter-menu, sorting, counts and desktop/mobile UI-card checks. Fix root causes while preserving layout and source evidence; verify actual product behavior, not just API totals.
6. Reconcile final published/review/bundle/duplicate/quarantine/error outcomes back to all 1,527,898 inputs, with priced research as a separately explained subset. Missing/unsupported facts stay review/null.
7. Complete pending PR #811 checks and exact application candidate/release validation, then perform the already-authorized main merge and exact live verification without bypassing automatic deployment gates. Do not merge unrelated theme changes.
8. Save final deployment, mutation and rollback evidence; shut down owned workers only when their work and final checks are complete. Report completion only with verified live outcomes and the exact deployed commit.

Helper/evidence roots are local `work/`, `work/.private/`, and `outputs/`. Main progress file: `outputs/execution-progress-20260906.json`. Read relevant latest receipts instead of relying on older numerical summaries. Keep this handoff current and preserve failed attempts as evidence.
