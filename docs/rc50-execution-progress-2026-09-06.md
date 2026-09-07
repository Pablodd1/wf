# WatchFacts finalization execution checkpoint

Latest continuation: 2026-09-07 00:55 UTC. The owner supplied the source endpoint
and reaffirmed singles first, bundles/multi-listing posts later. The existing
account matches the requested host, port and user and authenticates with pinned
TLS. Credentials remain private and are not recorded in this document.

Read-only source discovery measured 1,527,889 current auction rows and zero
duplicate IDs. Supabase has 1,492,330 raw `auctions` versions but only 1,487,330
unique IDs: just five IDs outside the authoritative selection, not 5,005 new
inputs. Other scopes have 19 additional canary IDs; benchmark scopes contribute
no missing authoritative IDs. These observations do not reconcile the original
8,470-input difference. Source binary logging is disabled; listing change-log
access is denied to this account. Exception events contain classification flags,
not an original-row history. No grants or source rows were changed.

The newly inspected `thecollective.companies` table resolves all **7,744** company
IDs referenced by the authoritative captured rows. A private field-limited
snapshot preserves their names, status/verification flags, phone identities and
seven logo keys, excluding credentials and unrelated account fields. Snapshot
SHA-256: `e43a985789771dae837902ab5a4235bb98d3bdab1c7cbbaba338045a430f376d`.
All 1,487,325 authoritative rows were compared in 9,164 company/poster groups:

- 135,968 rows match a consistently verified, active source company's phone,
  across 365 companies, before shared-phone and per-row content verification.
- 1,327,491 have an exact phone match but unverified/conflicting source status.
- 22,416 have no matching source company; 1,045 have a poster/company phone
  mismatch; 405 reference inactive or restricted companies.
- 74 source companies have conflicting `is_verified` and `status` fields.

These are reconciliation candidates, not newly approved public dealers. A new
private reviewer binds company snapshot bytes and field hashes to the exact
listing source hash. It requires matching source company ID and poster phone,
holds phones shared between captured companies, and refuses conflicting or
unknown restrictions. It never turns company stars into reviews, infers contact
consent, or publishes a record. Its uniqueness check covers the captured company
snapshot; it is not a claim about every company in the source platform.

A deterministic real sample of 500 authoritative IDs was retained privately.
499 pass the reviewer; one fails `PROVENANCE_TEXT_MISMATCH`. Local v11
normalization produced 71 Trading Floor candidates (56 WTB and 15 WTS), 95 held
bundles and no immediately qualified USD WTS research candidates. Other records
remain held for missing intent/identity/text; FX and full research admission are
still required. Sample evidence hash:
`336f79313308baffc13aa1e658206dde883084e2771d4c6387059eed19e3aa1e`.
The four company-evidence regression tests and three terminal-checkpoint tests
pass. The final reviewer was rechecked against the saved real sample without
another production read. No source/private raw messages were sent to an LLM,
public preview or customer API. UI and production state remain unchanged.

The pending boundary decision is concrete: retain the original manifest and
unresolved discrepancy, then establish a new complete source snapshot for the
release, or recover the original August 29 state from a historical backup.
The current database credentials do not reconstruct that former state. A new
boundary would change the master's exact historical-completion requirement and
must not silently replace it. Other luxury category qualification, dealer
publication, forward migrations, real canary and final deployment remain
unfinished. Evidence: task-workspace `outputs/source-access-reconciliation.json`,
`supabase-source-id-reconciliation.json`, `company-poster-reconciliation.json`,
`real-dealer-listing-sample.json`, and `company-sample-final-validation.json`.

## Previous continuation — historical recovery discovery

Latest continuation: 2026-09-07 00:17 UTC. The owner confirmed proceeding from
the observed `a8245646` deployment and expanded scope to real luxury singles.
The prior deployment-identity hold below is resolved. Production read-only
discovery is now complete enough to establish a different release blocker:
the frozen historical source count cannot be reconciled from its terminal
checkpoint. No production database/source mutations or deployments were made.

