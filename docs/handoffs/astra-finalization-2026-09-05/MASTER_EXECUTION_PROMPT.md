# WatchFacts RC50 to Full Live Population — GPT-6 Astra Master Execution Prompt

> Continuation update (2026-09-06): first read START_HERE.md,
> CURRENT_EXECUTION_STATE.md and PRODUCT_ACCEPTANCE.md in this directory.
> They supersede stale bootstrap/status statements below. This transfer branch
> is a documentation/patch package, not a deployable app. RC50 is already
> applied in the saved integration worktree; do not apply it there again.
> All production safety/verification gates below remain mandatory.

Copy everything below into a new Codex task using GPT-6 Astra. Attach the two Kimi archives to that task before execution.

---

Act as the sole senior integration lead, database engineer, release engineer, security reviewer, and QA owner for WatchFacts / Curated Luxury. Your responsibility is to take the verified RC50 work through safe integration, a real 50-listing live canary, complete eligible single-listing normalization, Supabase population, and final Vercel deployment. Continue through the phases without repeatedly asking for routine decisions. Correct your own implementation when a gate fails. Stop only for a genuine external-access blocker, missing required artifact, unsafe production discrepancy, or an action that requires authority not granted here.

This is an execution assignment, not a planning-only assignment. However, passing a gate is mandatory before moving to the next phase. Never describe an unexecuted test as passed.

The user explicitly authorizes continuation beyond RC50 through the complete historical source boundary and live release when the documented gates pass. RC50 is only the first production canary. Do not stop for another general CTO review after RC50, do not stop after preparing migrations, and do not treat a successful 50-row display as project completion. Continue capture, normalization, reconciliation, materialization, publication, deployment, and verification until the entire frozen input boundary has a durable outcome and the live website uses the completed consumer contract. Ask the user only when an essential artifact or credential is unavailable, an external service remains inaccessible after bounded diagnosis, production differs materially from the reviewed model, or an irreversible destructive action falls outside this prompt.

“The whole database is normalized and deployed” has a precise evidence-first meaning: every source row is processed and reconciled, every supported fact is normalized with lineage, every eligible listing is exposed to its correct customer surface, and every ambiguous/conflicting/unsafe row is retained in a durable review or quarantine state with a reason. It does not authorize publishing guesses, contacts, unsafe bundles, or unresolved prices merely to make the public count equal the raw count. The final report must reconcile the public, held, review, duplicate, bundle, quarantine, and error populations back to the complete frozen source total with no unexplained remainder.

## 1. Final product outcome

Deliver the following outcome:

1. A controlled set of exactly 50 real, source-backed, eligible listings is displayed live first as the release canary.
2. Those listings render correctly through the complete path: immutable source evidence -> normalized proposal -> reviewed/materialized record -> stable Supabase consumer view/RPC -> API -> ListingDisplayContract -> React UI.
3. Trading Floor displays every customer-eligible single listing, including eligible WTS and WTB records and eligible unpriced listings. Missing facts remain null and render truthfully.
4. Price Research receives only qualified, unique, source-backed priced WTS listings. WTB is never mixed into WTS price statistics.
5. After the 50-listing canary passes, continue in checkpointed, idempotent batches until every currently captured eligible single listing is processed and all safe consumer tables/views are populated.
6. Determine the live raw-capture checkpoint read-only. If the historical capture is incomplete, resume it safely from its exact committed checkpoint only after proving worker isolation and source connectivity. Once capture finishes, normalize the remainder and expand publication until the complete frozen source boundary is reconciled.
7. Handle bundles after the single-listing population by default. A bundle child may be admitted earlier only if deterministic segmentation and complete parent/line/source lineage are already proven. Unresolved bundle parents and children remain held for review.
8. Deploy the exact reviewed commit through Supabase and Vercel, verify the live application on desktop and mobile, and leave a reversible rollback path.

“Complete” means 100% of the frozen input boundary is reconciled into one of: eligible/published, review-required/held, duplicate/suppressed with evidence, bundle-held, or losslessly errored. It does not mean inventing values or auto-approving every raw message.

## 2. Repository instructions and evidence standard

Repository: `https://github.com/Pablodd1/wf.git`

Read completely before acting:

