# Review A — parser.js Price/Currency Extraction Audit

## Executive Summary

The parser has a **P0 architectural bug**: price-pattern matching is governed by
**array position**, not by **currency authority**. When a message contains both
an explicit USD price and a foreign-currency price, the pattern array can pick
the foreign-currency figure even when USD is explicitly and unambiguously stated
elsewhere in the same message. This is NOT the same bug fixed in commits
3c6ddfc/c16a79d (which fixed *conversion* — foreign currency wasn't being
converted to USD). This is a *selection* bug — the wrong number is chosen
before conversion even applies.

**Confirmed live corruption**: ref 52506, true price $43,500 USD, currently
stored in production DB as $176,000 (the AED figure, converted... to nothing,
since it hit the currency-unaware bare-comma catchall).

---

## Finding 1 (P0): `/-` separator breaks every currency-adjacency pattern

Repro:
```js
parseFull('Rolex 1908 Platinum 39mm\nRef: 52506 Ice Blue\n*Dated:  08 - 2025*\n\n*176,000/- AED ??*\n*$ 43,500/-USD ??*')
// => price=176000, currency=USD   (WRONG — should be 43500)
```

Root cause: dealer-style listings write `"176,000/- AED"` and `"$ 43,500/-USD"`
— the `/-` between number and currency code is common Gulf-dealer notation
(AED/HKD region). Every currency-aware pattern in the array (`currency-stuck`,
`comma-thousands-with-currency`, `HK$` variants) uses `\s*` between number and
currency word, which does **not** match `/-`. Both numbers fall through to the
generic bare-comma catchall (line ~1135), which has **zero currency awareness**
and simply returns whichever number matches **first by regex scan order in the
text** — here, 176,000 appears before 43,500, so it wins.

Also broken by the same root cause: `"$ 43,500"` (space after `$`) does not
match the `$`-prefix pattern (line 1127), which requires the digit to
immediately follow `$` with no space:
```js
/[\$](\d{1,3}(?:,\d{3})+)(?:\.\d+)?\b/g   // no \s* allowed after $
```

**Fix direction**: normalize `/-`, `-`, and other dealer punctuation to a space
before running the pattern array (one `.replace()` at the top of `parsePrice`),
and add `\s*` tolerance after `$`.

---

## Finding 2 (P0): Pattern array order overrides currency authority, not just adjacency

Even fixing Finding 1's tokenization gap won't fully fix the underlying design
problem. Proven with clean, unambiguous input (no `/-`, no missing space):

```js
parseFull('Ref: 5711 EUR 999,000 $ 43,500 USD')
// => price=1078920, currency=USD   (EUR 999,000 × 1.08 — WRONG, ignored the explicit $43,500 USD)

parseFull('Ref: 5711 $ 43,500 USD EUR 999,000')
// => price=1078920, currency=USD   (SAME wrong answer even with USD text-first)
```

This proves the bug is **not** about which price appears first in the text —
it's that pattern index 1120 (`comma-thousands + non-USD currency word`) is
scanned **before** pattern index 1127 (`$-prefixed comma-thousands`) in the
`patterns` array, and the `for (const pat of patterns)` loop returns on the
**first pattern that produces any valid value**, never comparing candidates
or preferring an explicitly-marked `$`/USD figure over a foreign one.

**This means: any dual-currency message, regardless of formatting, is
currency-roulette.** The AED case is just the one that got caught. EUR, GBP,
CNY, SGD are provably exposed to the identical bug (tested above — CNY/EUR/GBP
"passed" only by coincidence of test numbers landing close to the USD figure).

**Fix direction**: this needs a structural change, not a patch — collect ALL
pattern matches across the whole array (not just the first winner), then apply
a priority rule: (a) prefer a match explicitly tagged USD/USDT if one exists
anywhere in the text, (b) otherwise prefer the highest-confidence currency match,
(c) fall back to position-based selection only when genuinely ambiguous.

---

## Finding 3 (P1): `ambiguousCurrency` guard has a co-location blind spot

Location: ~line 1953-1963. Current logic:
```js
const hasCurrencyWord = /\b(hkd|usd|usdt|eur|gbp|chf|sgd|aed|cny)\b/i.test(text);
if ((hasBareK || hasBareCommaNumber) && !hasDollarSign && !hasCurrencyWord) {
  ambiguousCurrency = true;
}
```
This checks whether a currency word exists **anywhere** in the text, not
whether it's co-located with the actual matched price. In the AED repro case,
`hasCurrencyWord` is `true` (both "AED" and "USD" appear in the text) — so the
guard **never fires**, even though the selected price ($176,000) is objectively
wrong. The guard only catches the case where NO currency word exists at all; it
provides zero protection against the dual-currency wrong-selection bug (Finding
2), which is arguably the more dangerous case because it produces a
confidently-wrong APPROVED-verdict record instead of a flagged one.

**Fix direction**: after Finding 2's structural fix, this guard becomes largely
moot for dual-currency cases (the priority rule handles it). Keep it for the
genuinely-ambiguous single-number case.

---

## Finding 4 (Resolved — no bug): `validatePriceNotReference` 0.05% tolerance

Tested at the boundary:
| ref | price | distance | result | correct? |
|---|---|---|---|---|
| 52506 | 52506 | 0% | rejected (null) | ✅ yes, exact collision |
| 52506 | 52532 | 0.05% | rejected (null) | ✅ yes, still a likely collision |
| 52506 | 52700 | 0.37% | passes (52700) | ✅ yes, this was the real bug fixed earlier — legit nearby price now survives |
| 5711 | 5712 | 0.017% | rejected (null) | ✅ correct — a $5,712 price is implausible for a Patek 5711 anyway |

No further action needed here. The earlier fix (1% → 0.05%) is correctly
calibrated and did not introduce a new gap.

---

## Finding 5 (P1): RATES constant has no AED entry; AED handling is ad-hoc

`RATES` (line 47-60) does not include `AED`. Only ONE of the three
currency-aware patterns that reference AED (line 1120-1124, the
"comma-thousands with currency" pattern) has a **hardcoded fallback**:
```js
const rate = RATES[cur] || (cur === 'AED' ? 0.272 : undefined);
```
The other two patterns that list AED-adjacent currency sets either don't
include AED in their currency alternation at all, or would silently return
`undefined`/unconverted if they matched an AED figure. This is fragile —
any future pattern added without remembering the AED special-case will
silently break AED conversion again.

**Fix direction**: add `AED: 0.272` to the `RATES` constant directly instead of
a one-off inline fallback, so every pattern that does `RATES[cur]` gets it for
free.

---

## Severity Summary

| # | Finding | Severity | Status |
|---|---|---|---|
| 1 | `/-` separator + `$`-space breaks currency adjacency matching | **P0** | Actively corrupting live data (confirmed on prod) |
| 2 | Pattern array order ignores currency authority in dual-currency text | **P0** | Actively corrupting live data; broader than just AED — EUR/GBP/CNY/SGD provably exposed |
| 3 | `ambiguousCurrency` guard has co-location blind spot | **P1** | Latent — doesn't catch Finding 2's failure mode |
| 4 | `validatePriceNotReference` 0.05% tolerance | — | No bug, verified correct |
| 5 | `RATES` missing AED entry (ad-hoc fallback instead) | **P1** | Maintainability/fragility risk |

## Recommendation

Do NOT patch this with more one-off regex additions (the pattern that produced
Findings 1 & 2 in the first place). This needs the structural fix described in
Finding 2: collect all candidate price matches, prefer explicit USD, then
convert. Treat as a single focused rewrite of `parsePrice()`'s selection logic,
not another append to the `patterns` array.
