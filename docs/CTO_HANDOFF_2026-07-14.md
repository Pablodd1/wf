# WatchFacts CTO Handoff - 2026-07-14

> Historical snapshot. Continue from `docs/CTO_HANDOFF_2026-07-16.md`, which records
> the completed normalization scan, merged PRs #6/#7, current pending queues, and
> cross-computer bootstrap instructions.

## Purpose

This document is the durable handoff for continuing the WatchFacts repository audit,
normalization rollout, Price Search correction, Trading Floor work, and beta launch.
It contains no credentials. Repository code, migrations, tests, and this document are
the source of truth; prior chat history is supporting context only.

## Repository and live services

- GitHub: `Pablodd1/wf`
- Production branch: `main`
- Local workspace used for this rollout:
  `C:\Users\jasme\Documents\Codex\2026-07-12\review\work\wf`
- Customer site: `https://watchfacts-poc.vercel.app`
- Railway project: `satisfied-vibrancy`
- Railway environment: `production`
- Railway service: `wf`
- Railway URL: `https://wf-production-00b9.up.railway.app`
- Supabase project reference: `bptrvfncppbjnchsaxtb`
- Historical archive: approximately 2.63 million rows in `public.watch_records`
- Catalog source files supplied by the owner:
  `C:\Users\jasme\Downloads\Catalog`

Never store database passwords, service-role keys, API keys, or Railway tokens in
this file, source code, commits, issues, or prompts. Use environment variables.

## Product contract

WatchFacts ingests noisy dealer messages, preserves the source evidence, segments
multi-watch bundles, distinguishes WTS and WTB, normalizes currencies and prices,
reconciles references/configurations against the catalog, and routes uncertain data
to AI-assisted or human review. Approved records feed Trading Floor and Price Search.

Core requirements:

- Raw source evidence is immutable.
- HKD must be detected before conversion; `$` alone never proves USD.
- Message and section context can apply to following listing lines.
- Bundled messages remain linked to their source while producing separate candidates.
- Catalog evidence supports normalization but cannot silently override conflicting text.
- Human approval is capped at 100%; never display confidence above 100%.
- Price analytics use comparable WTS cohorts and retain excluded observations with reasons.
- New/used, configuration, condition, set status, and meaningful dial variants remain distinct.
- Historical and future Green API messages must enter the same normalization pipeline.

## Current normalization rollout

- Active job: `normalization-v4-dial-production`
- Normalizer version: `v4.1-dial-context`
- Processing model: deterministic JavaScript shadow normalizer, not an LLM bulk pass
- Source table: `public.watch_records`
- Output table: `public.normalization_shadow_v4`
- Checkpoint table: `public.normalization_shadow_checkpoints`
- Worker: `tools/shadow-reprocess/railway-worker.cjs`
- Live records are not mutated by this scan.
- Promotion requires policy gates, catalog confirmation, and human approval where required.

Checkpoint verified 2026-07-14 at approximately 11:53 UTC:

- Rows analyzed: `534250`
- Estimated archive: `2631468`
- Approximate completion: `20.3%`
- Last source ID: `e0cca8b4-f85a-4c84-aac3-6acfe340cce5`
- Railway service state: online, one running replica, zero crashed replicas

Safe Railway settings:

```text
SHADOW_JOB_NAME=normalization-v4-dial-production
SHADOW_BATCH_SIZE=250
SHADOW_ROWS_PER_LEASE=5000
SHADOW_IDLE_DELAY_MS=5000
```

Do not reset the checkpoint or change the job name while this pass is active.

## Dial normalization policy

Implemented in `api/_lib/dial-normalization.cjs`.

Evidence order:

1. Explicit dial text on the candidate listing line.
2. Existing non-placeholder structured dial.
3. Exact/collapsed brand + reference catalog match with one dial.
4. Multiple catalog dials become `DIAL_AMBIGUOUS`; do not guess.

Placeholders such as empty, Unknown, N/A, NA, None, and Unspecified are unresolved.
Safe spelling aliases are canonicalized. Market-significant variants remain distinct,
including Tiffany Blue, Ice Blue, Champagne, Salmon, Meteorite, Panda, Reverse Panda,
Chocolate, and Mother of Pearl.

A 5,000-row unknown-dial production sample found:

- 309 explicit raw-text resolutions
- 203 single-catalog proposals
- 276 ambiguous multi-dial records
- 4,212 unresolved records left untouched

`DIAL_AMBIGUOUS` blocks promotion. Catalog proposals remain reviewable.

Known catalog issue: the local catalog currently maps Rolex `52506` to Blue/Ice Blue.
Treat catalog conflicts as review evidence, not automatic truth.

## Price Search corrections

Rolex `52506` exposed two major defects:

1. Implausible values such as `$244`, `$332`, and `$398` contaminated IQR because the
   original lower fence became negative.
