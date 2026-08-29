# Curated Luxury continuation handoff — 2026-08-14

## Authority and workspace

- Repository: `Pablodd1/wf`
- Workspace: `C:\Users\Owner\Documents\Codex\2026-08-05\study\wf-dealer-gate`
- Canonical remote baseline at handoff: `origin/main` commit `c8b61e0d` (`fix: bucket dealer link sync without global sort (#509)`).
- Production site: `https://watchfacts-poc.vercel.app`
- Production Supabase project: QNSA `qnsafosakvonzgfcsphh`.
- Never point production back to retired project `bptrvfncppbjnchsaxtb` and do not mix rows from both projects.
- Preserve and do not stage/delete local `audit-output/` and `scratch-price-run-1786535506099/`.
- Preserve the older untracked `docs/CODEX_CONTINUATION_HANDOFF_2026-08-12.md` unless explicitly instructed otherwise.

## Customer-facing product rules

- Global customer brand name is **Curated Luxury**.
- Trading Floor keeps WTS and WTB, including genuinely unpriced activity, but Price Research averages use qualified priced WTS only.
- WTB must never enter WTS sale averages.
- Statistical policy remains 3.0 × IQR with outliers retained as excluded evidence.
- Exact source images render first. Missing/broken images render no empty image frame. Bundle parents/children never inherit or display group images.
- Ratings must be source-backed. Feedback count may render as `Rated (N)` but must never be converted into a fabricated five-point score.
- Preserve immutable raw messages and source lineage. Human-review records can be visible under the approved release contract, but analytical inclusion still requires identity, currency, dial, bundle, duplicate, and repost gates.
- POST IT remains open for testing, but saving requires a registered/authenticated dealer. Approved submissions must bind `dealer_id`, preserve raw/version lineage, enter review, and only then reach Trading Floor/Price Research.
- Do not publish ambiguous/unclassified items or unresolved multi-listings.

## Released brand state

The intended current released watch brands are:

1. Rolex
2. Patek Philippe
3. Audemars Piguet
4. Richard Mille
5. Cartier
6. Zenith

The live inventory discovery endpoint returned HTTP 503 during this handoff check, so refresh the exact production brand census before quoting totals.

### Required per-brand acceptance

- Broad Trading Floor brand route works and paginates without repeated IDs.
- Exact reference search works, including punctuation/equivalent references.
- Images are exact, reachable, globally image-first, and bundles are absent.
- Supplied USD/USDT and supported dated-FX prices display in USD; genuine no-price rows remain at the tail.
- Price Research keeps WTS/WTB/no-price/outlier/repost accounting non-overlapping and reconciled.
- Liquidity, WTB/WTS ratio, outlier counts, dial table, dial-colored chart, and provisional three-month outlook render without an action button.
- Forecast is explicitly provisional until sufficient monthly history exists.
- Listing poster, raw message, contact (when consented), location, and source-backed rating evidence remain connected.

## Next watch brand

**Panerai is the next recommended controlled brand rollout**, followed by Omega.

Reason: the prior catalog census showed Panerai as a smaller controlled surface than Omega, while Omega has a much larger reference space. Before Panerai release:

1. Re-audit current QNSA candidates and exact catalog identities; do not use stale July counts as production truth.
2. Quarantine mixed-brand, multiple-reference, quantity (`x2`, `pair`, `lot`, `pcs`) and comma/slash/or-separated request messages.
3. Run a bounded 100-row canary with WTS, WTB, priced, no-price, FX, image, duplicate, repost, bundle, and cross-brand controls.
4. Reconcile every canary input to published, withheld, or review-required disposition.
5. Enable Trading Floor first, then qualified Price Research, then run live browser acceptance.

## Multi-listing correction still required

A live audit found Richard Mille messages containing several references/prices published as one listing, including a raw message containing RM002, RM014, and RM022. The correct policy is:

