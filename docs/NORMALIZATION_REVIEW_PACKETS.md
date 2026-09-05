# Normalization review packets

This control plane turns bounded local normalization routing artifacts into
private, immutable review packets. It records proposed corrections for later
learning and review; it never applies them to `watch_records`.

## Safety boundary

- Packet headers, membership, frozen proposals, hashes, and decisions are
  service-role only with RLS enabled.
- A source record and normalization version can belong to only one packet.
  Each packet has one exclusive reason and at most 500 ordered items.
- Packet membership and decisions are append-only. Update and delete triggers
  reject mutation.
- Raw messages and dealer contact data are not copied into packet storage.
  Items retain the SHA-256 of immutable raw evidence.
- Reviewer evidence is fetched one item at a time, contact-redacted, and
  `private, no-store`. Full contact reveal reuses
  `/api/reviewer-contact-reveal` only when one exact staged lineage row exists,
  so the existing reason and access audit remain mandatory.
- The only packet decision is `CORRECTION_PROPOSED`. The database transaction
  rejects stale raw/proposal hashes and never updates `watch_records`.

## Protected API

All routes require an authenticated `reviewer` or `admin` cookie.

- `GET /api/review-packets?limit=50&after=<packet-id>` returns bounded packet
  summaries.
- `GET /api/review-packets?packetId=<packet-id>&limit=50&afterOrdinal=0`
  returns compact keyset-paginated items.
- `GET /api/review-packet-item?itemId=<item-id>` lazily returns one frozen
  proposal and one redacted source-evidence record.
- `POST /api/review-packet-decision` is same-origin only. The request is:

```json
{
  "itemId": "ri_example",
  "decision": "CORRECTION_PROPOSED",
  "fields": {
    "reference": "116500LN",
    "currency": null
  },
  "rationale": "Exact source evidence does not state a currency.",
  "expectedRawSha256": "64 lowercase hex characters",
  "expectedProposalSha256": "64 lowercase hex characters",
  "evidenceHashes": [
    "raw SHA-256",
    "proposal SHA-256"
  ]
}
```

Supported correction fields are `brand`, `reference`, `dial_color`,
`condition`, `year`, `price_raw`, `price_usd`, `currency`, and `listing_type`.
Null means the reviewer is explicitly proposing an unresolved value; it is not
an inferred default.

## Local snapshot

The snapshot tool reads only a local JSONL routing artifact and writes only
local files. It contains no Supabase client, database importer, or network
call. The hard maximum is 100,000 input rows and packet size is at most 500.

Each input line must contain:

```json
{
  "source_record_id": "immutable-source-id",
  "normalization_version": "v4.2-line-condition",
  "review_status": "PENDING",
  "review_reasons": ["CURRENCY_AMBIGUOUS"],
  "raw_message_sha256": "64 lowercase hex characters",
  "frozen_proposal": {
    "candidate_count": 1,
    "proposed_candidates": []
  }
}
```

`raw_message` may replace `raw_message_sha256` for a local-only input; the tool
hashes it and never writes it to output. Raw-message, raw-line, seller, phone,
contact, and email keys are removed from frozen proposals. Raw lines are
replaced by hashes.

```powershell
$env:REVIEW_PACKET_INPUT="C:\local\routing.jsonl"
$env:REVIEW_PACKET_OUTPUT="C:\local\review-packet-snapshot"
$env:REVIEW_PACKET_MAX_ROWS="100000"
$env:REVIEW_PACKET_SIZE="250"
npm run snapshot:review-packets
```

Outputs:

- `packets.jsonl`
- `packet-items.jsonl`
- `errors.jsonl`
- `checkpoint.json`
- `manifest.json`
- `reconciliation.json`

The checkpoint records output byte offsets. A resume truncates any uncommitted
tail before continuing, which prevents duplicate membership after interruption.
Resume also requires the same input hash and packet size; its row bound may be
raised, but never above the hard 100,000-row ceiling. The input path cannot
collide with any output artifact. Input rows reconcile exactly to packet items
plus errors.

The tool deliberately does not import the files. A later reviewed deployment
must apply the migration, verify query plans and RLS in a non-production
environment, and use a separately authorized service-only bounded importer.
