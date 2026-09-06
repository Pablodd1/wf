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

External preview is pending. Automatic approval review twice rejected placing
the Supabase CLI demo anon/service-role keys in isolated Vercel project
`wf-astra-disposable-20260906` (`prj_qBLBrF8XnDzs7FHQGRfesfmqAWtB`), including after
verification of their public local-development signatures and synthetic-only
data. No transfer was performed. Explicit user approval is required.

The temporary HTTPS test transport permits reviewed read/snapshot/contact-budget
RPCs and synthetic images, and denies private ingestion/admin routes. It must be
stopped while paused and recreated after authorization. This is a local genuine
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
