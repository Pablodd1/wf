# Security Requirements

## Immediate Requirements

- Rotate all credentials previously shared in chat or committed to Git.
- Remove `.env*` files from tracking.
- Purge secrets from Git history.
- Add secret scanning to CI.
- Use separate production, staging, and temporary migration credentials.
- Use read-only source DB credentials for audits.
- Do not expose service-role keys to browser code.
- Protect write routes with authentication and authorization.
- Validate webhooks and enforce idempotency.

## Current Findings

- `.env.prod`, `.env.production`, and `.env.vercel` are tracked.
- MySQL credentials are present in scripts.
- Several API routes use service-role key server-side. That is acceptable only if routes are authenticated and hardened.
- `api/ingest.js` permits broad CORS and unauthenticated POST ingestion in the observed code.

## Required CI Gates

- secret scan
- lint
- build
- dependency audit
- migration dry-run tests
- API auth tests

