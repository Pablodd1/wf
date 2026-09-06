# Current execution state — 2026-09-06

## Observed versus historical

No production database writes, capture, normalization, publication, or
deployments were executed by this continuation. Production completeness
has **not** been verified. Historical migration counts must not be shown as
current live progress.

The source boundary historically reported was 1,495,803 inputs with manifest
`fd545df7a5668c28ede4f2c721a9539fcb6f7cf755302a975052b23270b8adb1`.
Read and validate the authoritative current checkpoint before deciding whether
any remaining capture exists. Do not restart capture just because old logs
showed 951,750 or 1,189,250.

## Verified repository/deployment identities

- GitHub: https://github.com/Pablodd1/wf.git
- Main: `f936270b1a2027c7e6a5e83cf3b2ff5f6fbb4649`.
- Deployed lineage: `b9c0145c2e153dd82c936b7b4e02361f1f3e5fd9`,
  branch `review/mariadb-source-census-hardening-v2`.
- Merge base: `8649fea4b1c80f295fd590e245edf6770fa77b07`.
- Main's unique commit is a squash (#810). The historical statement
  “114 deployed commits absent from main” is an ancestry count, **not proof
  that 114 commits' functionality is missing**. Compare actual tree differences.
- Vercel project observed: `wf`, `prj_2Cb6ZB6nfvs3dIJN3Uer9IAFVHZs`;
  scope `pablos-projects-0f79dff2`; configured production branch `main`.
- Its active production metadata reported deployment
  `dpl_E16ydLbEPAMaTzQiNT9Kchhurr9b` with the deployed-lineage SHA above.
- Deployment URL: https://wf-jr82sv2ac-pablos-projects-0f79dff2.vercel.app
- Observed aliases include https://wf-ecru.vercel.app and
  https://wf-pablos-projects-0f79dff2.vercel.app.
- **Unresolved identity check:** the user-facing URL
  https://watchfacts-poc.vercel.app has not been proven to belong to this same
  project/deployment. Verify alias ownership before production promotion.
- Historical Railway project: `17fe5ba8-5b46-4c32-a8b2-e2e26c92fa18`,
  services `wf-mariadb-shadow` and `wf-mariadb-canonical-normalizer`.
  Current replicas, commands, region and checkpoints were not measured here.

Refresh live metadata before deployment; these are observations, not locks.

## Local work already in progress

Original owner checkout (dirty, preserve unrelated edits):

`C:/Users/jasme/Documents/Codex/2026-07-25/gh-repo-clone-pablodd1-wf-clone`

Isolated integration worktree (created from deployed SHA):

`C:/Users/jasme/Documents/Codex/2026-09-05/wf-rc50-final-integration`  
Branch: `codex/rc50-final-integration`

At this checkpoint it contains uncommitted prerequisite + RC50 + targeted
fix changes; four tracked environment-file removals are staged. Do not reset,
discard, or stage everything blindly. Do not copy those environment files
back from deployed history, and do not publish deletion diffs that expose
secret contents. Review current-tree sanitization and rotation needs.

The GitHub branch `codex/astra-finalization-package` is a separate parentless
documentation/patch package, not an application checkout. It does not replace
the actual deployed-history integration branch. It carries the exact RC50
patch and the newly tested file replacements so another machine can
forward-port them without re-publishing legacy data exports or secret history.

## Artifacts and independent replay

Archives are present at:

`C:/Users/jasme/Documents/Codex/2026-07-25/gh-repo-clone-pablodd1-wf-clone/docs/handoffs/astra-finalization-2026-09-05/artifacts/`

Freshly verified extraction:

`C:/Users/jasme/Documents/Codex/2026-09-05/rc50-final-intake/code`  
`C:/Users/jasme/Documents/Codex/2026-09-05/rc50-final-intake/evidence`

Both outer archive hashes and inner patch/manifest hashes match
EXPECTED_SHA256SUMS.txt. On the new transfer worktree, all 44 original
manifest files matched byte-for-byte after CRLF-only normalization, before
applying the subsequent fixes. No .orig/reject files or archives belong
in the pushed changes.

Earlier independent full RC50 replay evidence is in:

`C:/Users/jasme/Documents/Codex/2026-09-05/files-mentioned-by-the-user-kimi/outputs/`

Its report states 111 targeted tests, TypeScript, build and local RC50
57 PASS / 0 FAIL / 1 NOT_RUN. This was synthetic, local PostgreSQL 18.4 with
an RPC shim, not genuine Supabase/PostgREST/Vercel and not production.

## New fixes actually executed in this continuation

