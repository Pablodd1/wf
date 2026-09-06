# Astra: full-project finalization handoff

Updated 2026-09-06. This is a **review candidate, not a production release**.

Repository: https://github.com/Pablodd1/wf.git  
Transfer branch: `codex/astra-finalization-package`

Read this file, `CURRENT_EXECUTION_STATE.md`, `PRODUCT_ACCEPTANCE.md`,
`MASTER_EXECUTION_PROMPT.md`, and the repository's AGENTS.md plus its mandatory
handoffs completely. This file and CURRENT_EXECUTION_STATE supersede stale
bootstrap/status claims in the original master; its safety and release gates remain.

## What is already included

This is a **documentation-and-patch-only branch**, not an application checkout.
It contains the exact Kimi aggregate patch under `patches/`, its original
manifest, and the subsequently tested contact proxy/frozen-count file
replacements under `candidate-fixes/`. It contains no source archive,
legacy database exports, node_modules, full raw evidence, or source-history
ancestors. Its new root commit has zero parents.

Preserve this package locally, then use an isolated application worktree.
RC50 was independently replayed against
`442ea6e0431f768574e72d7a669f1c064881015d`; all 44 original file hashes matched
before follow-up fixes. Do not reapply it to the existing integration worktree,
where it is already applied. For a fresh verification worktree, apply the exact
patch to its exact base, verify the original 44 hashes, then review/copy the
`candidate-fixes/` files to their corresponding repository-relative paths.
These deliberately changed files will no longer match the original manifest.
Verify them against PACKAGE_SHA256SUMS.txt and review the delta instead.

This unrelated-history snapshot is for transfer/replay. Never merge it into
production using `--allow-unrelated-histories`, overwrite main, or force-push.
Use the verified deployed history as the actual release baseline and forward-port
the reviewed changes. Main's unique changes must also be assessed.

The original application root contained a hard-coded Moonshot API credential in
`public/index.html` and `public/extract.html`. Both standalone legacy tools
have inert replacements under `candidate-fixes/public/`. Replace these in
the application checkout before any build or execution. The package commit has
no parents so it does not carry that credential in its ancestors. Existing
remote history was not rewritten. **Credential revocation/rotation remains
an owner action; removing source text is not revocation.** Do not reintroduce
those tools or their built copies from any earlier archive/tree.

## The assignment, already decided

Finish the website and its data pipeline, not another planning document:
first prove and display 50 **real** eligible listings, then continue through
the entire verified frozen historical boundary, normalization, eligible
Supabase population, and the exact reviewed Vercel release. Singles first;
unresolved bundles later. Every source needs a durable reconciled outcome,
not necessarily a public listing. Do not invent missing information to reach
an attractive publication count.

The baseline decision is not an open question. Preserve the actual deployed
lineage after verifying its full SHA, and reconcile main. Ordinary fixes,
local tests, code review, safe forward migrations, and phased publication after
the required gates do not need repeated general approval.

The following still require a real stop: unavailable essential credentials or
artifacts, an unsafe production discrepancy, authorization for a new paid
resource, or irreversible destruction outside the approved protocol. Do not
disable security, alter MariaDB grants, weaken tests, or fabricate a pass to
avoid asking about a genuine blocker.

## First actions

1. Verify this branch's remote HEAD against the SHA in the owner's transfer
   message; inspect the clean tree and secret scan. Do not print secrets.
2. Check for the already-created local integration worktree listed in
   CURRENT_EXECUTION_STATE before creating a competing branch or worker.
   Preserve its uncommitted work and the owner's original dirty checkout.
3. Review the remaining blocker list. Run the smallest falsifying tests,
   correct root causes, then complete the full baseline/release comparison.
4. Prove real disposable Supabase/PostgREST and Vercel integration, not just
   the local SQL RPC shim. Do not rerun old canaries endlessly in place of
   closing the remaining blockers.
5. Follow master phases 12–17 for read-only production discovery, rollback,
   the real 50, the complete input boundary, bundles, final deployment,
   customer verification, and the final mutation/reconciliation report.

The archives are not committed because the transfer protocol keeps full
evidence archives local. Exact locations and checksums are recorded. If they
are unavailable on a different machine, ask for the two exact files instead
of searching entire disks or reconstructing evidence from prose. You can
inspect the supplied patch and prepare the existing candidate meanwhile; do not call that
a fresh archive-authenticity verification.

Completion requires live evidence and an exact deployed commit, not merely a
successful build, a pretty screenshot, a generated report, or this handoff.
