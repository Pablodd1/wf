# Phase 5A Rolex price-evidence remediation audit

## Technical summary

Rolex must remain blocked for automatic WTS price correction. The reconciled immutable Phase 4B/4C blocker union contains **9,936 rows** after removing **113 rows** that appeared in both the Phase 4C supported-currency cohort and the literal-AED cohort. No production row, raw message, parser rule, UI, schema, publication rule, or evidence standard changed.

The audit observed **73 rule-recoverable rows inside bounded evidence** and estimates **175 potentially recoverable rows** across the known union. None is automatically correctable now. Three HKD observations require a parser fixture proving their explicit multiplier grammar. The remaining estimated 172 are literal-AED observations that require a separately approved historical dated FX integration. The estimate is not an authorization or a frozen write cohort.

## Blocker distribution

| Blocker | Exact rows | Deterministic remediation | Human review | Parser/evidence change | False-positive risk | Estimated recoverable WTS |
| --- | ---: | --- | --- | --- | --- | ---: |
| `PRICE_CURRENCY_REVIEW` | 6,543 | No rule passed | Yes | No broad parser change justified | High | 0 |
| `MULTIPLE_PRICE_AMBIGUITY` | 196 | No exact association passed | Yes | Required for a future grammar-bound association | High | 0 |
| `NO_EXACT_AUTO_APPROVED_PRICE` | 2,391 | No | Yes; new source evidence may be required | No rule justified | Critical | 0 |
| `BUNDLE_OR_MULTIPLE_CONTEXT` | 123 | No exact association passed | Yes | Candidate/segment grammar required | High | 0 |
| `IMPLAUSIBLE_HKD` | 12 | Possible for explicit multiplier syntax only | Yes | Narrow multiplier fixture required | Medium when explicit; otherwise high | 3 |
| `AED_WITHOUT_APPROVED_FX` | 671 | Conditional only | Yes until FX path is approved | Historical dated FX integration required | Medium only with exact line/date; otherwise high | 172 |
| **Total** | **9,936** |  |  |  |  | **175 estimated** |

The reconciled outcome is:

- recoverable by deterministic rule, observed in bounded evidence: **73**;
- estimated recoverable across the known union: **175**;
- review-only estimate: **7,370**;
- permanently unresolved absent new source evidence: **2,391**;
- automatically correctable now: **0**.

## Exact source syntax patterns

No raw messages are reproduced. The sanitized patterns observed were:

| Blocker | Dominant exact syntax templates |
| --- | --- |
| `PRICE_CURRENCY_REVIEW` | unlabeled numeric amount; bare-dollar amount; named currency in shared/adjacent context; exact reference and named currency without one parser-approved price |
| `MULTIPLE_PRICE_AMBIGUITY` | one reference line inside a message containing multiple prices; multiple reference/price lines; AED in shared context |
| `NO_EXACT_AUTO_APPROVED_PRICE` | unlabeled numeric amount; named currency without a unique exact-reference price span; bare-dollar amount |
| `BUNDLE_OR_MULTIPLE_CONTEXT` | bundle/multiple segments; bare-dollar child lines; named currency in a shared parent context |
| `IMPLAUSIBLE_HKD` | exact reference with `HKD` amount of 1–3; three bounded rows also contained explicit multiplier syntax and remain proposed fixtures, not approved prices |
| `AED_WITHOUT_APPROVED_FX` | exact reference and literal `AED` on the same line; literal `AED` in shared/adjacent context |

Thirty-seven additional rows used `Dhs`, `Dh`, or `dirham` without literal `AED`. They were not promoted because those aliases do not, by themselves, prove the national currency or the correct FX series.

## Multiple-price investigation

The shadow rule required all of the following: exactly one normalized reference line, exactly one price candidate on that line, exactly one parser-v5 `AUTO_APPROVED` observation, explicit currency, no bundle grammar, immutable source lineage, and no use of ordering, amount proximity, or market value. No row in the multiple-price or bundle blocker classes passed that full contract. These classes remain human-review only.

## AED historical-FX proposal

The Central Bank of the UAE publishes official historical daily rates against AED. Its historical page states that rates are updated Monday through Friday at 18:00 UAE time and that the prior published rate applies when a market is closed. The monthly public PDFs provide a date, currency, and AED-per-unit rate; for example, the June 2026 document records the US Dollar rate as 3.6725 AED per USD on 1 June 2026.

That source is technically capable of supporting a dated AED-to-USD conversion, but it is **not integrated or approved**. A future implementation must divide the explicit AED amount by the dated official US Dollar rate, select only the latest official observation on or before the immutable source date, retain the official document URL and checksum, prove rate direction, and fail closed on missing dates, future rates, invalid rates, aliases, bundles, or multiple prices. Legal and operational review of the publisher's stated VAT-related purpose and disclaimer is required before adoption.

Sources:

- https://www.centralbank.ae/en/forex-eibor/exchange-rates
- https://www.centralbank.ae/en/forex-eibor/exchange-rates/historical-exchange-rates/june-2026/
- https://www.centralbank.ae/media/rpapxzng/fx_jun26_en.pdf

## Methodology and reconciliation

Phase 4B supplied exact blocker counts for 9,333 rows. Phase 4C supplied a frozen 285-row parser cohort and a literal-AED count of 431. Row-level read-only reconciliation proved 113 AED rows overlapped the supported-currency cohort, leaving 318 AED-only rows and an exact known union of 9,936.

The large Phase 4B population was not downloaded again. A deterministic 2,395-row sample used UUID partitions `0`, `4`, `8`, and `c` of 16. All 431 literal-AED rows were re-read in bounded UUID shards. Recovery estimates extrapolate only the Phase 4B sample rate and add exact recoverable results from the bounded Phase 4C supplement. Because UUID partitions are deterministic rather than a randomized statistical sample, the estimate has no claimed confidence interval and must not be treated as a write cohort.

The current supported-marker refresh returned 294 rows, nine more than the frozen Phase 4C cohort. Those nine rows were recorded as drift and excluded from the immutable Phase 5A union; they require a future separately frozen cohort.

## Proposed parser and evidence improvements

1. Add a shadow-only exact-reference-line grammar that requires one reference, one explicit named currency, one amount, and one parser-approved observation. Do not use ordering or amount proximity.
2. Add explicit multiplier fixtures for the three HKD patterns before considering any parser change. Preserve amount and multiplier source spans separately.
3. Build a CBUAE historical-document adapter only after source-use approval. Retain observation date, document URL, checksum, fetch time, rate direction, and formula version.
4. Keep generic `Dhs`/`Dh`/`dirham`, bare `$`, shared headers, multi-price lines, and bundle parents fail-closed.
5. Run a new read-only shadow replay. Only a later explicit authorization may freeze a small production canary.

## Decision

`ROLEX_AUTOMATIC_WTS_CORRECTIONS = BLOCKED`

`P3-RLX-001` remains `CANARY_PASSED` from Phase 4A. `WTS_PRICE_RESEARCH_CANARY` remains `BLOCKED_NO_SAFE_COHORT`. Phase 5A does not authorize Phase 4D or any production correction.

**NO PRODUCTION DATA WAS MODIFIED.**

**NO RAW DATA WAS MODIFIED.**

**NO EVIDENCE STANDARD WAS RELAXED.**