1. Contact IP keying ignores X-Forwarded-For/X-Real-IP for direct requests.
   A single valid edge IP is accepted only in a Vercel preview/production
   runtime. IPv6 aliases normalize; unknown peers share a bucket; the map is
   capped at 10,000 active clients without evicting active counters.
   Six adversarial tests plus ten existing dealer/security tests: **16 pass**.
   100 spoofed headers on one socket produced 70 denied attempts after the
   first 30. Reference contract:
   https://vercel.com/docs/headers/request-headers
   This is still a per-process limiter. Multi-instance/cold-start protection
   and the deployed trusted-edge behavior remain unproven.
2. Forward migration `20260907130000_snapshot_counts_forward.sql` adds
   service-role-only counts over frozen payloads. Trading Floor, Price
   Research WTS and WTB evidence use them; missing/invalid/overflowing counts
   fail closed. API/contract/snapshot targeted command: **53 pass, 0 fail**.
3. `tools/canary-e2e/verify-snapshot-counts.cjs` created its own temporary,
   loopback-only PostgreSQL **18.4** instance, applied the ten canary migrations
   and seeded 67 synthetic rows. Twenty-one filtered count/page comparisons
   passed and remained frozen after another session committed insert/update/
   delete. New snapshots saw changes; wrong-surface/expired snapshots rejected;
   local anon/authenticated roles denied, service_role allowed.
   Source-table counts: 67 before / 67 after. The test instance was stopped.
   This is not the full repository migration chain or real JWT/RLS validation.

The redacted SQL report is committed under `evidence/`. File replacements
under `candidate-fixes/` carry these fixes. The above commands first ran in the isolated integration
worktree; see the transfer-verification artifact for subsequent transfer checks.

## Remaining release blockers (do not mark complete)

**New security finding during transfer scan:** the supposedly sanitized
`442ea6e...` root contains a hard-coded Moonshot API credential in
`public/index.html` (line 331 before replacement) and `public/extract.html`
(line 338 before replacement). It is sent as Authorization to the Moonshot
chat-completions endpoint. The transfer snapshot replaces both standalone
tools with inert notices and is published as a new parentless root, not as a
descendant of that secret-bearing root. Shared history is not rewritten.
No credential value is recorded here. Owner revocation/rotation and assessment
of earlier published builds remain required; no provider API was contacted.
Earlier zero-findings claims were incomplete: scanning API code alone was
insufficient. The transfer scan includes static HTML and test fixtures.

1. Content-bound provenance: current contract validates structure/hash format,
   not all content-to-hash relationships. The prior adversarial replay accepted
   changed source text with an unchanged hash. Fix raw canonicalization,
   proposal/materialized bindings and fixed-ID verification; never expose raw
   payloads to the browser merely to verify them.
2. Snapshot scalability: snapshot-open currently copies an entire surface's
   payloads. Prove an affordable immutable publication-revision/reuse strategy
   before full-million-row rollout; per-request full copies are not acceptable.
3. Price Research totals now freeze, but statistics/facets/breakdown still use
   live RPCs. Define and test their temporal contract with frozen evidence.
4. Multi-instance rate limiting, contact consent/linkage, and actual Vercel
   trusted-proxy behavior need a production-like disposable test.
5. The prerequisite snapshot edits already-existing August migration files.
   Preserve deployed migration history and move required operational changes
   into forward migrations; clean-db bootstrap compatibility is a separate
   concern. Do not blindly apply all historical files to an existing database.
6. Reconcile main versus deployed actual trees. Keep safe worker isolation.
   Observed conflicts include default capture vs shadow commands, a main
   railway.toml test script, identity-review semantics and capture readback
   batching. None is approved for blind wholesale replacement.
7. The unconditional production-reference build guard can block a legitimate
   production build. Scope isolation guards to disposable validation without
   weakening their refusal guarantees. Review direct-PostgREST rewriting in
   api/_lib/supabase.js, stable 503 configuration failures and error redaction.
8. Full test-suite baseline/final comparison twice, lint classification,
   PostgreSQL 15 execution, **complete** migration-chain execution, genuine
   disposable Supabase/PostgREST/JWT/RLS, and external Vercel/browser gates.
   Earlier claims about 219 migrations are not independently proven by the
   nine/ten-canary-migration tests.
9. Production alias mapping, read-only schema/worker/checkpoint discovery,
   rollback rehearsal, real 50, full-source reconciliation, singles, bundles,
   dealer linkage and final live deployment remain.

WSL Ubuntu works with an escalation; PostgreSQL 16 is installed, and an
existing embedded PostgreSQL 18.4 dependency is available in the prior
`work/verification-linux` directory. Docker/Podman were not found by the
initial path check. Supabase paid-project creation was not authorized or
submitted. Prefer a local genuine stack if practical; request approval for
new billable infrastructure instead of silently subscribing.

No deadline or self-review wording waives these gates. Continue safe local
work independently while diagnosing bounded external blockers.
