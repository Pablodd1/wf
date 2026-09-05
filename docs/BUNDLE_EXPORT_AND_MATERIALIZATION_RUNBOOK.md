# Bundle Export and Materialization Runbook

## Recommended export format

The estimated 757,433 multi-listing parents must not be normalized from one Excel workbook.

- Authoritative machine export: checkpointed JSONL from `npm run export:multilistings`.
- Archive copy: gzip the completed JSONL after verifying its checkpoint.
- Human review slices: CSV or XLSX with 10,000 to 25,000 parent rows per file.
- Small review assignments: 1,000 to 5,000 parents when every child line must be checked manually.

Excel supports 1,048,576 rows per sheet, but that limit is not a practical target for raw messages and nested candidate data. JSONL remains streamable and resumable if the process or workstation stops.

Do not send the complete archive to an LLM. Deterministic segmentation, price parsing, catalog checks, and confidence gates run first. AI and human review receive only unresolved candidates.

## Step 1: persist an exact bundle cohort

Dry run is the default:

```powershell
$env:BUNDLE_COHORT_ROWS="10000"
$env:BUNDLE_COHORT_WRITE="false"
railway run npm run persist:bundle-cohort
```

After the dry-run report shows zero missing sources and zero missing raw lineage, persist only to `normalization_shadow_v4`:

```powershell
$env:BUNDLE_COHORT_WRITE="true"
railway run npm run persist:bundle-cohort
```

The report is written to `audit-output/bundle-cohort-persist/report.json`. A write run refetches every selected row and requires exact normalized content reconciliation.

## Step 2: reconcile

Required release evidence:

- selected parent count equals source count;
- every child raw line exists in the immutable parent raw message;
- persisted count equals selected parent count;
- persisted mismatches equal zero;
- no `watch_records` row is updated;
- no promotion decision is created.

## Step 3: bounded staging canary

The child canary targets `watch_staging`, never the live Trading Floor table. Default execution is a dry run over 25 parents, with a hard maximum of 100 parents:

```powershell
$env:BUNDLE_MATERIALIZE_PARENTS="25"
$env:BUNDLE_MATERIALIZE_WRITE="false"
railway run npm run materialize:bundle-canary
```

Review `audit-output/bundle-child-canary/children.jsonl` and `report.json`. Then allow the staging write:

```powershell
$env:BUNDLE_MATERIALIZE_WRITE="true"
railway run npm run materialize:bundle-canary
```

Every staging child has:

- a deterministic UUID, so reruns are idempotent;
- exact raw listing text;
- `bundle_child:<parent ID>` source lineage;
- parent ID and child index flags;
- `PENDING` verdict and confidence `0`;
- review flags for missing identity, dial, price, implausible price, or weak currency evidence.
- an adjacent-dial guard: a recognized dial term immediately after the exact reference overrides inherited parent dial text and records `DIAL_RAW_SOURCE_CONFLICT` for review.

No child becomes customer-facing or Price Research eligible through this command. Human/catalog review and a separate promotion decision remain mandatory.

## Verified July 18 canaries

- Exact shadow cohort: 10,000 parents, 115,486 children, 100% raw-line lineage, 10,000 persisted matches, zero mismatches.
- Staging cohort: 25 parents, 329 children, 329 persisted, zero missing or mismatched rows.
- 184 staged children have explicit review flags.
- All staged children remain `PENDING` at confidence `0`; no live listing was changed.

## Full export verification

```powershell
railway run npm run export:multilistings
Get-Content .\audit-output\multilistings\checkpoint.json
Get-Item .\audit-output\multilistings\multilistings.jsonl |
  Select-Object FullName, Length, LastWriteTime
```

If interrupted, rerun without `MULTILISTING_RESET=true`; the JSONL exporter resumes from its checkpoint.
