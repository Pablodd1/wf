# WatchFacts / Curated Luxury CTO Project Review

Date: 2026-07-19

## Executive conclusion

The core evidence-first normalization path is materially safer than the legacy application path. The deterministic parser, shadow queue, catalog gate, field-scoped human promotion, bundle lineage, outlier separation, and immutable audit records form a credible production foundation. The platform is suitable for controlled beta use, but it is not yet ready for unattended bulk normalization or unrestricted public AI traffic.

No production-wide data rewrite was performed during this review.

## Verified working

- Production build passes.
- 104 normalization and data-contract tests pass.
- Security boundary tests pass.
- HKD/HDK, `mil`/`mill`/`million`, explicit USD equivalents, ambiguous dollar signs, and malformed separators have deterministic coverage.
- Price Research requires five valid comparable observations and separates outliers from included observations.
- WTS and WTB eligibility contracts are separate.
- Bundle parents remain unsuppressed until reviewed children are publishable.
- Human-approved price and dial changes are field-scoped and audit logged.
- Critical references were revalidated: `5712/1A`, `5712/1R`, `3712/1A`, `116500LN`, and `52506`.
- The 89 approved price corrections were applied; 6 remain blocked.
- High-volume `116500LN` sampling now sees 5,485 observations instead of a capped low-volume subset.

## Corrected in this review

### Critical

1. Server-side image analysis could fetch arbitrary URLs. All shared image fetches now require public HTTPS destinations, reject private/reserved networks, validate every redirect, enforce image MIME types, time out, and cap downloads at 10 MB.
2. Public Price Research detail and CSV export could disclose dealer phone/WhatsApp data embedded in preserved raw messages. Public responses now redact contact paths while preserving references, prices, dates, and listing evidence. Immutable database evidence is unchanged.
3. The legacy direct MySQL import inferred missing currency as USD and could publish imported rows as approved. The endpoint now returns `410` and directs operators to the checkpointed raw migration and shadow workflow.

### High

4. Public CSV exports were vulnerable to spreadsheet formula injection. Every cell is now quoted and formula-leading values are neutralized.
5. Reviewer image-analysis endpoints could consume paid AI without authentication. They now require reviewer/admin session or a service token.
6. Marketplace extraction confidence could mark staging rows approved. New scraper rows are now always `PENDING` until evidence review.
7. Internal media and queue infrastructure now has an explicit privilege-hardening migration.

## Remaining risks

### P1 - resolve before unrestricted public launch

1. Public Demo and front-desk AI routes need durable distributed rate limits, daily quotas, request-size limits, and cost telemetry. Vercel Firewall or a shared Redis-backed limiter is appropriate; per-instance memory is not.
2. Apply and verify `20260719234000_security_hardening.sql` through the guarded production migration workflow.
3. Configure GitHub repository variables/secrets for guarded Supabase production migrations. Automatic production migration remains disabled until `ENABLE_PRODUCTION_MIGRATIONS=true` is deliberately set.
4. Supabase has recently shown statement timeouts and high dead-row counts. Keep normalization workers stopped during large maintenance operations; schedule vacuum/analyze and avoid concurrent analytics refreshes.

### P2 - beta hardening

5. Full ESLint baseline still reports 154 pre-existing errors across 41 legacy files. The current build and targeted changed-file lint pass, but the debt obscures future regressions.
6. Dependency vulnerability audit could not run because npm is configured to `npmmirror.com`, whose registry does not support the audit endpoint. Restore the official npm registry in CI and run `npm audit --omit=dev` plus a lockfile review.
7. Fifteen remote branches are not merged into `main`; merged historical branches also remain. Inventory unique commits before pruning.
8. Large lazy chunks remain for charts and XLSX. They do not block the initial route, but Price Research and export performance should be measured on mid-range phones.

## Data work still requiring human decisions

- Review 13 blocked dial records: 12 Rolex `116500LN` candidates appear to resolve to White; Patek/Rolex catalog evidence must be attached before field-scoped promotion. Preserve `52506` as the more specific `Ice Blue` when raw/catalog evidence supports it.
- Bundle canary: 329 children reviewed, 14 currently promotion-ready, 315 blocked. Do not suppress any parent until all relevant children are reconciled.
- Continue the checkpointed 757,433-parent multilisting export outside request paths.
- Resume image lineage only after message-to-listing relationships are proven.
- Dealer identity/contact reconciliation remains incomplete and must retain consent gates.

## Safe rollout order

1. Merge and deploy this API hardening change.
2. Smoke-test unauthorized vision endpoints, public redacted evidence, CSV export, Trading Floor, and Price Research.
3. Apply the privilege-hardening migration through the guarded workflow and verify grants.
4. Add distributed AI rate limiting and spend alerts.
5. Review the 13 dial decisions and 14 clean bundle children in Admin; promote only individually approved fields.
6. Resolve Supabase maintenance/capacity before restarting large background batches.
7. Continue dealer reconciliation, multilisting export, and then the next image-lineage batch.

## Release condition

Public beta is acceptable when API hardening is deployed, contact redaction is verified, distributed AI quotas are active, and Supabase maintenance headroom is stable. Bulk unattended promotion is not approved; normalization remains shadow-first and human-controlled.
