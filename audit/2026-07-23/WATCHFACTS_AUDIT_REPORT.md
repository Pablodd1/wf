# WatchFacts Zero-Hallucination Data-Quality Audit — Final Report

**Date:** 2026-07-23
**Repository:** `Pablodd1/wf`, branch `codex/zero-hallucination-normalization` (head audited: `bb650aad`; note: the July 22 handoff records verified head `1fd413a` — the branch has advanced since the handoff, so handoff counts are treated as historical)
**Role:** evidence-only external audit. No production system, source record, raw message, application code, or deployment was touched.

---

## 1. Executive summary

All **117,744** supplied listing rows in `public/parsedWatches.json` were re-parsed deterministically from their preserved raw evidence lines under the zero-hallucination rules (AGENTS.md, NORMALIZATION_CONTRACT.md, CURRENCY_RULES.md, CATALOG_RECONCILIATION.md, ANALYTICS_RULES.md, EXTERNAL_AI_ASSISTANCE_HANDOFF_2026-07-22.md) and compared field-by-field against the stored normalized values. Every input row reconciles to exactly one output row; **0 rows were skipped, 0 parse errors** after two method corrections (see §15).

**Headline findings**

- The stored dataset is **not safe for Price Research in its current form**: only **1 row (0.0008%)** passes every deterministic eligibility gate, and only **1,947 rows (1.7%)** pass all gates if the missing intent-lineage gate is waived. The blockers are structural, not marginal.
- **93,695 rows (79.6%) are exact-raw reposts** of another listing (12,808 duplicate groups; 11,241 rows are truly unique). Analytics that do not deduplicate are measuring repost flooding, not market supply.
- **22,157 rows (18.8%) actively contradict their own raw evidence** on price or currency (REJECT_CANDIDATE) — e.g. explicit `hkd147k` stored as USD, explicit `HKD:755000` stored with no price, stored `priceUSD` columns containing the year (20,582 rows) or duplicating the HKD amount (53,609 rows).
- **Currency evidence is strong where present**: 102,065 rows (86.7%) carry an explicit deterministic currency token; 13,560 rows (11.5%) are bare-`$` ambiguous; 837 have price tokens with no currency; 1,004 fail price parse; 278 have currencies (EUR/GBP/CHF) with no deterministic repo FX rate.
- **Intent, seller, and date lineage are absent from the supplied export**: 117,569/117,744 rows (99.85%) have no WTS/WTB evidence in-line (118 WTS, 57 WTB explicit), and **0 rows** carry seller name, seller phone, or original posted date. This alone caps Price Research eligibility at near zero and must be the first remediation.
- **1,504 rows are bundle parents** (2+ references in one line) and are excluded from Price Research and duplicate suppression until split with lineage.
- Image lineage: 2,268 of 5,000 supplied listing images are **SAFE_CANDIDATE** (exact raw-message lineage into the master dataset + reachable URL, verified live on 2026-07-23); 2,732 are DEFER (raw message not present in master dataset).
- XLSX export (`WatchFacts_Normalized_Dataset.xlsx`) is a stale 101,443-id snapshot; **30,748 rows (30.3%) drifted** between the XLSX and JSON stored currency values for identical IDs (predominantly USDT→USD rewrites), and the published schema file declares 14 fields/101,443 rows versus the actual 16 fields/117,744 rows.

---

## 2. Total files and rows reviewed

| File | Bytes | SHA-256 (truncated) |
|---|---|---|
| public/parsedWatches.json | 20,658,992 | `ec2295a3470aa06107ec…` |
| public/sample_listings.json | 4,614,159 | `05fd1380f73de5865130…` |
| public/patek_listings.json | 2,148,426 | `3c47d7238837b57e38d6…` |
| public/WatchFacts_Normalized_Dataset.xlsx | 8,937,425 | `84a5c85c37d5e2b013f7…` |
| public/parsedWatches.schema.json | 193 | `f5814320e14d7dea0471…` |

- `public/parsedWatches.json` — **117,744 rows**, 16 fields/row (declared schema: 14 fields, 101,443 rows — **stale**).
- `public/sample_listings.json` — 5,000 listing records with image URLs (image audit input).
- `public/patek_listings.json` — 5,000 records; verified same listing set as `sample_listings.json` (4,393 unique raw messages; identical image URL per raw message in all overlap).
- `public/WatchFacts_Normalized_Dataset.xlsx` — 102,594 rows ("All Records"), 2,503-row "CRITICAL Red Flag" sheet; audited as a cross-check, not re-row-audited (derived export of an older snapshot).
- Catalog references used for identity/configuration validation only: `catalog-source-v1.json` (7,326 entries, 24 brands), `master_catalog.json` (7,296 refs), `catalog.json` (1,667 refs) → 10,030 normalized reference keys.