- Preserve parent raw evidence.
- Quarantine the parent as `bundle_pending_separation`.
- Do not expose parent/child images.
- Split only when each reference/price span is deterministic.
- Generated children remain pending human/catalog review; never auto-publish them.
- Apply the unified multi-item detector to historical normalization, POST IT, Trading Floor defensive admission, and Price Research.

Do not launch Panerai until this five/six-brand defensive gate is applied and regression-tested.

## Dealer Directory — current live state

Merged work:

- PR #502 canonical QNSA Dealer Directory.
- PR #504 fail-closed synchronization.
- PR #505 release-view linkage.
- PR #506 listing ID cast.
- PR #507 bounded reconciliation.
- PR #508 indexed-candidate correction.
- PR #509 UUID bucket correction.

Live `/api/dealers?pageSize=5` returned:

- `success: true`
- `source: canonical-database`
- `total: 54` canonical dealers
- Real source-backed display names, countries, membership dates, review counts, and group counts.

Examples observed live:

- Federico Maman: 22 reviews, 25 groups.
- Jaztime Watches: 18 reviews, 22 groups.
- Zack: 16 reviews, 24 groups.
- Ian Mottale: 14 reviews, 30 groups.

No external WatchFacts profile links are exposed. Numeric ratings remain null when no numeric rating evidence exists.

### Dealer Directory blocker

Dynamic listing linkage is **not complete**. WTS/WTB totals on canonical profiles remain zero because each release-view linkage strategy reached PostgreSQL statement timeout. The fail-closed runs were:

- `31842577856`: public HTTP scan failed on repeated 503.
- `31842806310`: text listing ID required UUID cast.
- `31842889912`: full public-view join timed out.
- `31846337214`: per-identity ordered public-view query timed out.
- `31846594197`: indexed candidate/public-view join timed out.
- `31846869292`: UUID bucket/public-view join timed out.

The schema/profile/review snapshot work is live; the listing ledger is not reconciled. Do not claim listing-to-listing directory completion.

### Safe next Dealer Directory action

QNSA was previously measured near 7.894 GiB of an 8 GiB disk. Before adding an index:

1. Refresh disk capacity via the read-only QNSA disk audit.
2. Expand QNSA to at least 10–12 GiB, or reclaim only authorized derived data.
3. Add a forward-only composite/expression index matching verified seller phone plus listing cursor on the release source.
4. EXPLAIN the exact dealer-link query and require an index scan.
5. Resume bounded linkage and require zero duplicate verified phones, zero orphan links, and exact listing/WTS/WTB reconciliation.
6. Verify internal dealer profiles and Trading Floor rating badges in the live browser.

Do not increase statement timeout as the primary fix and do not weaken the public release gate.

## Verification commands

```powershell
git fetch origin main
git log origin/main -1 --oneline
npm run test:normalization
node --test tests/dealers-public-directory.test.cjs tests/qnsa-canonical-dealer-directory.test.cjs tests/dealer-directory-builders.test.cjs tests/dealer-profile-payload.test.cjs
npm run build
gh run list --repo Pablodd1/wf --workflow qnsa-canonical-dealer-directory.yml --limit 10
```

Live checks:

- `/api/health` must report QNSA `qnsafosakvonzgfcsphh`.
- `/api/dealers?pageSize=5` must remain `source=canonical-database`.
- Refresh exact Trading Floor and Price Research counts; never quote a stale total or a returned-page count as a global total.
- Check desktop and mobile visually after every customer-facing modification.

## Definition of completion

This program is complete only when:

- All six currently released brands pass broad and exact Trading/Price acceptance.
- All multi-item parents are withheld and deterministic children are reviewed.
- Supported currency evidence is converted with dated provenance; no guessed FX.
- Dealer listing linkage reconciles and profiles show real dynamic WTS/WTB/listings.
- POST IT and incoming group-chat entries preserve immutable lineage and reach the same review/publication pipeline.
- Panerai passes canary and controlled release; only then proceed to Omega.
- Production browser verification passes with no 5xx, no duplicate pagination, no bundle-image leakage, and no fabricated ratings.
