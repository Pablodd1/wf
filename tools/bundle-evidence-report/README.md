# Bundle Evidence Report

Creates a read-only CSV review queue for records flagged `BUNDLE_SPLIT_REQUIRED`.

Each row retains its source-record ID, original raw message, proposed candidate lines, source metadata, and a conservative disposition. `SAFE_SPLIT_CANDIDATE` has a raw message, multiple candidates, references, and no ambiguous dial/currency condition. Everything else remains `HUMAN_REVIEW_REQUIRED`.

The script never deletes, splits, promotes, or mutates production data.

```powershell
$env:BUNDLE_REPORT_MAX_ROWS = '1000'
railway run node tools/bundle-evidence-report/generate-bundle-evidence-report.cjs
```

Set `BUNDLE_REPORT_MAX_ROWS` to `0` only for the full flagged set. Start with bounded queues; output is intentionally ignored by Git.

To continue after the highest `source_record_id` in a completed CSV, set `BUNDLE_REPORT_START_AFTER` to that ID before running the next batch. This keeps review queues small and avoids repeating earlier rows.