1. `AGENTS.md`
2. `docs/EXTERNAL_AI_ASSISTANCE_HANDOFF_2026-07-22.md`
3. `docs/RESET_HANDOFF_AND_CLIENT_EXECUTIVE_SUMMARY_2026-07-18.md`
4. Any newer normalization, migration, shadow-promotion, Railway, RC50, and release documents introduced by the patch

Follow the newest verified evidence when dated documents conflict. Treat all historical counts in handoffs as non-authoritative until measured again.

For every material finding record severity, classification, file/line or database object, current behavior, evidence, data/customer impact, recommended correction, regression coverage, and deployment/rollback risk.

## 3. Non-negotiable data rules

- Preserve immutable raw messages and source hashes unchanged.
- Never send the historical raw archive through an LLM.
- Never assume bare `$` means USD.
- Never infer currency, price, date, condition, intent, dealer, dial, reference, image, or multiplier from geography, phone number, market value, catalog, or price magnitude.
- Missing, ambiguous, or conflicting facts are SQL/JSON null with an explicit review reason. Never use the string `[NULL]`.
- Catalog or online evidence may validate identity/configuration only; it cannot create or overwrite listing price, currency, date, condition, intent, seller, or media lineage.
- Preserve original amount/currency plus USD conversion, FX source, rate, and rate date when conversion is eligible.
- Keep WTS and WTB separate throughout normalization, publication, statistics, and UI.
- Preserve outliers as evidence; flag/exclude them from aggregates according to the reviewed policy instead of deleting them.
- Do not create display facts such as “Watch Listing,” “Anonymous Seller,” invented profile URLs, inferred dealer ratings, or guessed images. Store null and render a truthful label.
- Every normalized record must retain source message ID, immutable source hash, source cursor/date, context block or line, parser version, decision evidence, media lineage, and publication/review status.
- Do not expose raw contacts, private payloads, service-role credentials, internal evidence URLs, or private dealer-directory URLs in customer APIs, HTML, logs, screenshots, Git, or reports.

## 4. Authorized sanitized base

Safe history-free verification branch:

- Branch: `review/kimi-handoff-history-free-v2`
- Root commit: `442ea6e0431f768574e72d7a669f1c064881015d`
- Tree: `6e50fd01d42d11442be26ff7957b0535ba758d32`
- Required commit count: `1`
- Required parent count: `0`

This base removed a hard-coded Supabase anon-key fallback. Missing Supabase configuration now fails closed with HTTP 503 and has regression coverage. Never reintroduce a literal JWT or credential fallback.

Antigravity independently fetched this remote branch and verified the exact commit and tree. It did not find the Kimi archives anywhere on the Windows or WSL filesystems. Do not repeat broad filesystem searches.

The history-free root is a verification base, not automatically a mergeable production branch. Do not force-push it over `main` and do not merge unrelated histories blindly.

## 5. Required Kimi archive intake

The user must attach these two files to this task:

- `rc50-code-handoff.tar.gz`
- `rc50-evidence-handoff.tar.gz`

Expected archive hashes:

- `rc50-code-handoff.tar.gz` SHA-256: `5c5d7738e5bad3ce6f9160bfe7c46a9fbad347904485dd186d28e8e5f79aef00`
- `rc50-evidence-handoff.tar.gz` SHA-256: `6ebece12a793bfa9fbf02fa62600e68d70b2d45cd652ec11a125b7482bd69113`

Expected inner hashes:

- `rc50-complete.patch` SHA-256: `0f6e95e7a65661dd26ae8d78d5a60783fe5da81ec077f5f272d9e2cb0f0376dc`
- `manifest.json` SHA-256: `729ba89570f229114d92e6b5862a0d8838511eae110093fb070def2c4d80ce60`

Latest transfer report from the prior agent:

- Code archive reported at `outputs/rc50-code-handoff.tar.gz`.
- Evidence archive reported at `outputs/rc50-evidence-handoff.tar.gz`.
- Locally calculated hashes reported at `outputs/SHA256SUMS.txt`.
- Intake notes reported at `outputs/RC50-intake-report.md`.
- Both archives were reportedly extracted, the inner patch/manifest checks passed, and no patch was applied.
- The prior report incorrectly said sender-supplied outer checksums were unavailable. They are supplied above. Independently hash the two archive files and compare them with the exact Kimi values above. Do not trust the earlier extraction until both outer hashes match. If they match, repeat safe extraction into a fresh temporary directory and continue. If either differs, stop before applying anything and report the actual/expected pair.

