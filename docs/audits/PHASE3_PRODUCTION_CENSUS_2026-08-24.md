# WatchFacts Phase 3 production census — read-only evidence report

Status: **PARTIAL / SHARE WITH CAVEATS**

Production project: `qnsafosakvonzgfcsphh` (`watchfacts-pipeline-prod`)

Active normalization run: `mariadb-normalized-20260811-codex-v1`

Observation date: 2026-08-24 (America/New_York)

Merged prerequisite: PR #761, merge commit `421e67ed590d5476247eca3e0aa4216fc032d9db`

## Technical summary

The current authoritative watch path is the QNSA production project, not a local export. The active market-feed snapshot contains **600,986 watch observations**. The customer-facing live-release summary reports **565,620 watch listings**, but a second endpoint reports **580,325** under the same Trading Floor label. This 14,705-row difference is a confirmed metric-source mismatch, so neither number should be renamed `Total Listings` until the endpoint contract is reconciled.

The bounded Rolex aggregate completed successfully and is exact for the active run: **281,480 normalized rows**, **281,480 immutable raw-version IDs**, **232,191 WTS**, **49,289 WTB**, and **4,592 distinct nonblank normalized reference values**. However, **zero normalized Rolex model values are populated** in the active staging rows. The 4,592 values also include obvious non-reference tokens such as `BRACELET`, so they are not yet a customer-safe catalog-reference count.

The full joined publication/Price Research aggregate timed out at the Supabase upstream boundary even when limited to Rolex. It was not retried with broader load. Trading Floor and Price Research reference-level parity, parser-v5 shadow classifications, and the Phase-2 665 production mapping therefore remain **UNKNOWN**, not zero.

## 1. Exact production data sources verified

| Layer | Current source | Status | Evidence / limitation |
|---|---|---:|---|
| Legacy/source database | External source represented by `source_record_id`; planner estimate for `raw_messages` was 1,325,808 | LIKELY | Relation exists, but an authoritative global source-side aggregate was not available in the bounded window. |
| Immutable raw storage | `public.raw_message_versions` joined by exact version ID and source hash | VERIFIED | Rolex returned 281,480 distinct immutable version IDs for 281,480 active rows. Latest observed immutable timestamp: 2026-08-11 17:59:11 UTC. |
| Normalized/staging | `staging.listings` with active run from `public.qnsa_market_feed_control` | VERIFIED | Exact active snapshot total: 603,678 across enabled categories; watches: 600,986. |
| Reviewed/release | Brand release controls/manifests plus reviewed-workbook overlay | VERIFIED WITH CAVEAT | Cartier 7,154; Omega 6,871; Tudor 2,555; Vacheron Constantin Overseas 2,500. Most staging rows remain `PENDING_REVIEW`, so released is not synonymous with human-verified. |
| Trading Floor publication | Configured QNSA release view plus reviewed-workbook admissions; public summary endpoint | VERIFIED WITH CAVEAT | Public summary total 565,620. Vacheron is absent despite an enabled 2,500-row manifest. |
| Price Research | QNSA price-research views and exact-reference analytics evidence | VERIFIED WITH CAVEAT | Qualification policy is source-backed WTS with explicit currency or dated verified FX; joined aggregate timed out, so current reference totals are UNKNOWN. |
| Telegram/WhatsApp ingestion | `public.live_ingest` | UNKNOWN / INACTIVE | Relation exists; observed maximum `received_at` was null. No evidence it contributes to the active QNSA run. |

## 2. Global brand counts

The following are the exact current counts returned by the production public endpoints. `Live release` and `market-feed snapshot` intentionally remain separate because they use different sources.

