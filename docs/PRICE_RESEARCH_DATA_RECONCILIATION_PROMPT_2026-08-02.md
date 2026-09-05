# PRICE RESEARCH — DATA RECONCILIATION & LIVE-FEED REPAIR
## Target: https://watchfacts-poc.vercel.app/#/price-research
## Repo: Pablodd1/wf (main, production, auto-deploy to Vercel)
## Scope: all live listings July 2026 → present, and forward-going ingestion

---

## MISSION

Price Research is showing missing price, missing user/seller, missing images, and
missing dial color on listings that DO have this data in our structured sources.
This is NOT a data-loss problem — it is a retrieval/join/prioritization problem in
the live API layer. Fix the retrieval layer, not the underlying data.

Confirmed root cause (reproduced): evidence for a single listing (price, image,
seller, raw text) is fragmented across cohorts and joined incorrectly or not at all.
Some rows have verified price but no linked image/contact. Some have image+contact
but only workbook price or unresolved currency. Some workbook rows show normalized
summaries instead of the original raw source message.

## AVAILABLE DATA SOURCES (found on this machine — use whichever is faster/authoritative per field)

| Source | Location | Contents |
|---|---|---|
| Local CSV export (MySQL snapshot) | `/home/jasme/wf-db-export/` | `listings.csv` (28MB), `market_references.csv`, `auction_watches_ref_dial.csv`, `online_prices_by_watch.csv`, `references_full.csv`, `master_catalog.csv`, `watch_dial_colors.csv` |
| Training/labeled data | `/home/jasme/wf-training-data/` | `labeled_listings.csv` (21MB), `brand_ref_catalog.csv`, `ref_to_dial_color.csv` |
| Live Supabase (Pro, source of truth for production) | `bptrvfncppbjnchsaxtb.supabase.co` — pooler `aws-0-us-east-1.pooler.supabase.com:6543` | `reviewed_workbook_market_source` view, `price_research_verified_source` table, `normalization_shadow_v4` |
| Repo API layer | `/home/jasme/wf/api/price-research.js` (878 lines), `/home/jasme/wf/api/_lib/reviewed-workbook-analytics.cjs`, `/home/jasme/wf/api/catalog-models.js` | Current retrieval/gating logic |

**Rule: for any single field (price/image/seller/dial), pull from whichever source
returns it fastest AND is authoritative for that field — Supabase live tables win
for anything touched by ingestion since the workbook was loaded; local CSV wins for
bulk catalog/reference/dial lookups that never change.**

## SCOPE — TIME WINDOW

- Backfill and reconcile all listings from **July 1, 2026 → today** using the sources above.
- New listings arriving from Telegram/WhatsApp/Green API ingestion **from now forward**
  must pass through the SAME reconciliation join logic being fixed here — this is not
  a one-time backfill, it is a pipeline fix.

---

## WORK ITEMS (in priority order)

### 1. Data Normalization / Source Lineage
- Join evidence **only** through exact source identity: `source_record_id + source_file + source_row_number`.
  Never join by brand/reference alone (this is the bug causing wrong-image and orphaned-price rows).
- Backfill `workbook_source_record_id` linkage wherever a workbook summary row exists without
  its immutable raw source message attached. Keep the normalized summary internally; only
  display raw text once the original message is linked.
- File to fix: `/home/jasme/wf/api/_lib/reviewed-workbook-analytics.cjs` (mapWorkbookAnalyticsRow,
  loadReviewedWorkbookAnalyticsRows) — currently filters out any row missing brand+model+
  reference+dial_color+price_usd (line 83-86). This silently drops partial-evidence rows
  instead of surfacing them with a gate-status label.
- Deliverable: an automated reconciliation report — one row per listing — showing which
  gate failed (image / price-currency / dial / seller) for every row in the July→present window.

### 2. Pricing Engine
- Never invent USD. If currency is ambiguous/unverified, keep the record OUT of Price
  Research analytics but keep it visible on Trading Floor, sorted last, labeled
  `"Price pending currency verification"`.
- Add explicit multi-key sort to Trading Floor and Price Research result sets:
  `Best evidence` → `Highest verified price` → `Has source image` → `Newest`.
  Unknown-price records always sort last, never absent.
