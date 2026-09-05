# WatchFacts / Curated Luxury

## Reset Handoff and Client Executive Summary

**As of:** July 18, 2026

**Repository:** `Pablodd1/wf`

**Production:** `https://watchfacts-poc.vercel.app`

**Production branch:** `main`

**Latest verified merge:** PR #39, merge commit `74d5e0a`

## July 20 product-plan continuation

The latest saved product, mobile, currency, emoji-price, WTB/posting, dealer,
account, and three-month forecasting plan is
`docs/CTO_PRODUCT_AND_MOBILE_PLAN_2026-07-20.md`. It also records a new
release-critical production finding: some archive cards display reference-like
tokens as USD prices. Address that gate before enabling forecasts or broader
customer-facing price features.

## Latest CTO update - v4.2 bundle canary

The read-only 1,000-parent bundle canary is complete. It preserved all 11,287 candidates and exact raw-line lineage while reducing suspicious sub-$500 parser outputs from 1,558 to 107 (93.1%). No production data was changed. The active Railway cursor job is complete and is not applying v4.2; the next safe step is a distinct 10,000-row shadow-only v4.2 job. Full evidence and rollout conditions are in `docs/BUNDLE_CANARY_V42_2026-07-18.md`.

This document is the restart-safe source of truth for continuing the CTO rollout on another computer. It also summarizes the client-facing value delivered during the July 12-18 engineering window.

## Executive outcome

WatchFacts moved from a limited proof-of-concept toward a controlled luxury-market intelligence platform with:

- server-paginated access to the multi-million-record watch archive;
- stricter publication gates for Trading Floor and Price Research;
- deterministic HKD/USD parsing and price plausibility safeguards;
- auditable IQR/outlier exclusion with retained excluded evidence;
- catalog-backed reference and dial reconciliation;
- immutable raw-message evidence and human-review workflows;
- checkpointed shadow normalization rather than unsafe bulk overwrites;
- bundle-first duplicate handling;
- dealer authentication, admin-only operations, dealer profiles, and contact foundations;
- a professional Curated Luxury homepage and marketplace navigation;
- mobile-responsive customer surfaces and voice-assisted search;
- resumable image-lineage and multi-listing export tooling.

The platform is live and usable. The remaining work is primarily controlled data operations: regenerate bundle proposals with the corrected parser, approve child listings, reconcile authenticated dealer identities, and expand verified image coverage.

## Client value delivered

### 1. Repository and architecture audit

- Traced ingestion, normalization, catalog reconciliation, review, Trading Floor, Price Research, Admin, Supabase, Vercel, Railway, and media workflows.
- Replaced misleading static/demo counts with live or clearly labeled planner estimates.
- Documented architecture, data contracts, security, deployment, normalization, catalog, analytics, duplicate, image, and rollback protocols.
- Preserved source records instead of rewriting historical evidence.

### 2. Large-dataset performance

- Confirmed the main `watch_records` dataset is approximately 2.6 million rows and several gigabytes.
- Replaced browser-memory assumptions with server-side pagination and bounded evidence payloads.
- Added and validated Trading Floor indexes and query plans.
- Trading Floor validation recorded approximately 2,391,989 recent-market rows and 2,393,186 archive rows. These are PostgreSQL planner estimates, not exact billing-style counts.
- Price Research performs aggregate calculations while bounding returned evidence to protect Vercel and browser memory.

### 3. Price and currency normalization

- Added deterministic handling for `HKD`, `HK$`, `HDK`, Chinese HKD labels, section-level currency context, explicit USD equivalents, malformed separators, discounts, and multipliers.
- Added coverage for `K`, `M`, `mil`, `mill`, and `million` before or after the currency marker.
- Bare `$` is not automatically treated as USD without supporting evidence.
- Raw price text and original currency evidence remain available for audit.
- The current parser release is `v4.2-line-condition`.

### 4. Price Research accuracy

- Added reference resolution, dial normalization, condition filtering, minimum sample gates, repost control, IQR fences, excluded-observation evidence, and market ranges.
- Prevented implausible observations such as the Rolex 52506 `$244` row from affecting market analytics.
- Kept `New`, `Used`, and `Condition unspecified` as conditions beneath one dial rather than duplicating dial colors.
- Missing condition is never silently converted to Used.
- Corrected Patek and Rolex reference/currency cases raised during client review.

