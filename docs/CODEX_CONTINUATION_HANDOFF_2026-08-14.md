# Curated Luxury Continuation Handoff — 2026-08-14

## Production baseline

- Repository: `Pablodd1/wf`
- Production branch: `main`
- Verified production merge: `cc3feaac2261615e77f33edd63f242d6ccb112ba`
- Completion PR: `#482` (`Complete four-brand market availability`)
- Production database project: QNSA `qnsafosakvonzgfcsphh`
- Customer site: `https://watchfacts-poc.vercel.app/`
- Branding: Curated Luxury

The Vercel `watchfacts-poc` and `wf` deployments passed. Railway deployments
for `wf`, `wf-mariadb-live-v2`, and `wf-mariadb-shadow` passed. An unrelated
Railway service named `AIMedicalscriberjas` failed and is not part of this
pipeline.

## Released four-brand census

These are exact QNSA Trading Floor snapshot counts for every gate-passing
single-watch WTS or WTB observation. They are not page-one estimates.

| Brand | Trading Floor | WTS with price | WTS without price | WTB |
| --- | ---: | ---: | ---: | ---: |
| Rolex | 281,480 | 146,110 | 86,081 | 49,289 |
| Patek Philippe | 126,571 | 69,599 | 28,576 | 28,396 |
| Richard Mille | 39,958 | 23,469 | 10,410 | 6,079 |
| Cartier | 11,753 | 5,705 | 4,361 | 1,687 |
| **Total** | **459,762** | **244,883** | **129,428** | **85,451** |

All four rows reconcile: Trading Floor = priced WTS + no-price WTS + WTB.
Brand-level supplied-price counts are not the same as qualified analytics;
Price Research applies exact-reference identity, currency, dial, repost, and
3.0x IQR gates after a reference is selected.

## Live acceptance evidence

- Health: HTTP 200, QNSA reachable.
- Cursor sweep: 1,048 records across the four brands, zero repeated IDs and
  zero bundle/parent/child leakage.
- Richard Mille: 30 consecutive cursor pages, zero duplicates and zero 5xx
  after the final reliability migration.
- Production workflow `31822590600`: passed database and customer-endpoint
  smoke tests.
- UI displays exact global and current-page counts for brand views.
- Verified Price Research references:
  - Rolex `116500LN`: 1,054 tracked, 199 qualified WTS, 216 WTB.
  - Patek Philippe `5712`: 1,628 tracked, 397 qualified WTS, 628 WTB.
  - Richard Mille `RM11-03`: 14 tracked, 6 qualified WTS, 7 WTB.
  - Cartier `WSSA0018`: 86 tracked, 12 qualified WTS, 64 WTB.
- All four exact-reference responses were HTTP 200, analytics-ready, and WTS
  accounting reconciled. Dial charts/tables, liquidity, WTB/WTS ratio,
  outliers, raw evidence, seller data, and images rendered.

## Richard Mille pagination decision

The broad RM query previously exceeded the statement timeout. Migration
`20260814124000_qnsa_rm_reliable_stride.sql` uses a four-candidate source
stride. Pages can be smaller, but the cursor advances by the exact consumed
source window, so eligible watches are neither repeated nor skipped. Do not
raise the database statement timeout or replace this with offset pagination.

## POST IT and live intake

- Luxury App was removed from POST IT.
- Guests can complete and preview the form.
- Registration is required to save and submit.
- Unauthenticated API submission returns HTTP 401 with no write.
- Approved WTS records reach Trading Floor; only qualified watch price evidence
  reaches Price Research. WTB remains separate demand.
- A real authenticated write canary still requires a credentialed test dealer.
- The WatchFacts live and shadow Railway services deployed successfully, but a
  new source-chat event should be traced end-to-end before claiming a fresh
  incoming group message was normalized and published.

## Next release

Recommended next brand: **Zenith**.

Current accounted evidence: 464 Trading Floor observations, including 237 WTS
with supplied price, 214 WTS without supplied price, and 13 WTB. Before public
enablement, run the same identity, multi-listing, currency/FX, image-lineage,
duplicate/repost, cursor, and Price Research reconciliation gates used for the
four released brands.

## Safety boundaries

- Use QNSA only; do not combine legacy BPTR rows into customer APIs.
- Preserve immutable raw messages and raw-message versions.
- Never publish bundle parents, unresolved multi-listings, or generated bundle
  children without item-level review.
- Never include WTB, no-price WTS, unverified currency, repost duplicates, or
  statistical outliers in WTS averages.
- Do not fabricate dealer ratings. Display rating evidence only when it is
  source-backed.
- Local `audit-output/`, `scratch-price-run-1786535506099/`, and the untracked
  2026-08-12 handoff are intentionally not committed.