The manifest hash `fd545df7a5668c28ede4f2c721a9539fcb6f7cf755302a975052b23270b8adb1`
was recomputed successfully. Its 2026-08-29 snapshot contains 1,495,803 inputs.
The committed capture accounts for 1,487,325 staged rows plus eight retained
errors, leaving **8,470 unexplained inputs**. Its cursor already equals the
frozen upper boundary. The same endpoint row now has source `created_on` and
`updated_on` of 2026-09-04 13:14:07; the manifest recorded 2026-08-29 14:42:32.
The current source contains 1,483,003 rows inside the old cursor boundary and
zero null cursor dates. CA and certificate pin checks pass; the actual source
engine is MySQL 5.7.42, session/system timezone UTC. This demonstrates mutable
cursor data, not proof of how every missing row was lost. The available
category recovery log does not contain original payloads or historical dates.
Do not reset the checkpoint, reduce the frozen count, or relabel it complete.
Master sections 12.9 and 14 require holding production writes until historical
recovery evidence resolves the discrepancy. Historical source backup/snapshot
or binlog access is required; source SQL access itself works.

The capture runner now checks signed checkpoint accounting before opening a
source connection. A terminal cursor with a short count fails immediately,
including a falsely finalized checkpoint. Corrupt counters, unsigned manifests,
invalid dates and a cursor past the boundary also fail. Sixteen focused tests
pass, including the measured 8,470-row case; applying the pure guard to the
captured production checkpoint reproduces the expected refusal without writes.
This is a prevention fix, not recovery of missing rows or proof that all
interior source rows stayed unchanged. No UI or migration files were changed.

Verified destination: Supabase `bptrvfncppbjnchsaxtb`, dashboard name `WFtest`,
Ai Dynamic Pro organization, Medium compute (4 GB RAM/two cores). Seven physical
daily backups are listed from August 31 through September 6; the latest is
2026-09-06 10:05:25 UTC. PITR is not enabled. No restore or add-on was requested.
The dashboard reports 76.70 GB used of 90 GB and 87% disk usage; these rounded
figures differ from PostgreSQL's byte units. Full-population storage growth,
runtime, and any autoscale cost remain to be qualified before writes. The
destination backups do not prove recovery of source rows never captured.

Production has 63 migration-ledger entries and later objects outside that
ledger, so it must receive reviewed missing-only forward changes. The existing
V2 publication table contains 500 records, including 67 bundles; this is not
proof of the requested real RC50 gate. The authoritative raw table and legacy
normalized proposal table each contain 1,487,325 records, but legacy eligibility
flags are not v11 qualification. The public dealer table is empty. Private
directory staging has 45 authenticated directory profiles and 1,580 company-ID
entries, all pending; only three profiles have both positive rating and review
count, and none has an avatar. Two unique normalized-phone matches were found
among 3,084 private identities; these are candidates, not verified consent or
public identity links. Existing 16,094 MATCH_READY lineage records also require
review before application. Preserve names, ratings and contact evidence without
promoting company IDs or ambiguous matches into invented dealers.

Pending: historical recovery/reconciliation, qualification of non-watch luxury
singles across the v11 watch-only pipeline, genuine dealer evidence and card
icons, reviewed forward production migrations and rollback, real 50 canary,
complete eligible population, final exact deployment and live verification.
Bundles remain held under the owner's current scope. Full-suite results below
belong to the previously tested application candidate; this continuation ran
the focused 16-test capture regression set, syntax checks and diff validation.
Sanitized operational evidence is retained in the task workspace under
`outputs/source-recovery-release-gate.json` and its referenced reports.

## Historical checkpoint — superseded by the continuation above

Latest continuation: 2026-09-06 23:33 UTC. Production writes are paused under
master section 12.9 because read-only discovery confirmed an unrecorded change
to the live deployment. Project `wf` now serves
`a8245646d857ea20ce7f2963db3f53dd8620b2a3`, deployment
`dpl_DMzZowwtMqnNgySNRL98DhXQ6kmu`, through `wf-ecru.vercel.app`.
Vercel records a production redeploy at 2026-09-06 19:55:14 UTC from
`codex/rc50-final-integration`; the public version endpoint independently
confirms that commit and production environment, with tree reported unknown.
The documented baseline was `b9c0145c2e153dd82c936b7b4e02361f1f3e5fd9`.
The observed deployment is an ancestor nine commits behind the tested candidate.
Its promotion actor and production database changes have not been established.
No production database was queried or mutated by this continuation.
`watchfacts-poc.vercel.app` is verified to belong to a different project,
`prj_VV6SU5XtuhMnQwRRd14SjDXI4HxL`, not the authorized `wf` project.

