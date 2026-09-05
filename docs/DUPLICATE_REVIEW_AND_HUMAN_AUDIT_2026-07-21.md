# Duplicate Review and Human Audit Workflow

## What changed

Human Review now has three lanes:

- **All unbundled batches** for manually separated children.
- **Normalization corrections** for deterministic shadow proposals.
- **Duplicate candidates** for repost and duplicate observations.

For shadow corrections, the reviewer receives the preserved source message,
seller name, seller phone, original posting date, source, listing fields, and
image evidence when those fields exist. The AI review assistant remains
advisory only: it can quote raw evidence and suggest interpretations, but it
cannot confirm the catalog, approve a record, or publish contact information.

## Duplicate safety rule

The duplicate workflow is intentionally non-destructive:

1. The scanner produces candidate pairs and evidence.
2. Candidates are staged in `duplicate_review_candidates` with `PENDING` status.
3. A reviewer compares both raw messages and source context.
4. `SUPPRESS` excludes the candidate duplicate from Price Research analytics.
5. `KEEP_BOTH` preserves both observations.
6. `DEFER` leaves the candidate unresolved.

No raw message or `watch_records` row is deleted. Bundle-risk candidates remain
review-only until child lineage is proven. Different dealers are not merged
automatically, and a changed date or price is not by itself proof of the same
physical object.

## Staging candidate reports

After the migration is approved in the target environment, stage a bounded
candidate report with:

```powershell
$env:DUPLICATE_CANDIDATE_CSV = "audit-output/duplicates/patek-philippe/candidate-clusters.csv"
$env:DUPLICATE_CANDIDATE_MAX_ROWS = "100"
$env:DUPLICATE_CANDIDATE_SCAN_LIMIT = "20000"
$env:DUPLICATE_REVIEW_SELECTION_OUTPUT = "audit-output/duplicates/patek-philippe/review-batch-001.csv"
$env:APPLY_DUPLICATE_REVIEW_CANDIDATES = "true"
railway run npm run stage:duplicate-review
```

The command skips unresolved bundle-risk rows and synthetic child IDs, saves
the exact selected review batch, validates source IDs when writing, and writes
only to the private review table. It reports `publicRowsMutated: 0`. Do not
stage a full-brand report until the first bounded candidate set has been
audited.

Before any decision, run the read-only source-evidence join against the saved
batch:

```powershell
$env:DUPLICATE_REVIEW_SELECTION_CSV = "audit-output/duplicates/patek-philippe/review-batch-001.csv"
$env:DUPLICATE_REVIEW_EVIDENCE_OUTPUT = "audit-output/duplicates/patek-philippe/review-batch-001-evidence.json"
railway run node tools/duplicate-audit/audit-review-batch.cjs
```

This report joins each pair to the original `watch_records` row and records
raw-message, seller, intent, date, and source relationships. It writes no
database rows and never auto-approves a decision.

## Approval boundary

The duplicate migration is committed on the working branch only. It must be
applied through the reconciled migration process before staging candidates.
The first visible result should be the Duplicate candidates lane, not an
automatic deletion or public suppression. Public-floor changes require a
separate reviewed rollout.
