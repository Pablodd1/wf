# Review packet routing evidence export

This bounded, read-only bridge converts a local benchmark
`review-packets.csv` into the JSONL input accepted by
`tools/review-packets/snapshot-local.cjs`.

It makes only exact-ID `GET` requests to `watch_records` and
`normalization_shadow_v4`. It never writes to Supabase, never calls an LLM,
never stores raw messages or contact fields, and never changes
`watch_records`. The raw message is hashed locally. The frozen proposal is
copied only from the same source ID and normalization version in
`normalization_shadow_v4`; private keys inside proposed candidates are removed
or replaced by hashes. Legacy source price, currency, identity, and intent
columns are omitted so they cannot become reviewer defaults.

Use a read credential that can access both private tables. Configure secrets in
the shell or secret manager, never in a file:

```powershell
$env:REVIEW_PACKET_ROUTING_CSV="C:\local\review-packets.csv"
$env:REVIEW_PACKET_ROUTING_OUTPUT="C:\local\review-routing-export"
$env:REVIEW_PACKET_ROUTING_MAX_ROWS="100000"
$env:REVIEW_PACKET_ROUTING_BATCH_SIZE="100"
$env:SUPABASE_URL="https://PROJECT.supabase.co"
$env:SUPABASE_SERVICE_ROLE_KEY="configured-in-secret-store"
node tools/review-packets/export-routing-evidence.cjs
```

`REVIEW_PACKET_ROUTING_MAX_ROWS` has a hard ceiling of 100,000.
`REVIEW_PACKET_ROUTING_BATCH_SIZE` is capped at 100 to keep exact-ID PostgREST
queries bounded. `SUPABASE_REQUEST_TIMEOUT_MS` optionally sets a 1,000-120,000
ms GET timeout.

Local outputs:

- `routing.jsonl` — safe input for `snapshot-local.cjs`;
- `errors.jsonl` — one non-sensitive error for each rejected input row;
- `checkpoint.json` — source hash, committed byte offsets, and row counts;
- `manifest.json` — read/write/LLM counts and privacy declarations;
- `reconciliation.json` — exact `input = output + errors` proof.

If interrupted, rerun with the same input and output directory. The exporter
verifies the input SHA-256, truncates uncommitted output tails to checkpointed
byte offsets, skips committed CSV rows, and resumes. A larger row limit may be
used on resume up to 100,000.

After a reconciled export:

```powershell
$env:REVIEW_PACKET_INPUT="C:\local\review-routing-export\routing.jsonl"
$env:REVIEW_PACKET_OUTPUT="C:\local\review-packet-snapshot"
npm run snapshot:review-packets
```

Missing evidence, missing shadow rows, changed normalization versions, changed
review status, mismatched exclusive reason, candidate-count disagreement,
duplicate routing membership, malformed proposals, and unexpected response
lineage fail closed. No value is inferred.