The last tested application candidate is
`c07d52fa792efee40b3747027bfaa31d7bdcc074`, tree
`960acf4f401e352c3a98f1e275cf194552e1a687`. Its exact disposable Vercel
preview passes loaded 50-card browser/API checks and all 19 source-image
HEAD/GET checks. Mobile pages 24/24/2 exactly equal the independently ordered
database oracle, with no missing/duplicate identities or horizontal overflow.
WTB filtering returns all ten demand records; exact reference search returns
the expected single record. The dated ECB converter and navigation language
switches work; some page copy remains English. Existing layout is preserved.
Approved directory counts reconcile three all/two rated/one name-search result.
Actual browser account login, settings persistence across full reload, logout,
and source-bound dealer activity at desktop/mobile widths pass.

Complete test runs ten and eleven each execute 2,212 tests: 2,106 pass,
102 fail, four skip. All 102 failure identities reproduce on the exact
deployed baseline; two baseline failures resolve. Full lint has 184 errors
against 189 on the completed baseline, with no new diagnostic identities.
The unchanged hidden agent harness omitted by the baseline export was restored
from exact Git bytes and independently linted; its two existing diagnostics
remain explicitly counted. TypeScript, API syntax, frontend routes and exact
disposable build pass. The tracked candidate scan covers 2,250 files without
unclassified secrets. These qualifications do not claim a green legacy suite.

Qualified historical replay remains 258 migrations on PG15 and PG18, using
six documented bootstrap supplements and four hash-bound historical overlays.
Inventories now contain 676 relations and 284 functions in each instance.
Actual 500-listing disposable publication and rollback restored the original
50 synthetic rows exactly. Cached 1.5m research summary is 0.191 seconds;
its owner preparation is 270.599 seconds. No real RC50 or full historical
population has been published by this continuation. Resume requires resolving
the changed production baseline, then current schema/checkpoint/worker/backup
discovery, reviewed forward migrations, real 50, full singles population and
exact final deployment. Bundles remain held under the latest owner scope.

Local evidence: `outputs/disposable-release-gate.json`,
`outputs/final-suite-reconciliation.json`, `outputs/final-lint-reconciliation.json`,
`outputs/production-metadata-readonly.json`,
`outputs/production-discrepancy-verification.json`, and the immutable raw test
logs remain in the task workspace. They are not copied into Git.

Latest continuation: 2026-09-06 22:56 UTC. Complete runs eight and nine on
`541a7081` each executed 2,208 tests: 2,102 pass, 102 fail, four skip. Their
failure identities are identical and every failure also occurs on the exact
deployed baseline; two baseline failures were resolved. The candidate was built
and deployed only to the disposable preview, with exact commit/tree readback.

Subsequent account acceptance found and corrected legacy-table activity reads
and the authentication helper's default production URL. V2 accounts now use
the same exact published dealer activity; unavailable years remain null.
Login/registration share the tested platform-aware client-address resolver,
their local counters have bounded storage, and forwarded host headers cannot
authorize cross-origin mutations. These local counters complement Supabase
Auth; only contact resolution currently has an application-level shared budget.
Malformed cookies remain unauthenticated. Logout clears both cookies and
revokes the real Supabase refresh session.

An actual synthetic Supabase account passed login, authorized V2 activity,
preference persistence/reload, forged-user-ID isolation, cross-origin denial
and refresh-session revocation. The account and its private credentials remain
only for the pending browser workflow check. Production remains untouched;
these latest account changes still require their final exact preview and full
suite verification.

Latest continuation: 2026-09-06 22:37 UTC. Qualified PG15/18 replay is now
258 migrations. Approved dealer profiles expose current exact published-single
activity through a service-only bounded RPC. Pages bind the dealer identity and
publication revision; stale/foreign cursors refuse, revoked identities remove
activity, and unknown dates remain null. Actual Supabase handlers and a rolled-
back three-row pagination transaction pass. UI styling remains unchanged; a
load-more control exposes the complete activity and the total is labeled as
published linked listings, never lifetime activity.

The previously missing 500-row report was produced by execution. A frozen job
retained 450 additional private synthetic raw rows, normalized and materialized
all 450, published them alongside the original 50, traversed all 500 API IDs in
database order and checked every required contract field. The consumer views
measured 500 Trading Floor rows, 474 research candidates and 499 poster groups.
The first test attempt incorrectly expected five requests instead of five full
pages plus the terminal empty read. Both attempts rolled back to the exact 50;
the successful retry reused the committed workflow instead of recapturing rows.
The report is local disposable evidence, not a production publication claim.

