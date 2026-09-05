# Patek Philippe Duplicate Audit - Verified Dealer Rule

Generated: 2026-07-17

## Result

- Rows scanned: 513,648
- Bundle-like source rows: 283,134
- Duplicate candidates retained for review: 491,629
- Potential automatic analytics suppressions: 18

## Category Breakdown

- Exact raw message: 320,871
- Exact listing: 99,370
- Possible shared inventory: 65,493
- Date-shifted repost: 5,901
- Price-update repost: 11
- Likely repost: 1

## Safety Decision

The audit initially over-proposed suppression because the generic ingestion label
(`MYSQL_RAW`) could be interpreted as a dealer identity. The classifier now
requires a verified dealer/phone identifier before it can propose automatic
analytics suppression.

No listings were deleted, hidden, or modified. The 18 potential suppressions
remain pending a small manual sample review. All other candidates remain
historical evidence or human-review material, including bundles, price updates,
and possible cross-dealer inventory.

## Operational Follow-up

1. Review the 18 verified-dealer exact-message candidates.
2. Apply only an auditable analytics-suppression marker, never a deletion.
3. Keep price updates and different-dealer listings as market evidence.
4. Use bundle splitting before any broader duplicate action.
