# Critical Stage Status - 2026-07-17

## Zero-Hallucination Normalization Gate

Normalization accuracy is now enforced as an acceptance gate: unsupported values remain `null` and route to review instead of being completed by inference.

- Bare `$` no longer defaults to USD without preserved explicit context.
- Missing currency no longer defaults to USD or HKD.
- AI suggestions cannot fill missing price/currency or auto-approve a priced observation.
- Missing `K`/`M` multipliers are not silently repaired.
- Unresolved currency prevents USD conversion and Price Research admission.
- Catalog and online evidence validate identity/configuration only.

The shared contract lives in `api/_lib/ai-normalization-contract.cjs` and is enforced by `tests/zero-hallucination-contract.test.cjs`.

## 2026-07-18 follow-up

- The splash is now mounted at the application shell, so direct entry to Dealer Login, Trading Floor, and Price Research shows the same Curated Luxury opening sequence as the homepage.
- The central homepage statement follows the collection grid and its two customer destinations use dimensional gold treatments on desktop and mobile.
- Production Trading Floor reports approximately 2,391,989 customer-visible rows through server pagination.
- Shadow v4 has analyzed 2,631,468 rows. The baseline scan is complete; approximately 2,000,805 changed proposals remain pending review or targeted remediation.
- Railway was recovered from an orphaned worker lease. The current worker is healthy, but the legacy cursor is complete and the durable queue migration is not yet present in production. It must not be described as actively normalizing historical rows until the queue schema and controlled backfill are applied.
- A bounded global dial audit scanned 10,000 rows without a table-scan timeout. It sampled 447 unknown dials: 426 unresolved, 11 deterministic proposed corrections, and 10 catalog-ambiguous cases. No production watch row was changed.
- Price Research production canaries passed for Patek 3712/1A, Patek 5712/1A, Rolex 116500LN, and Rolex 52506. The Rolex 52506 included cohort has a $34,000 minimum; sub-$4,200 observations are retained as excluded evidence and do not affect the market statistics.
- All 70 targeted normalization, catalog, promotion, queue, dial, price, and review-policy tests pass.

## Verified production state

- `main` includes the image-showcase and duplicate-audit merges.
- Vercel production is ready at `watchfacts-poc.vercel.app`.
- The Trading Floor image endpoint returns 100 exact-lineage image rows.
- The customer promotion gate permits 39 of those rows and withholds 61 incomplete, implausible, non-WTS, or non-approved rows.
- The 39 remain subject to human image/catalog agreement before the image rail is treated as fully verified inventory.

## Price Research canaries

Production checks were run for the owner-critical references.

| Reference | Total sampled evidence | Eligible observations | Unique offers | Reposts | Selected cohort | Included statistics |
|---|---:|---:|---:|---:|---|---:|
| Patek Philippe 3712/1A | 1,291 | 23 | 10 | 13 | Used / Blue | 9 |
| Patek Philippe 5712/1A | 5,000 capped | 2,487 | 1,053 | 1,434 | Used / Blue | 395 |
| Rolex 116500LN | 5,000 capped | 3,849 | 1,621 | 2,228 | Unknown condition / White | 575 |
| Rolex 52506 | 1,657 | 1,320 | 557 | 763 | New / Blue | 336 |

The API previously labeled every retained exclusion as an outlier. The branch now separates:

- required-field/catalog exclusions;
- reposts counted once;
- plausibility-floor failures;
- IQR statistical outliers.

## Human review contract

- Approval requires one catalog-confirmed candidate.
- Bundle, no-candidate, currency, price-parse, and dial ambiguity flags block approval.
- Approval updates `watch_records` transactionally, writes immutable audit rows, sets `human_edited=true`, and sets confidence to exactly 100.
- A new non-blocking database constraint enforces confidence 0-100 for new and updated rows. Legacy validation remains a separate audited cleanup.

## Dealer/poster lineage

- Historical watch rows do not currently expose a reliable dealer relationship.
- Read-only scan: 17,000 `raw_records` rows, all from `auction_watches`.
- 10,491 rows (61.7%) have a source `company_id`.
- Those rows contain 1,580 unique source-company identities.
- 6,509 rows lack `company_id` and must remain unresolved unless another immutable source key is verified.
- The additive migration introduces private `dealers`, `dealer_source_identities`, and `watch_records.dealer_id`; it performs no guessed backfill.

## Security and resource corrections

- `.env.prod`, `.env.production`, and `.env.vercel` are removed from Git tracking while local copies remain ignored.
- Credential rotation and Git-history remediation are still mandatory because untracking does not erase prior commits.
- Legacy dashboard and analytics routes now redirect to live, source-backed pages; the 117,744-row static snapshot is no longer linked from production navigation.

## Release blockers still open

1. Apply the duplicate-audit `(brand, id)` index concurrently outside a migration transaction.
2. Complete full Patek duplicate scan and review false positives before any suppression.
3. Human-check image/reference/dial agreement for the 39 promoted image candidates.
4. Run unknown-dial and catalog-mismatch remediation globally.
5. Backfill only verified dealer identities after reviewing the additive schema and conflict report.
6. Rotate all exposed credentials and clean repository history.
7. Provision dealer accounts/MFA/recovery before removing the temporary beta skip.