Dealer tests now exercise the approved RPC rather than removed static-directory
fallbacks; private historical evidence checks remain. Source phone/name matches
alone cannot supply public ratings. A legacy-adapter test now checks its actual
canonical source/text fields and explicitly denies V2/research eligibility;
its original 1,000-proposal requirement and 100-record sample remain. A missing
country filter in the legacy combined-feed branch was restored. Full-suite
reconciliation and exact preview deployment of these changes are next.

Latest continuation: 2026-09-06 22:12 UTC. PostgreSQL 15/18 replay 257
migrations with the historical qualifications below. The 1.5-million-row
admission retest completed correctly, but exposed a 390.444-second broad
summary request. A forward migration prepares and retains that summary during
owner publication: measured preparation 270.599 seconds, cached full-boundary
read 0.191 seconds, filtered 150-offer read 1.253 seconds. The separate admission
prewarm measured 479.487 seconds; these full-scale phases were measured
separately, not as one final combined transaction. Actual small publication,
rollback, privacy, admission and unknown-date cursor checks pass after the hook.

The external disposable browser now waits for actual loaded content: all 50
Trading Floor IDs match API order, and four exact-cohort research offers have
the expected prices and admission labels. Screenshots were inspected. This is
synthetic evidence on application commit `f111ed99`, not the final candidate.
The exact deployed baseline was also completed with its tracked fixtures and
rerun twice: 1,982 tests, 1,877 pass, 104 fail, one skip on each run. Those 104
failure identities are stable. The older integration run has 27 additional
failure identities, several corrected since; final reconciliation is pending.
No production database reads, mutations or deployments have occurred.

Latest continuation: 2026-09-06 21:27 UTC. Both disposable PostgreSQL versions
replay 256 migrations with the existing historical qualifications. The new
materialization workflow passes actual Supabase restart, competing completion,
image-probe enforcement, replay and complete nine-input outcome accounting.
No production reads or mutations occurred. The external disposable `f111ed99`
preview was reverified against the newer database: 50 Trading Floor, 22 unique
research WTS, 10 separate WTB, 19 HTTPS images and consented contact checks pass.
The first 1.5-million-row admission benchmark was stopped after its query plan
showed underestimated cardinality and repeated nested-loop scans. The failed
run and query plans are retained. A scoped planner correction passes PG15/18
and small actual snapshot tests; its full-volume retest remains running.

Latest checkpoint: 2026-09-06 20:58 UTC. PostgreSQL 15/18 now replay 253
migrations with the historical qualifications below. Source dates remain null
when unknown and pass the real cursor codec. Frozen Price Research admission
displays 22 of 24 synthetic WTS candidates, retaining one repost and one outlier
as private evidence; Trading Floor remains 50 and WTB demand remains 10.
Five real PostgREST page sizes, exact-cohort/broad counts, facets, rejected
excluded-member cursors, durable outcome retention and actual source/dealer/card
APIs pass. Atomic cohort finalization and rollback were retested successfully
with this admission path and restored the original 50 public fixtures exactly.
See `docs/frozen-price-research-admission-v2.md`. The external preview still runs
`f111ed99` application code; the newer disposable database changes are not a new
production release. Remaining full-scale admission performance, browser/test
acceptance, historical orchestration and gated production execution are pending.

This is an integration review candidate, not a production release. The owner
limited the rollout to singles; bundles and multi-listings remain held. The
existing card layout and styling are preserved. No production data mutation,
publication or deployment has occurred in this continuation.

The handoff commit `5a5b882bfb68fe44e3ba5bce7afd8b71fcf9fb20` and all 30 package
checksums passed verification. Existing RC50 integration was continued on the
deployed `b9c0145c2e153dd82c936b7b4e02361f1f3e5fd9` lineage without reapplication.
All 42 tree differences against main were reviewed; see the lineage report.

Validation executed:

- PostgreSQL 15.8 Supabase and PostgreSQL 18: all 229 migrations executed in
  order, with historical bytes preserved. Fresh 228-file replays were followed
  by the new approved-dealer migration on each database. Six explicit bootstrap
  supplements and four SHA-bound replay overlays repair historical incompatibilities.
  An untouched historical replay fails; these are compatibility replay results.