Verified canaries recorded in the repository:

| Reference | Unique offers | Included | Outliers removed | Median | Included range |
| --- | ---: | ---: | ---: | ---: | --- |
| Patek 3712/1A | 10 | 9 | 1 | $133,000 | $106,650-$145,897 |
| Patek 5712/1A | 657 | 370 | 76 | $111,141 | $81,500-$162,000 |
| Rolex 116500LN | 1,147 | 527 | 168 | $27,000 | $20,600-$34,100 |
| Rolex 52506 | 254 | 151 | 8 | $42,240 | $34,000-$60,500 |

Later production API verification for Patek 5712/1A and Rolex 116500LN used larger included cohorts after endpoint refinements. The canary table is retained as the dated audit result, not presented as an eternal market quote.

### 5. Dial and catalog quality

- Added deterministic catalog-backed dial proposals without overwriting live rows.
- Original audit found 365 deterministic dial corrections; 337 current proposals remain in shadow review after respecting newer source state.
- Added explicit conflict flags when text, structured fields, and catalog disagree.
- Audited the five smallest populated brands and identified catalog/reference gaps, especially MB&F, F.P. Journe, and TAG Heuer.
- Preserved unresolved values as null/unspecified instead of inventing attributes.

### 6. Bundles, multilistings, and duplicates

- Identified approximately 757,433 source records with `BUNDLE_SPLIT_REQUIRED` in shadow normalization.
- Built an admin-only multi-listing queue with raw parent evidence and proposed child candidates.
- Corrected a critical rule: explicit child-line condition now overrides inherited section condition.
- Added durable checkpoints and a full JSONL exporter.
- Added conservative duplicate detection with seller identity, source lineage, and bundle awareness.
- No source parent has been deleted merely because similar records or different dates exist.
- Duplicate suppression is intentionally blocked until bundle children are approved.

Required order:

1. Preserve immutable raw parent.
2. Segment exact source lines.
3. Validate child brand, reference, dial, condition, intent, price, and currency.
4. Approve and materialize children with parent/line lineage.
5. Suppress the parent from Price Research only after accepted children exist.
6. Run duplicate review after splitting.

### 7. Dealer and admin operations

- Added credentialed dealer/admin authentication with role checks and audit events.
- Added admin-only Dashboard, Admin Review, and Multi-listing routes.
- Added dealer directory and dealer profile pages.
- Added data contracts for rating, review count, WhatsApp group count, WTS/WTB activity, posting years, location, and contact consent.
- Added protected listing-to-dealer contact API foundations.
- Scanned 17,000 raw source records and staged 1,580 explicit company identifiers as `PENDING`.
- No staged identifier was falsely presented as a verified rated dealer.
- Production currently reports zero verified dealer profiles until the authenticated legacy directory is reconciled.
- The supplied rated-dealer website is private research assistance only. Do not link customers to it, display its URL on profiles, or create/verify dealers from it without matching evidence and approval.

### 8. Trading Floor and customer experience

- Trading Floor exposes customer-eligible inventory while excluding `RECYCLE` records.
- WTB and historical NTQ demand are combined under buyer intent where appropriate.
- MULTI records have a dedicated review/filter path.
- Added full navigation between Trading Floor, Price Research, and marketplace surfaces.
- Removed internal database identifiers and unnecessary implementation details from customer listing presentation.
- Added source-safe availability/contact flow foundations.
- Added mobile layout corrections and verified key views at a 390x844 viewport.

### 9. Curated Luxury brand and homepage

- Repositioned the audience toward collectors, dealers, traders, retailers, and wholesalers.
- Built and revised a cinematic luxury homepage while retaining direct access to operational tools.
- Expanded the visual story beyond watches to jewelry, handbags, automobiles, and other rare luxury objects.
- Added social and AI front-desk controls, partner navigation, favicon, responsive logo treatment, and voice-assisted search.
- Corrected Hire Fi to `https://luxfi.ai/#add-fi`.

### 10. Images and media lineage

- Added a resumable Mission Images mapper for DigitalOcean Spaces manifests.
- Indexed 16,989 raw image filenames and scanned 1,813,407 inventory rows during the recorded pilot.
- Found 500 exact raw-record lineage matches and selected 100 customer-safe reachable records.
- The 100-record apply check made zero new links because all selected records were already linked, confirming idempotency.
- Generic or visually guessed images are not treated as actual dealer-listing photographs.

