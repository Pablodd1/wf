# Applying this package safely

The GitHub branch is documentation/patches only. Never deploy it or merge its
unrelated root into main. No environment values, full archives, legacy data
exports or secret-bearing ancestor commits are included.

1. Preserve this directory outside your application checkout. Verify the
   owner-supplied branch SHA and PACKAGE_SHA256SUMS.txt.
2. Read START_HERE.md, CURRENT_EXECUTION_STATE.md, PRODUCT_ACCEPTANCE.md and
   MASTER_EXECUTION_PROMPT.md. Read application AGENTS.md and linked handoffs.
3. On this owner's machine, inspect the existing isolated integration
   worktree before doing new work. It already has RC50 and the targeted fixes.
   Preserve unrelated changes and compare before overwriting anything.
4. On a fresh machine, create separate disposable verification and
   deployed-history integration worktrees. The original RC50 patch is based
   on 442ea6e0431f768574e72d7a669f1c064881015d. That historical tree has known
   unsafe static pages: do not build or execute it unchanged.
5. In the exact-base verification worktree, run git apply --check on
   patches/rc50-complete.patch, apply it once, and verify the 44 original
   file hashes from patches/rc50-original-manifest.json. Normalize CRLF only
   when doing so produces the exact expected hash; never rewrite arbitrary
   discrepancies to make a checksum pass.
6. Inspect candidate-fixes/ before executing anything. It mirrors relative
   application paths. Copy each reviewed file onto that path in the
   verification checkout (not onto newer integration code blindly). It
   contains the tested contact/snapshot fixes, their tests/SQL runner and
   inert replacements for the two credential-bearing legacy HTML files.
   Verify these replacements against PACKAGE_SHA256SUMS.txt.
7. Scan the complete resulting application tree, including public HTML,
   config, fixtures, binary/export locations and build outputs. The package's
   clean scan is not a certification of earlier application trees.
8. Run clean install, targeted regression tests, typecheck and build. Complete
   the master baseline and real disposable environment gates. The database
   runner accepts only a newly created loopback database, not a production URL.
9. Forward-port reviewed changes onto the independently verified deployed
   lineage. Account for newer main changes and earlier migration edits.
   No unrelated-history merge, force-push or ad-hoc production SQL.
10. Continue with real 50, full reconciliation/population and the final website
    only after those release gates pass.

Targeted follow-up tests (69 tests at assembly):

```text
node --test tests/contact-trusted-proxy.test.cjs tests/dealer-contact-security.test.cjs tests/snapshot-count.test.cjs tests/canary-api-contracts.test.cjs tests/canary-keyset-snapshot.test.cjs tests/contract-surface-separation.test.cjs
```

New database regression runner:

```text
node tools/canary-e2e/verify-snapshot-counts.cjs <local-redacted-report-path>
```

Use a supported disposable Linux embedded-PostgreSQL runtime. On the owner's
WSL host an existing dependency directory can be supplied through
RC50_TEST_DEPENDENCY_ROOT; this selects local npm dependencies only, never a
database endpoint. Run PG15 and PG18 separately and report actual versions.

The previous full-suite failures and external Supabase/Vercel blockers remain
open. A targeted-test pass is not approval for production mutation.