- Genuine local Supabase/Auth/Kong/PostgREST: 13 checks passed, including real
  JWT roles, auth.uid(), RLS/grants, schema profiles, frozen pagination/statistics,
  proposal persistence/hash binding, rejected backfill races, shared rate budget,
  approved dealer paging/counts, consent search and payload privacy.
- Local synthetic RC50 browser replay: 57 pass, zero failures. It uses an RPC
  shim and intercepted image requests, so it does not establish external success.
- Preview privacy/image/configuration/contact regressions: 21 pass. Disposable
  build passed. Changed-source lint has only the 16 existing TradingFloor errors.
- Latest full Node suite: 2,186 tests, 2,049 pass, 132 fail, 5 skipped. The earlier
  integration run had 117 failures; new dealer failures include retired static
  fallback/Top Rated contracts. Baseline has 124 failures and module-load gaps.
  Full failure reconciliation remains a release gate; no production pass is claimed.
- Follow-up raw-import/privacy checks: 17 pass. The raw-import failure was a
  transient Windows rename error and passed its focused rerun; the profile
  redaction marker now preserves the existing display contract.
- Exactly 50 synthetic singles were seeded in the disposable database, with an
  independent database ID oracle. No real listing has been represented by this count.

Public APIs no longer import private dealer crawl snapshots. Public static
assets use a reviewed allowlist; originals remain private. A separate security
commit removes tracked environment files and disables the legacy credential-bearing
extraction tools. Previously exposed Moonshot credential revocation remains unverified.

The owner explicitly approved the disposable key transfer. The isolated Vercel
project `wf-astra-disposable-20260906` (`prj_qBLBrF8XnDzs7FHQGRfesfmqAWtB`) now
has preview-only test configuration, with service-role credentials server-only.
External preview commit `fddb9e3b4e6741d229b15b67f9990fca9d592a60` passed real
Vercel-to-Supabase API traversal: 50 synthetic singles, 19 reachable synthetic
images, 24 priced WTS and 10 separate WTB records. The mobile browser displayed
all 50 identities in the independent SQL order without horizontal overflow.
These are synthetic checks, not the real production canary or a completed gate.

Browser follow-up repairs the missing dial selector, legacy metadata/detail
requests on the V2 lane, misleading unresolved-cohort and availability labels,
page-sized methodology totals, and duplicate/outlier inclusion labels. Two
additive migrations provide frozen dial options and bounded page membership
computed against the full exact cohort. Both apply on PG15/18 with service-only
grants; PG15 has 50 synthetic records and PG18 is empty. The real local Supabase
HTTP test proves six dial observations yield four included comparables, one
repost exclusion and one IQR exclusion, independent of page size. TypeScript,
changed PriceResearch/helper lint, and 35 targeted tests pass. External preview
`58bd6586fcb1505445e6d9973bb601956919a58c` verified the exact Blue/New picker flow,
$97,500 average from four comparables, two correctly labeled exclusions, and a
source detail dialog with no console errors.

Preview `e3bac6c3b54ab173ddf2b1bf11f223df745d0b9c` repeats the 50-ID mobile traversal
in exact SQL order, with page sizes 24/24/2, ten supported price ratings and no
false confirmed-availability claims or overflow. Desktop renders all 50 cards;
the image filter returns the exact 19 source-image records. The approved-profile
RPC applies on PG15/18 and passes real Supabase/API checks for consent, rating
nullability and hidden profiles. Three approved synthetic profiles appear in
the directory; the fourth unverified fixture is hidden. The approved profile
opens in Vercel without errors and exposes only its consented synthetic contact.
Four synthetic dealer fixtures are retained temporarily with exact cleanup IDs
in the task evidence. Listing linkage remains explicitly pending.

WTB source dialogs preserve canonical identity, original text and currency,
without inventing a posting date or falling back to legacy detail APIs. Final
label corrections distinguish buyer budgets from asking prices and WTB requests
from statistical outliers; the pending profile activity header also avoids a
zero count. These last label changes require deployment and browser confirmation.

The fourth full Node run records 2,195 tests, 2,058 passed, 132 failed, 5 skipped.
Two newly failing stale assertions (availability helper extraction and FX label
without currency evidence) have since been corrected and pass their focused run.
Remaining legacy/static/data-artifact failures are not claimed as passing.

