# Curated Luxury continuation handoff — 2026-08-15

## Resume here

- Repository: `Pablodd1/wf`
- Workspace: `C:\Users\Owner\Documents\Codex\2026-08-05\study\wf-dealer-gate`
- Production baseline: `7c5a3d44450a1b80b043c9d65562f47e9ac4aaff`
- Production site: `https://watchfacts-poc.vercel.app`
- Canonical Supabase: QNSA `qnsafosakvonzgfcsphh`
- Never restore or mix retired BPTR `bptrvfncppbjnchsaxtb`.
- Preserve and never stage/delete `audit-output/`, `scratch-price-run-1786535506099/`, or the older untracked August 12 handoff.

Before changing code, fetch `origin/main`, verify the deployed SHA, `/api/health`, `/api/live-release-summary`, QNSA capacity, and the working tree.

## Verified production state

Live health on August 15 returned `status=ok`, database reachable, and QNSA project ref `qnsafosakvonzgfcsphh`.

### Watch release snapshot

The live release summary reported 545,184 watch-feed rows:

| Brand | Release-feed rows |
|---|---:|
| Rolex | 281,480 |
| Patek Philippe | 126,571 |
| Audemars Piguet | 84,958 |
| Richard Mille | 39,958 |
| Cartier | 11,753 |
| Zenith | 464 |

These are release-feed snapshot counts, not proof that every row is customer-safe after all defensive quarantine checks.

### Dealer Directory

- 54 canonical verified dealer profiles are live.
- 53 dealers are connected to 24,383 exact released listing links; one dealer has no qualifying released exact match.
- Full reconciliation scanned 1,394,269 immutable raw versions with zero conflicts, zero orphan links, zero duplicate verified phones, and unchanged raw count.
- Profiles show source-backed WTS/WTB activity, reviews, dates, raw evidence, and internal listing links.
- Numeric ratings are never fabricated.
- Public phone remains hidden without consent.
- Group counts may be source-backed, but named group membership is unavailable and is labeled count-only.
- Customer-safety patch PR #543 suppresses malformed shorthand prices and contradictory watch identities.

### Non-watch luxury release snapshot

| Category | Total | WTS priced | WTS no price | WTB |
|---|---:|---:|---:|---:|
| Handbag | 986 | 808 | 141 | 37 |
| Jewelry | 1,539 | 1,294 | 159 | 86 |
| Accessory | 167 | 109 | 46 | 12 |
| **Total** | **2,692** |  |  |  |

This lane is not fully normalized. Of the 2,692 released rows, 2,483 currently have an unspecified maker. Ambiguous/unclassified items must remain withheld. Do not claim all non-watch luxury inventory is complete.

## Critical truth about Green API and incoming chats

The canonical database pipeline exists for immutable raw evidence, queued processing, normalization, review, and controlled publication. POST IT is designed to converge into that pipeline.

However, a deployed authenticated Green API webhook was not found or proven live on August 15. The repository contains:

- a Green API target-flow document;
- an older Baileys WhatsApp listener that downloads images locally and calls `/api/ingest`;
- no verified Green API production adapter, deployment configuration, live event counter, or source-to-QNSA reconciliation evidence.

Therefore do not claim that new Green API messages reaching DigitalOcean are being received, normalized, or published by QNSA. The next critical integration audit must identify the running external service, verify signed/idempotent events, reconcile source event counts to immutable raw versions/jobs, verify media lineage, and run shadow-mode acceptance before customer publication.

## Remaining blockers before the next brand

1. Deploy one unified conservative multi-item detector across historical ingestion, POST IT, Trading Floor, and Price Research. Quarantine mixed-brand, multiple-reference, quantity, slash/comma/or-separated and bundle messages. Parent and child images remain withheld until deterministic separation plus human/catalog review.
2. Complete Zenith Price Research qualification. Representative `03.2522.400` currently has 20 tracked rows but only one qualified priced WTS; analytics is not ready.
3. Prove one authenticated POST IT end-to-end canary: raw/version/job, review, Trading Floor, Price Research, dealer binding, media, and rollback.
4. Implement and prove the Green API shadow adapter and reconciliation described above.
5. Normalize the 2,483 non-watch rows with unspecified maker without guessing.

## Controlled brand order

- Next: Panerai.
- Then: Omega.
- Do not enable Panerai until multi-listing quarantine, broad/exact Trading Floor, FX, images, pagination, and Price Research canary gates pass live.

## Product invariants

- Preserve immutable raw messages and exact source lineage.
- Keep WTS and WTB separate.
- Use qualified priced WTS only for averages.
- Retain outliers as excluded evidence using 3.0x IQR.
- Use dated, named FX evidence; never guess currency.
- Render exact reachable source images only; no empty image frame and no inherited bundle image.
- Never fabricate ratings, dealer details, group names, prices, identities, or contact consent.
- Do not run overlapping long production corrections.
- Do not claim completion without live desktop/mobile acceptance and reconciled counts.

## Time record

The observed collaboration spans August 11–15, 2026, approximately four calendar days. Exact active hours were not instrumented. The owner referenced 27 hours at an earlier checkpoint; the final active total cannot be stated accurately from available evidence.
