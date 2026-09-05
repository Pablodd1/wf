# Enrichment & Re-Verification Plan — Normalized Watch Workbooks → Live Site

> **Status:** Plan only. No code changed.
> **Command this addresses:** "find what is missing … are you checking the normalized data from my machine folder … should [it] be done on the files or in supabase or directly to the site for speed since we need to show it? plan first"

---

## 1. Goal

Take the 388 normalized workbook files (1,342,971 Rolex rows verified; 388 files total across all brands), close the data gaps against the OceanDigital source, and get the result **visible on the live site as fast as possible**.

## 2. Verified findings so far (this session)

### What's in the workbook already (fill rates, all 104 Rolex files / 1,342,971 rows)
| Field | Col | Fill | Verdict |
|---|---|---|---|
| Price ($ USD) | 15 | 85.1% | ✅ |
| Dial Color | 12 | 97.9% | ✅ |
| Posted By | 2 | 100% | ✅ |
| Posting Date | 1 | 100% | ✅ |
| Phone Number | 4 | 100% | ✅ |
| Condition | 14 | 100% | ✅ |
| Raw / Normalized Reference | 8,9 | 99.8% | ✅ |
| Catalog Reference/Model/Dial | 10,11,13 | 57.3% | ⚠️ half unmatched |
| Exchange / Currency | 27 | **14.9%** | ❌ only `USD_CONVERTED`/empty — original currency dropped |
| **Dealer Image (User Image URL)** | 19 | **25.2%** (338,201) | ✅ **REAL images confirmed live** (200 JPEG on DO Spaces) |
| Final Image (shown) | 21 | 64.0% | ⚠️ mix of DO-Spaces real + ebmluxetime catalog + empty |

### Image correction (important)
- **Real dealer-posted images EXIST** — `thecollective-prod.nyc3.digitaloceanspaces.com/listings/full/*_front_image.jpg`, verified **HTTP 200, image/jpeg**. My earlier "text-only / no images" claim was wrong.
- They are concentrated in **`Rolex all 100–104` only** (338,201 rows; files 100,101,102,103,104). **99 of 104 files have 0 user images.**
- Remaining rows fall back to `ebmluxetime.com` **catalog** product URLs (generic stock, not the listing's photo) or have no image (36% final empty).

### What's genuinely missing and where it can come from (OceanDigital MySQL, live-verified)
| Missing | In OceanDigital? | Source + fill | Action |
|---|---|---|---|
| **Location** | ✅ 99.9% | `auctions.region` (Asia/N.America/Europe…) | Add |
| **Dealer name** | ✅ 100% | `auctions.from_name` | Add |
| **Contact** | ✅ 100% | `auctions.from_number`, `phone_code` | Add |
| **Good/Bad price vs avg** | ✅ compute-able | `auctions.avg` + `auctions.price` → ratio | Add |
| **Dealer rating** | ⚠️ 7.7% | `auctions.dealer_rating` (sparse 1–18 score) | Add as-is |
| **Exchange/original currency** | ⚠️ weak | only `auctions.price` (USD-centric); HKD/USDT converted, not kept | Partial |
| **Reviews** | ❌ none | no review/review_count column | Can't derive — needs external source |
| **Real images beyond all 100–104** | ⚠️ | images on DO Spaces only cover 25% of listings | Can't fully recover |

## 3. Where to do it — THE decision (what you asked)

**Answer: Enrich in the files, then write to Supabase. The site reads Supabase via its existing APIs — it does NOT read the xlsx.**

Evidence (code):
- Trading Floor `/api/reviewed-market-inventory.js` queries PostgREST on `reviewed_workbook_market_source_v2` and only shows an image when `has_exact_source_image === true` AND `user_image_url` is an exact HTTP URL.
- Price Research `/api/price-research.js` reads Supabase `price_research_verified_source`.
- The xlsx files are purely the **ingestion source**; editing them has zero effect on the live app.

**Why not "direct on the site":** the site has no endpoint to bulk-load enrichment; you'd be bypassing the pipeline and storing non-verified values. 
**Why not just the files:** you need it *shown* — files don't flow to Vercel.
**Why Supabase is right:** the schema already has the columns (`user_image_url`, `has_exact_source_image`, `region`, `dealer_name`, `rating`), the site already queries them, and it's the single source the APIs read. One upsert = site shows it immediately (no rebuild).

## 4. Proposed execution path (3 tracks)

### Track A — Enrich (files → build master)
1. Pull enrichment from OceanDigital MySQL (read-only), keyed by auction/listing ID:
   `region, from_name, from_number, dealer_rating, price/avg_ratio`.
2. Regenerate the missing workbook columns into new master files:
   - Fill Exchange/original currency where recoverable from source (`source_currency` in `reviewed_workbook_inventory`).
   - Backfill `User Image URL` from DO Spaces for rows that have them but weren't in all 100–104 subset.
   - Add new columns: `Region`, `Dealer Name`, `Dealer Contact`, `Dealer Rating`, `Price vs Avg` (GOOD/NEUTRAL/BAD vs `auctions.avg`).
3. Mark `Reviews` + unavailable images as **explicitly null** (don't fabricate).

### Track B — Re-verify (gated, before repopulation)
Scope: only rows whose enrichment changed materially, plus a deterministic re-run.
- Identity/dial/price: already 97–100% → **skip re-review** (don't waste time).
- Focus re-verify on: rows getting a NEW `region/dealer/rating/price-vs-avg` that could be wrong, and the `57.3%` catalog-unmatched refs.
- Time: deterministic full pass ~10 min; manual/LLM touches only the 7–8% REVIEW/RECYCLE tier.

### Track C — Publish to Supabase (the speed-win)
1. Upsert enriched master into `reviewed_workbook_market_source_v2`/`reviewed_workbook_inventory` keyed by `source_record_id`.
2. Flip `has_exact_source_image = true` only where `user_image_url` is a verified HTTP URL.
3. Add/confirm `region`, `dealer_name`, `dealer_rating`, `price_vs_avg` columns flow through `/api/reviewed-market-inventory` → Trading Floor UI.
4. **Result: site shows it within minutes of the upsert — no redeploy.**

## 5. Files likely to change
- `/home/jasme/wf/api/reviewed-market-inventory.js` (pass through new enrichment fields)
- `/home/jasme/wf/api/_lib/market-row-normalization.cjs` (map region/dealer/rating/price-vs-avg)
- Supabase: upsert script (SQL/PostgREST) into `reviewed_workbook_market_source_v2` source tables
- Master xlsx regenerator (new enrichment columns)

## 6. Validation
- xlsx: recompute fill % for every target column; assert region 99.9%, rating 7.7%, price-vs-avg coverage.
- API: `GET /api/reviewed-market-inventory?reference=126334` returns region/dealer/rating/image.
- Site: Trading Floor shows new fields; image renders (SPA route check via browser).

## 7. Risks / open questions
- **Reviews**: cannot be sourced from OceanDigital — needs a dealer-directory/marketplace import. Confirm whether to source elsewhere.
- **dealer_rating scale**: 1–18 score, not 0–5 stars — decide display mapping.
- **`reviewed_workbook_market_source_v2` REST errors (500/400)**: it's a view; confirm `region`/`dealer_*` can be added or must live in a backing table.
- **Time to repopulate 1.34M rows**: sub-10-min MySQL read (timed 3.7s full scan); Supabase upsert at ~1k/s → ~25–45 min. OK?
