# WatchFacts Duplicate Audit Protocol

## Purpose

Reduce duplicate inflation without deleting market evidence. The immutable raw archive and every extracted observation remain available for audit. Customer-facing inventory and Price Research use canonical offer clusters once a duplicate decision is confirmed.

## Counts That Must Remain Separate

- Raw source messages
- Extracted listing observations
- Unique offer clusters
- Active unique offers
- Confirmed reposts/duplicates
- Price updates within an existing offer
- Human-review duplicate candidates

The 2.4M+ archive count must not be relabeled as unique watches.

## Duplicate Categories

| Category | Meaning | Default action |
| --- | --- | --- |
| `EXACT_RAW_MESSAGE` | Same source payload after removing the chat envelope | Suppress repeats from inventory and price analytics; retain lineage |
| `EXACT_LISTING` | Same dealer/source, reference, dial, condition, intent, and price | Suppress only when source identity is reliable |
| `DATE_SHIFTED_REPOST` | Same payload after removing watch/date tokens | Review or high-confidence suppress when source identity agrees |
| `LIKELY_REPOST` | Same dealer/configuration and price within tolerance | Review before suppression |
| `PRICE_UPDATE_REPOST` | Same dealer/configuration with a meaningful price change | One active offer, but preserve dated price history |
| `BUNDLE_SOURCE_REPEAT` | Repeated multi-watch source message | Cluster the bundle; keep each correctly segmented candidate |
| `POSSIBLE_SHARED_INVENTORY` | Same configuration/price from different dealers | Never auto-collapse |

## Canonical Record

For an active Trading Floor offer, prefer the newest valid observation with the strongest catalog confirmation and complete required fields. For historical Price Research, retain meaningful price changes at their original timestamps. Every cluster stores `first_seen`, `last_seen`, `repost_count`, member IDs, reason, confidence, algorithm version, and review decision.

## Safety Rules

1. Never delete or overwrite raw messages.
2. Never merge records solely because brand, reference, dial, and price match across different dealers.
3. A changed date is evidence of a likely repost, not proof that two physical watches are the same.
4. A changed price is a market event and remains in historical time-series data.
5. Bundle rows must be segmented before normalized-column duplicate decisions are trusted.
6. Only confirmed/high-confidence duplicate members are excluded from customer-facing unique counts.
7. Human reviewers can reverse a cluster decision, and all changes are audited.

## Rollout

1. Read-only Patek Philippe audit.
2. Validate examples and false-positive rate with reviewers.
3. Add duplicate cluster/member tables and indexes.
4. Run resumable reports brand by brand.
5. Enable shadow exclusion metrics.
6. Release customer-facing unique counts only after reconciliation proves no loss of legitimate inventory.