### 11. Infrastructure and deployment

- Repaired Supabase production/preview configuration and migration ordering.
- Added schema and indexes for normalization shadow state, dealer lineage, dealer profiles, auth audit, and review workflows.
- Added Railway worker configuration and checkpointed processing tools.
- Repeatedly verified Vercel previews and production APIs before merging.
- Latest production verification after PR #36:
  - admin login: HTTP 200 with `admin` role;
  - dealer API: HTTP 200, exact verified total `0`;
  - multi-listing API: HTTP 200, total `757,433`;
  - deployed Price Research bundle includes `Condition unspecified`;
  - normalization tests: 30/30 for the final hotfix suite;
  - production build: passed.

## Engineering activity evidence

Repository history between the pre-audit baseline and the latest production merge records:

- 194 commits across the repository history window;
- 35 merge commits;
- 247 files touched;
- 197,182 insertions and 1,464 deletions.

These figures describe repository activity, not a timesheet and not necessarily one person's authorship. They should support a deliverables-based invoice, not be represented as exact labor hours.

### Defensible effort framing for invoicing

No trustworthy active-hours timer was available, so exact hours should come from the contractor's own time records. For commercial scoping only, the delivered work is comparable to approximately **88-144 senior engineering hours** across:

| Workstream | Equivalent effort range |
| --- | ---: |
| CTO architecture, audit, and operating documentation | 12-20 hours |
| Data normalization, catalog, currency, and analytics | 24-40 hours |
| Supabase, Railway, migration, and performance engineering | 16-28 hours |
| Customer UI/UX, marketplace, admin, and dealer workflows | 16-24 hours |
| QA, regression tests, production validation, and incident fixes | 12-20 hours |
| Handoff, reports, runbooks, and client review preparation | 8-12 hours |

This is an equivalent-effort estimate, not a claim of clocked billable hours.

## Current production state

### Safe and live

- Customer marketplace and Price Research are live.
- Price outliers are excluded from aggregates but retained as evidence.
- Raw messages are preserved and available in controlled review contexts.
- Admin login and protected operations work.
- Dealer and bundle schemas are applied.
- The corrected bundle parser is merged and deployed.

### Staged, not promoted

- 337 deterministic dial proposals.
- Approximately 757,433 bundle/multi-listing source proposals. The exact first 10,000 bundle parents are reconciled in shadow, and 329 children from 25 parents are staged as `PENDING` with confidence `0`.
- 1,580 source company identifiers awaiting rated-dealer reconciliation.
- Duplicate candidates awaiting bundle splitting and human review.

### Not safe to claim complete

- The full 2.6-million-row archive has not been proven 100% normalized.
- Bundle child materialization has not been completed.
- Dealer identities have not been reconciled to the authenticated Rated Dealers directory.
- The full image archive has not been mapped or visually validated.
- Forecast accuracy has not yet passed a documented historical backtest and client sign-off.

## Next execution sequence

### Latest bundle release gate

The v4.2 parser has now passed a read-only 10,000-parent gate covering 115,486 extracted candidates. Candidate counts were unchanged, every candidate retained exact raw-line lineage, no source rows or references were missing, and 32,181 ambiguous price/currency candidates remained unresolved rather than guessed. The gate found and corrected three additional parser collisions involving comma-delimited dates, following words whose first letter resembled a multiplier, and references such as Rolex `14060M`.

The final evidence and rollout boundary are recorded in `docs/BUNDLE_CANARY_V42_2026-07-18.md`. The code is approved for review and a separately checkpointed shadow deployment. Automatic child materialization and duplicate suppression remain unapproved until persisted shadow output reconciles with the read-only report.

PR #41 merged to `main` at merge commit `da85af4`. The separately named Railway one-shot job `normalization-v42-bundle-canary` then persisted 10,000 archive rows with 7,401 proposed changes and no live-row promotion. Its checkpoint is `042bf015-795f-4dfe-a232-9d0cdb558255`. This proves the v4.2 lease/checkpoint/shadow-write path, but the cursor cohort is the first 10,000 archive rows rather than the 10,000 bundle-only parents in the release audit. Do not claim bundle materialization is complete.

