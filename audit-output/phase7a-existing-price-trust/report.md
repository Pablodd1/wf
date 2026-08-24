# WATCHFACTS Phase 7A — Existing Price Integrity & Price Research Trust Audit

## Decision

**Combined recommendation: `PRICE_RESEARCH_REBUILD_REQUIRED`.** Rolex requires a Price Research rebuild; Patek Philippe requires partial remediation before its analytics can be called trustworthy. The dominant issue is unreliable existing price evidence, not missing normalized prices.

- Rolex: 105,866 of 157,495 current Price Research observations use retired `usd_defaulted_by_policy` evidence. Stored-evidence trust is 32.78% globally and 34.25% across customer-safe canonical references.
- Patek Philippe: 14,927 of 72,305 current observations use the same retired evidence. Stored-evidence trust is 79.35% globally and 79.77% across canonical references.
- Missing USD is comparatively small: 515 Rolex rows and 182 Patek rows have source price but no `price_usd`, versus 120,793 current WTS observations needing review because of legacy defaulting.
- A bounded parser-v5 recheck did not validate any of the 50 sampled legacy-defaulted rows. It also found six stored-price conflicts among 50 rows labeled source-evidenced, proving stored provenance alone is only an upper bound on trust.

## Authoritative live inventory

Brand | Active | WTS | WTB | Source price | USD normalized | TF priced | PR source | PR current qualified | PR stored-evidence verified | Trusted rate | Current ready refs | Verified-only ready refs
--- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | ---
Patek Philippe | 126,571 | 98,175 | 28,396 | 72,515 | 72,333 | 72,333 | 98,175 | 72,305 | 57,378 | 79.36% | 370 | 364
Rolex | 281,480 | 232,191 | 49,289 | 158,032 | 157,517 | 157,517 | 232,191 | 157,495 | 51,629 | 32.78% | 278 | 262

Definitions are preserved: `price_usd > 0` defines normalized USD and a priced Trading Floor row; Price Research source is WTS; current qualified excludes `suppressed_exact_duplicate`; canonical analytics use only exact or uniquely collapsed catalog identities.

## Existing normalized-price provenance

Brand | Provenance class | All normalized rows | Current PR rows
--- | --- | --- | ---
Patek Philippe | LEGACY_USD_DEFAULTED | 14,927 | 14,927
Patek Philippe | SOURCE_EXPLICIT_FOREIGN_WITH_VERIFIED_DATED_FX | 27,328 | 27,328
Patek Philippe | SOURCE_EXPLICIT_USD | 10,595 | 10,584
Patek Philippe | SOURCE_EXPLICIT_USDT | 19,483 | 19,466
Rolex | LEGACY_USD_DEFAULTED | 105,866 | 105,866
Rolex | SOURCE_EXPLICIT_FOREIGN_WITH_VERIFIED_DATED_FX | 28,089 | 28,086
Rolex | SOURCE_EXPLICIT_USD | 18,007 | 17,993
Rolex | SOURCE_EXPLICIT_USDT | 5,555 | 5,550

No existing non-null value was changed. `SOURCE_EXPLICIT_*` and dated-FX classes are retained as source-evidenced candidates; `LEGACY_USD_DEFAULTED` is review-required under the current contract.

## Parser-v5 immutable-source shadow recheck

Brand | Stored class | Parser-v5 outcome | Rows
--- | --- | --- | ---
Patek Philippe | LEGACY_USD_DEFAULTED | REVIEW_REQUIRED | 22
Patek Philippe | LEGACY_USD_DEFAULTED | UNRESOLVED | 3
Patek Philippe | SOURCE_EVIDENCED | VERIFIED_EQUIVALENT_FX | 9
Patek Philippe | SOURCE_EVIDENCED | VERIFIED_MATCH | 12
Patek Philippe | SOURCE_EVIDENCED | REVIEW_REQUIRED | 3
Patek Philippe | SOURCE_EVIDENCED | CURRENT_VALUE_CONFLICTS_WITH_SOURCE | 1
Rolex | LEGACY_USD_DEFAULTED | REVIEW_REQUIRED | 23
Rolex | LEGACY_USD_DEFAULTED | UNRESOLVED | 2
Rolex | SOURCE_EVIDENCED | VERIFIED_EQUIVALENT_FX | 9
Rolex | SOURCE_EVIDENCED | CURRENT_VALUE_CONFLICTS_WITH_SOURCE | 5
Rolex | SOURCE_EVIDENCED | VERIFIED_MATCH | 4
Rolex | SOURCE_EVIDENCED | REVIEW_REQUIRED | 7

The deterministic cohort contained 25 legacy-defaulted and 25 source-evidenced WTS Price Research rows per brand. Every row was joined by listing ID, source record ID, raw-version ID, and source hash; raw text was not retained. Results are sample evidence, not population estimates.

## Reference-level analytics impact

- Rolex canonical references represented: 287; 271 have a verified/current count ratio below 90%; analytics-ready references fall from 278 to 262.
- Patek canonical references represented: 419; 199 fall below 90%; analytics-ready references fall from 370 to 364.
- The table below shows exact verified-only statistic recomputation for the five highest-review references per brand. Broad all-reference percentile queries timed out, so all-reference medians and means remain intentionally unclaimed.

Brand | Reference | Current n | Verified n | Current median | Verified median | Median Δ | Current mean | Verified mean | Mean Δ | Current min–max | Verified min–max
--- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | ---
Patek Philippe | 5205G-013 | 101 | 65 | 42,000 | 39,800 | -5.24% | 79,438.85 | 40,976.52 | -48.42% | 34,800–388,000 | 34,800–60,585
Patek Philippe | 5224R-001 | 51 | 18 | 43,500 | 39,554.5 | -9.07% | 67,859.51 | 38,944.5 | -42.61% | 435–318,500 | 31,631–43,000
Patek Philippe | 5711/1A-014 | 57 | 24 | 213,500 | 225,929.5 | 5.82% | 637,012.47 | 1,205,529.63 | 89.25% | 221–24,087,867 | 221–24,087,867
Patek Philippe | 5905/1A-001 | 66 | 35 | 47,550 | 47,000 | -1.16% | 99,162.91 | 46,417.09 | -53.19% | 43,000–449,000 | 43,000–55,000
Patek Philippe | 6007G-001 | 49 | 9 | 31,500 | 28,300 | -10.16% | 46,352.96 | 28,666.11 | -38.16% | 23,500–279,000 | 27,019–34,043
Rolex | 126300 | 3,184 | 1,194 | 10,200 | 9,757 | -4.34% | 252,063.28 | 9,209.86 | -96.35% | 2–116,000,000 | 2–83,500
Rolex | 126331 | 2,298 | 646 | 16,300 | 16,100.5 | -1.22% | 364,626.72 | 14,750.21 | -95.95% | 11–170,000,000 | 18–176,562
Rolex | 126333 | 2,890 | 672 | 15,450 | 15,001 | -2.91% | 303,405.4 | 14,596.49 | -95.19% | 13–170,000,000 | 13–153,000
Rolex | 126334 | 6,860 | 2,215 | 14,000 | 13,600 | -2.86% | 556,180.46 | 12,870.13 | -97.69% | 1–168,000,000 | 1–155,790
Rolex | 228235 | 2,472 | 788 | 52,254 | 51,489 | -1.46% | 512,714.05 | 49,550.54 | -90.34% | 7–606,000,000 | 7–308,112

The extreme maxima (for example Rolex 228235 at $606,000,000 and 126300 at $116,000,000) materially distort current means. Even the stored-evidence subset retains implausible minima such as $1–$18 in some references, so plausibility and parser-v5 source agreement must remain separate gates.

## Future eligibility and quarantine policy

1. `KEEP_VERIFIED`: immutable lineage matches; one exact parser-v5 amount/currency binds to the listing; current value matches; dated FX is valid when foreign.
2. `EXCLUDE_FROM_PRICE_RESEARCH_PENDING_REVIEW`: legacy defaulted, bare-dollar, currencyless, multiple-price, bundle, or unsupported provenance. Keep Trading Floor/raw values unchanged.
3. `REVIEW_FOR_CORRECTION`: current normalized value conflicts with exact parser-v5 source evidence. Any later fix must be separately authorized, snapshotted, hash-bound, null-only where applicable, and reversible.
4. `FX_REMEDIATION`: explicit foreign source price exists but dated approved FX is missing, stale, or invalid.
5. `REFERENCE_REMEDIATION`: identity is partial, component, free text, ambiguous, malformed, or absent from the canonical catalog.

## Complete canonical-reference trust table

