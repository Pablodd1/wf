# Private normalization review-packet importer

This is the bounded bridge from an already-generated local
`normalization-review-packet-snapshot-v1` directory to only:

- `normalization_review_packets`
- `normalization_review_packet_items`

It does not write `watch_records`, copy raw messages or contact data, call an
LLM, update rows, or delete rows. Existing packet-item foreign-key constraints
still verify that each immutable source identifier exists.

## Release gate

Do not run this against production as part of code review. First apply
`20260726150000_normalization_review_packets.sql` and
`20260726160000_atomic_normalization_review_packet_import.sql` to an approved
shadow/preview database. Verify the target independently and put that exact
URL in the allowlist.

The database RPC accepts one complete packet and 1-500 matching items per
transaction. It checks the exact header shape, count, normalization version,
current immutable source hash, stable proposal hash, deterministic packet/item
identity, exclusive reason, candidate count, contiguous ordinals, exclusive
membership, and absence of private evidence keys. A retry succeeds only when
the stored packet and every stored item exactly match the supplied content.

## Run an approved bounded import

The importer has no default target and a hard ceiling of 100,000 items.
Credentials remain environment-only.

```powershell
$env:REVIEW_PACKET_IMPORT_APPROVAL="IMPORT_PRIVATE_NORMALIZATION_REVIEW_PACKETS"
$env:REVIEW_PACKET_IMPORT_URL="https://approved-shadow-project.supabase.co"
$env:REVIEW_PACKET_IMPORT_ALLOWED_TARGETS="https://approved-shadow-project.supabase.co"
$env:REVIEW_PACKET_IMPORT_SERVICE_ROLE_KEY="<shadow service-role key>"
$env:REVIEW_PACKET_IMPORT_DIR="C:\local\review-packet-snapshot"
node tools/review-packets/import-private.cjs
```

Required input files:

- `manifest.json`
- `reconciliation.json`
- `packets.jsonl`
- `packet-items.jsonl`

Local outputs:

- `import-checkpoint.json`
- `import-reconciliation.json`

The checkpoint binds the exact target and SHA-256 of all four input artifacts.
Rerun the same command after interruption. A packet committed immediately
before interruption is safe: the RPC accepts the retry only after an exact
stored-content comparison. Changing the target or any input file requires a
new checkpoint path and a new explicit review.

Success requires:

```text
input packets = imported packets
input items = imported items
difference = 0
reconciled = true
watch_records_mutated = false
```

Test without network access:

```powershell
node --test tests/normalization-review-packet-importer.test.cjs
```