Reported package contents and replay result:

- Aggregate patch: 44 files, 9,088 insertions, 144 deletions; 24 modified and 20 new.
- New files reportedly include eight migrations, seven test files, four tools, and contract/E2E additions.
- Clean replay on the exact safe base: `git apply --check` passed; `npm ci` passed; 111 targeted tests passed; build and TypeScript passed; RC50 runner returned 57 PASS / 0 FAIL / 1 NOT_RUN; secret scan returned zero findings.
- The one honest NOT_RUN was external Vercel preview validation because Kimi had no disposable Vercel access.

Intake procedure:

1. If either archive is not attached, stop immediately and request the two attachments. Do not reconstruct them from prose, Git history, or screenshots.
2. Compute both outer SHA-256 values before extraction. Stop on any mismatch.
3. List archive members without extracting. Refuse absolute paths, `..` traversal, links escaping the destination, device files, or unexpected executables.
4. Extract into a newly created temporary directory outside the repository.
5. Verify `SHA256SUMS`, `manifest.json`, every manifest member, the aggregate patch hash, file counts, and exclusions.
6. Scan extracted content for credentials, non-example `.env` files, JWT literals in executable source, database URLs containing passwords, Vercel bypass/OIDC tokens, private keys, contacts, raw payloads, and production exports. Test fixtures containing synthetic refusal strings must be clearly classified rather than mistaken for credentials.
7. Do not execute any extracted program until inspection and the secret gate pass.
8. Keep full evidence archives local. Commit only intentionally redacted evidence suitable for Git.

## 6. Git and integration protocol

Latest verified integration status:

- RC50 replay has now passed the outer archive hashes, all 44 manifest file hashes, 111 targeted tests, TypeScript, production build, and local E2E with 57 PASS / 0 FAIL.
- Production was unchanged by that replay.
- The currently deployed Vercel lineage reports a deployed commit beginning `b9c0145`, while current `main` begins `f936270`.
- The histories diverge and 114 deployed-side commits were reported absent from `main`.
- The release-baseline decision is already made: preserve the currently deployed history as the release baseline after resolving and verifying its full SHA from the active Vercel deployment. Preserve `main` and reconcile its unique changes as well. Do not ask the user to choose again.
- Content-bound provenance, trusted-proxy/rate-limiting, and frozen snapshot-total correctness remain unresolved release blockers and must be fixed before production promotion.

1. Clone/fetch the repository without changing `main`.
2. Verify the safe branch commit, tree, history count, and clean worktree exactly.
3. Create a temporary verification branch from `442ea6e...` and run `git apply --check` followed by application of the aggregate patch.
4. Verify that the resulting tree matches the manifest’s expected file set and that no `.orig`, rejected hunks, generated caches, dependencies, database files, archives, screenshots with sensitive content, or secrets entered the tree.
5. Independently replay the reported targeted tests and RC50 validation on this verification branch.
6. Fetch the current actual production integration base. Resolve the full `b9c0145...` SHA from the active Vercel deployment, identify its source branch, verify its commit/tree locally, and record its relationship to `origin/main`. Never rely on the abbreviated SHA alone.
7. Create `codex/rc50-final-integration` from the verified currently deployed commit. Use that deployed lineage as the release baseline.
8. Forward-port the reviewed aggregate changes onto that branch. Do not merge the history-free root with `--allow-unrelated-histories`. Preserve newer safe production changes and resolve every conflict through code/contract review.
9. Compare every commit/change unique to `main` with the deployed baseline. Bring forward applicable fixes deliberately, resolve overlapping changes explicitly, and document any intentionally deferred main-only work. Do not reset, force-push, delete, or casually merge either history.
10. Scan the current tree for tracked non-example `.env` files and real secrets. If the current production tree contains a credential, prevent deployment, remove it from the current tree in a separate reviewable security commit, and document required rotation. Do not rewrite shared history without separate explicit authorization.
11. Commit coherent units: security/contract, forward migrations, API/data access, UI, tests/evidence. Push only the sanitized review branch and open a PR against the verified production source branch. Never push archives, raw evidence, contacts, credentials, embedded database data, `node_modules`, browser caches, or generated local output.

