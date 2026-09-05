# Rolex Repost and Duplicate-Candidate Audit Pilot

## Executive Result

The read-only pilot scanned 1,000 production `watch_records` rows for `Rolex` on 2026-07-17.

| Metric | Result |
| --- | ---: |
| Rows scanned | 1,000 |
| Repost or duplicate-candidate members | 202 |
| Safe automatic suppressions proposed | 1 |
| Review-only candidates | 201 |
| Bundle-like source rows | 506 |
| Price-update reposts | 180 |
| Exact-listing matches | 17 |
| Exact raw-message matches | 2 |
| Likely reposts | 3 |

No production row was changed, hidden, or deleted. The 202 figure is a review queue, not a count of duplicate physical watches and not a deletion recommendation.

## Interpretation

Most candidates are dated price updates, not duplicate physical watches. They remain useful as historical observations and must not be erased from the raw archive.

More than half of the pilot came from bundle-like dealer messages. Those rows are review-only because their normalized fields can originate from separate lines of the same source message. They must be segmented before any duplicate decision is trusted.

Only one row met the conservative proposal for analytics suppression. Suppression is not yet applied: it requires a reversible duplicate-cluster record, reviewer sampling, and shadow-count reconciliation before it affects Trading Floor or Price Research totals.

## Correct Reading of the Result

| Classification | What it means | Customer-facing action today |
| --- | --- | --- |
| `PRICE_UPDATE_REPOST` | Same source/configuration reappeared with a different dated price | Keep historical observation; count only once in a future unique-offer view after review. |
| `EXACT_LISTING` / `EXACT_RAW_MESSAGE` | Stronger repeated-source evidence | Review for reversible cluster membership; do not delete the source. |
| `LIKELY_REPOST` | Similar evidence, but not conclusive | Human review only. |
| Bundle-like source | Several listing lines may share one source message | Segment before any duplicate decision. |

## Next Step

Complete the full Patek report first, then scan Rolex in full using the same read-only process. Review exact matches, date-shifted reposts, bundle candidates, and cross-dealer candidates as separate categories before creating any duplicate-cluster decisions.
