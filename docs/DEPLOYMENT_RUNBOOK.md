# Deployment Runbook

## Current Checks

```bash
npm ci
npm run lint
npm run build
npm run test:normalization
npm run test:security
```

Observed 2026-07-12:

- `npm ci`: passed.
- `npm run build`: passed.
- `npm run lint`: failed with existing lint errors.

## Release Rules

- No direct pushes to `main`.
- Use small PRs.
- Run checks before PR.
- Do not run production migrations from Vercel request handlers.
- Keep rollback plan for schema and API changes.
- Deploy migration tooling separately from user-facing UI.

## Required Environments

- local development
- staging
- migration runner
- production

Each must have separate credentials.

## Service Authentication

All server-side mutation endpoints require a shared bearer token named
`INGEST_API_TOKEN`. Generate a long random value and store it only in the
deployment secret stores.

- Set the token in Vercel for the API deployment.
- Set the same token in Railway for the WhatsApp listener or migration caller.
- Redeploy both services after changing the token.
- Never place the token in Git, client-side variables, logs, or documentation.

Release condition: verify an unauthenticated mutation request returns `401`, a
request with the configured bearer token reaches normal request validation, and
the WhatsApp listener can ingest a controlled test message. Roll back both
deployments together if the caller and API token values do not match.

Browser review mutations use the authenticated dealer session instead of
exposing `INGEST_API_TOKEN` to the client. AI parse and reprocessing require the
`reviewer` or `admin` role; catalog ingestion and demo tools require `admin`.

## Telegram Webhook Authentication

Set a separate random server-only `TELEGRAM_WEBHOOK_SECRET` in Vercel, then
register the same value as Telegram's `secret_token` when configuring the bot
webhook. Telegram webhook POSTs must include the
`X-Telegram-Bot-Api-Secret-Token` header. Manual alert triggers use
`INGEST_API_TOKEN` instead.

Release condition: a webhook with the wrong secret returns `401`, a correctly
signed `/start` test reaches the configured test chat, and a manual trigger
without the bearer token returns `401`. If the secret cannot be configured,
disable the webhook route rather than accepting unsigned updates.