- Maintain two separate counters everywhere counts are shown: `market_listings_count`
  and `analytics_eligible_count`. Never silently collapse them into one number.
- File to check: `/home/jasme/wf/api/_lib/price-research-eligibility.cjs` — this is the
  gate function (`classifyResearchEligibility`). Verify `MISSING_PRICE` / currency-status
  rejections are counted, not dropped.

### 3. Image & Asset Pipeline
- Image is only shown when it belongs to the EXACT source listing (via source_record_id)
  AND passes an automated reachability check (HTTP HEAD / GET on the URL before rendering).
  If neither condition holds, remove the image frame entirely rather than showing a broken
  image or wrong-brand image.
- Prohibit "image borrowing" at reference/model level — this caused wrong-watch-images
  historically. Match media through immutable source identity only, then validate
  brand/reference/configuration consistency before publication.
- Treat "has image" and "has verified price" as independent boolean flags in the sort/
  filter logic — currently currency-ambiguous rows with good images get buried behind
  verified-price rows with no image. Add a "source-image-first" view toggle without
  weakening the currency verification rule.
- File to check: `/home/jasme/wf/api/_lib/verified-listing-media.cjs`,
  `/home/jasme/wf/api/_lib/safe-image-fetch.cjs`, `/home/jasme/wf/api/_lib/public-image-provenance.cjs`

### 4. Current Blocking Bug — Model Browsing Timeout
- Confirmed live: selecting Richard Mille in `/api/catalog-models` takes ~26s then returns
  `"Brand inventory is too large for safe model browsing"`. The endpoint scans up to 10,000
  individual listing rows and groups them inside the Vercel serverless function — this hits
  the Vercel execution limit for Richard Mille and the Postgres statement timeout for Cartier.
- Fix: replace detail-row scanning with a **preaggregated model/reference index** — one row
  per (brand, model, reference) computed by a batch/cron job, not per-request.
  File to rewrite: `/home/jasme/wf/api/catalog-models.js` — the `loadReviewedZenithModels`
  pattern (paginated `.range()` scan, lines 81-101) is the anti-pattern to eliminate;
  replace with a single indexed table read.
- Frontend: add an 8-10 second request timeout + retry control + direct-reference search
  fallback while the backend index is being rebuilt, so the UI never appears frozen.
- Seller info: only surface from the same listing record (never inferred/copied across
  rows of the same reference). Add automated completeness counts per result set
  (X% have seller, Y% have phone, Z% have image) so gaps are visible, not silent.

---

## EXECUTION PLAN

1. **Model-index repair** (est. 2-4h) — build compact aggregated model/reference index,
   point `/api/catalog-models` at it instead of live listing scans.
2. **Richard Mille / Cartier evidence reconciliation** (est. 1-2h) — apply the exact-source-
   identity join rule to these two brands first as the proving ground.
3. **Trading Floor sorting + missing-image behavior** (est. 1-2h) — multi-key sort,
   remove-frame-if-no-valid-image, currency-pending-last labeling.
4. **Full cross-file reconciliation, July→present** (checkpointed) — run only after
   items 1-3 are proven correct on the bounded brands above; then expand to all brands
   and wire the same join logic into the live ingestion path so new listings inherit it.

## VERIFICATION AFTER EACH STEP

```bash
cd /home/jasme/wf
npx tsc --noEmit                      # type check before any deploy
node tests/price-research-eligibility.test.cjs
node tests/audit-all-price-research-cohorts.test.cjs
node tests/trading-floor-api.test.cjs
```

Then live-check:
```bash
curl -s "https://watchfacts-poc.vercel.app/api/catalog-models?brand=Richard%20Mille" -w "\ntime: %{time_total}s\n"
curl -s "https://watchfacts-poc.vercel.app/api/catalog-models?brand=Cartier" -w "\ntime: %{time_total}s\n"
```
Both must return under 8s with a populated `models` array, not a timeout error.

## OUTPUT REQUIRED FROM WHOEVER EXECUTES THIS

Per-brand counts table: `listings | has_price | has_verified_usd | has_image |
has_seller | has_raw_message | analytics_eligible` — for every brand in the July→present
window, before and after the fix, so the improvement is measurable.
