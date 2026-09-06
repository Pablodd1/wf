# WatchFacts full-finalization handoff

This directory is the transfer package for the GPT-6 Astra task that will integrate the verified RC50 work, validate the complete stack, publish the first 50 real listings, then continue through the full frozen source boundary and live release.

## Start here

**2026-09-06 update:** Read [START_HERE.md](START_HERE.md) first. The transfer
branch `codex/astra-finalization-package` contains documentation, the exact
RC50 patch and subsequent file replacements, not a deployable app. Do not
reapply RC50 to the existing integration worktree. Read
[CURRENT_EXECUTION_STATE.md](CURRENT_EXECUTION_STATE.md) for current evidence
and unresolved gates, and [PRODUCT_ACCEPTANCE.md](PRODUCT_ACCEPTANCE.md) for
the full customer requirements. Older availability/status text below is historical.

1. Open this GitHub transfer branch in the new Astra task and read the complete handoff directory.
2. Place the two Kimi archives in `artifacts/` using their exact filenames.
3. Confirm their SHA-256 values against `EXPECTED_SHA256SUMS.txt` before extraction.
4. Send the exact text in `LAUNCH_MESSAGE.txt`.

## Required repository identity

- GitHub: `https://github.com/Pablodd1/wf.git`
- Production site: `https://watchfacts-poc.vercel.app`
- Sanitized replay branch: `review/kimi-handoff-history-free-v2`
- Sanitized replay commit: `442ea6e0431f768574e72d7a669f1c064881015d`
- Sanitized replay tree: `6e50fd01d42d11442be26ff7957b0535ba758d32`

The sanitized root is a verification base. It is not the production integration baseline and must not be merged using unrelated-history shortcuts.

## Latest verified state

- RC50 archive replay passed both archive checksums, all 44 manifest file hashes, 111 targeted tests, TypeScript, production build, and local E2E with 57 PASS / 0 FAIL.
- Production was unchanged by the replay.
- Vercel currently deploys from a lineage whose live commit begins `b9c0145`.
- Current `main` begins `f936270`; 114 deployed-side commits were reported absent from `main`.
- The release baseline decision is to preserve the exact currently deployed commit after resolving its full SHA from Vercel, then reconcile useful `main` changes deliberately.
- Content-bound provenance, trusted-proxy rate limiting, and frozen snapshot totals remain release blockers.

## Completion definition

RC50 is the production canary, not the final delivery. The task continues after those 50 real listings pass. Every row in the frozen source boundary must receive a durable reconciled outcome. Eligible listings populate the customer surfaces; ambiguous, conflicting, bundle-held, duplicate, quarantine, and error records remain preserved with explicit reasons and reconcile to the same total.

## Local checkout warning

The checkout in which this handoff was assembled was on `codex/dealer-access-demo-security` at `074be93488ff10e9fc03d9b59e253642c949067c` and already contained unrelated user changes. It is not the release baseline. Do not discard, reset, stage, or commit those unrelated changes as part of this handoff.

## Artifact availability

The two RC50 archives were reported as found and extracted in another agent environment, but their bytes were not present in this Windows checkout when this directory was assembled. They must be copied into `artifacts/` or attached directly to the Astra task. The exact expected hashes are included here.