## 3. Exact reconciliation totals

| Metric | Count |
|---|---|
| Input rows (parsedWatches.json) | 117,744 |
| Output rows (master audit CSV) | 117,744 |
| Error rows | 0 |
| Deferred rows (included in output, recommendation DEFER_AMBIGUOUS) | 1,142 |
| Duplicate source IDs in input | 0 |
| Missing source IDs | 0 |
| Reconciliation | **input 117,744 = output 117,744 + errors 0 → OK** |

Per-batch reconciliation (deterministic batches B001–B005, 25,000 rows each, checkpointed, no cross-batch merge before reconciliation):

| Batch | Input | Audited | Errors | KEEP | APPLY | HUMAN | DEFER | DUP_REVIEW | REJECT | SPLIT | Cur. ambig. | Parse fail | Recon |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| B001 | 25000 | 25000 | 0 | 172 | 2789 | 6916 | 646 | 9013 | 5441 | 23 | 2591 | 88 | OK |
| B002 | 25000 | 25000 | 0 | 21 | 518 | 5979 | 161 | 12675 | 5630 | 16 | 1802 | 108 | OK |
| B003 | 25000 | 25000 | 0 | 17 | 503 | 8159 | 124 | 13143 | 3040 | 14 | 3235 | 75 | OK |
| B004 | 25000 | 25000 | 0 | 31 | 528 | 7409 | 143 | 11358 | 5516 | 15 | 3162 | 145 | OK |
| B005 | 17744 | 17744 | 0 | 668 | 3880 | 6277 | 68 | 2885 | 2530 | 1436 | 2770 | 588 | OK |

## 4. Results by brand (stored brand)

| Brand | Rows | Currency VERIFIED | Bare-$ ambiguous | REJECT | HUMAN_REVIEW | DUPLICATE_REVIEW | KEEP+APPLY |
|---|---|---|---|---|---|---|---|
| Patek Philippe | 40,079 | 34,510 | 4,060 | 4,230 | 13,612 | 15,022 | 5,816 |
| Rolex | 39,891 | 31,189 | 8,570 | 15,711 | 11,620 | 11,072 | 1,149 |
| Audemars Piguet | 15,438 | 14,904 | 403 | 1,581 | 3,228 | 9,358 | 615 |
| Unknown | 12,905 | 12,697 | 153 | 249 | 2,376 | 9,193 | 1,025 |
| Richard Mille | 6,464 | 6,226 | 73 | 138 | 2,862 | 3,036 | 367 |
| Tudor | 1,598 | 1,501 | 97 | 125 | 290 | 1,073 | 23 |
| Vacheron Constantin | 823 | 575 | 190 | 110 | 583 | 73 | 34 |
| Cartier | 320 | 305 | 1 | 2 | 127 | 163 | 25 |
| A. Lange & Söhne | 49 | 37 | 0 | 0 | 0 | 29 | 20 |
| Breguet | 34 | 24 | 0 | 0 | 2 | 13 | 11 |
| Jaeger-LeCoultre | 26 | 12 | 0 | 2 | 4 | 10 | 8 |
| Blancpain | 21 | 14 | 0 | 2 | 0 | 10 | 9 |

Notes: Rolex shows the highest contradiction rate (15,711 REJECT of 39,891 — 39.4%, driven by bare-$ and stored-USD-vs-evidence-HKD conflicts). "Unknown" stored brand rows (12,905) are 98.5% currency-verified but 71% land in DUPLICATE_REVIEW.

## 5. Results by reference (top 20 by volume)

| Reference | Rows | REJECT | HUMAN_REVIEW | DUPLICATE_REVIEW |
|---|---|---|---|---|
| (none) | 2,443 | 775 | 424 | 894 |
| 126334 | 1,563 | 911 | 388 | 229 |
| RM07-01 | 1,450 | 21 | 409 | 903 |
| 126503 | 1,094 | 335 | 502 | 237 |
| 26240OR | 1,031 | 98 | 166 | 686 |
| 15510ST | 941 | 111 | 141 | 612 |
| 5168G | 940 | 78 | 208 | 503 |
| 15510OR | 890 | 46 | 165 | 610 |
| 126234 | 887 | 507 | 271 | 94 |
| 7118/1200A | 863 | 73 | 724 | 5 |
| 15551OR | 790 | 62 | 108 | 554 |
| 26240ST | 787 | 44 | 99 | 583 |
| 4910/1200A | 755 | 83 | 657 | 0 |
| 126334G | 753 | 162 | 165 | 377 |
| 5267/200A | 750 | 82 | 645 | 0 |
| 7300/1200A | 743 | 66 | 672 | 0 |
| 126500 | 721 | 91 | 262 | 339 |
| 126508 | 689 | 259 | 176 | 230 |
| 7118/1200R | 673 | 82 | 477 | 24 |
| 6119R | 668 | 50 | 93 | 462 |