The temporary HTTPS test transport permits reviewed read/snapshot/contact-budget
RPCs and synthetic images, and denies private ingestion/admin routes. It must be
stopped when validation ends. It is currently running. This is a local genuine
Supabase stack reached through HTTPS, not hosted Supabase and not an RPC shim.

Remaining: external preview/browser verification; regression reconciliation;
V2 dealer/contact linkage and approved profile publication; large-cohort snapshot
performance; production read-only discovery/rollback; a durable singles worker
from the verified checkpoint; real 50, full frozen-boundary reconciliation and
publication; exact final deployment and worker shutdown. Historical one-shot
scripts containing fixed old counts are not execution entry points.

Evidence checksums and private local log paths are recorded in the task workspace
`outputs/execution-progress-20260906.json`. This checkpoint never substitutes for
the owner's requested final live results.

Follow-up at 17:26 UTC: the sanitized review branch is preserved in draft PR
https://github.com/Pablodd1/wf/pull/813 against the verified deployed source
branch. No merge or production deployment was performed. The credential scan
at `9eca06b7` found no unclassified credentials; five test-only findings were
reviewed against the exact test-file checksum.

Preview `ca99e8ef742cba9747a14cf3df950c3bcd056a76` separates the V2 API switch
from `VITE_DISPOSABLE_PREVIEW`, which explicitly labels synthetic deployments.
Its desktop browser renders all 50 synthetic singles at 1440px without overflow
or false confirmed availability. Searching the source fixture matches the same
two IDs as independent SQL across the documented search fields. The currency
converter displays dated ECB rates (2026-09-04). WTB budget labels and pending
dealer activity were verified on the preceding application candidate.

Two additional forward migrations pass in both full-chain replay databases
(234 ledger entries, retaining the documented historical compatibility overlays).
The singles view now excludes bundle parents, children, and malformed child
markers. Six transactional test cases prove only the singleton reaches either
public view or a new snapshot; private source counts remain unchanged.

The separate PostgreSQL 18 scale database contains 1,500,000 synthetic singles.
This is a capacity fixture, not a claim about the current historical boundary.
Initial full payload materialization took 93.51 seconds for Trading Floor and
102.57 seconds for Price Research; total storage was approximately 7.49 GB before
the new indexes. Publication must prewarm both surfaces transactionally before
commit. Warm readers continue to use the preceding committed publication while
that work runs, instead of waiting on the publisher's revision lock.

Snapshot renewal now creates a new traversal identity over the same immutable
publication payload. It never revives an expired cursor. At 1.5 million rows,
renewal took 0.287 seconds with exactly 3,000,000 physical member rows before and
after, compared with a full copy per surface previously. Unfiltered frozen totals
fell from 21.336 to 0.301 seconds by using the stored count. Indexed exact-cohort
statistics fell from 6.373 to 0.362 seconds, with identical statistics; 20 repeated
cohort calls took 0.53 seconds. These timings include the local command overhead
and do not predict hosted production latency or storage capacity.

Real Supabase/API card, statistics, membership, and approved-profile checks pass
after the migration. The new two-connection renewal test proves stale-cursor
rejection, zero-copy renewal, safe pruning, and warm readers completing under two
seconds while a publisher holds the next revision. All publication test mutations
were rolled back. The scale database is isolated from the externally served
50-row disposable database and is retained only for validation.

Production discovery, durable listing-to-dealer linkage, historical population,
real RC50, complete outcome reconciliation, final deployment, and worker shutdown
remain pending. The scale result and draft PR are not a production release claim.

### Source-bound dealer validation, 2026-09-06 18:20 UTC

Four further forward migrations now pass in both disposable replay databases
(238 ledger entries, with the same documented historical overlays). The private
dealer linkage ledger binds the complete canonical source payload hash, original
message, verified phone identity and dealer ID. It performs no name matching,
automatic dealer verification or consent inference. Changed matches retain their
previous private state; missing or contradictory evidence receives an idempotent
review outcome. Original poster IDs and names remain unchanged, preserving the
existing duplicate/cohort grouping. Contact actions retain WTS versus WTB intent.

Two explicitly synthetic raw rows were added for existing A01/A02 fixtures, with
the original canonical rows backed up privately. Their source hashes now bind
the complete synthetic payload. Messages, poster identity, prices, image keys,
listing order and the 50-row total remain unchanged. Their exact dealer matches
prove a consenting 4.5/8 reviewed dealer and an unconsented dealer with two
feedback records and no numeric rating. These are test fixtures, not real watches.

