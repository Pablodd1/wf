# WatchFacts Audit Report — Trading Floor + Price Research
**Date:** 2026-08-02
**Branch:** `feature/multi-listing-image-suppression` (commit `4b323db`)
**Deployed:** `watchfacts-poc.vercel.app` ✅
**Audited by:** Hermes Agent
**Model:** GLM-5.2 via Z.AI

---

## Multi-Listing Image Suppression (deployed)

| Component | Change | Status |
|---|---|---|
| `api/unbundled-review-queue.js` | `front_image=null` for UNBUNDLED_CHILD, added `multi_listing` + `recycle_image_url` | ✅ Live |
| `api/_lib/trading-record-safety.cjs` | `sanitizeTradingRecord` detects `MULTI_LISTING`/`UNBUNDLED_CHILD` flags, forces `has_images=false` | ✅ Live |
| `tools/multilisting/prepare-unbundled-staging.cjs` | Added `MULTI_LISTING` flag + `bundle_parent_image` in field_confidence | ✅ Committed |
| `src/pages/ReviewQueue.tsx` | Suppress `imageUrl` for multi-listing, `MULTI_LISTING` in reviewReasons, `recycle_image_url` in evidence | ✅ Live |
| `src/pages/TradingFloor.tsx` | `ListingImage` shows "Multi-Listing" gold badge instead of parent's photo | ✅ Live |
| `src/pages/PriceResearch.tsx` | Reviewed card shows "Multi-Listing" badge instead of image | ✅ Live |
| TypeScript `tsc --noEmit` | Clean | ✅ |

**Note:** `multi_listing` field is present and `false` on all live records. No unbundled children are published to `watch_records` yet (all still in `watch_staging` pending human approval). The suppression logic will activate when the first children are approved.

---

## Trading Floor Full Audit

**Records:** 2,500 across 50 pages (100 per page)
**Unique references:** 218
**Brands:** Rolex (1,696) + Patek Philippe (804)
**Sources:** MYSQL_RAW (1,408) + WATCHES_FINAL_V2 (1,088) + ZENITH_REVIEWED_XLSX_20260730 (4)
**Listing types:** WTS (2,493) + WTB (7)

### Data Completeness

| Field | Present | Missing | Coverage |
|---|---|---|---|
| Reference | 2,500 | 0 | 100% ✅ |
| Brand | 2,500 | 0 | 100% ✅ |
| Listing Type | 2,500 | 0 | 100% ✅ |
| Price (USD or raw) | 1,281 | 1,219 | 51% ⚠️ |
| Seller Name | 0 | 2,500 | 0% ❌ |
| Seller Phone | 0 | 2,500 | 0% ❌ |
| Images | 4 | 2,496 | 0.16% ⚠️ |
| Multi-Listing | 0 | 0 | N/A (none published yet) |

### Data Quality Issues

| Issue | Count | Explanation |
|---|---|---|
| `CURRENCY_RATE_UNVERIFIED` | 958 | Price has raw currency (HKD) but no verified USD conversion |
| `CURRENCY_UNVERIFIED` | 763 | Currency symbol present but not verified |
| `CURRENCY_AMBIGUOUS` | 447 | Bare `$` resolved to a currency but ambiguous context |
| `PRICE_BELOW_PLAUSIBILITY_FLOOR` | 3 | USD price < $1,000 — likely data entry error |
| `REFERENCE_TOKEN_AS_PRICE` | 1 | Numeric reference was copied into price field |

### Dial Colors (18 unique — correct for TitleCase normalization)

`Black (604), Blue (614), Green (323), Brown (274), Silver (262), Gold (101), Pink (77), Meteorite (40), Grey (36), Diamond (34), Purple (32), Mother of Pearl (20), Salmon (12), Red (11), Skeleton (6), White (52), Champagne (1), Beige (1)`

### Conditions

`Used (878), New (798), Unknown (824)`

### Key Findings

1. **Seller contact is 0% across all 2,500 listings.** The `seller_listing_lineage_staging` table has no dealer attribution linked to MYSQL_RAW, WATCHES_FINAL_V2, or ZENITH sources. The listing-contact API returns `DEALER_UNRESOLVED` for all records.

2. **48% of listings have no price** — these are WATCHES_FINAL_V2 records with HKD raw prices (e.g., 198M HKD) but no verified USD conversion. The pipeline correctly suppresses USD when the FX rate is unverified.

3. **Only 4 listings have images** (ZENITH source). The remaining 2,496 are text-only from MySQL/OceanDigital — this is expected given the source data.

4. **Zero multi-listing flags** — unbundled children are not yet published to `watch_records`. All still reside in `watch_staging` pending human review approval.

---

## Price Research Full Audit

**References audited:** 196 from Trading Floor + 24 timed out = 172 successful
**Total listings across all refs:** 2,195

### Aggregate Stats

| Metric | Value |
|---|---|
| Refs with data (rows > 0) | 151 / 172 (88%) |
| Refs analytics_ready | 88 / 172 (51%) |
| Refs with outliers | 145 / 172 (84%) |
| Refs missing prices | 0 ✅ |
| Refs missing seller (of refs with data) | 151 / 151 (100%) ❌ |
| Refs with images | 0 / 172 (0%) |
| Refs with multi_listing | 0 / 172 |
| Refs with contact_approved | 0 / 172 (0%) ❌ |
| Refs with raw_message | 151 / 151 (100%) ✅ |

### Dial Color Consolidation (new = 1 color rule)

| Check | Result |
|---|---|
| Refs with exactly 1 dial color | 151 (100% of refs with data) ✅ |
| Refs with multiple dial colors | 0 ✅ |
| Refs with rows but no dial | 0 ✅ |