2. Explicit HKD observations such as `HKD 325k` were stored as `USD 325000`.

Live corrections:

- Deterministic plausibility floor runs before IQR.
- Explicit currency is re-read from the exact reference line for analytics.
- Explicit USD/USDT equivalent wins; otherwise explicit HKD is converted at 7.8 HKD/USD.
- Stored source values remain unchanged and auditable.
- Discarded observations remain visible with reason codes.
- Dial and currency completeness warnings are returned to the UI.

Verified live `52506` result after correction:

- Minimum: `$34,000`
- Median: `$41,500`
- Average: `$41,397`
- Maximum: `$50,000`
- Included comparable observations: `816`
- Excluded observations/outliers: `128`
- Explicit currency mismatches corrected for analytics: `675`
- `$244` observations remain visible as discarded and do not affect statistics

Remaining analytics work:

- Duplicate/repost clustering and suppression
- Catalog-relative plausibility bands
- Comparable configuration validation
- Better listing-date coverage
- Audit other high-volume references and brands

## Railway incident and resolution

An unused duplicate service named `considerate-vibrancy` repeatedly crashed because it
did not have Supabase variables. It was deleted. Only `wf` remains.

The real worker encountered a Supabase statement timeout with 2,000-row writes.
Batch size was reduced to 250 and rows per lease to 5,000. A stale lease left by a
replaced deployment was removed only after confirming its holder was no longer active.

Do not recreate the duplicate service. Do not delete `wf`.

## Published commits

Most recent relevant production commits:

```text
fd4136c fix: repair explicit currency before market analytics
1ec6241 feat: audit and normalize dial colors safely
d0c5f76 perf: remove expensive price research count
d1fa0c3 fix: discard implausible prices before IQR
794e372 fix: use indexed trading floor search
422fb70 fix: harden public market search
24253ff feat: secure dealer access and market feed
5c5c333 fix: page complete price history samples
```

## Verification already completed

- 55 normalization, catalog, pricing, and promotion-policy tests passed.
- Production Vite build passed.
- Production Price Search API was tested for Rolex `52506`.
- Railway worker and checkpoint were verified live.
- Trading Floor exact-reference query uses the verified composite index.
- Dealer login foundation and public market feed were published.

## Performance concern

Supabase reported resource exhaustion. Running-query inspection showed expensive
analytics work including `refresh_all_analytics()` and materialized-view refreshes.
Do not terminate queries blindly. Audit their schedules, duration, concurrency, and
business need, then move heavy refreshes away from normalization windows or replace
them with incremental aggregates.

Railway build also reports npm dependency vulnerabilities. Review and upgrade them in
a separate tested branch; do not run an unreviewed forced `npm audit fix` in production.

## Exact next priorities

1. Monitor v4.1 until the checkpoint reaches the full archive without repeated errors.
2. Produce completion counts by evidence and change flag without expensive full-table scans.
3. Validate a stratified sample of at least 500 proposals across major brands.
4. Implement duplicate/repost clustering before calculating volume and liquidity.
5. Add catalog-relative price plausibility and configuration-aware cohorts.
6. Audit and reschedule Supabase analytics refresh jobs.
7. Promote only deterministic, sampled, catalog-confirmed corrections.
8. Route conflicts and ambiguous configurations to human review with reason codes.
9. Continue beta testing Trading Floor, Price Search, login, review queue, and mobile UI.
10. Connect Green API in shadow mode only after historical normalization is stable.

## Commands for the next Codex task

Run from the repository root.

```powershell
git status --short
git pull --ff-only origin main
railway status
railway service list --json
railway logs --service wf --environment production --latest --lines 80
railway run node -e "const u=process.env.SUPABASE_URL+'/rest/v1/normalization_shadow_checkpoints?job_name=eq.normalization-v4-dial-production&select=rows_analyzed,last_source_record_id,updated_at';fetch(u,{headers:{apikey:process.env.SUPABASE_SERVICE_ROLE_KEY,Authorization:'Bearer '+process.env.SUPABASE_SERVICE_ROLE_KEY}}).then(async r=>console.log(await r.text()))"
npm run test:normalization
npm run build
```

## Recommended opening prompt for a new task

```text
Continue the WatchFacts CTO rollout in Pablodd1/wf.

First read docs/CTO_HANDOFF_2026-07-14.md and AGENTS.md if present. Treat the
repository, migrations, tests, and handoff as authoritative. Do not ask me to paste
the old conversation. Verify the current Railway checkpoint and service health before
making changes. Continue the exact next priorities in the handoff. Preserve raw data,
keep normalization shadow-only until validated, do not reset the active checkpoint,
and do not modify production data without evidence and a safe rollout condition.
Report current progress, changes made, tests, deployment status, and remaining risks.
```