Actual local HTTP through Supabase Kong/PostgREST passes all card, pagination,
cohort and contact checks. Bulk responses contain no private phone or source
payload. On-demand contact returns an opaque action and resolves the consented
synthetic destination with a manual redirect; no message is sent. Unconsented,
revoked, mismatched and content-tampered cases fail closed. Transactional tests
verify prior-state retention, idempotent review and exact role grants, then roll
back their adversarial mutations. Targeted security/contracts: 76 passing tests;
additional UI/privacy checks: 9 passing tests; TypeScript build passes.

Historical normalization and population, real production canary, final live
deployment and whole-boundary reconciliation remain unexecuted. The complete
test suite still has failures requiring explicit baseline/contract classification.
No production database discovery or mutation has occurred. The existing UI
layout and unrelated checkout changes remain preserved.

### Exact external candidate dff5c5cc, 2026-09-06 18:40 UTC

The disposable Vercel version endpoint verifies commit
`dff5c5cc50247b13229a584eeb496f41acb6e367` and tree
`afe55b0b2dd4d2df0de3eab715a406362bbee91a`. All 50 synthetic identities,
19 image HEAD/GET checks, 24 WTS and 10 separate WTB records pass over HTTPS.
Opaque consented contact redirects resolve correctly without contacting the
messaging service. Page sizes 1/7/12/49/50 return identical frozen payloads.
Desktop has 50 cards without overflow; mobile pages 24/24/2 match the independent
database order exactly. Original poster identity and actual 4.5/8 versus
count-only dealer feedback render correctly on cards. English/Spanish navigation
selection works. Redacted desktop and mobile source/dealer screenshots are retained.

The fifth complete test run has 2,196 tests: 2,060 pass, 131 fail, 5 skip. The one
new failure against the fourth run was an old exact WTB sentence assertion;
the current separate-demand wording passes after updating that assertion.
The remaining failures have not yet all been classified as release-blocking or
superseded. This is not a green full-suite or final browser acceptance claim.

Opening the Trading Floor detail exposed a legacy seller-summary request that
rejects V2 IDs, misleading contact wording, and replacement of the source poster
with the verified dealer's name. The current correction skips the legacy request
for V2, preserves the original poster in both detail surfaces, and labels the
approved dealer action accurately. Layout remains unchanged. TypeScript and 18
focused card/security/UI tests pass; these corrections still need exact-preview
browser retesting after this commit.

An inspected older proposal-writer definition was superseded by a later migration:
the composite writer already persists the full field set and supports no-op replay,
as earlier actual Supabase tests established. No speculative replacement was made.
The missing complete durable normalization/materialization/publication path and
production rollout remain the substantive next work.

### Durable private normalization, 2026-09-06 18:54 UTC

Migration `20260908070000_frozen_normalization_jobs.sql` passes on PostgreSQL
15 and 18 (239 replay ledger entries, same historical overlays). The new worker
freezes explicit checkpoint membership, uses bounded leases and retries, and
commits proposals, durable outcomes and counters atomically. It never publishes
or invokes capture. Usage and limits are in `docs/frozen-normalization-v2.md`.

The deterministic real Supabase test accounts for all nine synthetic inputs:
4 normalized, 2 review, 1 bundle held, 1 quarantine and 1 exhausted-retry error.
Disjoint concurrent claims, repeated claim/completion, changed replay rejection,
invalid proposal rollback, proposal hash readback and exact final counts pass.
The public 50-row cohort remains unchanged. Three nine-row test runs are retained
privately; the first test's readback assertion used PostgreSQL numeric strings
instead of its JSON projection and failed after processing completed. The corrected
JSON readback passes. No raw evidence was rewritten to make that assertion pass.

The exact `04a7d5e1` disposable preview also passes the corrected detail flow:
original poster preserved, opaque consented action, linked verified dealer
profile, and no failing API requests during that flow. Anonymous account access
is denied with HTTP 401; its existing page misleadingly kept displaying a loader.
A separate pending UI fix ends that loading state and supplies the sign-in link.
Production remains untouched, and materialization/publication/FX/image completion
and final release acceptance remain pending.
# 19:35 UTC — source-bound FX and image receipts

