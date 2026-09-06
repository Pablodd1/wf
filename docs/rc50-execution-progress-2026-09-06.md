# WatchFacts finalization execution checkpoint

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
