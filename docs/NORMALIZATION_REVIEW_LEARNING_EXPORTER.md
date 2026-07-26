# Normalization review learning exporter

`tools/review-learning/export-candidates.cjs` converts immutable
`CORRECTION_PROPOSED` decisions into local, review-only rule and fixture
candidates. It does not change the normalizer, parser, catalog, UI, database,
or `watch_records`. It makes only Supabase REST `GET` requests and makes no LLM
calls.

Use an approved non-production or explicitly authorized read target. Configure
every table name explicitly so the job cannot silently select a similarly named
legacy table:

```powershell
$env:REVIEW_LEARNING_SUPABASE_URL="https://PROJECT.supabase.co"
$env:REVIEW_LEARNING_SUPABASE_SERVICE_ROLE_KEY="<server-side key>"
$env:REVIEW_LEARNING_DECISIONS_TABLE="normalization_review_packet_decisions"
$env:REVIEW_LEARNING_ITEMS_TABLE="normalization_review_packet_items"
$env:REVIEW_LEARNING_PACKETS_TABLE="normalization_review_packets"
$env:REVIEW_LEARNING_SOURCE_TABLE="watch_records"
$env:REVIEW_LEARNING_OUTPUT="audit-output/review-learning-candidates-001"
$env:REVIEW_LEARNING_MAX_DECISIONS="100000"
$env:REVIEW_LEARNING_DECISION_BATCH="250"
$env:REVIEW_LEARNING_ID_BATCH="100"
$env:REVIEW_LEARNING_MINIMUM_SUPPORT="3"
node tools/review-learning/export-candidates.cjs
```

The service key stays in the environment. Do not put it in a command transcript,
checkpoint, output file, or commit. The source table is read only for
`id,raw_message`; each raw message is hashed in memory and discarded.
Exact-ID joins reject unrequested or duplicate response lineage. Packet reason,
candidate count, frozen proposal hash, and current raw evidence hash must all
agree before a correction can enter a fixture or candidate group. Bundle
parents are not eligible for correction learning through this exporter.

Outputs:

- `rule-candidates.json` and `rule-candidates.csv`: grouped by exclusive packet
  reason, corrected field, old deterministic proposal value, and reviewer value.
  The support threshold is a reporting aid only.
- `fixture-candidates.jsonl`: item/source IDs, reason, normalization version,
  immutable hashes, and structured corrections only.
- `errors.jsonl`: decision/item IDs and fail-closed reason codes only.
- `reconciliation.json`, `manifest.json`, and `checkpoint.json`: bounded counts,
  safety declarations, and resume state.
- `rule-observations.jsonl`: private-free intermediate rows used to reproduce
  the grouped counts.

The hard ceiling is 100,000 selected decisions. If more exist,
`selection_truncated` is true; start another explicitly bounded review run only
after this run is reconciled. Rerun the same command after an interruption to
resume. A completed checkpoint refuses to run again.

Exit code `2` means the bounded selection reconciled but one or more decisions
failed evidence validation. Those rows never enter fixtures or rule candidates.
No output is permission to change a deterministic rule: an engineer must review
the candidate, add a failing fixture, implement the smallest deterministic
change, and run the full regression suite.
