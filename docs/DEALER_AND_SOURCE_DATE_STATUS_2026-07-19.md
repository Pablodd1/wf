# Dealer And Original Posting-Date Status - 2026-07-19

## Executive status

Dealer history and contact UI exist, but production has no verified dealer identities linked to listings yet. Original posting dates are also sparse. Customer-facing pages must therefore keep dealer identity/contact unavailable and show unknown dates when `listing_date` is absent.

## Read-only production evidence

| Metric | Result |
| --- | ---: |
| Total watch records (planner) | 2,631,583 |
| Records with original `listing_date` (planner) | 23,684 |
| Records without original `listing_date` (planner) | 2,607,899 |
| Raw lineage rows inspected | 17,000 |
| Raw lineage date/timestamp keys found | 0 |
| Staged source-company candidates | 1,580 |
| Verified dealers | 0 |
| Verified phone/WhatsApp identities | 0 |
| Listings linked to a dealer | 0 |

The posting-date counts are planner estimates suitable for rollout decisions. The dealer reconciliation completed without query errors and is exact for the current dealer tables.

## Available once identities are verified

The existing `dealer_profile_stats` view provides:

- total posts;
- WTS posts and active WTS listings;
- WTB posts, with NTQ counted as WTB;
- first and last known original posting date;
- number of posting years;
- dated and undated post counts.

The dealer profile API also supports authoritative rating, review count, WhatsApp-group count, location, recent linked listings, and admin/reviewer access to raw messages. No value is inferred from free text.

## Integrity correction

`created_at` is an import/database timestamp and is no longer substituted for an absent original `listing_date` in Trading Floor, Price Research, dealer history, or monthly market charts. Unknown original dates remain unknown.

## Remaining dealer rollout gate

1. Import an authenticated Rated Dealers directory export into `dealer_directory_import_staging`.
2. Review the 1,580 pending source-company candidates against that directory.
3. Approve deterministic matches and create verified `dealer_source_identities`.
4. Backfill `watch_records.dealer_id` only through immutable source lineage.
5. Publish ratings and WhatsApp contact only for verified dealers with contact consent.

Until those five steps are complete, dealer totals by person/company cannot be shown accurately to customers.
