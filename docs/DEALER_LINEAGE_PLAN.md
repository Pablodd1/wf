# Dealer And Poster Lineage

## Current evidence

- Historical `watch_records` has `seller_name` and `seller_phone`, but sampled imported rows do not populate them reliably.
- `live_ingest` preserves `channel_id`, but a channel is not automatically a verified dealer.
- `raw_records.raw_data` sometimes contains source keys such as `company_id`.
- The customer UI must not claim a seller identity until a source identity is verified and contact consent is recorded.

## Contract

```text
source system + immutable source identity
-> dealer_source_identities
-> verified dealers row
-> watch_records.dealer_id
```

Names and phone numbers are attributes of a verified dealer account, not matching keys exposed to customers.

## Backfill phases

Current discovery sample: 17,000 `auction_watches` raw rows; 10,491 (61.7%) contain `company_id`, representing 1,580 unique source-company identities. The remaining 6,509 stay unresolved unless another immutable key is verified.

1. Inventory non-null source identities by source table and identity type.
2. Create one dealer candidate per unique source identity without publishing it.
3. Detect identities that map to conflicting names, phones, or companies.
4. Human-verify conflicts and record consent/status.
5. Backfill `watch_records.dealer_id` by immutable source lineage.
6. Reconcile counts by dealer, WTS/WTB intent, and posting year.
7. Expose dealer attribution only for `VERIFIED` dealers with the required consent.

## Acceptance checks

- No raw evidence is overwritten.
- No dealer is inferred solely from message text.
- Every backfilled listing has an auditable source identity.
- WTS and WTB counts reconcile to the underlying listings.
- Unresolved and conflicting identities remain NULL and enter a review report.
