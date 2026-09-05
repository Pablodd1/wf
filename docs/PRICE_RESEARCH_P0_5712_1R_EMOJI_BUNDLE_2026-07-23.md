# P0 Price Research Root Cause: 5712/1R Emoji-Bullet Bundle

**Status:** Fixed in review branch; not yet deployed to production.

## Finding

The live `Patek Philippe / 5712/1R / Black / New` cohort included two values at
`$1,050,000`. A source-lineage inspection showed both are nine-item dealer
inventory messages. The `5712/1R` item explicitly states `HKD 1.73m`; the
later `5303R` item states `1.05m USDT`.

The prior logical-line splitter only recognized newlines. This message uses
emoji bullets on one physical line, so `referenceBlock` reached the later
`5303R` price and incorrectly treated it as the `5712/1R` price.

## Verified Evidence

Affected immutable source IDs:

```text
mysql_auctions_7bd1fa3e-dd6f-4825-b3ea-636d9c28ac38
mysql_auctions_f3aacafe-ea63-4036-9777-beddbd165525
```

Before the fix, each was published in the selected cohort as `$1,050,000`.
The corrected deterministic parser finds:

```text
5712/1R 5/2025 NEW HKD 1.73m
```

and derives `$221,795`. It also identifies nine listing candidates in each
parent message, which disqualifies the unsplit parent from Price Research.

## Correction

- `splitMessageLines` now recognizes newlines, valid emoji bullets, and the
  observed UTF-8 mojibake bullet form.
- `segmentDealerMessage` and `referenceBlock` use the same splitter.
- Unsplit emoji-bullet messages now remain bundle/multi-listing evidence rather
  than lending a later item's price to an earlier reference.

## Regression Coverage

- `tests/normalization-v4.test.cjs`: emoji-bullet message becomes two
  candidates with their own prices.
- `tests/market-row-normalization.test.cjs`: `5712/1R` cannot borrow the later
  `5303R` USDT amount.
- `tests/inspect-live-price-cohort.test.cjs`: source-lineage inspection flags
  selected multi-listing rows.

The focused suite passed 73 tests on 2026-07-23. No `watch_records` row was
changed during investigation. Production must be re-queried after deployment;
the expected result is that the two unsplit parents move into excluded evidence
and no longer influence the New cohort.
