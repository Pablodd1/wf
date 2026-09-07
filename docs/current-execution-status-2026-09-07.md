# WatchFacts saved execution status

Checkpoint: 2026-09-07T21:35:34.749162+00:00. Full project completion is not claimed.

## Live site and saved release

- Trading Floor: https://wf-ecru.vercel.app/#/trading
- Price Research: https://wf-ecru.vercel.app/#/price-research
- Verified live application commit: `ff7ec7dd4f70ae669b1d8e08ca8053952e9eba8c`.
- Deployment: `dpl_39M2N2sohpc9bmFZynG5cwAZEQov`, existing project `wf`.
- Work branch: `codex/rc50-final-integration`; draft PR https://github.com/Pablodd1/wf/pull/813.
- Application rollback: `dpl_uQi4CCDwTuiU2MsWLQPve2iftd5M` / `a77c5f54a0860f90c179e6db2c3a15264a421fc3`.
- Documentation commits after the live application do not constitute a new deployment.

## Exact checkpoint totals

| Stage | Count | Meaning |
|---|---:|---|
| Frozen source boundary | 1,527,898 | Complete raw snapshot durably sealed in Supabase |
| Normalization processed | 1,527,898 | Complete; independently audited with zero unexplained remainder |
| Preliminary single candidates | 104,160 | Still subject to materialization/source-identity/publication checks |
| Normalization review | 923,888 | Durable review outcomes; no guessed publication |
| Bundle-held | 499,842 | Deferred under owner scope |
| Quarantine | 8 | PROVENANCE_LOSSLESS_REVIEW_REQUIRED; raw evidence preserved |
| Normalization errors | 0 | No error outcomes |
| Full materialization processed | 1,075,500 | Of 1,527,898; 452,398 remain |
| Live Trading Floor | 61,715 | Public API total verified 2026-09-07T21:33:37.521Z |
| Live Price Research | 1,457 | Qualified unique priced WTS; separate from WTB demand |

These are different stages and must not be added together. Candidate counts are not promised final publication counts. Source messages, bundles and eligible singles are not interchangeable measures.

## Card and release verification

The existing UI layout is preserved. Desktop 50-card and mobile 24-card checks passed: source messages matched the API, displayed image URLs matched the original listing, real source images rendered, and no horizontal overflow or API failures occurred. No images were generated. Price Research's selected-reference image display passed.

The complete current Price Research snapshot passed at 21:26:54 UTC: 1,457 rows across 15 pages, 1,448 source images, every row with verified USD, every row WTS, zero missing/duplicate IDs, and all 52 card fields compared with the frozen database snapshot. A larger full Trading Floor snapshot audit remains in progress. Its earlier attempt lost an unused idle read-only database connection; the audit now closes that connection after loading its frozen oracle.

Sixty-six reviewed forward migrations are applied. Actual disposable PostgreSQL 15/18 and Supabase/PostgREST tests cover the relevant forward migrations, provenance, snapshot membership, rollback and publication gates. The repository-wide suite has documented pre-existing failures; no claim that the entire suite is green is made.

Only source-backed fields are populated. Missing dates, identity facts, supported currency conversions, dealer reviews and comparable-cohort price ratings stay unavailable. Price Research excludes unsupported currencies, WTB, duplicates and unqualified/outlier offers. The raw source remains immutable; public source text follows the contact-redaction boundary.

## Dealer scope and acknowledged incident

The owner acknowledged the contact incident; never ask for that same acknowledgment again. Subsequent fresh public API, HTML and desktop/mobile DOM verification confirmed the opaque correction on live commit `ff7ec7dd4f70ae669b1d8e08ca8053952e9eba8c`. See `dealer-contact-incident-status-2026-09-07.md` for scope and receipts.

Latest instruction: defer dealer/user work and contact-card enhancements. Import stopped at 3,075 database-confirmed poster identities; 128 planned identities remain unimported. Existing-link reconciliation stopped after its local checkpoint of 15,000 of 44,682 links. A final in-flight link transaction may require read-only reconciliation when that work resumes; do not equate the local offset with an independently audited link total. No dealer workers remain authorized to restart automatically. Existing consent state and opaque contact behavior remain preserved.

## Display interruption and recovery

Partial dealer-link reconciliation advanced the publication revision without rebuilding each corresponding snapshot. This caused first-page snapshot creation to exceed the public request timeout and also contended with the publisher. Dealer work is now stopped. The reviewed snapshot functions rebuilt both surfaces under one locked revision, with no changes to listing count, raw rows or dealers. Receipt: `restored-current-publication-snapshots.json`; both live APIs subsequently returned successfully. Any future dealer-link batch must preserve the same atomic revision/snapshot publication gate before that deferred work resumes.

## Storage and remaining work

Latest materialization capacity reading: 107.22 GB of database data, against 135 GB provisioned storage. This is disk usage, not RAM. The storage review found large legacy workbook tables/indexes; four non-unique index candidates total approximately 4.96 GB but require dependency, usage and rollback verification before deletion. No Supabase data, table, index or image has been deleted.

Remaining active work: finish full-boundary materialization; publish every eligible remaining single; finish full Trading Floor and final Price Research snapshot/API/browser reconciliation; reconcile published/review/bundle/duplicate/quarantine/error totals; retain exact final deployment and rollback evidence; then shut down owned workers. Bundles and dealer work remain deferred. Unsupported other-luxury categories remain in durable review and must not be described as published.

At save time the owned materializer and publisher were running, along with a read-only Trading Floor audit. They checkpoint locally and in Supabase. A laptop restart will stop local processes; resume from the durable database state, verify owned advisory-lock holders and exact live release, and never launch duplicate workers. Do not restart paused dealer helpers.

## Saved evidence

Frozen receipt directory: `saved-checkpoint-20260907T213534Z` under the local task's outputs directory, with CHECKSUMS.json. Execution helper archive: `execution-helpers-20260907T213534Z.zip` under the local private work directory. Raw capture, credentials, contact evidence and rollback files remain local/private and are not committed to GitHub. Application code and this public status document are saved on the isolated branch. Unrelated user edits and historical audit-file changes remain unstaged.
