# WatchFacts Restart Handoff - 2026-07-13

## Production state

- Repository: `Pablodd1/wf`
- Production Vercel project: `watchfacts-poc`
- Production URL: `https://watchfacts-poc.vercel.app`
- Production `/api/ingest` is healthy with server-key access.
- Full archive estimate: 2,634,269 records.
- Market-ready estimate: 2,632,776 dated records.
- Trading Floor has Market-ready and Full archive modes.
- Price Research for Rolex 126610LN returns a robust cohort using 1.5x IQR.
- Normalization v4 regression coverage includes Chinese price and intent forms:
  the HKD Chinese alias and ten-thousand multiplier parse correctly, a Chinese
  HKD section header applies to following bare-dollar prices, and Chinese buy
  requests classify as WTB.
- No live `watch_records` values were changed by the shadow work.

## Normalization evidence

A cursor-paged, protected read-only production sample analyzed 1,000 distinct
records with normalization v4. Results:

- 718 records flagged (71.8%). Flags overlap because a row can require more
  than one correction or review action.
- `BUNDLE_SPLIT_REQUIRED`: 259
- `NO_CANDIDATE`: 165
- `REFERENCE_CHANGED`: 132
- `INTENT_CHANGED`: 104
- `PRICE_CHANGED`: 66
- `BRAND_CHANGED`: 60
- `CURRENCY_CHANGED`: 12

That initial read-only sample was not persisted because the shadow schema was
not yet installed at that point. It has since been installed and a persisted,
isolated 10,000-row shadow run has completed.

### Persisted shadow review run

- `rowsAnalyzed`: 10,200
- `changed` / pending review: 7,624
- `BUNDLE_SPLIT_REQUIRED`: 2,553
- `NO_CANDIDATE`: 940
- `REFERENCE_CHANGED`: 1,781
- `INTENT_CHANGED`: 112
- `PRICE_CHANGED`: 1,549
- `BRAND_CHANGED`: 602
- `CURRENCY_CHANGED`: 880
- `CURRENCY_AMBIGUOUS`: 1,272
- `PRICE_PARSE_FAILED`: 345

No rows in `public.watch_records` were modified. The purpose of this result is
to prioritize parser fixes and human-review cohorts, not to auto-promote all
changes. The first review found and corrected two parser hazards: Patek
four-digit suffix references such as `5935A-001`, and six-digit asking prices
such as `195000 USD` being misread as Rolex references.

The final evaluated checkpoint is `normalization-v4-format-fix`, completed at
`2026-07-13T14:43:45Z`. It also covers Cartier `WSSA` references, dotted
Hublot references, literal Excel `_x000D_` separators, and English WTB header
inheritance.

The temporary `SHADOW_RUN_TOKEN` used for this controlled run was removed from
Vercel Production and the local ignored workspace after completion.

Protected sample review confirms that the remaining `NO_CANDIDATE` cohort is
mixed and must not be bulk-filled: it includes valid catalog-alias requests
such as `WTB BATMAN 2020+ PLEASE PM`, unsupported-brand references such as
`Carrier W4BB0021`, and lines whose legacy reference must be retained until a
candidate can be proven. Multi-watch inventory messages are correctly retained
as linked bundle proposals rather than flattened into one final listing.

## Shadow schema status

The production schema is now installed. The additive migration remains the
authoritative schema reference:

`supabase/migrations/20260713003000_normalization_shadow_v4.sql`

The repository also contains the idempotent, new-timestamp retry migration
`supabase/migrations/20260713012000_apply_normalization_shadow_v4.sql`.

## 2026-07-13 recovery update

- The production Supabase project has **no GitHub integration**. Pushing new
  migration files to `main` does not apply them to production.
- The current production `DATABASE_URL` is malformed (its host resolves as
  `base`), so it cannot be used as a direct migration connection.
- The authenticated Supabase dashboard is the available execution path. Run
  either shadow migration in its SQL Editor; both are additive and idempotent.
- After a successful SQL Editor run, verify:

  ```text
  https://watchfacts-poc.vercel.app/api/shadow-status
  ```

  It must return `status: "ok"` before creating a temporary trigger token or
  invoking the persisted shadow worker.