## 7. Independently reproduce the baseline and resolve known discrepancies

The earlier reproducible baseline reportedly ran twice with:

- 2,066 tests total
- 1,937 passed
- 126 failed
- 3 skipped
- zero flaky by failure-name comparison
- lint had substantial pre-existing failures

The RC50 tree was later reported with different full-suite totals, approximately 1,986 passed and 170 failed, while also claiming no new deterministic failures by allowlist. This discrepancy is unresolved and must not be waved away.

On both the unpatched current integration base and the fully integrated branch:

1. Perform a clean dependency install using the committed lockfile.
2. Run the repository’s exact complete test command twice.
3. Run the exact typecheck command, lint, API syntax verification, frontend route verification, and production build.
4. Save machine-readable test-name/status output and compare by stable test identity, not just totals.
5. Explain added, removed, renamed, newly passing, and newly failing tests.
6. Fix every deterministic regression caused by the integration. Do not hide failures by deleting tests, weakening assertions, expanding an allowlist, or changing expected totals.
7. Distinguish pre-existing failures from release regressions. Do not spend the release rewriting unrelated legacy lint unless a failure blocks compilation, security, or this release path.

## 8. Mandatory technical blockers to close

Before any production data mutation, independently verify or correct all of the following:

### Provenance

- Recompute provenance hashes from canonical serialized content at every hop. A 64-character regex check is insufficient.
- For fixed redacted source IDs, prove immutable raw row/hash -> normalized proposal -> materialized/canary record -> consumer view/RPC -> API response.
- Compare every populated contract field and fail closed on mismatch.
- Do not print raw payloads or contacts in provenance artifacts.

### Pagination and snapshots

- Use genuine database composite keyset pagination with exactly: `priced_rank ASC`, `image_rank ASC`, `price_usd DESC NULLS LAST`, `source_created_at DESC`, `listing_id ASC`.
- Cursor carries all five sort values plus an immutable snapshot/version identifier.
- Invalid, forged, stale, or inconsistent cursors return HTTP 400; never silently restart.
- Database RPC and API apply identical explicit ordering; do not rely on ordering embedded in a view.
- Freeze both membership and payload required for an open traversal. Concurrent insert, update, delete, or a new snapshot must not create duplicates, omissions, or changed records within that traversal.
- Return a frozen `snapshot_total`, not a live count that drifts during pagination.
- Prove page sizes 1, 7, 12, 49, and 50 exhaust the same oracle identities exactly once.

### Price Research statistics

- Compute aggregates in PostgreSQL/RPC. Never download the complete cohort into JavaScript or browser memory.
- Cohorts require normalized brand plus exact reference/model, dial, and condition where applicable.
- Include only qualified unique WTS offers with source-backed USD or reviewed FX, repost deduplication, plausibility filters, and reviewed 3.0x IQR policy. WTB remains separate.
- Return `stats=null` for unresolved cohorts.
- Validate `q1 <= median <= q3`, `iqr ~= q3-q1`, lower fence `~= max(0,q1-3*iqr)`, upper fence `~= q3+3*iqr`, lower <= upper, and multiplier exactly 3.0. Fail closed on inconsistency.
- Market price ratings must use only the matching cohort and must never manufacture a rating when evidence is insufficient.

### Database safety

- Use forward-only, dependency-preserving migrations. No `DROP ... CASCADE` promotion strategy.
- Audit dependent views/functions/policies/grants before changes.
- Pin `search_path` safely for SECURITY DEFINER functions, use least privilege, and verify function ownership.
- Validate duplicate source IDs across partitions: identical evidence deduplicates losslessly; conflicts quarantine rather than merge; singletons remain unchanged.
- Test migrations on both PostgreSQL 15 and PostgreSQL 18 disposable instances. Do not claim PG15 compatibility unless it actually executes there.
- Validate real Supabase/PostgREST schema exposure, `Accept-Profile`/`Content-Profile`, JWT roles, `auth.uid()`, managed extensions, RLS policies, grants, and Vercel-to-Supabase calls in a disposable Supabase environment. Local `SET ROLE` simulation alone is insufficient.

### API/security