1. Completed: merge the v4.2 parser corrections and deploy the separately named shadow worker.
2. Completed: reconcile the exact 10,000-parent bundle cohort with 10,000/10,000 stable matches.
3. Completed: stage a 25-parent canary with 329/329 children persisted, 184 explicit review rows, and no live-row changes.
4. Export the complete multi-listing queue and review/stage later cohorts in checkpointed batches.
5. Human/catalog-review staged children before any promotion.
6. Run duplicate suppression only after the relevant child cohort exists and reconciles.
7. Obtain an authenticated Rated Dealers export and reconcile the 1,580 staged identities.
8. Backfill `watch_records.dealer_id` from approved matches and validate profile totals.
9. Expand the image-lineage pilot beyond 100 only after customer-safety QA.
10. Backtest forecasts and present error metrics to John before public release.

## Multi-listing export: what to do after running the command

### Current workstation diagnosis

The attempted command on July 18 was launched from
`work/wf` on branch `codex/zero-hallucination-normalization` at commit
`ae33a08`. That stale checkout does not contain
`tools/multilisting/export-multilistings.cjs`; no exporter process and no
`audit-output/multilistings` output were found afterward. Therefore the full
export did **not** start. Do not treat it as completed.

Run it only from a fresh clone or checkout of `main` containing merge commit
`89e52d5` or later. Confirm the script first:

```powershell
git checkout main
git pull origin main
Test-Path .\tools\multilisting\export-multilistings.cjs
```

The last command must return `True`.

The exporter writes locally to the checkout from which it was launched:

```text
audit-output/multilistings/multilistings.jsonl
audit-output/multilistings/checkpoint.json
```

`audit-output/` is intentionally ignored by Git because the file may be very large and may contain raw messages and contact evidence.

Verify the export from the same terminal directory:

```powershell
Get-Content .\audit-output\multilistings\checkpoint.json
Get-Item .\audit-output\multilistings\multilistings.jsonl |
  Select-Object FullName, Length, LastWriteTime
Get-Content .\audit-output\multilistings\multilistings.jsonl -Tail 2
```

A complete run should end with an event similar to:

```json
{"event":"multilisting_export_complete","exported":757433,"completed":true}
```

The exact exported count can differ if the shadow queue changes during processing. Trust the checkpoint and current database count, not the older estimate.

If interrupted, rerun the same command without setting `MULTILISTING_RESET=true`. The exporter resumes from `checkpoint.json`:

```powershell
railway run node tools/multilisting/export-multilistings.cjs
```

Do not open the entire JSONL file in Excel or a text editor. Use streaming tools, PowerShell `Get-Content -Tail`, or a purpose-built review importer. Before resetting or replacing the computer, copy the entire `audit-output/multilistings` directory to encrypted external or cloud storage if it exists.

## Restart instructions on another computer

```powershell
git clone https://github.com/Pablodd1/wf.git
cd wf
git checkout main
git pull origin main
npm ci
npm run build
node --test tests/normalization-v4.test.cjs tests/shadow-reprocess.test.cjs
```

Read these documents first:

1. `AGENTS.md`
2. `docs/RESET_HANDOFF_AND_CLIENT_EXECUTIVE_SUMMARY_2026-07-18.md`
3. `docs/CTO_STATUS_2026-07-18.md`
4. `docs/CTO_DATA_ROLLOUT_2026-07-18.md`
5. `docs/NORMALIZATION_CONTRACT.md`
6. `docs/SHADOW_PROMOTION_POLICY.md`
7. `docs/RAILWAY_NORMALIZATION_WORKER.md`

Required environment credentials must be restored through Vercel, Railway, and Supabase secret stores. Never place them in Git or documentation.

## Security follow-up

- Rotate every credential previously pasted into chat, including database, DigitalOcean, Railway, and admin credentials.
- Use separate production, staging, and temporary migration credentials.
- Keep source database access read-only for audit and migration operations.
- Preserve raw evidence and audit logs.
- Do not expose dealer contact details until identity and contact-consent rules are satisfied.

## Client-ready payment summary

The engagement delivered architecture recovery, large-scale data performance, deterministic currency normalization, auditable price analytics, catalog and dial reconciliation, protected human review, bundle and duplicate safety controls, dealer/admin foundations, customer marketplace improvements, responsive luxury branding, media-lineage tooling, production deployment, regression testing, and permanent operational documentation.

The remaining tasks are not a redo of completed work. They are the controlled rollout and enrichment stages that the new architecture was built to support.