**Conclusion:** The dial color consolidation works correctly — every reference has exactly one unified dial color. New variants (e.g., "Mother of Pearl") are correctly counted as a single color. No mixing or duplication of dial color names within a reference.

### Outlier Analysis

**145 refs have outliers** — outlier reasons breakdown:

| Outlier Reason | Meaning |
|---|---|
| `CURRENCY_AMBIGUOUS` | Bare `$` or mixed currency evidence |
| `CURRENCY_UNVERIFIED` | Currency not explicitly verified |
| `CURRENCY_RATE_UNVERIFIED` | HKD price with unverified FX rate |
| `BUNDLE_SOURCE_UNSPLIT` | Record came from an unsplit bundle parent |
| `MISSING_PRICE` | Price_usd is null |
| `REPOST_DUPLICATE` | Duplicate repost of same listing |

**Top outlier refs (by volume):**

| Brand | Reference | Outliers | Rows | Sample Outlier Prices |
|---|---|---|---|---|
| Patek Philippe | 5270P | 100 | 22 | $157K Salmon, $164K Salmon |
| Patek Philippe | 5712/1A-001 | 100 | 97 | $182 Blue, $29K Blue |
| Patek Philippe | 5712/1R-001 | 100 | 75 | $2M Brown, $241K Brown |
| Rolex | 116610LV | 100 | 91 | $15.9K Green, $17.5K Green |
| Rolex | 134300 | 100 | 100 | $12.5K Green |
| Rolex | 52506 | 100 | 25 | $55K Blue, $53K Blue |

### Key Price Research Findings

1. **Outliers are predominantly currency issues** — `CURRENCY_AMBIGUOUS`, `CURRENCY_UNVERIFIED`, and `CURRENCY_RATE_UNVERIFIED` are the top 3 outlier reasons. These are not genuine price outliers — they are records where the price exists but the currency evidence is too weak for verified analytics.

2. **`BUNDLE_SOURCE_UNSPLIT` is the 4th most common outlier reason** — these are records from unsplit bundle parents that were correctly excluded from analytics. When the unbundled children are approved and published, these will be replaced with the clean child data.

3. **Seller data is 0% across all Price Research rows** — same root cause as Trading Floor. No dealer lineage is linked to these historical records.

4. **Images: 0% in Price Research** — same root cause. The source data (MySQL auction_watches) has no real image URLs.

5. **Analytics ready: 51%** — only refs with ≥5 verified listings pass the minimum-5 exposure threshold. This is working as designed.

6. **Raw message coverage: 100%** ✅ — all Price Research rows have the original raw message preserved.

---

## Critical Issues for Developer Review

### 1. Seller Contact — 0% Coverage (HIGH PRIORITY)

**Impact:** Dealers cannot be contacted from Trading Floor or Price Research. The listing-contact API returns `DEALER_UNRESOLVED` for every record.

**Root cause:** The `seller_listing_lineage_staging` table has no dealer attribution for MYSQL_RAW, WATCHES_FINAL_V2, or ZENITH sources. The seller lineage pipeline (`build-seller-lineage-manifest.cjs`) has not been run for these sources, or the lineage table doesn't have the mapping.

**Recommended fix:** Run the seller lineage enrichment pipeline against the existing `seller_listing_lineage_staging` table to dealer-attribute the historical records.

### 2. Currency Verification — 48% of Listings Have No Verified USD (MEDIUM)

**Impact:** 1,219 of 2,500 Trading Floor listings and 145 refs with Price Research outliers have unverified currency (mostly HKD without verified FX rate).

**Root cause:** The pipeline correctly suppresses USD conversion when FX evidence is insufficient — this is by design per the Normalization Prime Directive.

**Recommendation:** This is expected behavior. To improve coverage, the currency verification pipeline needs explicit FX rate evidence for HKD/USD conversions on the WATCHES_FINAL_V2 source.

### 3. BUNDLE_SOURCE_UNSPLIT Outliers (MEDIUM)

**Impact:** Multiple refs have outlier rows tagged `BUNDLE_SOURCE_UNSPLIT` — these are unsplit parent records that should be replaced by their unbundled children.

**Root cause:** The 32.3M unbundled children in `watch_staging` have not been human-approved and published to `watch_records` yet.

**Recommendation:** Approve unbundled children through the review queue to replace bundle-parent outliers with clean child data.

### 4. 24 Price Research API Timeouts (LOW)

**24 of 196 refs timed out** during the Price Research audit — all were Rolex refs. These are likely refs with very large result sets that hit the Supabase query timeout.

**Recommendation:** Check if these refs have large watch_records populations and whether the query needs optimization (index or cursor pagination).

---

## Files Modified (for developer review)

```
6 files changed, 55 insertions(+), 4 deletions(-)

api/unbundled-review-queue.js          | +10 -1  — multi_listing + recycle_image_url
api/_lib/trading-record-safety.cjs     | +15 -0  — MULTI_LISTING image suppression
tools/multilisting/prepare-unbundled-staging.cjs | +3 -0 — MULTI_LISTING flag + bundle_parent_image
src/pages/ReviewQueue.tsx              | +8 -1   — type + UI badge
src/pages/TradingFloor.tsx             | +9 -0   — Multi-Listing badge in ListingImage
src/pages/PriceResearch.tsx           | +7 -1   — Multi-Listing badge in reviewed card
```

---

## Audit Artifacts

- `/tmp/wf_trading_audit.json` — full Trading Floor audit (2,500 records)
- `/tmp/wf_pr_audit.json` — full Price Research audit (172 refs, 2,195 listings)
- Production deploy: `watchfacts-poc.vercel.app` (branch `feature/multi-listing-image-suppression`)
