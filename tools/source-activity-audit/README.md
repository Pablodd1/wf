# Source Activity Audit

Read-only archive audit for observed poster coverage, WTS/WTB intent, and posting-year history. It does not update Supabase and does not publish seller identity.

Observed phone/name values are converted to keyed HMAC pseudonyms before they enter the report. These pseudonyms are operational evidence only; they are not verified dealers.

The audit first joins `watch_records.flags.source_table + flags.mysql_id` to `raw_records.source_table + raw_data.id`. When `raw_data.company_id` exists, it becomes the strongest observed source-company evidence. Seller columns and structured chat-envelope phones are fallback evidence only.

## Pilot

```powershell
$env:SOURCE_AUDIT_HASH_KEY = '<random secret used only for this audit>'
$env:SOURCE_AUDIT_MAX_ROWS = '5000'
$env:SOURCE_AUDIT_PAGE_SIZE = '500'
$env:SOURCE_AUDIT_RESUME = 'false'
railway run npm run audit:sources
```

## Full resumable scan

Use the same `SOURCE_AUDIT_HASH_KEY` for every resumed run and keep it outside Git.

```powershell
$env:SOURCE_AUDIT_HASH_KEY = '<same audit secret>'
Remove-Item Env:SOURCE_AUDIT_MAX_ROWS -ErrorAction SilentlyContinue
$env:SOURCE_AUDIT_PAGE_SIZE = '500'
$env:SOURCE_AUDIT_RESUME = 'true'
railway run npm run audit:sources
```

Reports are written to `audit-output/source-activity/`, which is ignored by Git. Delete the checkpoint or choose a different `SOURCE_AUDIT_OUTPUT` to begin a new audit.

`SOURCE_AUDIT_INCLUDE_RAW_MESSAGE` defaults to `false` so the full archive scan does not transfer millions of large message bodies. Set it to `true` only for a bounded pilot that needs structured chat-envelope phone fallback. Full reporting still uses source-company lineage and populated seller columns.