| Brand | Live release | Market-feed snapshot | Difference | Interpretation |
|---|---:|---:|---:|---|
| Rolex | 281,480 | 281,480 | 0 | Reconciles at brand total. |
| Patek Philippe | 126,571 | 126,571 | 0 | Reconciles at brand total. |
| Audemars Piguet | 84,958 | 84,958 | 0 | Reconciles at brand total. |
| Richard Mille | 39,958 | 39,958 | 0 | Reconciles at brand total. |
| Cartier | 7,154 | 11,753 | -4,599 | Controlled manifest is smaller than source snapshot. |
| Omega | 6,871 | 10,384 | -3,513 | Controlled manifest is smaller than source snapshot. |
| Tudor | 2,555 | 3,934 | -1,379 | Controlled manifest is smaller than source snapshot. |
| Zenith | 464 | 464 | 0 | Reconciles at brand total. |
| Vacheron Constantin | omitted | 9,008 | UNKNOWN | Enabled 2,500-row Overseas manifest is not represented in the summary response. |
| All watches | 565,620 | 580,325 | -14,705 | Confirmed count-definition/source mismatch. |

The active staging snapshot also contains pseudo-brand labels such as model-family names. Those labels require taxonomy review before a customer-visible global brand count is safe.

## 3–5. Model and exact-reference inventory

### Rolex exact active-run result

| Metric | Count | Status |
|---|---:|---|
| Normalized rows | 281,480 | VERIFIED |
| Source identifiers | 281,480 | VERIFIED |
| Immutable raw-version identifiers | 281,480 | VERIFIED |
| WTS | 232,191 | VERIFIED |
| WTB | 49,289 | VERIFIED |
| Rows with original price | 158,032 | VERIFIED |
| Rows with normalized USD price | 157,514 | VERIFIED |
| Distinct populated model values | 0 | VERIFIED defect |
| Distinct populated reference values | 4,592 | VERIFIED, not customer-safe |

The complete 4,592-row aggregate reference inventory is stored in `audit-output/phase3-production-census/rolex-reference-census.json` with SHA-256 `58B238AD8D6B03738F5D0F4CE9FE91FCC6201556A8D667A3A96F0CE4DD626FFE`.

Production catalog metadata separately reports Rolex as 17 searchable models and 303 searchable catalog references. That catalog count is **not** the same grain as the 4,592 staging values and must not be substituted into the staging census.

Global model→reference listing totals are **UNKNOWN** because the broad aggregate and the joined Rolex publication aggregate exceeded the bounded upstream timeout. No local-export count was used as a replacement.

## 6. Source-to-publication reconciliation

| Stage | Rolex count | Loss from prior stage | Status / reason |
|---|---:|---:|---|
| Source identifiers in active normalized rows | 281,480 | — | VERIFIED; this is not a complete external-source census. |
| Immutable raw versions in active normalized rows | 281,480 | 0 | VERIFIED. |
| Active normalized rows | 281,480 | 0 | VERIFIED. |
| Review/release | UNKNOWN | UNKNOWN | Release view expansion timed out; review states are predominantly pending. |
| Trading Floor rows | 281,480 at snapshot/summary grain | UNKNOWN at exact-reference publication grain | Brand total reconciles; exact-reference publication parity not proven. |
| Price Research qualified WTS | UNKNOWN | UNKNOWN | Public coverage endpoint returns null; bounded view aggregate timed out. |
| Analytics-ready references | UNKNOWN | UNKNOWN | Bounded analytics view aggregate timed out. |

Determinable price gap in active Rolex staging: 518 rows have a positive original price but no normalized USD price. This is a field-state count only; it is **not** a safe-parser candidate count.

## 7. Phase-2 665 cohort

The local Phase-2 artifact classified 620 `NORMALIZATION_SKIPPED`, 20 `BUNDLE_DEFERRED`, 13 currency-policy, 9 multiple-price review, 2 other, and 1 reference unresolved. Its row IDs are local/static identifiers and the canary output did not retain the production immutable/source IDs or source-payload hashes needed for primary-key reconciliation.

| Production status | Count |
|---|---:|
| Present in production raw | UNKNOWN |
| Present in normalized staging | UNKNOWN |
| Already corrected | UNKNOWN |
| Still missing normalized price | UNKNOWN |
| Intentionally deferred | UNKNOWN |
| Duplicated/superseded | UNKNOWN |
| Not found | UNKNOWN |
| Impossible to map safely from the current artifact | 665 |

Raw-message text alone was not used as the primary identifier. A safe mapping requires a regenerated cohort export carrying `source_record_id`, `raw_message_version_id`, or the exact production source hash.

## 8–10. Parser-v5 shadow outcome

