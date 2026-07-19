# Dealer Coverage Pilot - 2026-07-19

## Scope

Read-only source activity audit executed through the linked Railway production worker. The pilot scanned 5,000 historical listing rows and did not publish, update, or delete any listing or dealer record.

## Result

| Metric | Result |
|---|---:|
| Rows scanned | 5,000 |
| Verified dealer identities observed | 0 |
| Rows with resolved dealer identity | 0 |
| Rows unresolved | 5,000 |
| WTS posts | 4,090 |
| WTB posts | 805 |
| Unknown intent | 105 |
| Posts dated 2025 | 3,072 |
| Posts dated 2026 | 1,915 |
| Unknown posting year | 13 |

The audit also loaded 10,491 source-lineage rows available for reconciliation, but the sampled watch rows did not carry a customer-safe verified dealer relationship. This is consistent with the existing dealer-lineage findings and does not mean that 5,000 distinct dealers exist.

## Expanded pilot and blocker

A second read-only run scanned 50,000 rows. It returned 41,746 WTS posts, 8,149 WTB posts, 105 unknown-intent rows, 30,463 posts dated 2025, 19,409 dated 2026, and 128 with no posting year. It still resolved zero poster identities.

The join diagnostic found that sampled `watch_records` rows do not contain the `flags.source_table` and `flags.mysql_id` values required by the current raw-lineage join. A broad production query looking for non-null flags also hit the database statement timeout. This is a lineage/indexing blocker, not evidence that the rows have no dealers. The identity migration must repair or expose a bounded indexed source key before dealer counts can be trusted.

## Customer-safety conclusion

The current dealer contact workflow is correctly conservative. It can show a dealer profile or WhatsApp action only when the listing is linked to a `VERIFIED` dealer, the identity is verified, and contact consent plus a verified phone are present. No phone, name, or source-company ID should be promoted from this pilot alone.

## Next steps

1. Complete the checkpointed source-company scan and reconcile the 1,580 staged source identities against an authenticated dealer directory export.
2. Repair the source-key join with a bounded indexed mapping from the actual imported record identity to `raw_records`; do not use an unindexed JSON null scan.
3. Resolve conflicts between company IDs, names, phones, channels, and posting groups manually or through an approved identity map.
4. Backfill `watch_records.dealer_id` only for approved matches.
5. Recompute each dealer's WTS, WTB/NTQ, active-listing, posting-year, group, and review metrics.
6. Re-run Trading Floor detail and WhatsApp contact tests for verified rows only.
7. Keep non-watch pilot records marked `UNNORMALIZED` until their source message, category, dealer lineage, and image are reviewed.