- Missing required Supabase configuration returns a stable 503 without leaking environment details or stack traces.
- Customer endpoints expose only approved display fields. Full raw evidence remains protected/admin-only; customer message excerpts must be redacted for contacts and sensitive metadata.
- Rate limiting must not blindly trust `X-Forwarded-For`. Use the platform’s trusted proxy contract or a server-controlled identifier and test spoofed header behavior.
- No customer response, DOM, source map, log, or error may include service credentials, raw contacts, private payloads, internal directory URLs, or protected provenance content.

### Images

- Resolve only source-backed image keys using the canonical path contract, including the reviewed DigitalOcean Spaces candidate path where applicable.
- Test GET as well as HEAD because object stores/CDNs may handle them differently.
- Exact source/listing lineage and URL reachability are required. Filename similarity, brand/model proximity, catalog image, or visual resemblance is not enough.
- Use a truthful placeholder when no verified listing image exists.

## 9. Customer display contract

Each listing card/API item should support the following when source-backed, otherwise null/truthful fallback:

- public listing identity (not an internal sensitive identifier)
- brand
- model
- reference
- dial/color
- condition
- WTS or WTB intent
- original asking amount and currency
- verified USD amount plus FX provenance when converted
- observed/source date
- sanitized source-message excerpt
- verified source image URL or placeholder
- approved dealer display name
- approved dealer rating/review counts where evidence exists
- publication/review status appropriate to the audience
- exact Price Research cohort/rating when eligible

Do not show “Anonymous Seller,” “Watch Listing,” invented dealer pages, generated review scores, or invented market facts.

Dealer/reference behavior:

- The complete approved dealer population appears under All Dealers.
- Rated Dealers is a filtered subset ordered from strongest source-backed rating downward.
- Do not maintain a contradictory “Top Rated Dealers” tab unless product requirements explicitly reintroduce it.
- Search is responsive/autosearch and counts reconcile: rated cannot exceed all unless the labels genuinely represent different documented universes.
- Legacy XLSX/JSON dealer directories are private reconciliation evidence only. Match them to authenticated/source identities before publication. Never expose their private URLs.
- A WhatsApp contact action may appear only for an authorized, source-backed dealer contact with consent. Avoid exposing the phone number in bulk APIs/DOM. Prefill a minimal message identifying the selected watch/reference and the user’s inquiry; do not inject unredacted raw payloads or unrelated personal data.
- Privacy, data-analysis consent, retention, security, deletion/contact, and terms surfaces must exist and be legally reviewable. Do not fabricate legal compliance claims; mark copy requiring counsel review.

Preserve already requested UI refinements where they remain applicable: truthful live/preview labeling, functional language switching, responsive desktop/mobile layout, working filters and sort order, no obsolete explanatory helper text, and functional navigation/footer links. Do not let cosmetic work delay data-integrity gates.

## 10. Bundle policy

Singles come first. For bundle or multi-listing records:

1. Preserve immutable raw parent.
2. Segment exact child source lines/context without creating facts.
3. Validate each child’s identity, dial, condition, intent, price, currency, image, and seller inheritance separately.
4. Preserve parent ID, child ID, line/context index, parser version, source hash, and decision evidence.
5. Admit a child only when all required publication evidence passes.
6. Do not assign one parent price or image to every child without exact evidence.
7. Suppress a bundle parent from customer/Price Research views only after accepted children exist and reconciliation proves nothing was lost.
8. Run duplicate/repost suppression after bundle splitting, not before.
9. Leave unresolved bundles in a protected review queue. Do not block safe singles while the bundle phase continues.

## 11. Disposable end-to-end release gate

Before production:

1. Create disposable PostgreSQL 15 and 18 environments and a genuine disposable Supabase/PostgREST project/stack.
2. Apply the complete actual migration chain in order to clean databases. Record each migration checksum and final object inventory.
3. Seed only synthetic/redacted RC50 fixtures. Do not copy production contacts or payloads.
4. Re-run migration dependency, duplicate partition, provenance, RLS/grant, keyset/snapshot concurrency, image contract, statistics, API, and privacy tests.
5. Deploy the exact integration commit to a disposable Vercel project with production-like feature flags but disposable endpoints.
6. Verify `/api/canary/version` or equivalent returns the exact commit SHA and contract version.
7. Use a real browser to test Trading Floor, Price Research, Reference Check, authentication guards, filters, pagination, search, dealer actions, responsive views, and console/network errors.
8. Verify the 50 browser identities and ordering against an independent database oracle.
9. Capture redacted screenshots at desktop and mobile sizes.
10. Relabel synthetic content clearly as preview/test data; never call synthetic fixtures live market data.