| Outcome | Count | Status |
|---|---:|---|
| Safe null-only correction candidates | UNKNOWN | Raw contents plus immutable IDs were not available through a bounded aggregate; no rows were downloaded. |
| Review required | UNKNOWN | Same limitation. |
| Unresolved | UNKNOWN | Same limitation. |

The parser was not run against production rows because doing so safely would require a bounded immutable-ID extract of missing-price raw evidence. The confirmed field-state population is 518 Rolex rows with original price present and normalized USD absent; none is deemed safe until parser-v5 shadow output and evidence policy both pass.

## 11. Ranked correction opportunities

The ranking below is diagnostic only. `USD gap` means original price exists while normalized USD is absent; it is not authorization to fill.

| Priority | Brand | Model | Reference | Active rows | Missing USD price | USD gap | TF gap | PR gap |
|---:|---|---|---|---:|---:|---:|---:|---:|
| 1 | Rolex | UNKNOWN | 126334 | 12,985 | 6,124 | 11 | UNKNOWN | UNKNOWN |
| 2 | Rolex | UNKNOWN | 126300 | 5,778 | 2,594 | 6 | UNKNOWN | UNKNOWN |
| 3 | Rolex | UNKNOWN | 228235 | 5,162 | 2,690 | 7 | UNKNOWN | UNKNOWN |
| 4 | Rolex | UNKNOWN | 228238 | 4,464 | 2,324 | 13 | UNKNOWN | UNKNOWN |
| 5 | Rolex | UNKNOWN | 126333 | 5,007 | 2,117 | 12 | UNKNOWN | UNKNOWN |

`BRACELET` was excluded from the correction ranking even though it has 10,024 rows, because it is a product/component token rather than an exact watch reference.

## 12. Proposed first correction batch

**P3-RLX-001 is BLOCKED**, not canary-ready. Proposed complete reference boundaries are `126334`, `126300`, `228235`, `228238`, and `126333`. Before any correction authorization:

1. backfill or deterministically derive the canonical model mapping in a review artifact (not production);
2. export only the 49 original-price/normalized-USD gap rows across those five references with immutable IDs and source hashes;
3. run parser-v5 in shadow mode;
4. separate source-explicit USD/USDT, dated verified FX, and human-review lanes;
5. prove TF/PR exact-reference parity with bounded per-reference queries.

## 13. Durable tracking ledger

The batch ledger is `docs/audits/PHASE3_PRODUCTION_CENSUS_LEDGER_2026-08-24.csv`. It is repository-only and does not alter production.

## 14. Bounded read-only methodology

- PR #761 was merged before census execution.
- Every private production query used `BEGIN TRANSACTION READ ONLY` and `ROLLBACK`; `SHOW transaction_read_only` returned `on`.
- Counts were computed server-side; no customer-facing million-row pagination was used.
- Broad aggregate attempt: one upstream timeout.
- Optimized broad summary: one upstream timeout.
- Rolex joined reference/publication attempt: one upstream timeout.
- Minimal Rolex staging reference aggregate: succeeded in approximately 50 seconds.
- Combined Rolex publication/analytics aggregate: one upstream timeout.
- Failed query forms were not repeatedly retried and no concurrent production scans were run.
- Public count endpoints were refreshed on 2026-08-24 and kept separate because their source definitions differ.

## Canonical customer count recommendation

Use **Total Listings** only for a distinct, currently published single-watch observation count:

`COUNT(DISTINCT canonical_listing_observation_id)` after excluding parent bundles, deferred bundle children, exact duplicates, suppressed/deleted/withdrawn/superseded versions, and review-only candidates; include WTS and WTB, and display their split separately.

Do not call the active staging snapshot, catalog-reference count, or Price Research-qualified WTS count `Total Listings`. Until the 565,620-versus-580,325 endpoint discrepancy is reconciled and Vacheron is included consistently, the website should label the current value by its source, not as a universal total.

## Required no-change statements

**NO PRODUCTION DATA WAS MODIFIED.**

**NO UI/UX WAS MODIFIED.**

**NO NORMALIZED VALUE WAS CHANGED.**

**NO PUBLICATION STATE WAS CHANGED.**