Brand | Model | Reference | Current qualified | Stored-evidence verified | Review required | Unsupported | Unresolved | Trusted rate | Current ready | Verified-only ready
--- | --- | --- | --- | --- | --- | --- | --- | --- | --- | ---
Patek Philippe | Golden Ellipse | 3738/100G-012 | 12 | 11 | 1 | 0 | 0 | 91.67% | YES | YES
Patek Philippe | Calatrava | 4895G-001 | 11 | 11 | 0 | 0 | 0 | 100.00% | YES | YES
Patek Philippe | Calatrava | 4895R-001 | 8 | 8 | 0 | 0 | 0 | 100.00% | YES | YES
Patek Philippe | Calatrava | 4897/300G-001 | 22 | 22 | 0 | 0 | 0 | 100.00% | YES | YES
Patek Philippe | Calatrava | 4897G-001 | 35 | 33 | 2 | 0 | 0 | 94.29% | YES | YES
Patek Philippe | Calatrava | 4897G-010 | 7 | 7 | 0 | 0 | 0 | 100.00% | YES | YES
Patek Philippe | Calatrava | 4897R-001 | 19 | 18 | 1 | 0 | 0 | 94.74% | YES | YES
Patek Philippe | Calatrava | 4899/900G-001 | 2 | 2 | 0 | 0 | 0 | 100.00% | YES | YES
Patek Philippe | Calatrava | 4899/901G-001 | 10 | 10 | 0 | 0 | 0 | 100.00% | YES | YES
Patek Philippe | Twenty~4 | 4908/11R-011 | 12 | 9 | 3 | 0 | 0 | 75.00% | YES | YES
Patek Philippe | Twenty~4 | 4908/200G-001 | 6 | 6 | 0 | 0 | 0 | 100.00% | YES | YES
Patek Philippe | Twenty~4 | 4908/200G-011 | 5 | 4 | 1 | 0 | 0 | 80.00% | YES | YES
Patek Philippe | Twenty~4 | 4909/50G-001 | 1 | 0 | 1 | 0 | 0 | 0.00% | NO | NO
Patek Philippe | Twenty~4 | 4909/50R-001 | 2 | 0 | 2 | 0 | 0 | 0.00% | YES | NO
Patek Philippe | Twenty~4 | 4910/10A-011 | 35 | 30 | 5 | 0 | 0 | 85.71% | YES | YES
Patek Philippe | Twenty~4 | 4910/10A-012 | 29 | 28 | 1 | 0 | 0 | 96.55% | YES | YES
Patek Philippe | Twenty~4 | 4910/11R-010 | 14 | 13 | 1 | 0 | 0 | 92.86% | YES | YES
Patek Philippe | Twenty~4 | 4910/11R-011 | 7 | 6 | 1 | 0 | 0 | 85.71% | YES | YES
Patek Philippe | Twenty~4 | 4910/1200A-001 | 9 | 9 | 0 | 0 | 0 | 100.00% | YES | YES
Patek Philippe | Twenty~4 | 4910/1200A-010 | 17 | 6 | 11 | 0 | 0 | 35.29% | YES | YES
Patek Philippe | Twenty~4 | 4910/1200A-011 | 8 | 2 | 6 | 0 | 0 | 25.00% | YES | YES
Patek Philippe | Twenty~4 | 4910/1201R-001 | 4 | 2 | 2 | 0 | 0 | 50.00% | YES | YES
Patek Philippe | Twenty~4 | 4910/1201R-010 | 17 | 14 | 3 | 0 | 0 | 82.35% | YES | YES
Patek Philippe | Twenty~4 | 4910/20G-010 | 4 | 4 | 0 | 0 | 0 | 100.00% | YES | YES
Patek Philippe | Twenty~4 | 4910/49G-001 | 2 | 2 | 0 | 0 | 0 | 100.00% | YES | YES
Patek Philippe | Twenty~4 | 4910/52G | 2 | 2 | 0 | 0 | 0 | 100.00% | YES | YES
Patek Philippe | Twenty~4 | 4910/52G-001 | 2 | 2 | 0 | 0 | 0 | 100.00% | YES | YES
Patek Philippe | Twenty~4 | 4910G-001 | 6 | 4 | 2 | 0 | 0 | 66.67% | YES | YES
Patek Philippe | Twenty~4 | 4910R-001 | 5 | 5 | 0 | 0 | 0 | 100.00% | YES | YES
Patek Philippe | Twenty~4 | 4911G-001 | 1 | 1 | 0 | 0 | 0 | 100.00% | NO | NO
Patek Philippe | Twenty~4 | 4920G-001 | 5 | 5 | 0 | 0 | 0 | 100.00% | YES | YES
Patek Philippe | Twenty~4 | 4920G-010 | 4 | 3 | 1 | 0 | 0 | 75.00% | YES | YES
Patek Philippe | Twenty~4 | 4920R-001 | 5 | 5 | 0 | 0 | 0 | 100.00% | YES | YES
Patek Philippe | Twenty~4 | 4920R-010 | 9 | 9 | 0 | 0 | 0 | 100.00% | YES | YES
Patek Philippe | Complications | 4936J-001 | 22 | 20 | 2 | 0 | 0 | 90.91% | YES | YES
Patek Philippe | Complications | 4937G-001 | 12 | 10 | 2 | 0 | 0 | 83.33% | YES | YES
Patek Philippe | Complications | 4937R-001 | 7 | 7 | 0 | 0 | 0 | 100.00% | YES | YES
Patek Philippe | Annual Calendar | 4946G-001 | 8 | 8 | 0 | 0 | 0 | 100.00% | YES | YES
Patek Philippe | Complications | 4946R-001 | 34 | 10 | 24 | 0 | 0 | 29.41% | YES | YES
Patek Philippe | Complications | 4947/1A-001 | 35 | 22 | 13 | 0 | 0 | 62.86% | YES | YES
Patek Philippe | Complications | 4947G-001 | 39 | 38 | 1 | 0 | 0 | 97.44% | YES | YES
Patek Philippe | Complications | 4947G-010 | 43 | 36 | 7 | 0 | 0 | 83.72% | YES | YES
Patek Philippe | Complications | 4947R-001 | 32 | 28 | 4 | 0 | 0 | 87.50% | YES | YES
Patek Philippe | Complications | 4948G-010 | 26 | 13 | 13 | 0 | 0 | 50.00% | YES | YES
Patek Philippe | Complications | 4948R-001 | 28 | 25 | 3 | 0 | 0 | 89.29% | YES | YES
Patek Philippe | Gondolo | 4962/200R-001 | 7 | 5 | 2 | 0 | 0 | 71.43% | YES | YES
Patek Philippe | Gondolo | 4962/200R-010 | 23 | 17 | 6 | 0 | 0 | 73.91% | YES | YES
Patek Philippe | Complications | 4968-400R-001 | 2 | 2 | 0 | 0 | 0 | 100.00% | YES | YES
Patek Philippe | Complications | 4968G-001 | 3 | 3 | 0 | 0 | 0 | 100.00% | YES | YES
Patek Philippe | Complications | 4968G-010 | 14 | 14 | 0 | 0 | 0 | 100.00% | YES | YES
Patek Philippe | Complications | 4968R-001 | 13 | 12 | 1 | 0 | 0 | 92.31% | YES | YES
Patek Philippe | Gondolo | 4972/1G-001 | 30 | 30 | 0 | 0 | 0 | 100.00% | YES | YES
Patek Philippe | Gondolo | 4972G-001 | 10 | 4 | 6 | 0 | 0 | 40.00% | YES | YES
Patek Philippe | Calatrava | 4978/400G-001 | 13 | 12 | 1 | 0 | 0 | 92.31% | YES | YES
Patek Philippe | Calatrava | 4997/200G-001 | 19 | 1 | 18 | 0 | 0 | 5.26% | YES | NO
Patek Philippe | Calatrava | 4997/200R-001 | 22 | 10 | 12 | 0 | 0 | 45.45% | YES | YES
Patek Philippe | Aquanaut | 5062/450R-001 | 12 | 11 | 1 | 0 | 0 | 91.67% | YES | YES
Patek Philippe | Aquanaut | 5066J | 11 | 9 | 2 | 0 | 0 | 81.82% | YES | YES
Patek Philippe | Aquanaut | 5067A-001 | 28 | 25 | 3 | 0 | 0 | 89.29% | YES | YES
Patek Philippe | Aquanaut | 5067A-024 | 24 | 22 | 2 | 0 | 0 | 91.67% | YES | YES
Patek Philippe | Aquanaut | 5067A-025 | 13 | 13 | 0 | 0 | 0 | 100.00% | YES | YES
Patek Philippe | Aquanaut | 5068R-001 | 22 | 19 | 3 | 0 | 0 | 86.36% | YES | YES
Patek Philippe | Aquanaut | 5069G-011 | 0 | 0 | 0 | 0 | 0 | N/A | NO | NO
Patek Philippe | Aquanaut | 5069R-001 | 3 | 3 | 0 | 0 | 0 | 100.00% | YES | YES
Patek Philippe | Aquanaut | 5072G-001 | 1 | 1 | 0 | 0 | 0 | 100.00% | NO | NO
Patek Philippe | Aquanaut | 5072R-001 | 18 | 16 | 2 | 0 | 0 | 88.89% | YES | YES
Patek Philippe | Complications | 5073P-001 | 0 | 0 | 0 | 0 | 0 | N/A | NO | NO
Patek Philippe | Grand Complications | 5073P-010 | 0 | 0 | 0 | 0 | 0 | N/A | NO | NO
Patek Philippe | Grand Complications | 5074R-001 | 3 | 3 | 0 | 0 | 0 | 100.00% | YES | YES
Patek Philippe | Grand Complications | 5074R-012 | 1 | 1 | 0 | 0 | 0 | 100.00% | NO | NO
Patek Philippe | Grand Complications | 5078G-001 | 2 | 1 | 1 | 0 | 0 | 50.00% | YES | NO
Patek Philippe | Grand Complications | 5078G-010 | 6 | 6 | 0 | 0 | 0 | 100.00% | YES | YES
Patek Philippe | Grand Complications | 5078P-001 | 3 | 3 | 0 | 0 | 0 | 100.00% | YES | YES
Patek Philippe | Grand Complications | 5078P-010 | 2 | 2 | 0 | 0 | 0 | 100.00% | YES | YES
Patek Philippe | Calatrava | 5088/100P-001 | 17 | 16 | 1 | 0 | 0 | 94.12% | YES | YES
Patek Philippe | Calatrava | 5119G-001 | 1 | 1 | 0 | 0 | 0 | 100.00% | NO | NO
Patek Philippe | Calatrava | 5120G-001 | 5 | 4 | 1 | 0 | 0 | 80.00% | YES | YES
Patek Philippe | Calatrava | 5120J-001 | 3 | 3 | 0 | 0 | 0 | 100.00% | YES | YES
Patek Philippe | Calatrava | 5123R-001 | 53 | 53 | 0 | 0 | 0 | 100.00% | YES | YES
Patek Philippe | Gondolo | 5124J-001 | 9 | 8 | 1 | 0 | 0 | 88.89% | YES | YES
Patek Philippe | World Time | 5130/1G-011 | 18 | 14 | 4 | 0 | 0 | 77.78% | YES | YES
Patek Philippe | World Time | 5130/1R | 44 | 36 | 8 | 0 | 0 | 81.82% | YES | YES
Patek Philippe | World Time | 5130G-019 | 0 | 0 | 0 | 0 | 0 | N/A | NO | NO
Patek Philippe | World Time | 5130J-001 | 3 | 1 | 2 | 0 | 0 | 33.33% | YES | NO
Patek Philippe | World Time | 5131/1P-001 | 12 | 8 | 4 | 0 | 0 | 66.67% | YES | YES
Patek Philippe | World Time | 5131R-001 | 2 | 2 | 0 | 0 | 0 | 100.00% | YES | YES
Patek Philippe | Gondolo | 5135G-010 | 3 | 3 | 0 | 0 | 0 | 100.00% | YES | YES
Patek Philippe | Gondolo | 5135J-001 | 40 | 34 | 6 | 0 | 0 | 85.00% | YES | YES
Patek Philippe | Gondolo | 5135R-001 | 5 | 5 | 0 | 0 | 0 | 100.00% | YES | YES
Patek Philippe | Grand Complications | 5139G-010 | 48 | 44 | 4 | 0 | 0 | 91.67% | YES | YES
Patek Philippe | Grand Complications | 5140G-001 | 26 | 24 | 2 | 0 | 0 | 92.31% | YES | YES
Patek Philippe | Grand Complications | 5140J-001 | 9 | 6 | 3 | 0 | 0 | 66.67% | YES | YES
Patek Philippe | Grand Complications | 5140P-013 | 2 | 2 | 0 | 0 | 0 | 100.00% | YES | YES
Patek Philippe | Grand Complications | 5140P-017 | 3 | 2 | 1 | 0 | 0 | 66.67% | YES | YES
Patek Philippe | Grand Complications | 5140R-001 | 19 | 19 | 0 | 0 | 0 | 100.00% | YES | YES
Patek Philippe | Complications | 5146/1G-001 | 36 | 36 | 0 | 0 | 0 | 100.00% | YES | YES
Patek Philippe | Complications | 5146/1G-010 | 7 | 7 | 0 | 0 | 0 | 100.00% | YES | YES
Patek Philippe | Complications | 5146/1J-001 | 15 | 15 | 0 | 0 | 0 | 100.00% | YES | YES
Patek Philippe | Complications | 5146/1R-001 | 7 | 6 | 1 | 0 | 0 | 85.71% | YES | YES
Patek Philippe | Complications | 5146G-001 | 76 | 66 | 10 | 0 | 0 | 86.84% | YES | YES
Patek Philippe | Complications | 5146G-010 | 45 | 41 | 4 | 0 | 0 | 91.11% | YES | YES
Patek Philippe | Complications | 5146J-001 | 65 | 60 | 5 | 0 | 0 | 92.31% | YES | YES
Patek Philippe | Complications | 5146J-010 | 62 | 61 | 1 | 0 | 0 | 98.39% | YES | YES
Patek Philippe | Complications | 5146R-001 | 76 | 71 | 5 | 0 | 0 | 93.42% | YES | YES
Patek Philippe | Complications | 5147G-001 | 71 | 64 | 7 | 0 | 0 | 90.14% | YES | YES
Patek Philippe | Calatrava | 5153G-001 | 6 | 6 | 0 | 0 | 0 | 100.00% | YES | YES
Patek Philippe | Calatrava | 5153G-010 | 6 | 6 | 0 | 0 | 0 | 100.00% | YES | YES
Patek Philippe | Calatrava | 5153J-001 | 12 | 9 | 3 | 0 | 0 | 75.00% | YES | YES
Patek Philippe | Calatrava | 5153R-001 | 7 | 5 | 2 | 0 | 0 | 71.43% | YES | YES
Patek Philippe | Grand Complications | 5159G-001 | 46 | 42 | 4 | 0 | 0 | 91.30% | YES | YES
Patek Philippe | Grand Complications | 5159J-001 | 40 | 29 | 11 | 0 | 0 | 72.50% | YES | YES
Patek Philippe | Grand Complications | 5159R-001 | 26 | 22 | 4 | 0 | 0 | 84.62% | YES | YES
Patek Philippe | Grand Complications | 5160/500G-001 | 17 | 14 | 3 | 0 | 0 | 82.35% | YES | YES
Patek Philippe | Grand Complications | 5160/500R-001 | 7 | 4 | 3 | 0 | 0 | 57.14% | YES | YES
Patek Philippe | Grand Complications | 5160R-001 | 24 | 24 | 0 | 0 | 0 | 100.00% | YES | YES
Patek Philippe | Aquanaut | 5164A-001 | 100 | 90 | 10 | 0 | 0 | 90.00% | YES | YES
Patek Philippe | Aquanaut | 5164G-001 | 48 | 37 | 11 | 0 | 0 | 77.08% | YES | YES
Patek Philippe | Aquanaut | 5164R-001 | 116 | 95 | 21 | 0 | 0 | 81.90% | YES | YES
Patek Philippe | Aquanaut | 5167/1A-001 | 41 | 32 | 9 | 0 | 0 | 78.05% | YES | YES
Patek Philippe | Aquanaut | 5167/300R-010 | 0 | 0 | 0 | 0 | 0 | N/A | NO | NO
Patek Philippe | Aquanaut | 5167A-001 | 170 | 156 | 14 | 0 | 0 | 91.76% | YES | YES
Patek Philippe | Aquanaut | 5167A-012 | 12 | 11 | 1 | 0 | 0 | 91.67% | YES | YES
Patek Philippe | Aquanaut | 5167R-001 | 159 | 129 | 30 | 0 | 0 | 81.13% | YES | YES
Patek Philippe | Aquanaut | 5168G-001 | 109 | 86 | 23 | 0 | 0 | 78.90% | YES | YES
Patek Philippe | Aquanaut | 5168G-010 | 77 | 50 | 27 | 0 | 0 | 64.94% | YES | YES
Patek Philippe | Complications | 5170G-001 | 19 | 18 | 1 | 0 | 0 | 94.74% | YES | YES
Patek Philippe | Complications | 5170G-010 | 13 | 2 | 11 | 0 | 0 | 15.38% | YES | YES
Patek Philippe | Complications | 5170R-001 | 11 | 11 | 0 | 0 | 0 | 100.00% | YES | YES
Patek Philippe | Complications | 5170R-010 | 9 | 4 | 5 | 0 | 0 | 44.44% | YES | YES
Patek Philippe | Complications | 5172G-001 | 33 | 21 | 12 | 0 | 0 | 63.64% | YES | YES
Patek Philippe | Complications | 5172G-010 | 23 | 17 | 6 | 0 | 0 | 73.91% | YES | YES
Patek Philippe | Grand Complications | 5178G-001 | 2 | 2 | 0 | 0 | 0 | 100.00% | YES | YES
Patek Philippe | Grand Complications | 5178G-012 | 5 | 5 | 0 | 0 | 0 | 100.00% | YES | YES
Patek Philippe | Complications | 5180/1G-010 | 11 | 8 | 3 | 0 | 0 | 72.73% | YES | YES
Patek Philippe | Complications | 5180/1R-001 | 32 | 28 | 4 | 0 | 0 | 87.50% | YES | YES
Patek Philippe | Calatrava | 5196G-001 | 8 | 7 | 1 | 0 | 0 | 87.50% | YES | YES
Patek Philippe | Calatrava | 5196J-001 | 16 | 16 | 0 | 0 | 0 | 100.00% | YES | YES
Patek Philippe | Calatrava | 5196P-001 | 13 | 13 | 0 | 0 | 0 | 100.00% | YES | YES
Patek Philippe | Calatrava | 5196R-001 | 23 | 21 | 2 | 0 | 0 | 91.30% | YES | YES
Patek Philippe | Gondolo | 5200G-001 | 17 | 17 | 0 | 0 | 0 | 100.00% | YES | YES
Patek Philippe | Grand Complications | 5204/1R-001 | 0 | 0 | 0 | 0 | 0 | N/A | NO | NO
Patek Philippe | Grand Complications | 5204G-001 | 9 | 7 | 2 | 0 | 0 | 77.78% | YES | YES
Patek Philippe | Split-Seconds Chronograph Perpetual Calendar | 5204G-010 | 0 | 0 | 0 | 0 | 0 | N/A | NO | NO
Patek Philippe | Grand Complications | 5204R-001 | 2 | 2 | 0 | 0 | 0 | 100.00% | YES | YES
Patek Philippe | Grand Complications | 5204R-011 | 11 | 11 | 0 | 0 | 0 | 100.00% | YES | YES
Patek Philippe | Annual Calendar | 5205G-001 | 38 | 32 | 6 | 0 | 0 | 84.21% | YES | YES
Patek Philippe | Complications | 5205G-013 | 101 | 65 | 36 | 0 | 0 | 64.36% | YES | YES
Patek Philippe | Complications | 5205R-001 | 92 | 81 | 11 | 0 | 0 | 88.04% | YES | YES
Patek Philippe | Complications | 5205R-010 | 38 | 36 | 2 | 0 | 0 | 94.74% | YES | YES
Patek Philippe | Complications | 5205R-011 | 57 | 47 | 10 | 0 | 0 | 82.46% | YES | YES
Patek Philippe | Grand Complications | 5207/700P-001 | 0 | 0 | 0 | 0 | 0 | N/A | NO | NO
Patek Philippe | Grand Complications | 5207G-001 | 19 | 17 | 2 | 0 | 0 | 89.47% | YES | YES
Patek Philippe | Grand Complications | 5207P-001 | 0 | 0 | 0 | 0 | 0 | N/A | NO | NO
Patek Philippe | Grand Complications | 5207R-001 | 3 | 3 | 0 | 0 | 0 | 100.00% | YES | YES
Patek Philippe | Grand Complications | 5208R-001 | 1 | 1 | 0 | 0 | 0 | 100.00% | NO | NO
Patek Philippe | Calatrava | 5212A-001 | 66 | 47 | 19 | 0 | 0 | 71.21% | YES | YES
Patek Philippe | Grand Complications | 5216P-001 | 2 | 2 | 0 | 0 | 0 | 100.00% | YES | YES
Patek Philippe | Grand Complications | 5216R-001 | 0 | 0 | 0 | 0 | 0 | N/A | NO | NO
Patek Philippe | Complications | 5224R-001 | 51 | 18 | 33 | 0 | 0 | 35.29% | YES | YES
Patek Philippe | Calatrava | 5226G-001 | 49 | 34 | 15 | 0 | 0 | 69.39% | YES | YES
Patek Philippe | Calatrava | 5227G-001 | 8 | 6 | 2 | 0 | 0 | 75.00% | YES | YES
Patek Philippe | Calatrava | 5227G-010 | 31 | 26 | 5 | 0 | 0 | 83.87% | YES | YES
Patek Philippe | Calatrava | 5227G-015 | 4 | 2 | 2 | 0 | 0 | 50.00% | YES | YES
Patek Philippe | Calatrava | 5227J-001 | 25 | 14 | 11 | 0 | 0 | 56.00% | YES | YES
Patek Philippe | Calatrava | 5227R-001 | 65 | 43 | 22 | 0 | 0 | 66.15% | YES | YES
Patek Philippe | World Time | 5230G-001 | 8 | 7 | 1 | 0 | 0 | 87.50% | YES | YES
Patek Philippe | World Time | 5230G-014 | 18 | 17 | 1 | 0 | 0 | 94.44% | YES | YES
Patek Philippe | World Time | 5230P-001 | 20 | 20 | 0 | 0 | 0 | 100.00% | YES | YES
Patek Philippe | World Time | 5230R-001 | 30 | 27 | 3 | 0 | 0 | 90.00% | YES | YES
Patek Philippe | World Time | 5231G-001 | 38 | 36 | 2 | 0 | 0 | 94.74% | YES | YES
Patek Philippe | World Time | 5231J-001 | 7 | 7 | 0 | 0 | 0 | 100.00% | YES | YES
Patek Philippe | Complications | 5235/50R-001 | 34 | 17 | 17 | 0 | 0 | 50.00% | YES | YES
Patek Philippe | Complications | 5235G-001 | 24 | 20 | 4 | 0 | 0 | 83.33% | YES | YES
Patek Philippe | Grand Complications | 5236P-001 | 29 | 18 | 11 | 0 | 0 | 62.07% | YES | YES
Patek Philippe | Grand Complications | 5236P-010 | 4 | 2 | 2 | 0 | 0 | 50.00% | YES | YES
Patek Philippe | In-Line Perpetual Calendar | 5236P-011 | 5 | 5 | 0 | 0 | 0 | 100.00% | YES | YES
Patek Philippe | Aquanaut | 5260/1455R-001 | 1 | 1 | 0 | 0 | 0 | 100.00% | NO | NO
Patek Philippe | Aquanaut | 5260/355R-001 | 7 | 7 | 0 | 0 | 0 | 100.00% | YES | YES
Patek Philippe | Aquanaut | 5261R-001 | 53 | 35 | 18 | 0 | 0 | 66.04% | YES | YES
Patek Philippe | Aquanaut | 5267/200A-001 | 28 | 25 | 3 | 0 | 0 | 89.29% | YES | YES
Patek Philippe | Aquanaut | 5267/200A-010 | 51 | 46 | 5 | 0 | 0 | 90.20% | YES | YES
Patek Philippe | Aquanaut | 5267/200A-011 | 67 | 45 | 22 | 0 | 0 | 67.16% | YES | YES
Patek Philippe | Aquanaut | 5268-200R-001 | 21 | 14 | 7 | 0 | 0 | 66.67% | YES | YES
Patek Philippe | Aquanaut | 5268/200R-010 | 23 | 14 | 9 | 0 | 0 | 60.87% | YES | YES
Patek Philippe | Aquanaut | 5268/461G-001 | 12 | 8 | 4 | 0 | 0 | 66.67% | YES | YES
Patek Philippe | Aquanaut | 5269/200R-001 | 29 | 29 | 0 | 0 | 0 | 100.00% | YES | YES
Patek Philippe | Aquanaut | 5269R-001 | 56 | 46 | 10 | 0 | 0 | 82.14% | YES | YES
Patek Philippe | Grand Complications | 5270/1R-001 | 18 | 14 | 4 | 0 | 0 | 77.78% | YES | YES
Patek Philippe | Grand Complications | 5270J-001 | 42 | 32 | 10 | 0 | 0 | 76.19% | YES | YES
Patek Philippe | Grand Complications | 5270P-001 | 15 | 5 | 10 | 0 | 0 | 33.33% | YES | YES
Patek Philippe | Grand Complications | 5270P-014 | 34 | 17 | 17 | 0 | 0 | 50.00% | YES | YES
Patek Philippe | Chronograph Perpetual Calendar | 5270P-015 | 2 | 2 | 0 | 0 | 0 | 100.00% | YES | YES
Patek Philippe | Chronograph Perpetual Calendar | 5270P-016 | 1 | 1 | 0 | 0 | 0 | 100.00% | NO | NO
Patek Philippe | Chronograph Perpetual Calendar | 5270P-017 | 0 | 0 | 0 | 0 | 0 | N/A | NO | NO
Patek Philippe | Grand Complications | 5270R-001 | 15 | 15 | 0 | 0 | 0 | 100.00% | YES | YES
Patek Philippe | Grand Complications | 5271/11P-010 | 35 | 34 | 1 | 0 | 0 | 97.14% | YES | YES
Patek Philippe | Grand Complications | 5271/12P-010 | 57 | 56 | 1 | 0 | 0 | 98.25% | YES | YES
Patek Philippe | Grand Complications | 5271P-001 | 24 | 23 | 1 | 0 | 0 | 95.83% | YES | YES
Patek Philippe | Grand Complications | 5271P-010 | 23 | 23 | 0 | 0 | 0 | 100.00% | YES | YES
Patek Philippe | Calatrava | 5296G-010 | 17 | 12 | 5 | 0 | 0 | 70.59% | YES | YES
Patek Philippe | Calatrava | 5296R-001 | 80 | 77 | 3 | 0 | 0 | 96.25% | YES | YES
Patek Philippe | Calatrava | 5296R-010 | 64 | 56 | 8 | 0 | 0 | 87.50% | YES | YES
Patek Philippe | Calatrava | 5297G-001 | 44 | 40 | 4 | 0 | 0 | 90.91% | YES | YES
Patek Philippe | Calatrava | 5298P-012 | 6 | 6 | 0 | 0 | 0 | 100.00% | YES | YES
Patek Philippe | Grand Complications | 5303R-001 | 11 | 8 | 3 | 0 | 0 | 72.73% | YES | YES
Patek Philippe | Grand Complications | 5304/301R-001 | 1 | 1 | 0 | 0 | 0 | 100.00% | NO | NO
Patek Philippe | Grand Complications | 5308G-001 | 1 | 1 | 0 | 0 | 0 | 100.00% | NO | NO
Patek Philippe | Grand Complications | 5316/50P-001 | 5 | 5 | 0 | 0 | 0 | 100.00% | YES | YES
Patek Philippe | Grand Complications | 5316P-001 | 0 | 0 | 0 | 0 | 0 | N/A | NO | NO
Patek Philippe | Grand Complications | 5320G-001 | 54 | 37 | 17 | 0 | 0 | 68.52% | YES | YES
Patek Philippe | Grand Complications | 5320G-011 | 36 | 20 | 16 | 0 | 0 | 55.56% | YES | YES
Patek Philippe | 24-Hour Alarm Grand Complication | 5322G-001 | 2 | 2 | 0 | 0 | 0 | 100.00% | YES | YES
Patek Philippe | Complications | 5326G-001 | 48 | 32 | 16 | 0 | 0 | 66.67% | YES | YES
Patek Philippe | Grand Complications | 5327G-001 | 50 | 40 | 10 | 0 | 0 | 80.00% | YES | YES
Patek Philippe | Grand Complications | 5327J-001 | 24 | 24 | 0 | 0 | 0 | 100.00% | YES | YES
Patek Philippe | Grand Complications | 5327R-001 | 42 | 39 | 3 | 0 | 0 | 92.86% | YES | YES
Patek Philippe | Calatrava | 5328G-001 | 102 | 93 | 9 | 0 | 0 | 91.18% | YES | YES
Patek Philippe | World Time | 5330G-001 | 19 | 11 | 8 | 0 | 0 | 57.89% | YES | YES
Patek Philippe | Grand Complications | 5370P-001 | 19 | 19 | 0 | 0 | 0 | 100.00% | YES | YES
Patek Philippe | Grand Complications | 5370P-011 | 2 | 1 | 1 | 0 | 0 | 50.00% | YES | NO
Patek Philippe | Grand Complications | 5370R-001 | 17 | 17 | 0 | 0 | 0 | 100.00% | YES | YES
Patek Philippe | Grand Complications | 5372P-001 | 7 | 7 | 0 | 0 | 0 | 100.00% | YES | YES
Patek Philippe | Grand Complications | 5372P-010 | 0 | 0 | 0 | 0 | 0 | N/A | NO | NO
Patek Philippe | Grand Complications | 5373P-001 | 0 | 0 | 0 | 0 | 0 | N/A | NO | NO
Patek Philippe | Grand Complications | 5374/300P-001 | 1 | 1 | 0 | 0 | 0 | 100.00% | NO | NO
Patek Philippe | Minute Repeater Perpetual Calendar | 5374/400P-001 | 0 | 0 | 0 | 0 | 0 | N/A | NO | NO
Patek Philippe | Grand Complications | 5374G-001 | 3 | 3 | 0 | 0 | 0 | 100.00% | YES | YES
Patek Philippe | Complications | 5396/1G-001 | 5 | 5 | 0 | 0 | 0 | 100.00% | YES | YES
Patek Philippe | Complications | 5396/1G-010 | 43 | 40 | 3 | 0 | 0 | 93.02% | YES | YES
Patek Philippe | Complications | 5396/1R-010 | 5 | 5 | 0 | 0 | 0 | 100.00% | YES | YES
Patek Philippe | Complications | 5396G-011 | 47 | 41 | 6 | 0 | 0 | 87.23% | YES | YES
Patek Philippe | Complications | 5396G-014 | 14 | 14 | 0 | 0 | 0 | 100.00% | YES | YES
Patek Philippe | Complications | 5396G-017 | 37 | 27 | 10 | 0 | 0 | 72.97% | YES | YES
Patek Philippe | Complications | 5396R-011 | 75 | 61 | 14 | 0 | 0 | 81.33% | YES | YES
Patek Philippe | Complications | 5396R-015 | 65 | 51 | 14 | 0 | 0 | 78.46% | YES | YES
Patek Philippe | Annual Calendar Moon Phases | 5396R-016 | 2 | 2 | 0 | 0 | 0 | 100.00% | YES | YES
Patek Philippe | Grand Complications | 5470P-001 | 3 | 2 | 1 | 0 | 0 | 66.67% | YES | YES
Patek Philippe | Grand Complications | 5496P-014 | 8 | 8 | 0 | 0 | 0 | 100.00% | YES | YES
Patek Philippe | Grand Complications | 5496P-015 | 22 | 21 | 1 | 0 | 0 | 95.45% | YES | YES
Patek Philippe | Grand Complications | 5496R-001 | 12 | 11 | 1 | 0 | 0 | 91.67% | YES | YES
Patek Philippe | Grand Complications | 5520P-001 | 11 | 10 | 1 | 0 | 0 | 90.91% | YES | YES
Patek Philippe | Complications | 5524G-001 | 21 | 18 | 3 | 0 | 0 | 85.71% | YES | YES
Patek Philippe | Complications | 5524G-010 | 29 | 17 | 12 | 0 | 0 | 58.62% | YES | YES
Patek Philippe | Complications | 5524R-001 | 57 | 39 | 18 | 0 | 0 | 68.42% | YES | YES
Patek Philippe | World Time | 5531G-001 | 4 | 4 | 0 | 0 | 0 | 100.00% | YES | YES
Patek Philippe | Grand Complications | 5539G-001 | 0 | 0 | 0 | 0 | 0 | N/A | NO | NO
Patek Philippe | Nautilus | 5711/110P-001 | 13 | 11 | 2 | 0 | 0 | 84.62% | YES | YES
Patek Philippe | Nautilus | 5711/111P-001 | 1 | 1 | 0 | 0 | 0 | 100.00% | NO | NO
Patek Philippe | Nautilus | 5711/112P-001 | 3 | 2 | 1 | 0 | 0 | 66.67% | YES | YES
Patek Philippe | Nautilus | 5711/113P-001 | 3 | 2 | 1 | 0 | 0 | 66.67% | YES | YES
Patek Philippe | Nautilus | 5711/1300A-001 | 5 | 5 | 0 | 0 | 0 | 100.00% | YES | YES
Patek Philippe | Nautilus | 5711/1A-010 | 57 | 41 | 16 | 0 | 0 | 71.93% | YES | YES
Patek Philippe | Nautilus | 5711/1A-014 | 59 | 26 | 33 | 0 | 0 | 44.07% | YES | YES
Patek Philippe | Nautilus | 5711/1R-001 | 49 | 33 | 16 | 0 | 0 | 67.35% | YES | YES
Patek Philippe | Nautilus | 5712/1A-001 | 168 | 139 | 29 | 0 | 0 | 82.74% | YES | YES
Patek Philippe | Nautilus | 5712/1R-001 | 65 | 37 | 28 | 0 | 0 | 56.92% | YES | YES
Patek Philippe | Nautilus | 5712G-001 | 83 | 69 | 14 | 0 | 0 | 83.13% | YES | YES
Patek Philippe | Nautilus | 5712R-001 | 190 | 180 | 10 | 0 | 0 | 94.74% | YES | YES
Patek Philippe | Nautilus | 5719/10G-010 | 21 | 21 | 0 | 0 | 0 | 100.00% | YES | YES
Patek Philippe | Nautilus | 5719/10R-010 | 0 | 0 | 0 | 0 | 0 | N/A | NO | NO
Patek Philippe | Nautilus | 5719/1G-001 | 5 | 5 | 0 | 0 | 0 | 100.00% | YES | YES
Patek Philippe | Nautilus | 5723/112R-001 | 15 | 15 | 0 | 0 | 0 | 100.00% | YES | YES
Patek Philippe | Nautilus | 5723/1R-001 | 23 | 23 | 0 | 0 | 0 | 100.00% | YES | YES
Patek Philippe | Nautilus | 5723/1R-010 | 8 | 6 | 2 | 0 | 0 | 75.00% | YES | YES
Patek Philippe | Nautilus | 5724G-001 | 15 | 14 | 1 | 0 | 0 | 93.33% | YES | YES
Patek Philippe | Nautilus | 5724R-001 | 7 | 7 | 0 | 0 | 0 | 100.00% | YES | YES
Patek Philippe | Nautilus | 5726/1A-001 | 8 | 8 | 0 | 0 | 0 | 100.00% | YES | YES
Patek Philippe | Nautilus | 5726/1A-010 | 44 | 42 | 2 | 0 | 0 | 95.45% | YES | YES
Patek Philippe | Nautilus | 5726/1A-014 | 63 | 36 | 27 | 0 | 0 | 57.14% | YES | YES
Patek Philippe | Nautilus | 5726A-001 | 127 | 102 | 25 | 0 | 0 | 80.31% | YES | YES
Patek Philippe | Golden Ellipse | 5738/1R-001 | 19 | 7 | 12 | 0 | 0 | 36.84% | YES | YES
Patek Philippe | Golden Ellipse | 5738/51G-001 | 8 | 1 | 7 | 0 | 0 | 12.50% | YES | NO
Patek Philippe | Golden Ellipse | 5738G-001 | 1 | 1 | 0 | 0 | 0 | 100.00% | NO | NO
Patek Philippe | Golden Ellipse | 5738P-001 | 30 | 25 | 5 | 0 | 0 | 83.33% | YES | YES
Patek Philippe | Golden Ellipse | 5738R-001 | 14 | 10 | 4 | 0 | 0 | 71.43% | YES | YES
Patek Philippe | Nautilus | 5740/1G-001 | 79 | 57 | 22 | 0 | 0 | 72.15% | YES | YES
Patek Philippe | Nautilus 50th Anniversary | 5810/1G-001 | 5 | 3 | 2 | 0 | 0 | 60.00% | YES | YES
Patek Philippe | Nautilus 50th Anniversary | 5810G-001 | 8 | 8 | 0 | 0 | 0 | 100.00% | YES | YES
Patek Philippe | Nautilus | 5811/1460G-001 | 13 | 12 | 1 | 0 | 0 | 92.31% | YES | YES
Patek Philippe | Nautilus | 5811/1G-001 | 27 | 17 | 10 | 0 | 0 | 62.96% | YES | YES
Patek Philippe | Cubitus | 5821/1A-001 | 43 | 18 | 25 | 0 | 0 | 41.86% | YES | YES
Patek Philippe | Cubitus | 5821/1AR-001 | 22 | 13 | 9 | 0 | 0 | 59.09% | YES | YES
Patek Philippe | Cubitus | 5822P-001 | 42 | 20 | 22 | 0 | 0 | 47.62% | YES | YES
Patek Philippe | Cubitus Perpetual Calendar Skeleton | 5840P-001 | 1 | 0 | 1 | 0 | 0 | 0.00% | NO | NO
Patek Philippe | Complications | 5905/1A-001 | 66 | 35 | 31 | 0 | 0 | 53.03% | YES | YES
Patek Philippe | Complications | 5905P-001 | 39 | 36 | 3 | 0 | 0 | 92.31% | YES | YES
Patek Philippe | Complications | 5905P-010 | 23 | 18 | 5 | 0 | 0 | 78.26% | YES | YES
Patek Philippe | Complications | 5905R-001 | 49 | 45 | 4 | 0 | 0 | 91.84% | YES | YES
Patek Philippe | Complications | 5905R-010 | 54 | 39 | 15 | 0 | 0 | 72.22% | YES | YES
Patek Philippe | Complications | 5924G-001 | 13 | 13 | 0 | 0 | 0 | 100.00% | YES | YES
Patek Philippe | Complications | 5924G-010 | 10 | 2 | 8 | 0 | 0 | 20.00% | YES | YES
Patek Philippe | World Time | 5930G-010 | 18 | 11 | 7 | 0 | 0 | 61.11% | YES | YES
Patek Philippe | World Time | 5930P-001 | 28 | 24 | 4 | 0 | 0 | 85.71% | YES | YES
Patek Philippe | World Time | 5935A-001 | 93 | 75 | 18 | 0 | 0 | 80.65% | YES | YES
Patek Philippe | Grand Complications | 5940J-001 | 28 | 27 | 1 | 0 | 0 | 96.43% | YES | YES
Patek Philippe | Grand Complications | 5950R-010 | 0 | 0 | 0 | 0 | 0 | N/A | NO | NO
Patek Philippe | Grand Complications | 5951/500P-001 | 0 | 0 | 0 | 0 | 0 | N/A | NO | NO
Patek Philippe | Grand Complications | 5959P-001 | 0 | 0 | 0 | 0 | 0 | N/A | NO | NO
Patek Philippe | Complications | 5960/01G-001 | 13 | 9 | 4 | 0 | 0 | 69.23% | YES | YES
Patek Philippe | Complications | 5960/1A-001 | 23 | 17 | 6 | 0 | 0 | 73.91% | YES | YES
Patek Philippe | Complications | 5960R | 30 | 11 | 19 | 0 | 0 | 36.67% | YES | YES
Patek Philippe | Complications | 5961P-001 | 60 | 44 | 16 | 0 | 0 | 73.33% | YES | YES
Patek Philippe | Complications | 5961R-010 | 27 | 25 | 2 | 0 | 0 | 92.59% | YES | YES
Patek Philippe | Aquanaut | 5968A-001 | 78 | 57 | 21 | 0 | 0 | 73.08% | YES | YES
Patek Philippe | Aquanaut | 5968G-001 | 32 | 25 | 7 | 0 | 0 | 78.13% | YES | YES
Patek Philippe | Aquanaut | 5968G-010 | 46 | 26 | 20 | 0 | 0 | 56.52% | YES | YES
Patek Philippe | Aquanaut | 5968R-001 | 42 | 22 | 20 | 0 | 0 | 52.38% | YES | YES
Patek Philippe | Nautilus | 5980/1400G-010 | 9 | 9 | 0 | 0 | 0 | 100.00% | YES | YES
Patek Philippe | Nautilus | 5980/1400R-011 | 11 | 11 | 0 | 0 | 0 | 100.00% | YES | YES
Patek Philippe | Nautilus | 5980/1AR-001 | 37 | 28 | 9 | 0 | 0 | 75.68% | YES | YES
Patek Philippe | Nautilus | 5980/1R-001 | 49 | 40 | 9 | 0 | 0 | 81.63% | YES | YES
Patek Philippe | Nautilus | 5980/60G-001 | 53 | 47 | 6 | 0 | 0 | 88.68% | YES | YES
Patek Philippe | Nautilus | 5980R-001 | 84 | 78 | 6 | 0 | 0 | 92.86% | YES | YES
Patek Philippe | Nautilus | 5990/1400G-001 | 2 | 2 | 0 | 0 | 0 | 100.00% | YES | YES
Patek Philippe | Nautilus | 5990/1421G-001 | 0 | 0 | 0 | 0 | 0 | N/A | NO | NO
Patek Philippe | Nautilus | 5990/1422G-001 | 1 | 1 | 0 | 0 | 0 | 100.00% | NO | NO
Patek Philippe | Nautilus | 5990/1423G-001 | 0 | 0 | 0 | 0 | 0 | N/A | NO | NO
Patek Philippe | Nautilus | 5990/1A-001 | 70 | 57 | 13 | 0 | 0 | 81.43% | YES | YES
Patek Philippe | Nautilus | 5990/1A-011 | 46 | 27 | 19 | 0 | 0 | 58.70% | YES | YES
Patek Philippe | Nautilus | 5990/1R-001 | 64 | 42 | 22 | 0 | 0 | 65.63% | YES | YES
Patek Philippe | Grand Complications | 6002R-001 | 2 | 2 | 0 | 0 | 0 | 100.00% | YES | YES
Patek Philippe | Calatrava | 6006G-001 | 10 | 7 | 3 | 0 | 0 | 70.00% | YES | YES
Patek Philippe | Calatrava | 6007G-001 | 49 | 9 | 40 | 0 | 0 | 18.37% | YES | YES
Patek Philippe | Calatrava | 6007G-010 | 33 | 11 | 22 | 0 | 0 | 33.33% | YES | YES
Patek Philippe | Calatrava | 6007G-011 | 51 | 20 | 31 | 0 | 0 | 39.22% | YES | YES
Patek Philippe | Grand Complications | 6102P-001 | 18 | 15 | 3 | 0 | 0 | 83.33% | YES | YES
Patek Philippe | Grand Complications | 6102R-001 | 36 | 36 | 0 | 0 | 0 | 100.00% | YES | YES
Patek Philippe | Grand Complications | 6104G-001 | 8 | 6 | 2 | 0 | 0 | 75.00% | YES | YES
Patek Philippe | Grand Complications | 6104P-010 | 0 | 0 | 0 | 0 | 0 | N/A | NO | NO
Patek Philippe | Grand Complications | 6104R-001 | 33 | 27 | 6 | 0 | 0 | 81.82% | YES | YES
Patek Philippe | Celestial Sunrise and Sunset | 6105G-001 | 0 | 0 | 0 | 0 | 0 | N/A | NO | NO
Patek Philippe | Calatrava | 6119G-001 | 69 | 52 | 17 | 0 | 0 | 75.36% | YES | YES
Patek Philippe | Calatrava | 6119R-001 | 52 | 34 | 18 | 0 | 0 | 65.38% | YES | YES
Patek Philippe | Grand Complications | 6159G-001 | 39 | 32 | 7 | 0 | 0 | 82.05% | YES | YES
Patek Philippe | Calatrava | 6196P-001 | 10 | 7 | 3 | 0 | 0 | 70.00% | YES | YES
Patek Philippe | Grand Complications | 6300/401G-001 | 0 | 0 | 0 | 0 | 0 | N/A | NO | NO
Patek Philippe | Grand Complications | 6300/403G-001 | 0 | 0 | 0 | 0 | 0 | N/A | NO | NO
Patek Philippe | Grand Complications | 6300G-010 | 3 | 3 | 0 | 0 | 0 | 100.00% | YES | YES
Patek Philippe | Grand Complications | 6301P-001 | 3 | 2 | 1 | 0 | 0 | 66.67% | YES | YES
Patek Philippe | Grand Complications | 7000R-001 | 0 | 0 | 0 | 0 | 0 | N/A | NO | NO
Patek Philippe | Nautilus | 7010/1G-013 | 26 | 22 | 4 | 0 | 0 | 84.62% | YES | YES
Patek Philippe | Nautilus | 7010/1R-011 | 6 | 5 | 1 | 0 | 0 | 83.33% | YES | YES
Patek Philippe | Nautilus | 7010/1R-012 | 19 | 19 | 0 | 0 | 0 | 100.00% | YES | YES
Patek Philippe | Nautilus | 7010/1R-013 | 32 | 28 | 4 | 0 | 0 | 87.50% | YES | YES
Patek Philippe | Nautilus | 7010G-013 | 21 | 9 | 12 | 0 | 0 | 42.86% | YES | YES
Patek Philippe | Nautilus | 7010R-011 | 39 | 33 | 6 | 0 | 0 | 84.62% | YES | YES
Patek Philippe | Nautilus | 7010R-012 | 45 | 44 | 1 | 0 | 0 | 97.78% | YES | YES
Patek Philippe | Nautilus | 7010R-013 | 35 | 27 | 8 | 0 | 0 | 77.14% | YES | YES
Patek Philippe | Nautilus | 7014/1G-001 | 0 | 0 | 0 | 0 | 0 | N/A | NO | NO
Patek Philippe | Nautilus | 7018/1A-001 | 15 | 15 | 0 | 0 | 0 | 100.00% | YES | YES
Patek Philippe | Nautilus | 7018/1A-010 | 14 | 14 | 0 | 0 | 0 | 100.00% | YES | YES
Patek Philippe | Nautilus | 7018/1A-011 | 9 | 8 | 1 | 0 | 0 | 88.89% | YES | YES
Patek Philippe | Nautilus | 7021/1G-001 | 2 | 2 | 0 | 0 | 0 | 100.00% | YES | YES
Patek Philippe | Grand Complications | 7040/250G-001 | 0 | 0 | 0 | 0 | 0 | N/A | NO | NO
Patek Philippe | Gondolo | 7041R-001 | 41 | 36 | 5 | 0 | 0 | 87.80% | YES | YES
Patek Philippe | Gondolo | 7042/100G-001 | 1 | 1 | 0 | 0 | 0 | 100.00% | NO | NO
Patek Philippe | Gondolo | 7042/100G-010 | 5 | 5 | 0 | 0 | 0 | 100.00% | YES | YES
Patek Philippe | Gondolo | 7042/100R-010 | 10 | 5 | 5 | 0 | 0 | 50.00% | YES | YES
Patek Philippe | Minute Repeater | 7047G-001 | 0 | 0 | 0 | 0 | 0 | N/A | NO | NO
Patek Philippe | Complications | 7071G-001 | 1 | 1 | 0 | 0 | 0 | 100.00% | NO | NO
Patek Philippe | Complications | 7071G-010 | 2 | 2 | 0 | 0 | 0 | 100.00% | YES | YES
Patek Philippe | Annual Calendar | 7071R-001 | 5 | 4 | 1 | 0 | 0 | 80.00% | YES | YES
Patek Philippe | Complications | 7071R-010 | 19 | 19 | 0 | 0 | 0 | 100.00% | YES | YES
Patek Philippe | Gondolo | 7099G-001 | 18 | 18 | 0 | 0 | 0 | 100.00% | YES | YES
Patek Philippe | Gondolo | 7099R-001 | 10 | 9 | 1 | 0 | 0 | 90.00% | YES | YES
Patek Philippe | Nautilus | 7118/1200A-001 | 57 | 44 | 13 | 0 | 0 | 77.19% | YES | YES
Patek Philippe | Nautilus | 7118/1200A-010 | 17 | 15 | 2 | 0 | 0 | 88.24% | YES | YES
Patek Philippe | Nautilus | 7118/1200A-011 | 31 | 23 | 8 | 0 | 0 | 74.19% | YES | YES
Patek Philippe | Nautilus | 7118/1200R-001 | 68 | 57 | 11 | 0 | 0 | 83.82% | YES | YES
Patek Philippe | Nautilus | 7118/1200R-010 | 50 | 41 | 9 | 0 | 0 | 82.00% | YES | YES
Patek Philippe | Nautilus | 7118/1300R-001 | 7 | 7 | 0 | 0 | 0 | 100.00% | YES | YES
Patek Philippe | Nautilus | 7118/1450G-001 | 8 | 8 | 0 | 0 | 0 | 100.00% | YES | YES
Patek Philippe | Nautilus | 7118/1450R-001 | 9 | 9 | 0 | 0 | 0 | 100.00% | YES | YES
Patek Philippe | Nautilus | 7118/1451G-001 | 2 | 2 | 0 | 0 | 0 | 100.00% | YES | YES
Patek Philippe | Nautilus | 7118/1452G-001 | 10 | 10 | 0 | 0 | 0 | 100.00% | YES | YES
Patek Philippe | Nautilus | 7118/1453G-001 | 11 | 11 | 0 | 0 | 0 | 100.00% | YES | YES
Patek Philippe | Nautilus | 7118/1A-001 | 53 | 31 | 22 | 0 | 0 | 58.49% | YES | YES
Patek Philippe | Nautilus | 7118/1A-010 | 25 | 21 | 4 | 0 | 0 | 84.00% | YES | YES
Patek Philippe | Nautilus | 7118/1A-011 | 29 | 10 | 19 | 0 | 0 | 34.48% | YES | YES
Patek Philippe | Nautilus | 7118/1R-001 | 49 | 37 | 12 | 0 | 0 | 75.51% | YES | YES
Patek Philippe | Nautilus | 7118/1R-010 | 29 | 21 | 8 | 0 | 0 | 72.41% | YES | YES
Patek Philippe | Calatrava | 7119G-010 | 19 | 18 | 1 | 0 | 0 | 94.74% | YES | YES
Patek Philippe | Calatrava | 7119J-010 | 9 | 9 | 0 | 0 | 0 | 100.00% | YES | YES
Patek Philippe | Calatrava | 7120G-001 | 10 | 10 | 0 | 0 | 0 | 100.00% | YES | YES
Patek Philippe | Calatrava | 7120R-001 | 8 | 6 | 2 | 0 | 0 | 75.00% | YES | YES
Patek Philippe | Complications | 7121/200G-001 | 23 | 12 | 11 | 0 | 0 | 52.17% | YES | YES
Patek Philippe | Complications | 7121J-001 | 37 | 34 | 3 | 0 | 0 | 91.89% | YES | YES
Patek Philippe | Calatrava | 7122-200G-001 | 2 | 2 | 0 | 0 | 0 | 100.00% | YES | YES
Patek Philippe | Cubitus | 7128/1G-001 | 17 | 10 | 7 | 0 | 0 | 58.82% | YES | YES
Patek Philippe | Cubitus | 7128/1R-001 | 24 | 20 | 4 | 0 | 0 | 83.33% | YES | YES
Patek Philippe | World Time | 7129J-001 | 3 | 3 | 0 | 0 | 0 | 100.00% | YES | YES
Patek Philippe | World Time | 7130G-010 | 11 | 11 | 0 | 0 | 0 | 100.00% | YES | YES
Patek Philippe | World Time | 7130G-014 | 3 | 3 | 0 | 0 | 0 | 100.00% | YES | YES
Patek Philippe | World Time | 7130G-016 | 66 | 61 | 5 | 0 | 0 | 92.42% | YES | YES
Patek Philippe | World Time | 7130R-001 | 14 | 14 | 0 | 0 | 0 | 100.00% | YES | YES
Patek Philippe | World Time | 7130R-013 | 12 | 12 | 0 | 0 | 0 | 100.00% | YES | YES
Patek Philippe | World Time | 7130R-014 | 11 | 6 | 5 | 0 | 0 | 54.55% | YES | YES
Patek Philippe | Complications | 7134G-001 | 19 | 19 | 0 | 0 | 0 | 100.00% | YES | YES
Patek Philippe | Grand Complications | 7140G-001 | 8 | 6 | 2 | 0 | 0 | 75.00% | YES | YES
Patek Philippe | Grand Complications | 7140R-001 | 18 | 11 | 7 | 0 | 0 | 61.11% | YES | YES
Patek Philippe | Complications | 7150/250R-001 | 7 | 5 | 2 | 0 | 0 | 71.43% | YES | YES
Patek Philippe | Calatrava | 7200/1R-001 | 3 | 3 | 0 | 0 | 0 | 100.00% | YES | YES
Patek Philippe | Calatrava | 7200/200R-001 | 24 | 19 | 5 | 0 | 0 | 79.17% | YES | YES
Patek Philippe | Calatrava | 7200/50G-001 | 0 | 0 | 0 | 0 | 0 | N/A | NO | NO
Patek Philippe | Calatrava | 7200/50G-012 | 22 | 22 | 0 | 0 | 0 | 100.00% | YES | YES
Patek Philippe | Calatrava | 7200R-001 | 5 | 3 | 2 | 0 | 0 | 60.00% | YES | YES
Patek Philippe | Complications | 7234G-001 | 10 | 6 | 4 | 0 | 0 | 60.00% | YES | YES
Patek Philippe | Complications | 7234R-001 | 52 | 50 | 2 | 0 | 0 | 96.15% | YES | YES
Patek Philippe | Twenty~4 | 7300/1200A-001 | 46 | 41 | 5 | 0 | 0 | 89.13% | YES | YES
Patek Philippe | Twenty~4 | 7300/1200A-010 | 27 | 14 | 13 | 0 | 0 | 51.85% | YES | YES
Patek Philippe | Twenty~4 | 7300/1200A-011 | 31 | 21 | 10 | 0 | 0 | 67.74% | YES | YES
Patek Philippe | Twenty~4 | 7300/1200R-001 | 5 | 5 | 0 | 0 | 0 | 100.00% | YES | YES
Patek Philippe | Twenty~4 | 7300/1200R-010 | 19 | 16 | 3 | 0 | 0 | 84.21% | YES | YES
Patek Philippe | Twenty~4 | 7300/1200R-011 | 5 | 5 | 0 | 0 | 0 | 100.00% | YES | YES
Patek Philippe | Twenty~4 | 7300/1201R-001 | 1 | 1 | 0 | 0 | 0 | 100.00% | NO | NO
Patek Philippe | Twenty~4 | 7300/1450R-001 | 2 | 2 | 0 | 0 | 0 | 100.00% | YES | YES
Patek Philippe | Twenty~4 | 7340/1R-001 | 9 | 7 | 2 | 0 | 0 | 77.78% | YES | YES
Patek Philippe | Twenty~4 | 7340/1R-010 | 6 | 2 | 4 | 0 | 0 | 33.33% | YES | YES
Patek Philippe | Aquanaut | 7968/300R-001 | 58 | 54 | 4 | 0 | 0 | 93.10% | YES | YES
Rolex | Submariner | 114060 | 325 | 107 | 218 | 0 | 0 | 32.92% | YES | YES
Rolex | Oyster Perpetual | 114300 | 206 | 59 | 147 | 0 | 0 | 28.64% | YES | YES
Rolex | Date | 115234 | 37 | 19 | 18 | 0 | 0 | 51.35% | YES | YES
Rolex | Oyster Perpetual | 116000 | 220 | 68 | 152 | 0 | 0 | 30.91% | YES | YES
Rolex | Datejust | 116138 | 63 | 43 | 20 | 0 | 0 | 68.25% | YES | YES
Rolex | Datejust | 116139 | 51 | 13 | 38 | 0 | 0 | 25.49% | YES | YES
Rolex | Datejust | 116185 | 12 | 11 | 1 | 0 | 0 | 91.67% | YES | YES
Rolex | Datejust | 116188 | 18 | 14 | 4 | 0 | 0 | 77.78% | YES | YES
Rolex | Datejust | 116189 | 9 | 6 | 3 | 0 | 0 | 66.67% | YES | YES
Rolex | Datejust | 116199 | 5 | 2 | 3 | 0 | 0 | 40.00% | YES | YES
Rolex | Datejust | 116233 | 1,136 | 565 | 571 | 0 | 0 | 49.74% | YES | YES
Rolex | Datejust | 116238 | 75 | 65 | 10 | 0 | 0 | 86.67% | YES | YES
Rolex | Datejust | 116243 | 259 | 132 | 127 | 0 | 0 | 50.97% | YES | YES
Rolex | Datejust | 116244 | 181 | 32 | 149 | 0 | 0 | 17.68% | YES | YES
Rolex | Datejust | 116285BBR | 9 | 8 | 1 | 0 | 0 | 88.89% | YES | YES
Rolex | Milgauss | 116400 | 362 | 153 | 209 | 0 | 0 | 42.27% | YES | YES
Rolex | Milgauss | 116400GV | 469 | 176 | 293 | 0 | 0 | 37.53% | YES | YES
Rolex | Cosmograph Daytona | 116500LN | 905 | 249 | 656 | 0 | 0 | 27.51% | YES | YES
Rolex | Cosmograph Daytona | 116503 | 879 | 430 | 449 | 0 | 0 | 48.92% | YES | YES
Rolex | Cosmograph Daytona | 116505 | 1,173 | 501 | 672 | 0 | 0 | 42.71% | YES | YES
Rolex | Cosmograph Daytona | 116506 | 636 | 321 | 315 | 0 | 0 | 50.47% | YES | YES
Rolex | Cosmograph Daytona | 116508 | 1,196 | 635 | 561 | 0 | 0 | 53.09% | YES | YES
Rolex | Cosmograph Daytona | 116509 | 827 | 289 | 538 | 0 | 0 | 34.95% | YES | YES
Rolex | Cosmograph Daytona | 116515LN | 638 | 174 | 464 | 0 | 0 | 27.27% | YES | YES
Rolex | Cosmograph Daytona | 116518LN | 416 | 144 | 272 | 0 | 0 | 34.62% | YES | YES
Rolex | Cosmograph Daytona | 116519LN | 301 | 115 | 186 | 0 | 0 | 38.21% | YES | YES
Rolex | Cosmograph Daytona | 116595RBOW | 212 | 164 | 48 | 0 | 0 | 77.36% | YES | YES
Rolex | Cosmograph Daytona | 116599 | 30 | 23 | 7 | 0 | 0 | 76.67% | YES | YES
Rolex | Cosmograph Daytona | 116599RBR | 20 | 11 | 9 | 0 | 0 | 55.00% | YES | YES
Rolex | Cosmograph Daytona | 116599TBR | 36 | 3 | 33 | 0 | 0 | 8.33% | YES | YES
Rolex | Submariner | 116610LN | 723 | 181 | 542 | 0 | 0 | 25.03% | YES | YES
Rolex | Submariner | 116610LV | 1,073 | 349 | 724 | 0 | 0 | 32.53% | YES | YES
Rolex | Submariner | 116613 | 271 | 118 | 153 | 0 | 0 | 43.54% | YES | YES
Rolex | Submariner | 116618 | 73 | 15 | 58 | 0 | 0 | 20.55% | YES | YES
Rolex | Submariner | 116659 | 9 | 8 | 1 | 0 | 0 | 88.89% | YES | YES
Rolex | Yacht-Master | 116680 | 485 | 82 | 403 | 0 | 0 | 16.91% | YES | YES
Rolex | Yacht-Master | 116681 | 527 | 153 | 374 | 0 | 0 | 29.03% | YES | YES
Rolex | Yacht-Master | 116688 | 425 | 75 | 350 | 0 | 0 | 17.65% | YES | YES
Rolex | Yacht-Master | 116689 | 112 | 15 | 97 | 0 | 0 | 13.39% | YES | YES
Rolex | GMT-Master II | 116710BLNR | 563 | 123 | 440 | 0 | 0 | 21.85% | YES | YES
Rolex | GMT-Master II | 116710LN | 520 | 110 | 410 | 0 | 0 | 21.15% | YES | YES
Rolex | GMT-Master II | 116713LN | 248 | 47 | 201 | 0 | 0 | 18.95% | YES | YES
Rolex | GMT-Master II | 116758SA | 19 | 8 | 11 | 0 | 0 | 42.11% | YES | YES
Rolex | GMT-Master II | 116758SANR | 23 | 19 | 4 | 0 | 0 | 82.61% | YES | YES
Rolex | GMT-Master II | 116758SARU | 29 | 19 | 10 | 0 | 0 | 65.52% | YES | YES
Rolex | GMT-Master II | 116759SA | 10 | 4 | 6 | 0 | 0 | 40.00% | YES | YES
Rolex | GMT-Master II | 116759SANR | 10 | 2 | 8 | 0 | 0 | 20.00% | YES | YES
Rolex | GMT-Master II | 116759SARU | 7 | 0 | 7 | 0 | 0 | 0.00% | YES | NO
Rolex | Day-Date | 118135 | 85 | 48 | 37 | 0 | 0 | 56.47% | YES | YES
Rolex | Day-Date | 118138 | 151 | 97 | 54 | 0 | 0 | 64.24% | YES | YES
Rolex | Day-Date | 118139 | 84 | 62 | 22 | 0 | 0 | 73.81% | YES | YES
Rolex | Day-Date | 118205 | 72 | 15 | 57 | 0 | 0 | 20.83% | YES | YES
Rolex | Day-Date | 118206 | 35 | 7 | 28 | 0 | 0 | 20.00% | YES | YES
Rolex | Day-Date | 118235 | 216 | 84 | 132 | 0 | 0 | 38.89% | YES | YES
Rolex | Day-Date | 118238 | 620 | 272 | 348 | 0 | 0 | 43.87% | YES | YES
Rolex | Day-Date | 118239 | 128 | 50 | 78 | 0 | 0 | 39.06% | YES | YES
Rolex | Day-Date | 118296 | 14 | 0 | 14 | 0 | 0 | 0.00% | YES | NO
Rolex | Day-Date | 118339 | 20 | 2 | 18 | 0 | 0 | 10.00% | YES | YES
Rolex | Day-Date | 118346 | 44 | 35 | 9 | 0 | 0 | 79.55% | YES | YES
Rolex | Day-Date | 118348 | 82 | 53 | 29 | 0 | 0 | 64.63% | YES | YES
Rolex | Day-Date | 118366 | 47 | 37 | 10 | 0 | 0 | 78.72% | YES | YES
Rolex | Day-Date | 118388 | 39 | 28 | 11 | 0 | 0 | 71.79% | YES | YES
Rolex | Day-Date | 118389 | 18 | 11 | 7 | 0 | 0 | 61.11% | YES | YES
Rolex | Day-Date | 118398 | 3 | 3 | 0 | 0 | 0 | 100.00% | YES | YES
Rolex | Submariner | 124060 | 693 | 227 | 466 | 0 | 0 | 32.76% | YES | YES
Rolex | Oyster Perpetual | 124200 | 489 | 163 | 326 | 0 | 0 | 33.33% | YES | YES
Rolex | Oyster Perpetual | 124300 | 1,394 | 544 | 850 | 0 | 0 | 39.02% | YES | YES
Rolex | Reference-only listings | 126000 | 1,463 | 596 | 867 | 0 | 0 | 40.74% | YES | YES
Rolex | Sea-Dweller | 126067 | 154 | 79 | 75 | 0 | 0 | 51.30% | YES | YES
Rolex | Datejust | 126200 | 800 | 295 | 505 | 0 | 0 | 36.88% | YES | YES
Rolex | Datejust | 126201 | 86 | 14 | 72 | 0 | 0 | 16.28% | YES | YES
Rolex | Datejust | 126203 | 53 | 11 | 42 | 0 | 0 | 20.75% | YES | YES
Rolex | Datejust | 126231 | 909 | 267 | 642 | 0 | 0 | 29.37% | YES | YES
Rolex | Datejust | 126233 | 1,445 | 412 | 1,033 | 0 | 0 | 28.51% | YES | YES
Rolex | Datejust | 126234 | 2,371 | 754 | 1,617 | 0 | 0 | 31.80% | YES | YES
Rolex | Datejust | 126281RBR | 179 | 50 | 129 | 0 | 0 | 27.93% | YES | YES
Rolex | Datejust | 126283RBR | 193 | 65 | 128 | 0 | 0 | 33.68% | YES | YES
Rolex | Datejust | 126284RBR | 327 | 43 | 284 | 0 | 0 | 13.15% | YES | YES
Rolex | Datejust | 126300 | 3,184 | 1,194 | 1,990 | 0 | 0 | 37.50% | YES | YES
Rolex | Datejust | 126301 | 209 | 20 | 189 | 0 | 0 | 9.57% | YES | YES
Rolex | Datejust | 126303 | 183 | 39 | 144 | 0 | 0 | 21.31% | YES | YES
Rolex | Datejust | 126331 | 2,298 | 646 | 1,652 | 0 | 0 | 28.11% | YES | YES
Rolex | Datejust | 126333 | 2,890 | 672 | 2,218 | 0 | 0 | 23.25% | YES | YES
Rolex | Datejust | 126334 | 6,860 | 2,215 | 4,645 | 0 | 0 | 32.29% | YES | YES
Rolex | Cosmograph Daytona | 126500LN | 1,221 | 404 | 817 | 0 | 0 | 33.09% | YES | YES
Rolex | Cosmograph Daytona | 126502 | 2 | 1 | 1 | 0 | 0 | 50.00% | YES | NO
Rolex | Cosmograph Daytona | 126503 | 840 | 286 | 554 | 0 | 0 | 34.05% | YES | YES
Rolex | Cosmograph Daytona | 126505 | 696 | 186 | 510 | 0 | 0 | 26.72% | YES | YES
Rolex | Cosmograph Daytona | 126506 | 462 | 207 | 255 | 0 | 0 | 44.81% | YES | YES
Rolex | Cosmograph Daytona | 126508 | 1,132 | 549 | 583 | 0 | 0 | 48.50% | YES | YES
Rolex | Cosmograph Daytona | 126509 | 367 | 111 | 256 | 0 | 0 | 30.25% | YES | YES
Rolex | Cosmograph Daytona | 126515LN | 571 | 221 | 350 | 0 | 0 | 38.70% | YES | YES
Rolex | Cosmograph Daytona | 126518LN | 657 | 303 | 354 | 0 | 0 | 46.12% | YES | YES
Rolex | Cosmograph Daytona | 126519LN | 535 | 165 | 370 | 0 | 0 | 30.84% | YES | YES
Rolex | Cosmograph Daytona | 126535TBR | 30 | 16 | 14 | 0 | 0 | 53.33% | YES | YES
Rolex | Cosmograph Daytona | 126539TBR | 32 | 25 | 7 | 0 | 0 | 78.13% | YES | YES
Rolex | Cosmograph Daytona | 126579RBR | 91 | 45 | 46 | 0 | 0 | 49.45% | YES | YES
Rolex | Cosmograph Daytona | 126589RBR | 96 | 64 | 32 | 0 | 0 | 66.67% | YES | YES
Rolex | Cosmograph Daytona | 126595TBR | 78 | 59 | 19 | 0 | 0 | 75.64% | YES | YES
Rolex | Cosmograph Daytona | 126598TBR | 55 | 23 | 32 | 0 | 0 | 41.82% | YES | YES
Rolex | Sea-Dweller | 126600 | 701 | 181 | 520 | 0 | 0 | 25.82% | YES | YES
Rolex | Submariner | 126610LN | 1,527 | 374 | 1,153 | 0 | 0 | 24.49% | YES | YES
Rolex | Submariner | 126610LV | 1,319 | 381 | 938 | 0 | 0 | 28.89% | YES | YES
Rolex | Submariner | 126613LB | 934 | 242 | 692 | 0 | 0 | 25.91% | YES | YES
Rolex | Submariner | 126613LN | 505 | 101 | 404 | 0 | 0 | 20.00% | YES | YES
Rolex | Submariner | 126618LB | 286 | 52 | 234 | 0 | 0 | 18.18% | YES | YES
Rolex | Submariner | 126618LN | 123 | 27 | 96 | 0 | 0 | 21.95% | YES | YES
Rolex | Submariner | 126619LB | 230 | 43 | 187 | 0 | 0 | 18.70% | YES | YES
Rolex | Yacht-Master | 126621 | 527 | 169 | 358 | 0 | 0 | 32.07% | YES | YES
Rolex | Yacht-Master | 126622 | 1,077 | 483 | 594 | 0 | 0 | 44.85% | YES | YES
Rolex | Yacht-Master | 126655 | 632 | 293 | 339 | 0 | 0 | 46.36% | YES | YES
Rolex | Sea-Dweller | 126660 | 497 | 129 | 368 | 0 | 0 | 25.96% | YES | YES
Rolex | Yacht-Master II | 126680 | 5 | 3 | 2 | 0 | 0 | 60.00% | YES | YES
Rolex | Yacht-Master II | 126688 | 5 | 2 | 3 | 0 | 0 | 40.00% | YES | YES
Rolex | GMT-Master II | 126710BLNR | 2,197 | 635 | 1,562 | 0 | 0 | 28.90% | YES | YES
Rolex | GMT-Master II | 126710BLRO | 1,802 | 539 | 1,263 | 0 | 0 | 29.91% | YES | YES
Rolex | GMT-Master II | 126710GRNR | 1,407 | 501 | 906 | 0 | 0 | 35.61% | YES | YES
Rolex | GMT-Master II | 126711CHNR | 980 | 280 | 700 | 0 | 0 | 28.57% | YES | YES
Rolex | GMT-Master II | 126713GRNR | 626 | 224 | 402 | 0 | 0 | 35.78% | YES | YES
Rolex | GMT-Master II | 126715CHNR | 384 | 122 | 262 | 0 | 0 | 31.77% | YES | YES
Rolex | GMT-Master II | 126718GRNR | 369 | 121 | 248 | 0 | 0 | 32.79% | YES | YES
Rolex | GMT-Master II | 126719BLRO | 342 | 74 | 268 | 0 | 0 | 21.64% | YES | YES
Rolex | GMT-Master II | 126729VTNR | 119 | 49 | 70 | 0 | 0 | 41.18% | YES | YES
Rolex | GMT-Master II | 126755SARU | 103 | 68 | 35 | 0 | 0 | 66.02% | YES | YES
Rolex | Land-Dweller | 127234 | 270 | 113 | 157 | 0 | 0 | 41.85% | YES | YES
Rolex | Land-Dweller | 127235 | 161 | 110 | 51 | 0 | 0 | 68.32% | YES | YES
Rolex | Land-Dweller | 127236 | 74 | 61 | 13 | 0 | 0 | 82.43% | YES | YES
Rolex | Land-Dweller | 127285TBR | 43 | 24 | 19 | 0 | 0 | 55.81% | YES | YES
Rolex | Land-Dweller | 127286TBR | 19 | 16 | 3 | 0 | 0 | 84.21% | YES | YES
Rolex | Land-Dweller | 127334 | 508 | 264 | 244 | 0 | 0 | 51.97% | YES | YES
Rolex | Land-Dweller | 127335 | 186 | 103 | 83 | 0 | 0 | 55.38% | YES | YES
Rolex | Land-Dweller | 127336 | 50 | 32 | 18 | 0 | 0 | 64.00% | YES | YES
Rolex | Reference-only listings | 127385TBR | 36 | 27 | 9 | 0 | 0 | 75.00% | YES | YES
Rolex | Land-Dweller | 127386TBR | 30 | 26 | 4 | 0 | 0 | 86.67% | YES | YES
Rolex | Day-Date | 128235 | 450 | 178 | 272 | 0 | 0 | 39.56% | YES | YES
Rolex | Day-Date | 128236 | 158 | 72 | 86 | 0 | 0 | 45.57% | YES | YES
Rolex | Day-Date | 128238 | 936 | 550 | 386 | 0 | 0 | 58.76% | YES | YES
Rolex | Day-Date | 128239 | 285 | 95 | 190 | 0 | 0 | 33.33% | YES | YES
Rolex | Day-Date | 128345RBR | 219 | 117 | 102 | 0 | 0 | 53.42% | YES | YES
Rolex | Day-Date | 128348RBR | 229 | 145 | 84 | 0 | 0 | 63.32% | YES | YES
Rolex | Day-Date | 128349RBR | 66 | 36 | 30 | 0 | 0 | 54.55% | YES | YES
Rolex | Day-Date | 128395TBR | 39 | 33 | 6 | 0 | 0 | 84.62% | YES | YES
Rolex | Day-Date | 128396TBR | 108 | 48 | 60 | 0 | 0 | 44.44% | YES | YES
Rolex | Day-Date | 128398TBR | 28 | 7 | 21 | 0 | 0 | 25.00% | YES | YES
Rolex | Day-Date | 128399TBR | 7 | 7 | 0 | 0 | 0 | 100.00% | YES | YES
Rolex | Oyster Perpetual | 134300 | 1,324 | 644 | 680 | 0 | 0 | 48.64% | YES | YES
Rolex | Oyster Perpetual 41 | 134303 | 6 | 5 | 1 | 0 | 0 | 83.33% | YES | YES
Rolex | Sea-Dweller | 136668LB | 105 | 38 | 67 | 0 | 0 | 36.19% | YES | YES
Rolex | Yacht-Master | 16623 | 94 | 16 | 78 | 0 | 0 | 17.02% | YES | YES
Rolex | Yacht-Master | 168622 | 66 | 10 | 56 | 0 | 0 | 15.15% | YES | YES
Rolex | Yacht-Master | 168623 | 36 | 4 | 32 | 0 | 0 | 11.11% | YES | YES
Rolex | Yacht-Master | 169622 | 33 | 1 | 32 | 0 | 0 | 3.03% | YES | NO
Rolex | Yacht-Master | 169623 | 31 | 0 | 31 | 0 | 0 | 0.00% | YES | NO
Rolex | Oyster Perpetual | 177200 | 148 | 52 | 96 | 0 | 0 | 35.14% | YES | YES
Rolex | Datejust | 178158 | 4 | 2 | 2 | 0 | 0 | 50.00% | YES | YES
Rolex | Datejust | 178159 | 0 | 0 | 0 | 0 | 0 | N/A | NO | NO
Rolex | Datejust | 178238 | 3 | 2 | 1 | 0 | 0 | 66.67% | YES | YES
Rolex | Datejust | 178243 | 29 | 1 | 28 | 0 | 0 | 3.45% | YES | NO
Rolex | Datejust | 178245 | 9 | 9 | 0 | 0 | 0 | 100.00% | YES | YES
Rolex | Datejust | 178248 | 6 | 2 | 4 | 0 | 0 | 33.33% | YES | YES
Rolex | Datejust | 178273 | 291 | 80 | 211 | 0 | 0 | 27.49% | YES | YES
Rolex | Datejust | 178275 | 14 | 9 | 5 | 0 | 0 | 64.29% | YES | YES
Rolex | Datejust | 178278 | 67 | 19 | 48 | 0 | 0 | 28.36% | YES | YES
Rolex | Datejust | 178279 | 7 | 1 | 6 | 0 | 0 | 14.29% | YES | NO
Rolex | Datejust | 178288 | 4 | 3 | 1 | 0 | 0 | 75.00% | YES | YES
Rolex | Datejust | 178341 | 113 | 15 | 98 | 0 | 0 | 13.27% | YES | YES
Rolex | Datejust | 178343 | 36 | 5 | 31 | 0 | 0 | 13.89% | YES | YES
Rolex | Datejust | 178344 | 112 | 6 | 106 | 0 | 0 | 5.36% | YES | YES
Rolex | Datejust | 178383 | 107 | 60 | 47 | 0 | 0 | 56.07% | YES | YES
Rolex | Datejust | 178384 | 69 | 14 | 55 | 0 | 0 | 20.29% | YES | YES
Rolex | Datejust | 179136 | 20 | 16 | 4 | 0 | 0 | 80.00% | YES | YES
Rolex | Datejust | 179161 | 17 | 1 | 16 | 0 | 0 | 5.88% | YES | NO
Rolex | Datejust | 179178 | 144 | 48 | 96 | 0 | 0 | 33.33% | YES | YES
Rolex | Datejust | 179238 | 23 | 1 | 22 | 0 | 0 | 4.35% | YES | NO
Rolex | Datejust | 179384 | 29 | 9 | 20 | 0 | 0 | 31.03% | YES | YES
Rolex | Day-Date | 18946 | 51 | 31 | 20 | 0 | 0 | 60.78% | YES | YES
Rolex | Day-Date | 18948 | 71 | 41 | 30 | 0 | 0 | 57.75% | YES | YES
Rolex | Day-Date | 18956 | 36 | 29 | 7 | 0 | 0 | 80.56% | YES | YES
Rolex | Explorer | 216570 | 431 | 53 | 378 | 0 | 0 | 12.30% | YES | YES
Rolex | Explorer | 224270 | 202 | 65 | 137 | 0 | 0 | 32.18% | YES | YES
Rolex | Explorer | 226570 | 645 | 144 | 501 | 0 | 0 | 22.33% | YES | YES
Rolex | Yacht-Master | 226627 | 444 | 149 | 295 | 0 | 0 | 33.56% | YES | YES
Rolex | Yacht-Master | 226659 | 449 | 176 | 273 | 0 | 0 | 39.20% | YES | YES
Rolex | Day-Date | 228206 | 336 | 106 | 230 | 0 | 0 | 31.55% | YES | YES
Rolex | Day-Date | 228235 | 2,472 | 788 | 1,684 | 0 | 0 | 31.88% | YES | YES
Rolex | Day-Date 40 | 228235JG | 0 | 0 | 0 | 0 | 0 | N/A | NO | NO
Rolex | Day-Date | 228236 | 536 | 155 | 381 | 0 | 0 | 28.92% | YES | YES
Rolex | Day-Date | 228238 | 2,140 | 714 | 1,426 | 0 | 0 | 33.36% | YES | YES
Rolex | Day-Date | 228239 | 896 | 264 | 632 | 0 | 0 | 29.46% | YES | YES
Rolex | Day-Date | 228345RBR | 385 | 145 | 240 | 0 | 0 | 37.66% | YES | YES
Rolex | Day-Date | 228348RBR | 377 | 175 | 202 | 0 | 0 | 46.42% | YES | YES
Rolex | Day-Date | 228349RBR | 226 | 112 | 114 | 0 | 0 | 49.56% | YES | YES
Rolex | Day-Date | 228396TBR | 328 | 157 | 171 | 0 | 0 | 47.87% | YES | YES
Rolex | Day-Date | 228398TBR | 237 | 148 | 89 | 0 | 0 | 62.45% | YES | YES
Rolex | Yacht-Master | 268621 | 208 | 63 | 145 | 0 | 0 | 30.29% | YES | YES
Rolex | Yacht-Master | 268622 | 189 | 38 | 151 | 0 | 0 | 20.11% | YES | YES
Rolex | Yacht-Master | 268655 | 176 | 107 | 69 | 0 | 0 | 60.80% | YES | YES
Rolex | Oyster Perpetual | 276200 | 210 | 42 | 168 | 0 | 0 | 20.00% | YES | YES
Rolex | Oyster Perpetual | 277200 | 802 | 361 | 441 | 0 | 0 | 45.01% | YES | YES
Rolex | Datejust | 278240 | 253 | 87 | 166 | 0 | 0 | 34.39% | YES | YES
Rolex | Datejust | 278241 | 35 | 6 | 29 | 0 | 0 | 17.14% | YES | YES
Rolex | Datejust | 278243 | 57 | 5 | 52 | 0 | 0 | 8.77% | YES | YES
Rolex | Datejust | 278245 | 0 | 0 | 0 | 0 | 0 | N/A | NO | NO
Rolex | Datejust | 278248 | 3 | 1 | 2 | 0 | 0 | 33.33% | YES | NO
Rolex | Datejust | 278271 | 663 | 143 | 520 | 0 | 0 | 21.57% | YES | YES
Rolex | Datejust | 278273 | 804 | 236 | 568 | 0 | 0 | 29.35% | YES | YES
Rolex | Datejust | 278274 | 1,139 | 277 | 862 | 0 | 0 | 24.32% | YES | YES
Rolex | Datejust | 278275 | 122 | 38 | 84 | 0 | 0 | 31.15% | YES | YES
Rolex | Datejust | 278278 | 236 | 105 | 131 | 0 | 0 | 44.49% | YES | YES
Rolex | Datejust | 278285RBR | 52 | 30 | 22 | 0 | 0 | 57.69% | YES | YES
Rolex | Datejust | 278288RBR | 100 | 68 | 32 | 0 | 0 | 68.00% | YES | YES
Rolex | Datejust | 278289RBR | 43 | 19 | 24 | 0 | 0 | 44.19% | YES | YES
Rolex | Datejust | 278341RBR | 97 | 5 | 92 | 0 | 0 | 5.15% | YES | YES
Rolex | Datejust | 278343 | 6 | 0 | 6 | 0 | 0 | 0.00% | YES | NO
Rolex | Datejust | 278344RBR | 98 | 30 | 68 | 0 | 0 | 30.61% | YES | YES
Rolex | Datejust | 278381RBR | 150 | 22 | 128 | 0 | 0 | 14.67% | YES | YES
Rolex | Datejust | 278383RBR | 154 | 49 | 105 | 0 | 0 | 31.82% | YES | YES
Rolex | Datejust | 278384RBR | 177 | 30 | 147 | 0 | 0 | 16.95% | YES | YES
Rolex | Datejust | 279135RBR | 79 | 49 | 30 | 0 | 0 | 62.03% | YES | YES
Rolex | Datejust | 279136RBR | 1 | 0 | 1 | 0 | 0 | 0.00% | NO | NO
Rolex | Datejust | 279138RBR | 79 | 13 | 66 | 0 | 0 | 16.46% | YES | YES
Rolex | Datejust | 279160 | 121 | 10 | 111 | 0 | 0 | 8.26% | YES | YES
Rolex | Datejust | 279161 | 12 | 2 | 10 | 0 | 0 | 16.67% | YES | YES
Rolex | Datejust | 279163 | 21 | 3 | 18 | 0 | 0 | 14.29% | YES | YES
Rolex | Datejust | 279165 | 9 | 8 | 1 | 0 | 0 | 88.89% | YES | YES
Rolex | Datejust | 279166 | 0 | 0 | 0 | 0 | 0 | N/A | NO | NO
Rolex | Datejust | 279171 | 579 | 141 | 438 | 0 | 0 | 24.35% | YES | YES
Rolex | Datejust | 279173 | 776 | 276 | 500 | 0 | 0 | 35.57% | YES | YES
Rolex | Datejust | 279174 | 486 | 78 | 408 | 0 | 0 | 16.05% | YES | YES
Rolex | Datejust | 279175 | 214 | 153 | 61 | 0 | 0 | 71.50% | YES | YES
Rolex | Datejust | 279178 | 223 | 109 | 114 | 0 | 0 | 48.88% | YES | YES
Rolex | Datejust | 279381RBR | 147 | 15 | 132 | 0 | 0 | 10.20% | YES | YES
Rolex | Datejust | 279383RBR | 101 | 25 | 76 | 0 | 0 | 24.75% | YES | YES
Rolex | Datejust | 279384RBR | 135 | 9 | 126 | 0 | 0 | 6.67% | YES | YES
Rolex | Sky-Dweller | 326135 | 186 | 61 | 125 | 0 | 0 | 32.80% | YES | YES
Rolex | Sky-Dweller | 326138 | 52 | 13 | 39 | 0 | 0 | 25.00% | YES | YES
Rolex | Sky-Dweller | 326139 | 68 | 3 | 65 | 0 | 0 | 4.41% | YES | YES
Rolex | Sky-Dweller | 326235 | 337 | 105 | 232 | 0 | 0 | 31.16% | YES | YES
Rolex | Sky-Dweller | 326238 | 188 | 41 | 147 | 0 | 0 | 21.81% | YES | YES
Rolex | Sky-Dweller | 326933 | 562 | 113 | 449 | 0 | 0 | 20.11% | YES | YES
Rolex | Sky-Dweller | 326934 | 1,205 | 284 | 921 | 0 | 0 | 23.57% | YES | YES
Rolex | Sky-Dweller | 326935 | 494 | 161 | 333 | 0 | 0 | 32.59% | YES | YES
Rolex | Sky-Dweller | 326938 | 270 | 53 | 217 | 0 | 0 | 19.63% | YES | YES
Rolex | Sky-Dweller | 326939 | 87 | 13 | 74 | 0 | 0 | 14.94% | YES | YES
Rolex | Sky-Dweller | 336235 | 182 | 58 | 124 | 0 | 0 | 31.87% | YES | YES
Rolex | Sky-Dweller | 336238 | 338 | 153 | 185 | 0 | 0 | 45.27% | YES | YES
Rolex | Sky-Dweller | 336239 | 161 | 59 | 102 | 0 | 0 | 36.65% | YES | YES
Rolex | Sky-Dweller | 336933 | 480 | 168 | 312 | 0 | 0 | 35.00% | YES | YES
Rolex | Sky-Dweller | 336934 | 2,151 | 729 | 1,422 | 0 | 0 | 33.89% | YES | YES
Rolex | Sky-Dweller | 336935 | 513 | 114 | 399 | 0 | 0 | 22.22% | YES | YES
Rolex | Sky-Dweller | 336938 | 423 | 137 | 286 | 0 | 0 | 32.39% | YES | YES
Rolex | Cellini | 50505 | 92 | 66 | 26 | 0 | 0 | 71.74% | YES | YES
Rolex | Cellini | 50509 | 28 | 15 | 13 | 0 | 0 | 53.57% | YES | YES
Rolex | Cellini | 50515 | 97 | 60 | 37 | 0 | 0 | 61.86% | YES | YES
Rolex | Cellini | 50519 | 39 | 16 | 23 | 0 | 0 | 41.03% | YES | YES
Rolex | Cellini | 50525 | 115 | 65 | 50 | 0 | 0 | 56.52% | YES | YES
Rolex | Cellini | 50529 | 21 | 14 | 7 | 0 | 0 | 66.67% | YES | YES
Rolex | Cellini | 50535 | 128 | 56 | 72 | 0 | 0 | 43.75% | YES | YES
Rolex | Cellini | 50609RBR | 2 | 2 | 0 | 0 | 0 | 100.00% | YES | YES
Rolex | Cellini | 50705RBR | 8 | 5 | 3 | 0 | 0 | 62.50% | YES | YES
Rolex | Cellini | 50709RBR | 0 | 0 | 0 | 0 | 0 | N/A | NO | NO
Rolex | 1908 | 52506 | 298 | 192 | 106 | 0 | 0 | 64.43% | YES | YES
Rolex | 1908 | 52508 | 225 | 107 | 118 | 0 | 0 | 47.56% | YES | YES
Rolex | 1908 | 52509 | 101 | 40 | 61 | 0 | 0 | 39.60% | YES | YES
Rolex | Datejust | 80298 | 22 | 11 | 11 | 0 | 0 | 50.00% | YES | YES
Rolex | Datejust | 80299 | 22 | 1 | 21 | 0 | 0 | 4.55% | YES | NO
Rolex | Datejust | 80315 | 23 | 15 | 8 | 0 | 0 | 65.22% | YES | YES
Rolex | Datejust | 80318 | 34 | 16 | 18 | 0 | 0 | 47.06% | YES | YES
Rolex | Datejust | 80319 | 23 | 4 | 19 | 0 | 0 | 17.39% | YES | YES
Rolex | Datejust | 81158 | 1 | 1 | 0 | 0 | 0 | 100.00% | NO | NO
Rolex | Datejust | 81159 | 1 | 1 | 0 | 0 | 0 | 100.00% | NO | NO
Rolex | Datejust | 81208 | 3 | 1 | 2 | 0 | 0 | 33.33% | YES | NO
Rolex | Datejust | 81209 | 7 | 0 | 7 | 0 | 0 | 0.00% | YES | NO
Rolex | Datejust | 81285 | 5 | 3 | 2 | 0 | 0 | 60.00% | YES | YES
Rolex | Datejust | 81298 | 1 | 0 | 1 | 0 | 0 | 0.00% | NO | NO
Rolex | Datejust | 81315 | 22 | 19 | 3 | 0 | 0 | 86.36% | YES | YES
Rolex | Datejust | 81318 | 7 | 7 | 0 | 0 | 0 | 100.00% | YES | YES
Rolex | Datejust | 81319 | 16 | 1 | 15 | 0 | 0 | 6.25% | YES | NO
Rolex | Datejust | 81338 | 4 | 3 | 1 | 0 | 0 | 75.00% | YES | YES
Rolex | Datejust | 81339 | 8 | 1 | 7 | 0 | 0 | 12.50% | YES | NO
Rolex | Datejust | 81348SARO | 3 | 3 | 0 | 0 | 0 | 100.00% | YES | YES
Rolex | Datejust | 81349SA | 2 | 2 | 0 | 0 | 0 | 100.00% | YES | YES
Rolex | Datejust | 86285 | 4 | 3 | 1 | 0 | 0 | 75.00% | YES | YES
Rolex | Datejust | 86289 | 4 | 3 | 1 | 0 | 0 | 75.00% | YES | YES
Rolex | Datejust | 86348SABLV | 17 | 11 | 6 | 0 | 0 | 64.71% | YES | YES
Rolex | Datejust | 86348SAJOR | 18 | 18 | 0 | 0 | 0 | 100.00% | YES | YES
Rolex | Pearlmaster | 86409RBR | 16 | 9 | 7 | 0 | 0 | 56.25% | YES | YES

## Limitations and controls

- Full canonical reference counts were reconciled in 16 deterministic UUID shards after the broad join timed out.
- Exact medians, means, minima, and maxima were recalculated for the five highest-review canonical references per brand; all-reference statistic recalculation was bounded out by production timeout.
- Stored explicit/dated-FX provenance counts are an upper bound on trust: parser-v5 shadow found conflicts/review outcomes inside the bounded source-evidenced sample.
- No raw message contents are retained in this artifact.

Audit checksum: `2fd7467bd8dd8e85e22edef74b039472831cea3e90666785de2433182e9a486a`  
Production writes: 0. Normalized-value changes: 0. Publication changes: 0. UI changes: 0.

**NO PRODUCTION DATA WAS MODIFIED.**  
**NO NORMALIZED PRICE WAS CHANGED.**  
**NO PUBLICATION STATE WAS CHANGED.**  
**NO UI/UX WAS MODIFIED.**
