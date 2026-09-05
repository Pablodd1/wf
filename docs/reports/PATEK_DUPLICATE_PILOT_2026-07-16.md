# Patek Philippe Duplicate Pilot

## Executive Result

The read-only pilot scanned 1,000 production `watch_records` rows for `Patek Philippe`.

| Metric | Result |
| --- | ---: |
| Rows scanned | 1,000 |
| Duplicate/repost candidates | 275 |
| Safe proposed suppressions | 25 |
| Review-only candidates | 250 |
| Bundle-risk rows | 441 |
| Price-update reposts | 236 |
| Exact-listing matches | 26 |
| Exact raw-message matches | 7 |
| Likely reposts | 6 |

No production row was changed, hidden, or deleted.

## What The Numbers Mean

The candidate rate is 27.5%, but it is not a deletion rate. Most candidates are price updates or come from bundle-like source messages. Those observations must remain available for historical price movement or be segmented correctly before a duplicate decision is trusted.

Only 25 rows (2.5% of the pilot) currently meet the conservative automatic-suppression proposal. Even those remain preserved as source evidence and would only be excluded from customer-facing unique counts after shadow validation.

## Confirmed Data Risk

441 rows contain bundle-like source text. Production samples show cases where a row's normalized reference and price can originate from different lines in the same dealer inventory message. Therefore:

- normalized columns alone are insufficient for bulk deletion;
- bundle segmentation must precede final duplicate decisions;
- price changes must remain dated market observations;
- identical stock from different dealers must remain separate unless shared-inventory evidence is confirmed.

## Full-Scan Blocker

The full Patek run reached 1,500 rows and then Supabase cancelled the query with statement timeout `57014`. Production has separate brand and primary-key indexes, but the audit query requires a composite `(brand, id)` index for stable keyset pagination.

Run `tools/duplicate-audit/create-indexes.sql` manually outside peak traffic. The script uses `CREATE INDEX CONCURRENTLY` and must not be wrapped in a transaction.

## Safe Rollout Condition

1. Composite index completes successfully.
2. Full Patek report completes without statement timeout.
3. Reviewers inspect exact, date-shifted, bundle, and cross-dealer samples.
4. False-positive rate is acceptable for each category independently.
5. Duplicate clusters are stored with canonical ID, member IDs, reason, confidence, first/last seen, and reversible review status.
6. Shadow customer counts reconcile before any duplicate exclusion reaches Trading Floor or Price Research.

The raw archive count remains unchanged. The product should show separate counts for raw observations, unique offer clusters, active unique offers, reposts, and review candidates.
