# Telegram Shadow Pipeline Pilot

## Purpose

Connect one approved Telegram group to the WatchFacts normalization pipeline
without changing `watch_records`, Trading Floor, Price Research, reviewed
workbooks, or another developer's release work.

```text
allowlisted Telegram group
-> authenticated existing bot webhook
-> immutable telegram_ingest_shadow_events
-> deterministic v4.2 worker
-> optional AI image suggestion
-> telegram_ingest_shadow_results (PENDING review)
```

AI output is advisory only. The pilot has no promotion path.

## Telegram prerequisites

1. The bot must be a member of the test group.
2. To receive ordinary group messages, disable BotFather privacy mode for this
   bot or make the bot a group administrator with the required visibility.
3. While capture is disabled, send `/chatid` in the group to obtain its numeric
   ID. Store it as a server secret; do not commit it.
4. Telegram permits one webhook per bot. Keep the existing
   `/api/telegram-bot` webhook and add shadow capture inside that route rather
   than registering a competing webhook.

## Server-only configuration

Configure these in Vercel/Railway secret stores. Never place values in Git or
chat transcripts.

```text
TELEGRAM_BOT_TOKEN
TELEGRAM_WEBHOOK_SECRET
TELEGRAM_SHADOW_CAPTURE_ENABLED=true
TELEGRAM_SHADOW_ALLOWED_CHAT_IDS=-100...
TELEGRAM_SHADOW_MAX_ATTEMPTS=3
SUPABASE_URL
SUPABASE_SERVICE_ROLE_KEY (or SUPABASE_SECRET_KEY)
```

Optional image suggestions require:

```text
TELEGRAM_SHADOW_VISION_ENABLED=true
TELEGRAM_VISION_API_URL=https://<deployment>/api/batch-image-dial
INGEST_API_TOKEN
KIMI_API_KEY (configured only on the API deployment)
```

## Release sequence

1. Apply only `20260801120000_telegram_ingest_shadow.sql` to the selected
   staging/shadow Supabase project.
2. Deploy the branch to a preview deployment.
3. Register the preview `/api/telegram-bot` URL using Telegram's
   `secret_token` option, or use the same route after the reviewed merge.
4. Send one text-only WTS test, one WTB test, one image-with-caption test, one
   multi-watch message, and replay one identical update.
5. Verify exact input-event reconciliation, one stored event per Telegram
   update, raw text unchanged, image `file_id` preserved, and zero production
   writes.
6. Run one Railway worker only:

   ```text
   npm run telegram:shadow-worker
   ```

7. Review deterministic and vision suggestions manually. Do not enable any
   promotion or customer-facing publication during this pilot.

## Acceptance checks

- Wrong webhook secret returns `401`.
- Non-allowlisted chats are acknowledged but not stored.
- Duplicate Telegram delivery creates no duplicate event.
- Atomic claims prevent two workers from processing the same event, and failed
  events stop retrying after the configured attempt limit.
- Normal group posts receive no bot response.
- Raw messages and Telegram payloads remain unchanged.
- Vision runs only when an exact Telegram photo belongs to the same update.
- Every result remains `PENDING` and `READY_FOR_REVIEW` or `ERROR`.
- `watch_records` receives zero writes.

## Rollback

Set `TELEGRAM_SHADOW_CAPTURE_ENABLED=false` and redeploy. The bot command
behavior remains available, while group capture stops. Preserve existing shadow
events as immutable audit evidence.