If disposable Supabase or Vercel access is unavailable, report `BLOCKED_EXTERNAL_ACCESS`. Do not substitute localhost and claim the external gate passed.

## 12. Production read-only discovery and rollback preparation

Only after the disposable gate passes:

1. Identify the exact Supabase, Vercel, and Railway production projects through configured project metadata without printing secrets.
2. Verify production deployment branch and current exact Git SHA.
3. Read current schema objects, migrations, table/view/RPC/policy definitions, row counts, dependencies, grants, and feature flags.
4. Read the raw-capture and normalization checkpoints. Historical observations such as 951,750 or 1,189,250 of 1,495,803 are not current truth.
5. Verify Railway service source, Dockerfile, effective start command, region, restart policy, configured/running replicas, and last deployment state for capture and normalization independently.
6. Establish before counts and checksums without exporting raw contacts or payloads.
7. Confirm managed backup/PITR availability and create an explicit rollback runbook. Prefer stable versioned tables/views and feature flags so rollback is a view/flag reversal, not destructive restoration.
8. Confirm migrations are forward-only, transactional where safe, dependency-preserving, and bounded for locks/runtime.
9. If the live state differs materially from the reviewed assumptions, stop before writes and report the exact discrepancy.

## 13. Real 50-listing production canary

The local Kimi RC50 was synthetic validation. Never publish those fixtures as real listings.

For the live canary:

1. Select exactly 50 real records deterministically from already captured immutable source evidence.
2. Prefer the reviewed mix when enough eligible evidence exists: priced WTS with and without images, evidenced WTB, unpriced WTB, and unpriced WTS with and without images. Never lower evidence standards merely to satisfy a category count.
3. Exclude unresolved bundle parents. Controlled bundle children may be included only under the bundle policy.
4. Normalize into private/versioned proposal tables first.
5. Recompute content-bound provenance and independently compare fixed redacted IDs through every hop.
6. Materialize idempotently. A rerun must insert zero new records and report identical/changed/conflicted counts truthfully.
7. Expose the canary through a stable V2 consumer view/RPC with a reversible feature flag; do not overwrite legacy consumers blindly.
8. Apply only reviewed forward migrations, then deploy the exact Vercel commit.
9. Verify the live 50 through HTTPS APIs and real browser sessions at desktop and mobile widths. Test every visible card field, sorting/filtering, pagination, images, Price Research links/cohorts, dealer/reference behavior, WhatsApp consent flow, language selection, network failures, auth guards, and console errors.
10. Keep the canary live only if database oracle, API identities, browser identities, totals, provenance, and privacy all match. Otherwise disable the flag/repoint the stable view and roll back without deleting evidence.

## 14. Complete capture, normalization, and population

After the real 50 passes:

### Raw capture

- If the frozen historical source boundary is already fully staged and reconciled, do not rerun capture.
- If incomplete, resume the read-only MariaDB capture from the exact committed keyset checkpoint. Do not restart from zero or modify the source.
- Do not change MariaDB grants. If Railway is rejected, prefer the previously authorized execution environment and diagnose password-versus-host restriction without exposing secrets.
- Capture uses a dedicated service/start command and cannot invoke normalization. Normalization uses a separate dedicated worker and cannot invoke capture.
- Verify checkpoint totals after every batch: newly staged + identical + lossless errors = input rows.
- Preserve source manifest boundary/hash and stop on cursor regression, changed source identity, or unreconciled count.

### Single-listing normalization

- Consume only committed immutable staged rows, using an explicit frozen upper boundary/checkpoint.
- Process in bounded resumable batches with leases, retry limits, idempotency keys, and progress metrics.
- Begin with singles. Route ambiguous intent/currency/identity/image/condition to review rather than guessing.
- Materialize proposals into versioned private canonical tables, validate them, then expose eligible rows through stable consumer views/RPCs.
- Every eligible listing goes to Trading Floor.
- Only qualified priced WTS records enter Price Research/statistical cohorts.
- Unpriced eligible listings remain on Trading Floor and do not contaminate price statistics.
- WTB remains visible/analytically separate and never contributes to WTS price distribution.
- Reposts/duplicates retain evidence and are suppressed according to reviewed deterministic rules.
- Expand publication in bounded cohorts. For each cohort record before/after counts, inserted, identical, changed, conflicted, held, and error totals. Exact reconciliation is mandatory.
- Run API/database/browser sampling after each early cohort and at increasing intervals once stable.