The disposable preview at commit `7dce8991cddfad7269d55f24213517d36ddb7322` passes the anonymous account guard: the profile editor stays hidden and the sign-in action opens the existing dealer login route. Production has not been read or changed.

Both disposable PostgreSQL 15 and PostgreSQL 18 now pass 241 recorded migration applications, with the previously documented historical replay supplements and overlays. New private receipt migrations preserve the retained ECB CSV and source image probe evidence. The reviewed FX client recomputes all 23 supported currency rates using one common observation date; currencies without a matching dated quote cannot be mixed into that snapshot. The actual ECB observation is 2026-09-04, evidence SHA-256 `f359945b45a41ff048b41a70f00f6d03639dc3cb0fb3c2bd73ee415801bc6dbc`.

Actual disposable Supabase tests prove exact FX receipt persistence, replay without insertion, changed-rate rejection, and independently computed PostgreSQL decimal conversion. Image testing performs real HTTPS HEAD and bounded GET requests against the explicitly synthetic image gateway. Receipt persistence rejects rehashed changes to image key, origin, and source hash; SQL and JavaScript path encoding agree, including Unicode and traversal rejection. No production image was probed. Five focused image tests also cover non-image bodies, network failure, bounded response consumption, and disposable-origin restrictions.

These receipts attest the reviewed capture client's checks; SQL does not perform external network requests or independently parse the ECB CSV. The source-to-canonical materialization/publication path, remaining disposable release checks, production discovery, real canary, and historical rollout remain pending. The existing 50 public fixtures are unchanged and remain synthetic.
# 19:56 UTC — private canonical pipeline and reversible publication

Actual disposable Supabase now proves immutable raw content → frozen normalization job → complete stored proposal → private canonical materialization with verified FX/image evidence → published consumer views → real HTTP API card fields. One additional synthetic listing was temporarily published for that integration test; rollback restored all original 50 public fixture rows exactly. Production remains untouched.

The first rollback test exposed an ambiguous PL/pgSQL result variable and an attempt to re-resolve dealer links after their listing exposure had been removed. Failure and recovery evidence was retained. Narrow forward migrations fix both causes; the final publication/API/isolation/replay/rollback test passes. Rollback now invalidates active pagination cursors and keeps removed dealer linkage as a durable private outcome. Both PostgreSQL 15 and 18 replay all 247 migrations with the historical replay qualifications already documented.

The normalizer now requires watch-category evidence; source brand/reference metadata cannot publish an explicit bag, jewelry item, accessory, or unknown category. Fourteen relevant normalization/category tests pass. Of 54 focused display/image/API contract tests, 53 pass; the remaining older test requires a missing historical 500-row report and only checks its count plus a constant field-name array. The actual new pipeline tests verify real stored and API field values and do not fabricate that report. The full test suite has not yet been rerun or declared green.
# 20:21 UTC — atomic historical cohort gate

The source-backed single materialization/publishing commit `f111ed99ab56c7918b94ad185cdcaf16747ffe34` is deployed only to the existing disposable Vercel project. Its exact version endpoint, 50 API identities, 19 HTTPS image probes, separate WTS/WTB results and consented contact redirect pass. Mobile pages contain 24/24/2 cards in the independent database order with no horizontal overflow or duplicate/missing IDs. All content remains explicitly synthetic.

The sixth full suite at that commit records 2,206 tests: 2,067 passed, 134 failed and 5 skipped. Two newly stale contact-label assertions were corrected in `02ca6e66528a0151ad6815e7fd7526d1bea9a613`; the 18 focused privacy/security tests pass. A Windows Edge smoke process timed out; real browser verification uses the independently recorded Chromium preview session. Remaining older failures still require explicit classification, and the full suite is not green.

Owner-only cohort publication now streams bounded writes, reconciles the actual final count, and prepares one snapshot pair per larger atomic cohort. A deferred database constraint refuses commit when finalization is omitted, including held-only inputs, or when a subsequent write invalidates the snapshots. The actual disposable cohort test passes replay, membership/count checks, zero intermediate snapshot copies, post-finalization mutation refusal, and partial/full rollback. The original 50 public fixtures are restored exactly; all private mutation and outcome evidence remains. PostgreSQL 15 and 18 each replay all 249 recorded migrations with the previously documented historical qualifications.

No production database discovery or mutation has occurred. Historical materialization orchestration, unique/repost admission, remaining test/browser acceptance and the gated real canary/full rollout remain pending.