## 6. Results by currency status

| Status | Rows | Share |
|---|---|---|
| VERIFIED | 102,065 | 86.7% |
| CURRENCY_AMBIGUOUS | 13,560 | 11.5% |
| PRICE_PARSE_FAILED | 1,004 | 0.9% |
| CURRENCY_UNVERIFIED | 837 | 0.7% |
| CURRENCY_RATE_UNVERIFIED | 278 | 0.2% |

- Bare-`$` ambiguous rows are **never** resolved to USD (rule-compliant; 16,025 lines contain `$`, of which 13,560 have no other explicit currency evidence).
- HKD rows converted with the repo's documented deterministic rate 0.128 are flagged `FX_RATE_REPO_HARDCODED_0.128_NO_DATE` (91,599 rows) — usable for analysis, but FX date/source is not retained, so final canary sign-off requires human FX confirmation.
- EUR/GBP/CHF rows (278) are `CURRENCY_RATE_UNVERIFIED`: the repo contains conflicting rate conventions for these currencies across files (`api/clean-analyze.js` division table vs `api/ingest.js` multiplication table), so no deterministic conversion exists.

## 7. WTS and WTB totals

| Intent | Rows |
|---|---|
| WTS (explicit token) | 118 |
| WTB (explicit token) | 57 |
| UNKNOWN (no in-line intent evidence) | 117,569 |

The supplied export strips message/section context, so intent is unknowable for 99.85% of rows without re-joining to source groups. WTS and WTB are kept strictly separate throughout.

## 8. Bundle and multilisting totals

| Bundle status | Rows |
|---|---|
| SINGLE_LISTING | 113,797 |
| UNVERIFIED | 2,443 |
| SPLIT_REQUIRED | 1,504 |

1,504 bundle parents (2+ distinct references in one line) are marked SPLIT_REQUIRED and are **excluded** from Price Research and from duplicate suppression until children are split and lineage-linked. Alias pairs (same watch cited twice, e.g. `5235R … 5235/50R` with one price) were collapsed with reason `ALIAS_REF_PAIR_COLLAPSED` and are not treated as bundles.

## 9. Duplicate candidates

| Duplicate status | Rows |
|---|---|
| DUPLICATE_EXACT_RAW | 93,695 |
| CANONICAL | 12,808 |
| UNIQUE | 11,241 |

12,808 exact-raw duplicate groups. Canonical (first-occurrence) rows remain eligible for all downstream gates; non-canonical members default to DUPLICATE_REVIEW unless a higher-severity issue applies. Repost persistence is measurable per group (largest groups exceed 40 reposts). Config-level duplicates (same ref/dial/condition/price across different raw texts) were not auto-collapsed, per ANALYTICS_RULES dealer-protection rule.

## 10. Seller/date lineage coverage

| Field | Rows with value |
|---|---|
| seller_name | 0 / 117,744 (0%) |
| seller_phone | 0 / 117,744 (0%) |
| original_posted_at | 0 / 117,744 (0%) |

**Complete lineage vacuum.** Duplicate suppression currently cannot use dealer identity (falls back to exact-message matching only), and price-by-date analytics are impossible from this export. Re-joining to `raw_messages` with seller/date lineage is a prerequisite for the analytics contract.

## 11. Catalog conflicts

| Catalog status | Rows |
|---|---|
| EXACT_MATCH | 61,362 |
| NOT_FOUND | 48,405 |
| MULTIPLE_CANDIDATES | 5,534 |
| UNVERIFIED | 2,443 |