### Bundles

- After singles and the remaining capture boundary reconcile, process bundles in a distinct checkpointed phase.
- Reuse already proven controlled children without duplicating them.
- Keep unresolved children/parents held for human review and report their counts; do not manufacture completion.

### Completion

- Continue until the frozen source boundary and every normalization checkpoint reconcile fully.
- Scale one-shot capture/normalization services back to the intended stopped/zero-running state after completion. Verify configured and running replicas plus final deployment status through live platform JSON.
- Do not leave accidental workers running, crashed services presented as stopped, or normalization pointed at capture commands.

## 15. Final production deployment and verification

1. Ensure the review PR contains only sanitized reviewed changes and has passing required checks.
2. Merge using the repository’s normal review mechanism; never force-push `main`.
3. Apply production Supabase migrations using the reviewed migration mechanism and exact commit. Record migration IDs and before/after object/count checks.
4. Deploy the exact merged commit to Vercel production and verify commit identity from the live version endpoint.
5. Confirm production environment variables are present by name/fingerprint only; never print values.
6. Verify Trading Floor, Price Research, Reference Check, login/account guards, language selection, responsive behavior, images, contact consent flow, errors, and API pagination through the production URL.
7. Verify 50-canary continuity and the expanded final population against database oracles.
8. Confirm no synthetic preview banner/data remains in the live customer dataset; truthful labels may remain where appropriate.
9. Confirm no secret, contact, private payload, internal URL, or stack trace is exposed.
10. Keep rollback available until post-deployment checks and counts stabilize.

Production promotion is authorized by this assignment only when every preceding release gate passes. If a gate fails, do not partially improvise around it: preserve state, roll back the reversible exposure when necessary, fix safely in the review branch, retest, and retry. Stop and request user action only for missing credentials/artifacts, inaccessible external services after bounded retries, an unsafe production-state discrepancy, or an irreversible/destructive operation outside this protocol.

## 16. Self-review discipline

At the end of every phase:

1. Compare actual results with this prompt’s acceptance criteria.
2. Review your own diff for invented facts, privacy leaks, unsafe SQL, pagination/statistics mistakes, and test weakening.
3. Run the smallest tests that can disprove the change.
4. When stable, run the complete relevant gate once.
5. If a test fails, find and correct the root cause; do not merely report the symptom.
6. Do not repeat an identical failed external command more than twice. Change the method or report the external blocker.
7. Keep concise progress updates with exact completed phase, current evidence, and next action.

## 17. Required final report

Return a single durable release report understandable by both the CTO and a non-developer owner. Include:

- final outcome and whether production is genuinely complete;
- safe base, integration branch, PR, merge commit, deployed commit, migration IDs, Supabase project identity, Railway services, Vercel deployment ID and live URLs;
- archive, patch, manifest, migration, and relevant artifact checksums;
- clean-tree and secret-scan proof;
- baseline-versus-final test reconciliation, exact commands, totals, and remaining pre-existing failures;
- PostgreSQL 15/18 and disposable Supabase/PostgREST results;
- disposable and production browser results with redacted screenshot paths;
- raw capture frozen boundary, checkpoint, staged/identical/error reconciliation, and final status;
- normalized totals by eligible, published, review-required, error, intent, currency status, image status, duplicate/repost status, bundle parent, bundle child, and dealer linkage;
- Trading Floor total, Price Research qualified total, WTB total, and exact reason they differ;
- 50-canary composition and independent database/API/browser identity reconciliation;
- price cohort/IQR verification;
- provenance assertions without contacts or payloads;
- dealer/reference and WhatsApp privacy/consent verification;
- mutation ledger with before/after counts for every production write;
- rollback procedure and whether it was exercised in disposable validation;
- honest remaining limitations and human-review queues;
- explicit confirmation that raw source evidence was preserved and no missing fact was invented.

Do not end with a plan. End only with the executed outcome, or a precise external blocker containing the last safely completed checkpoint and the one user action required.
