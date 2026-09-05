# Supabase production operations

## Current resource condition

On 2026-07-19 the Supabase dashboard reported resource exhaustion. Production
statistics showed stale zero-row planner estimates for `watch_records` and
`normalization_shadow_v4`. A bounded manual `ANALYZE` refreshed estimates to:

| Table | Estimated live | Dead rows |
| --- | ---: | ---: |
| `watch_records` | 2,645,395 | 309,364 |
| `normalization_shadow_v4` | 2,625,382 | 131,331 |
| `watch_staging` | 1,423 | 329 |

The completed Railway normalization worker is scaled to zero. Do not restart it
until Supabase usage is stable and a new bounded job is explicitly approved.

## Write guardrails

- Run one remediation process at a time.
- Use serial decisions or batches of at most 100 rows.
- Stop on HTTP 429, 5xx, or statement timeout; do not increase concurrency.
- Never normalize during historical copy or image mapping.
- Keep bundle parents visible until every child is catalog-reviewed and the
  child set passes count and lineage reconciliation.
- Do not run `VACUUM FULL` in production.
- Do not run `refresh_all_analytics()` during customer traffic. Its observed
  execution time was approximately 113 seconds.

## Migration automation

`.github/workflows/supabase-production-migrations.yml` applies new migration
files on `main` through a protected GitHub `production` environment. Configure:

- `SUPABASE_ACCESS_TOKEN`
- `SUPABASE_DB_PASSWORD`
- `SUPABASE_PROJECT_REF`

After the first reviewed manual run succeeds, set the repository variable
`ENABLE_PRODUCTION_MIGRATIONS=true`. Until then, pushes create a skipped job
instead of attempting an unconfigured production migration.

Before enabling automatic pushes, reconcile the remote migration ledger with
the migrations that were applied manually. Run the workflow once with branch
protection and review its `supabase migration list` output before accepting the
first production `db push`.

The targeted private-lineage workflow uses the project's IPv4-compatible
Supavisor session pooler by default because this project resolves its direct
`db.<project-ref>.supabase.co` endpoint to IPv6. The current default is
`aws-1-us-west-2.pooler.supabase.com:5432` with user
`postgres.<project-ref>`. Optional production environment secrets
`SUPABASE_DB_HOST`, `SUPABASE_DB_USER`, and `SUPABASE_DB_PORT` override those
defaults without changing the migration SQL.
