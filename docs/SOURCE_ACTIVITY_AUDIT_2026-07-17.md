# Source And Poster Activity Audit - 2026-07-17

## Scope

The read-only production audit scanned `watch_records` by primary-key pages and joined immutable import lineage from:

```text
watch_records.flags.source_table + flags.mysql_id
-> raw_records.source_table + raw_data.id
-> raw_data.company_id
```

No production row was updated, deleted, suppressed, or published. Poster values were written only as keyed HMAC pseudonyms in the ignored local report directory.

## Exact archive result

| Metric | Count |
| --- | ---: |
| Rows scanned | 2,631,583 |
| WTS | 2,307,168 |
| WTB including NTQ | 308,449 |
| Unknown intent | 15,958 |
| Other luxury | 8 |
| Observed poster pseudonyms | 1,570 |
| Rows with poster evidence | 9,539 |
| Rows without poster evidence | 2,622,044 |
| Poster-evidence coverage | 0.36% |

Poster evidence consisted of 9,502 rows linked through `raw_data.company_id` and 37 rows with a populated seller-phone column. An observed poster is not a verified dealer and must not be shown to customers until dealer verification and contact consent are complete.

## Posting-year coverage

This table came from the original v1 audit, which used `listing_date` first and then substituted `created_at`. That substitution is now retired because `created_at` is often the database import timestamp. These year totals must not be used as original posting history.

| Year | Rows |
| --- | ---: |
| 2010-2024 combined | 13,753 |
| 2025 | 377,967 |
| 2026 | 2,238,277 |
| 2027-2028 | 9 |
| Unknown | 1,576 |

The v2 audit uses only `listing_date`. Production planner statistics on 2026-07-19 found approximately 23,684 dated rows and 2,607,899 undated rows out of 2,631,583 total. Missing original dates must remain unknown.

## Source-system reconciliation

| Source | Rows |
| --- | ---: |
| auction_watches | 987,616 |
| auctions | 875,682 |
| WATCHES_FINAL_V2 | 507,999 |
| MYSQL_RAW | 155,630 |
| WTB_LOOKING_FOR | 100,000 |
| listings | 4,515 |
| demo-ui | 93 |
| WhatsApp | 37 |
| jewelry_archive | 8 |
| preview_seed | 3 |

The 96 `demo-ui`/`preview_seed` records must remain excluded from customer analytics and counts. Their continued database presence is acceptable only if customer APIs enforce fixture exclusion.

## CTO decisions

1. Do not display source-table labels as dealer identities.
2. Create dealer candidates only from immutable `company_id` lineage; do not infer verified dealers from names or free-form messages.
3. Backfill `watch_records.dealer_id` only after conflicts are reviewed and a source identity is verified.
4. Keep phone/name pseudonyms restricted to operations; customer attribution additionally requires consent.
5. Add Admin metrics for attributed rows, unresolved rows, observed-company count, WTS/WTB mix, and posting-year quality only after the lineage backfill is audited.
6. Route 15,958 unknown-intent rows to the targeted intent classifier rather than assuming WTS.
7. Review the nine future-dated rows and 1,576 undated rows before publishing longitudinal posting analytics.

## Reproducibility

The implementation is in `tools/source-activity-audit/`. Reports are generated under ignored `audit-output/source-activity/` directories. The full scan completed with 1,000-row bounded REST pages and no production mutation.
