# CTO Continuation Note - 2026-07-14

This note is for the next Codex session or a new computer. Read `docs/CTO_HANDOFF_2026-07-14.md` first; that document remains authoritative for rollout safety.

## Repository

- Remote: `https://github.com/Pablodd1/wf.git`
- Branch: `codex/continue-cto-rollout-20260714`
- Latest commit: `b7c413c feat: complete partner navigation and workflow`
- Worktree at handoff: clean and tracking the remote branch.

## Product work completed

- Trading Floor uses the dark luxury theme with gold accents.
- Trading Floor defaults to All; WTB combines WTB and NTQ; multi-listings remain available.
- Price Research preserves raw price evidence, corrects explicit HKD/USD values for analytics, exposes supply and demand counts, and falls back from unknown model labels to usable identity.
- HIRE FII page is available at `/hire-fi` with member pricing, LuxFi/WhatsApp/Telegram links, community links, and workflow content.
- Partners page is available at `/partners` with partner categories, external partner links, contact flow, community links, and workflow content.

## Verification

- `npm run build` passed after the latest UI changes.
- `npm run test:normalization` passed all 55 tests before the final Partners-only content update.

## Railway and normalization snapshot

- Service: `wf` in project `satisfied-vibrancy`, production environment.
- URL: `https://wf-production-00b9.up.railway.app`
- Last observed service state: Online.
- Last observed deployment ID: `4a5ab626-5bd4-4d6c-a6bd-6c4856cd6bac`.
- The latest UI branch commit was pushed, but a matching Railway deployment was not yet confirmed.
- Last read-only progress report: `1,282,250 / 2,631,468` rows analyzed (`48.73%`), estimated `1,349,218` remaining.
- Table-wide shadow estimate: `1,960,428` pending review rows; this is not job-scoped because `normalization_shadow_v4` has no `job_name`.
- Last observed lease holder was the active deployment; do not delete, reset, or replace the lease.
- Recent worker behavior: batches complete successfully, with intermittent Supabase statement timeouts and automatic recovery.

## Resume checklist

1. Read `docs/CTO_HANDOFF_2026-07-14.md` and this note.
2. Run `git status --short --branch` and confirm the branch is clean/tracking.
3. Verify Railway status, latest deployment, checkpoint, lease, and logs before any change.
4. Run `railway run npm run shadow:progress` for a fresh read-only count.
5. Do not reset the checkpoint, create another worker, mutate raw data, or promote shadow proposals without validation and safe rollout evidence.
