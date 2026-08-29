# Unclassified Inventory Audit — August 11, 2026

## Executive verdict

Do not publish any row labeled `UNCLASSIFIED`. This state means the available source fields did not provide deterministic category evidence under the audited classifier. It does not mean the row is a confirmed non-watch item, and it does not mean the row is unusable.

The cited **288,530** total belongs to the older `wf-mariadb-non-watch-audit-v1` run over 1,394,269 immutable source rows. The stricter v2 run classifies **303,315** rows as `UNCLASSIFIED`. The totals changed because v2 deliberately stopped treating cross-category houses and weak terminology as sufficient product proof.

Neither audit performed normalization or publication writes.

## Reconciled audit totals

| Audit | Watch | Handbag | Jewelry | Accessory | Ambiguous | Unclassified | Errors |
|---|---:|---:|---:|---:|---:|---:|---:|
| v1, August 10 | 1,069,552 | 1,017 | 1,642 | 646 | 32,882 | **288,530** | 0 |
| v2, August 11 | 1,049,410 | 1,018 | 1,815 | 854 | 37,857 | **303,315** | 0 |

Both runs reconcile exactly to 1,394,269 input rows.

## What the 288,530 rows appear to be

The v1 audit retained a bounded private sample of 100 unclassified records. That sample is not a population-wide estimate, but it explains the main failure mode:

- 64 F.P. Journe
- 12 Franck Muller
- 6 Piaget
- 6 Hermès
- 5 Bell & Ross
- 4 Girard-Perregaux
- 3 Ulysse Nardin

Within the sample:

- 59 were source `search` or WTB-style records and 41 were sale records.
- 100/100 had no normalized reference in the audited source projection.
- 100/100 had a source image reference.
- 35/100 had a positive structured price.
- 94/100 used source category ID 19 and 6/100 used category ID 24.

Many sample messages are plainly watch-related, such as F.P. Journe, Franck Muller, Bell & Ross, Girard-Perregaux, Piaget, and Ulysse Nardin offers or requests. They remained unclassified because the v1 watch evidence dictionary was intentionally narrow and the records lacked a normalized reference. Hermès and Piaget require extra caution because those houses sell multiple product categories.

Therefore the 288,530 rows are best described as **category unresolved**, not as 288,530 non-watch products.

## Publication policy

`UNCLASSIFIED` and `AMBIGUOUS` rows remain outside every customer-facing publication category. They must not appear in the Trading Floor or Price Research until a later deterministic classification or signed human decision supplies the missing evidence.

Price Research remains watch-only. A non-watch classification can make a row eligible for the Trading Floor after review, but it never makes that row eligible for watch-price analytics.

## Recommended recovery lane

1. Match exact source brand and reference against the full catalog, including long-tail watch brands.
2. Validate source category IDs against the original category table instead of interpreting the number by itself.
3. Separate cross-category houses into watch, handbag, jewelry, and accessory candidates using item-level source terms.
4. Use the source image only as review evidence; do not infer a public category or publish an image without visual and lineage approval.
5. Send remaining conflicts to a bounded human-review queue.
6. Reconcile every source ID to one outcome: classified, ambiguous, or unclassified. Never silently drop or auto-publish a row.

## Evidence used

- `audit-output/mariadb-live/non-watch-full-20260810-codex-v1/report.json`
- `audit-output/mariadb-live/non-watch-full-20260810-codex-v1/private-samples.jsonl`
- `audit-output/mariadb-live/non-watch-full-20260811-codex-v2/report.json`

The `audit-output` files remain private, local evidence and are intentionally excluded from version control.
