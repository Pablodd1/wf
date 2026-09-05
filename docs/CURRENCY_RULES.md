# Currency Rules

## Required Rules

1. `$` alone is ambiguous.
2. Explicit line currency wins.
3. Section currency applies until changed.
4. Message-level currency applies only if no nearer evidence exists.
5. Dealer geography is supporting evidence only.
6. Never default unresolved currency to USD.
7. Preserve original amount and currency.
8. Store FX rate, source, and date.
9. Use asking price for analytics.
10. Compare explicit dual-currency prices for plausibility.

## Explicit HKD Vocabulary

- `HKD`, `HK$`, dotted `H.K.D.`, `港币`, and `港幣` normalize to HKD.
- `HDK` is accepted as a documented dealer typo for HKD only when it is an
  explicit currency token in the raw message.
- `K` and `mil` mean one thousand.
- `M`, `MN`, `mill`, and `million` mean one million.
- `W` and `万` mean ten thousand.
- Currency and multiplier tokens may appear before or after the amount.
- A multiplier without explicit line currency or inherited section currency
  remains unresolved.

## Required Regression Examples

```text
HKD ~ Without Box
126500 White N5/26 $283000
```

```text
105,000HK$/13,500US$
```

```text
86,800 -30% = 60,760HK$
```

```text
7118/1300R-001 N5/26 $2.070,000
```

```text
18,300U$
```

## Current Risk

`src/utils/parseEngine.ts` maps `$` to USD and defaults missing currency to USD. Server ingest has partial context handling but does not yet prove section-level currency inheritance.

