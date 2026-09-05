# Google Drive/GCS CSV staging importer

This Cloud Run-compatible job imports the WatchFacts CSV into the isolated
`staging` schema. It does not update `public.watch_records` and does not trust
the CSV's normalized brand, reference, currency, or price fields.

Required environment variables:

```text
DATABASE_URL       Direct or session-pooler PostgreSQL URL for Supabase
SOURCE_URI         Prefer gs://bucket/object; HTTPS download URLs also work
SOURCE_FILE_ID     Stable source identity, e.g. the Google Drive file ID
SOURCE_NAME        watchfacts_full_2026-07-03.csv
SOURCE_SIZE_BYTES  2300322738
BATCH_SIZE         5000
```

Recommended execution:

1. Copy the Drive file into a private Google Cloud Storage bucket once.
2. Build this directory as a container and run it as a Cloud Run Job.
3. Use a dedicated Supabase migration database user with access to `staging`.
4. Verify `staging.drive_import_runs` reports `COMPLETE`.
5. Run `validate_staging.sql` before promoting any row.

Reruns are safe: source row numbers and row hashes prevent duplicate staging
records. A failed job can be rerun against the same `SOURCE_FILE_ID`.

The supplied validation queries identify missing fields, duplicate source IDs,
invalid numeric prices, likely multi-watch messages, reference/price confusion,
and field differences against the current `public.watch_records` rows.