The configured production `DATABASE_URL` is malformed for direct Postgres use:
its host resolves as `base`. The shadow worker no longer depends on it and no
longer runs DDL from Vercel. Do not restore automatic DDL. Apply the checked-in
SQL in Supabase, then repair or remove the obsolete `DATABASE_URL` separately.

Historical pre-migration status:

```json
{"status":"schema_pending","total":0,"changed":0,"pending":0,"bundles":0,"flagCounts":{}}
```

## Resume sequence

1. Inspect protected representative samples for each high-volume review flag.
2. Add narrowly targeted parser tests and fixes only where samples demonstrate
   a deterministic issue.
3. Run a second 10,000-row pass after the fixes using a new checkpoint job
   such as `normalization-v4-reference-fix`. This re-evaluates the same
   deterministic cursor cohort and replaces only its shadow proposals, then
   compare flag rates and sample quality.
4. Draft a promotion policy with auto-promote gates and explicit human-review
   reasons. Do not run it until approved.
5. Remove the temporary trigger token after the controlled review cycle.

## Reviewer decision rollout

The catalog-confirmed read-only queue is available at:

```text
/api/shadow-review-queue?limit=100
```

Before reviewers can record decisions, apply
`supabase/migrations/20260713020000_shadow_review_decisions.sql` using the
production Supabase SQL Editor. Then configure a new temporary
`REVIEW_OPERATOR_TOKEN` as a Vercel Production secret. Do not use the old
shadow-run token and do not expose this token to the browser.

The audited decision endpoint changes only `normalization_shadow_v4.review_status`
and inserts `normalization_review_decisions`; it does not mutate `watch_records`.

### Controlled production validation - completed 2026-07-13

The reviewer-decision migration was applied to the WatchFacts production
Supabase project and a single catalog-confirmed proposal was approved through
the production endpoint as a controlled validation. The proposal was:

```text
source_record_id: 043f88e0-26bf-4cff-a461-75f90687c047
catalog match: exact enriched Patek Philippe 5396R
```

The endpoint returned `status: ok`, created audit record
`d38ef243-d367-4c10-a1bc-434274d4b8be`, and set only the corresponding shadow
row to `APPROVED`. A follow-up queue read confirmed that this record is no
longer pending. No `watch_records` row was inserted, updated, or deleted.

The one-time `REVIEW_OPERATOR_TOKEN` must now be removed from Vercel Production
and the local temporary token file deleted before continuing with human review.

## Continuous shadow normalization

Production runs `GET /api/shadow-normalize` on a five-minute Vercel cron. Each
invocation processes at most 1,000 source records, writes only shadow proposals,
and advances the `normalization-v4-production` checkpoint. It is authorized by
the existing `CRON_SECRET`; do not expose that secret or add it to browser code.

The current review UI is available at:

```text
https://watchfacts-poc.vercel.app/review-queue
```

The first larger scheduled batch must be checked through `/api/shadow-status`.
If a 1,000-row batch approaches the function limit, reduce the batch size before
increasing the cron frequency. Do not run concurrent manual requests against the
same checkpoint job.

Do not enable a repeating cron until shadow persistence succeeds and a bounded
sample has been reviewed.

## Verification commands

```bash
npm run test:normalization
npm run build
curl "https://watchfacts-poc.vercel.app/api/ingest?page=1&pageSize=10&quality=market"
curl "https://watchfacts-poc.vercel.app/api/ingest?page=1&pageSize=10&quality=archive"
curl "https://watchfacts-poc.vercel.app/api/shadow-status"
curl "https://watchfacts-poc.vercel.app/api/price-research?reference=126610LN"
```

## Durable requirements

Continue using `AGENTS.md`, `WATCHFACTS_MASTER_SPEC.md`, and the `docs/`
architecture files as the project source of truth. Key rules remain:

- Preserve raw evidence and lineage.
- Never assume `$` means USD.
- Apply section-level HKD context.
- Split bundles before final normalization.
- Keep WTS and WTB separate.
- Preserve and flag outliers.
- Never load millions of records into browser memory.
- Normalize in shadow mode before promoting corrections.
- Connect Green API only after historical normalization is stable.

## UI/UX work

UI/UX work can continue in parallel on a separate branch. Keep API contracts,
route names, review states, and normalization schemas stable. The current
Market-ready/Full archive control is intentional and should be preserved.