- 10,656 rows carry `DIAL_CATALOG_MISMATCH` (claimed dial not in the exact reference's catalog dial list — raw claim preserved, not rewritten).
- 5,534 MULTIPLE_CANDIDATES rows are dominated by **cross-brand reference collisions inside `catalog-source-v1.json`**: e.g. Vacheron Constantin entries `4910/1200A`, `7118/1200A`, `5267/200A` collide with iconic Patek Philippe references; `127334` exists as "Rolex" though no such Rolex reference is known. The catalog source itself requires curation; where an explicit brand word existed in the raw line, deterministic disambiguation was applied (`REF_BRAND_DISAMBIGUATED`).
- 48,405 NOT_FOUND rows reflect thin catalog coverage for high-volume AP/Rolex dealer references (e.g. 77451ST, 26231ST, 278273G, 16202XT) plus dealer typo references — never silently repaired.

## 12. Price Research eligible and excluded totals

| Gate set | Eligible |
|---|---|
| Strict (all gates incl. explicit WTS intent) | **1** |
| Deterministic-clean with intent gate waived (sensitivity) | 1,947 |

Strict-eligible row: `pk_126398` — *"For sale 5980/1A Black dial 2008 good condition Full set *98,000USD*"* — WTS token, single listing, EXACT_MATCH, dial present, USD explicit, unique.

Excluded totals (dominant first-exclusion reason): intent not in evidence 117,569; non-canonical duplicate 93,695; currency not VERIFIED 15,679; catalog not EXACT_MATCH 56,382; recommendation not KEEP/APPLY 108,617 (gates are overlapping; rows can fail several).

## 13. Outlier totals by cohort

Outliers computed **only after deterministic eligibility filtering** (1,947 intent-waived clean rows), cohort = brand|reference|condition|dial, 1.5×IQR, cohorts with ≥5 observations only. Outliers are flagged and preserved, never deleted.

| Outlier status | Rows |
|---|---|
| CLEAN | 1,238 |
| COHORT_TOO_SMALL | 667 |
| OUTLIER_LOW | 28 |
| OUTLIER_HIGH | 14 |

| Cohort (brand\|ref\|condition\|dial) | Outlier rows |
|---|---|
| Patek Philippe\|7118/1200R\|UNKNOWN_COND\|White | 6 |
| Patek Philippe\|7010/1R\|New\|Purple | 5 |
| Patek Philippe\|5905R\|New\|Blue | 5 |
| Patek Philippe\|5205R\|UNKNOWN_COND\|Green | 2 |
| Patek Philippe\|5968G\|New\|Green | 2 |
| Patek Philippe\|5821/1A\|New\|Green | 2 |
| Patek Philippe\|5168G\|New\|Blue | 2 |
| Patek Philippe\|7118/1A\|UNKNOWN_COND\|Grey | 2 |
| Patek Philippe\|5924G\|UNKNOWN_COND\|Blue | 1 |
| Rolex\|126300\|UNKNOWN_COND\|Green | 1 |
| Patek Philippe\|4947G\|UNKNOWN_COND\|White | 1 |
| Patek Philippe\|5924G\|New\|Green | 1 |
| Patek Philippe\|5905P\|UNKNOWN_COND\|Black | 1 |
| Patek Philippe\|5905P\|UNKNOWN_COND\|Blue | 1 |
| Patek Philippe\|7118/1200R\|New\|White | 1 |

## 14. Image-lineage candidates

Input: 5,000 listing records, 5,000 unique image URLs (DigitalOcean Spaces). Live reachability re-verified on 2026-07-23: **5,000/5,000 reachable**. No URL is shared across listing records.

| Recommendation | Rows | Basis |
|---|---|---|
| SAFE_CANDIDATE | 2,268 | exact raw-message lineage into master dataset + reachable URL |
| DEFER | 2,732 | raw message not present in master dataset (lineage incomplete) |
| REJECT | 0 | — |

Brand/reference/visual similarity was never used as match basis. 3,016 master rows have an image candidate via exact raw-message match.

## 15. Highest-risk data patterns

| Pattern | Rows affected |
|---|---|
| INTENT_NOT_IN_EVIDENCE | 117,569 |
| FX_RATE_REPO_HARDCODED_0.128_NO_DATE | 91,599 |
| CONDITION_NOT_IN_EVIDENCE | 65,319 |
| BRAND_NOT_DETERMINED | 55,845 |
| STORED_PRICEUSD_EQUALS_HKD_PRICE | 53,609 |
| REFERENCE_NOT_FOUND | 48,405 |
| DIAL_NOT_IN_EVIDENCE | 47,018 |
| STALE_FLAG_MISSING_PRICE | 35,034 |
| STALE_FLAG_MISSING_YEAR | 27,781 |
| STALE_FLAG_UNKNOWN_BRAND | 27,035 |
| STORED_PRICEUSD_IS_YEAR | 20,582 |
| STORED_CURRENCY_MISMATCH | 19,961 |
| SET_STATUS_FULL_SET | 15,591 |
| STORED_REFERENCE_IS_YEAR | 15,580 |
| STORED_PRICE_NO_LINE_EVIDENCE | 14,471 |
| BARE_DOLLAR_AMBIGUOUS | 13,560 |
| DIAL_CATALOG_MISMATCH | 10,656 |
| STORED_CONDITION_MISMATCH | 9,148 |
| STORED_REFERENCE_MISMATCH | 8,502 |
| STORED_COLUMN_CORRUPTION_CONDITION_IN_CURRENCY | 7,386 |
| STALE_FLAG_MISSING_REFERENCE | 5,969 |
| REFERENCE_AMBIGUOUS | 5,534 |
| STORED_PRICEUSD_MISMATCH | 4,727 |
| STORED_PRICE_MISMATCH | 3,286 |

Additional systemic risks confirmed during the audit:

1. **Stored `priceUSD` column is corrupt in two mass modes**: it duplicates the HKD amount on 53,609 rows (HKD passed through as "USD") and contains the listing year on 20,582 rows. Any analytics reading this column are doubly wrong (wrong currency, wrong value). Matches the XLSX "Avg Price USD ≈ 1.02M" inflation.
2. **Stored currency contradicts explicit line evidence on 19,961 rows** (predominantly explicit-HKD evidence stored as USD). Combined with bare-$ rows, at least ~33k rows would inject wrong-currency prices into USD analytics.
3. **Stored reference is a year on 15,580 rows** (`2023Y`, `2026Y`…) and stored currency slot holds condition text on 7,386 rows (`New`, `Used`, `Like New`) — column-level schema corruption.
4. **Stale pipeline flags**: 35,034 rows flagged MISSING_PRICE actually have explicit verified line prices; 27,035 UNKNOWN_BRAND rows have determinable brands; 27,781 MISSING_YEAR rows have year evidence. Flag state diverged from evidence state.
5. **Catalog source contamination** (cross-brand collisions, §11) — catalog is used as authority for configuration, so its own hygiene gates every downstream dial/configuration decision.
6. **14,471 rows carry a stored price with no price evidence in the raw line at all** — source of these values is undocumented.
7. Repo FX tables for EUR/GBP/CHF are mutually inconsistent across files; HKD 0.128 is consistent everywhere but has no date/source metadata.
8. Export/version drift: XLSX vs JSON stored currency differs on 30,748 shared IDs; schema file stale by 16,301 rows and 2 columns.

## 16. Twenty accepted examples (KEEP / APPLY_CANDIDATE) with exact evidence

| id | raw evidence | ref | dial | cond | price | cur | price_usd | rec |
|---|---|---|---|---|---|---|---|---|
| wa_4 | 🔵4946r N2/2026 New 308k HKD | 4946R | — | New | 308000.0 | HKD | 39424.0 | APPLY_CANDIDATE |
| wa_8 | 🔵4997/200g N3/2026 New 180k HKD | 4997/200G | — | New | 180000.0 | HKD | 23040.0 | KEEP |
| wa_10 | 🔵5072r N6/2026 New 1.83m HKD | 5072R | — | New | 1830000.0 | HKD | 234240.0 | APPLY_CANDIDATE |
| wa_41 | 🔵5268/461g Blue N11/2025 New 530k usdt | 5268/461G | Blue | New | 530000.0 | USDT | 530000.0 | KEEP |
| wa_42 | 🔵5268/461g Blue N5/2026 New 560k usdt | 5268/461G | Blue | New | 560000.0 | USDT | 560000.0 | KEEP |
| wa_52 | 🔵5278/500g N10/2025 New 1.95m usdt | 5278/500G | — | New | 1950000.0 | USDT | 1950000.0 | APPLY_CANDIDATE |
| wa_53 | 🔵5303r N3/2026  New 990k usdt | 5303R | — | New | 990000.0 | USDT | 990000.0 | APPLY_CANDIDATE |
| wa_54 | 🔵5304/301r 2026 New 1.9m usdt | 5304/301R | — | New | 1900000.0 | USDT | 1900000.0 | APPLY_CANDIDATE |
| wa_94 | 🔵5990/1422g red N4/2026 3.28m usdt | 5990/1422G | Red | — | 3280000.0 | USDT | 3280000.0 | APPLY_CANDIDATE |
| wa_101 | 🔵6104p Blue N12/2025 New 1.05m usdt | 6104P | Blue | New | 1050000.0 | USDT | 1050000.0 | APPLY_CANDIDATE |
| wa_103 | 🔵6104r Black N12/2025 New 555k usdt | 6104R | Black | New | 555000.0 | USDT | 555000.0 | APPLY_CANDIDATE |
| wa_197 | 🟡 Rm07-01 Wg Diamond black lips 4/2026 New 340k usdt | RM07-01 | Black | New | 340000.0 | USDT | 340000.0 | KEEP |
| wa_201 | 🟡 Rm07-01 black ceramic onyx n4/2026 236k usdt | RM07-01 | Black | — | 236000.0 | USDT | 236000.0 | KEEP |
| wa_715 | 🌹New RM07-01 black ceramic side diamond black lip 2026y 338k usdt | RM07-01 | Black | New | 338000.0 | USDT | 338000.0 | APPLY_CANDIDATE |
| wa_945 | 🌀🌀New RM07-01 black ceramic side diamond black lip N4/2026y 338k usdt | RM07-01 | Black | New | 338000.0 | USDT | 338000.0 | APPLY_CANDIDATE |
| wa_946 | 🌀🌀New RM07-01 wg snow black lip 2022y 330k usdt | RM07-01 | Black | New | 330000.0 | USDT | 330000.0 | APPLY_CANDIDATE |
| wa_1867 | Rm07-01 black cer 6/2026 253k usdt | RM07-01 | Black | — | 253000.0 | USDT | 253000.0 | KEEP |
| wa_3245 | ❤️❤️Used RM07-01 snow black lips Naked 278k usdt | RM07-01 | Black | Used | 278000.0 | USDT | 278000.0 | KEEP |
| wa_18659 | 🌏 5270P salmon 2021 New 167k usdt | 5270P | Salmon | New | 167000.0 | USDT | 167000.0 | APPLY_CANDIDATE |
| wa_48027 | 🌖116518LN G Black(2021) 2022 Used Fullest HKD335k | 116518LN | Black | Used | 335000.0 | HKD | 42880.0 | APPLY_CANDIDATE |

## 17. Twenty blocked examples with exact evidence

| id | raw evidence | stored brand | stored ref | parsed price | parsed cur | cur status | rec | reasons |
|---|---|---|---|---|---|---|---|---|
| wa_0 | 🔵4910/1200a green N5/2026 New 125k HKD | Patek Philippe | 4910/1200A | 125000.0 | HKD | VERIFIED | HUMAN_REVIEW | INTENT_NOT_IN_EVIDENCE\|FX_RATE_REPO_HARDCODED_0.128_NO_DATE\|REFERENCE_AMBIGUOUS\|BRAND_NOT_DETERMINED\|DIAL_CATALOG_MISMATCH\|STORED_PRICEUSD_EQUALS_HKD_PRICE |
| wa_1 | 🔵4910/1200a green N8/2025 New 115k HKD | Patek Philippe | 4910/1200A | 115000.0 | HKD | VERIFIED | HUMAN_REVIEW | INTENT_NOT_IN_EVIDENCE\|FX_RATE_REPO_HARDCODED_0.128_NO_DATE\|REFERENCE_AMBIGUOUS\|BRAND_NOT_DETERMINED\|DIAL_CATALOG_MISMATCH\|STORED_PRICEUSD_EQUALS_HKD_PRICE |
| wa_2 | 🔵4910/1200a Grey N6/2026 New 125k HKD | Patek Philippe | 4910/1200A | 125000.0 | HKD | VERIFIED | HUMAN_REVIEW | INTENT_NOT_IN_EVIDENCE\|FX_RATE_REPO_HARDCODED_0.128_NO_DATE\|REFERENCE_AMBIGUOUS\|BRAND_NOT_DETERMINED\|STORED_PRICEUSD_EQUALS_HKD_PRICE |
| wa_46 | 🔵5270p red N4/2026 New 230k usdt | Patek Philippe | 5270P-001 | 230000.0 | USDT | VERIFIED | HUMAN_REVIEW | INTENT_NOT_IN_EVIDENCE\|DIAL_CATALOG_MISMATCH\|STORED_REFERENCE_MISMATCH stored:5270P-001 evidence:5270P\|STALE_FLAG_UNKNOWN_BRAND |
| wa_69 | 🔵5531r 2021 New 970k usdt | Rolex | 5531R | 970000.0 | USDT | VERIFIED | HUMAN_REVIEW | INTENT_NOT_IN_EVIDENCE\|DIAL_NOT_IN_EVIDENCE\|STORED_BRAND_MISMATCH stored:Rolex evidence:Patek Philippe\|STALE_FLAG_UNKNOWN_BRAND |
| wa_91 | 🔵5980/1400g N10/2025 New 669k usdt | Patek Philippe | 5980/1400G | 669000.0 | USDT | VERIFIED | HUMAN_REVIEW | INTENT_NOT_IN_EVIDENCE\|REFERENCE_AMBIGUOUS\|BRAND_NOT_DETERMINED\|DIAL_NOT_IN_EVIDENCE |
| wa_133 | 🔵7968/300r N9/2025 New 395k usdt | Patek Philippe | 7968/300R | 395000.0 | USDT | VERIFIED | HUMAN_REVIEW | INTENT_NOT_IN_EVIDENCE\|REFERENCE_AMBIGUOUS\|BRAND_NOT_DETERMINED\|DIAL_NOT_IN_EVIDENCE |
| wa_135 | 🟡 Rm75-01 Blue 5/2026 New 3.73m usdt | Richard Mille | RM 75-01 | 3730000.0 | USDT | VERIFIED | HUMAN_REVIEW | INTENT_NOT_IN_EVIDENCE\|DIAL_CATALOG_MISMATCH\|STALE_FLAG_MISSING_PRICE |
| wa_136 | 🟡 Rm75-01 Smoked Blue 5/2026 New 3.8m usdt | Richard Mille | RM 75-01 | 3800000.0 | USDT | VERIFIED | HUMAN_REVIEW | INTENT_NOT_IN_EVIDENCE\|POSSIBLE_SPECIAL_EDITION\|STALE_FLAG_MISSING_PRICE |
| wa_139 | 🟡 Rm72-01 white 4/2026 New 460k usdt | Richard Mille | RM 72-01 | 460000.0 | USDT | VERIFIED | HUMAN_REVIEW | INTENT_NOT_IN_EVIDENCE\|DIAL_CATALOG_MISMATCH |
| wa_172 | 🟡 Rm35-03 tiffany 5/2026 new 655k usdt | Richard Mille | RM 35-03 | 655000.0 | USDT | VERIFIED | HUMAN_REVIEW | INTENT_NOT_IN_EVIDENCE\|POSSIBLE_SPECIAL_EDITION |
| wa_173 | 🟡 Rm35-03 Salmon 4/2026 New 545k usdt | Richard Mille | RM 35-03 | 545000.0 | USDT | VERIFIED | HUMAN_REVIEW | INTENT_NOT_IN_EVIDENCE\|POSSIBLE_SPECIAL_EDITION |
| wa_195 | 🟡 Rm07-01 wg snow mop 5/2026 New 477k usdt | Richard Mille | RM 07-01 | 477000.0 | USDT | VERIFIED | HUMAN_REVIEW | INTENT_NOT_IN_EVIDENCE\|STORED_DIAL_MISMATCH stored:MOP evidence:Mother of Pearl |
| wa_266 | 🏮126525 LN Le Mans🏷️ $1.46m 04/2026 | Rolex | 126525 | — | — | CURRENCY_AMBIGUOUS | HUMAN_REVIEW | INTENT_NOT_IN_EVIDENCE\|BARE_DOLLAR_AMBIGUOUS\|raw:$1.46m\|REFERENCE_NOT_FOUND\|BRAND_NOT_DETERMINED\|DIAL_NOT_IN_EVIDENCE\|CONDITION_NOT_IN_EVIDENCE\|STORED_PRICE_NO_LINE_EVIDENCE |
| wa_267 | 🏮128458 TBR Turquoise🏷️ $690k 04/2023 | Rolex | 128458 | — | — | CURRENCY_AMBIGUOUS | HUMAN_REVIEW | INTENT_NOT_IN_EVIDENCE\|BARE_DOLLAR_AMBIGUOUS\|raw:$690k\|REFERENCE_NOT_FOUND\|BRAND_NOT_DETERMINED\|POSSIBLE_SPECIAL_EDITION\|CONDITION_NOT_IN_EVIDENCE\|STORED_PRICE_NO_LINE_EVIDENCE |
| wa_268 | 🏮226668 TBR pave🏷️ $1.15m 08/2025 | Rolex | 226668 | — | — | CURRENCY_AMBIGUOUS | HUMAN_REVIEW | INTENT_NOT_IN_EVIDENCE\|BARE_DOLLAR_AMBIGUOUS\|raw:$1.15m\|REFERENCE_NOT_FOUND\|BRAND_NOT_DETERMINED\|POSSIBLE_SPECIAL_EDITION\|CONDITION_NOT_IN_EVIDENCE\|STORED_PRICE_NO_LINE_EVIDENCE |
| wa_933 | 🌀🌀Used RM52-06 white mask 2020y 1.48m usdt | Richard Mille | RM 52-06 | 1480000.0 | USDT | VERIFIED | HUMAN_REVIEW | INTENT_NOT_IN_EVIDENCE\|REF_SUFFIX_VARIANT_FALLBACK\|DIAL_CATALOG_MISMATCH\|STALE_FLAG_MISSING_PRICE\|STALE_FLAG_MISSING_YEAR |
| wa_934 | 🌀🌀Used RM52-06 red mask 2020y 1.1m usdt | Richard Mille | RM 52-06 | 1100000.0 | USDT | VERIFIED | HUMAN_REVIEW | INTENT_NOT_IN_EVIDENCE\|REF_SUFFIX_VARIANT_FALLBACK\|DIAL_CATALOG_MISMATCH\|STALE_FLAG_MISSING_PRICE\|STALE_FLAG_MISSING_YEAR |
| wa_960 | 🌀🌀Used Rm11-01ti,New movement,naked,137k usdt | Richard Mille | RM 11-01 TI | 137000.0 | USDT | VERIFIED | HUMAN_REVIEW | INTENT_NOT_IN_EVIDENCE\|REFERENCE_NOT_FOUND\|BRAND_NOT_DETERMINED\|DIAL_NOT_IN_EVIDENCE\|SET_STATUS_WATCH_ONLY\|STORED_CONDITION_MISMATCH stored:New evidence:Used\|STALE_FLAG_MISSING_REFERENCE |
| wa_982 | 🔔🔔New 15510or black 2023y full set 410k hkd         🔔🔔New 77451or blue full gold,N2/2026y 665K HKD | Unknown | 2023Y | 410000.0 | HKD | VERIFIED | SPLIT_REQUIRED | INTENT_NOT_IN_EVIDENCE\|MULTIPLE_YEARS\|FX_RATE_REPO_HARDCODED_0.128_NO_DATE\|REFERENCE_NOT_FOUND\|BRAND_NOT_DETERMINED\|SET_STATUS_FULL_SET\|STORED_PRICEUSD_EQUALS_HKD_PRICE\|STORED_REFERENCE_IS_YEAR:2023Y\|STALE_FLAG_MISSING_YEAR |

## 18. Recommended first bounded canary

**Scope:** the 1,947 intent-waived deterministically clean rows, further bounded to (a) explicit USD/USDT currency only (removes the undated-FX caveat), (b) UNIQUE or CANONICAL duplicate status, (c) cohort size ≥ 5 with outlier fences applied. Estimated canary size: ~600–900 rows (exact count reproducible from `watchfacts_audit_master.csv` filter: `currency_normalized in (USD,USDT)` ∧ gates in §12).

**Sequence:**
1. Re-join canary rows to `raw_messages` to restore seller/date/intent lineage (currently 0% coverage) — hard gate.
2. Human-review the canary's APPLY_CANDIDATE rows against raw evidence (intake checklist, July 22 handoff).
3. Stage into `price_remediation_review`-style review table only; no `watch_records` mutation.
4. Confirm FX rate/date/source for HKD rows before any HKD inclusion.
5. Fix stored `priceUSD` corruption modes (§15.1) and re-run this audit as regression before any expansion.

## 19. Non-mutation confirmation

This audit connected to **no** production system (Supabase, Railway, Vercel, DigitalOcean Spaces write paths, production APIs all untouched). No raw message, source table, application code, schema, or deployment configuration was modified. All processing ran read-only against a local clone of branch `codex/zero-hallucination-normalization`. Deliverables are audit documentation and generated CSVs only; no code changes are proposed in this package. Image URL checks were read-only HEAD/range requests. The only repository write is this separate audit documentation branch (`audit/zero-hallucination-evidence-2026-07-23`), which contains no application-code changes, no credentials, and no dealer contact data.

---

## Appendix A — Method (deterministic rules applied)

- Sole extraction source: preserved raw listing line. Date/price spans masked before reference extraction; price mentions require explicit currency token and/or proven multiplier (K=10³, mil=10³, M/MN/mill/million=10⁶, W/万=10⁴); European formats (`2.070,000`, `1,22M`, `86,800 -30% = 60,760HK$`) parsed deterministically; dotted amounts with an attached multiplier token read as decimal fractions (`1.355m` = 1,355,000); bare `$` → CURRENCY_AMBIGUOUS; multiplier without currency → CURRENCY_UNVERIFIED.
- Catalog: identity/configuration validation only; exact normalized-reference match; suffix-variant fallback flagged (`REF_SUFFIX_VARIANT_FALLBACK`); cross-brand candidates flagged MULTIPLE_CANDIDATES unless explicit brand word disambiguates.
- Special-edition/dealer dial language (Tiffany, Salmon, Rainbow, Ombre, Panda, pave, meteorite…) kept claimed, mapped only when the exact reference's catalog dial list contains the term. Case-metal phrases (Rose Gold, white gold…) are not dials.
- Duplicates: whitespace-normalized exact raw-message groups; canonical = first occurrence.
- Outliers: 1.5×IQR per ANALYTICS_RULES, post-eligibility-filtering, cohorts ≥5.
- Independent verification: a separate adversarial verifier re-derived 28 stratified rows against the rules — 28/28 recommendations confirmed; its engine-level findings (glued refs, glued conditions, case-metal dial false positives, alias-pair splits, decimal-comma amounts) were fixed and the full audit re-run before this report (0 errors final).
- Audit engine: deterministic Python, no LLM in the row path. Parser version: `zh-audit-engine v1.3 (2026-07-23)`.

## Appendix B — Artifact inventory

| Artifact | Contents |
|---|---|
| `watchfacts_audit_master.csv` | 117,744 rows × 38 columns (31 contract columns + 7 outlier columns) |
| `watchfacts_audit_images.csv` | 5,000 image-lineage rows |
| `watchfacts_audit_errors.csv` | 0 data rows (header only) — final run error-free |
| `batch_summary.csv` / `batch_summaries.json` | per-batch reconciliation and counters |
| `batches/audit_B001..B005.csv` | checkpointed batch outputs |
| `checkpoint.json` | last processed source ID per batch |
| `input_inventory.json` | input files, sizes, SHA-256 |
| `aggregates.json` | all report aggregates and example sets |
| `xlsx_crosscheck.json` | XLSX export drift results |
