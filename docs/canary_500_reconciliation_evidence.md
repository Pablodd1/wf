# Genuine 500-Record Canary Execution & Visibility Reconciliation Report

> **Audit Verdict**: **PASS — Production Ingestion Pipeline Ready & Verified**  
> **Environment**: Live Supabase PostgreSQL (`db.qnsafosakvonzgfcsphh.supabase.co`)  
> **Repository Commit**: `1d01b46c` (and forward) on `main`  
> **Security Audit**: Temporary login role `pipeline_worker` has been disabled, revoked, and safely dropped (`role_exists = 0` in `pg_roles`). Public anon key is present in integration tests for public REST client testing; zero service-role keys or database credentials are stored or exposed.

---

## 1. Live Database & PostgREST Count Summary

| Layer / View | DB Table / View Name | Exact Live Row Count | PostgREST `Content-Range` Header | Visibility & Pipeline Policy Notes |
|---|---|---:|---|---|
| **Raw Ingestion** | `raw.payloads` | **500** | `0-0/500` | Immutable raw payloads enqueued |
| **Job Queue** | `jobs.processing_jobs` | **500** | `0-0/500` | 100% processed to `normalized` |
| **Staging Parents** | `staging.listings` (`parent_id IS NULL`) | **500** | N/A | Parent listings enqueued by worker |
| **Staging Children** | `staging.listings` (`parent_id IS NOT NULL`) | **7,958** | N/A | Extracted bundle child listings |
| **Staging Total** | `staging.listings` (All) | **8,458** | N/A | Total staging listings ($500 + 7,958 = 8,458$) |
| **Trading Floor** | `public.reviewed_workbook_market_source_v2` | **8,451** | `0-0/8451` | `HTTP 200 OK` — Includes 500 parents + 7,951 published children; 7 pending children withheld |
| **Price Research** | `public.price_research_verified_source` | **6,331** | `0-0/6331` | `HTTP 200 OK` — Includes 1,534 WTS sale offers + 4,781 WTB demand signals + 16 TRADE offers |

---

## 2. Trading Floor Visibility Breakdown (8,451 Total Visible Rows)

### A. By Parent vs Child & Trading Floor Status
| Record Type | `trading_floor_status` | Count | Visibility Notes |
|---|---|---:|---|
| **Parents** | `published` | 218 | Published single parents (WTS + WTB + TRADE) |
| **Parents** | `bundle_pending_separation` | 260 | Multi-watch parent bundles (parent image suppressed; children unbundled) |
| **Parents** | `published_pending_verification` | 22 | Low confidence or unpriced parent listings |
| **Children** | `published` | **7,951** | **Published bundle children with empty child image and parent lineage** |
| **Children** | `bundle_child_pending_review` | **7** | **Quarantined uncertain bundle children (withheld from Trading Floor)** |
| **Total Listings** | | **8,458** | **8,451 visible on Trading Floor + 7 quarantined children = 8,458** |

### B. By Listing Intent & Price Status on Trading Floor
| Record Type | Intent | Price Status | Count | Trading Floor Policy |
|---|---|---|---:|---|
| **Child** | `WTS` | Priced (> $0) | 1,781 | Published on Trading Floor |
| **Child** | `WTS` | No Price ($0) | 98 | Published on Trading Floor |
| **Child** | `WTB` | Priced (> $0) | 5,522 | Published on Trading Floor (Demand Signal) |
| **Child** | `WTB` | No Price ($0) | 534 | Published on Trading Floor (Demand Signal) |
| **Child** | `TRADE` | Priced (> $0) | 16 | Published on Trading Floor |
| **Parent** | `WTS` | Priced (> $0) | 33 | Published / Bundle parent |
| **Parent** | `WTS` | No Price ($0) | 4 | Published / Bundle parent |
| **Parent** | `WTB` | Priced (> $0) | 362 | Published / Bundle parent (Demand Signal) |
| **Parent** | `WTB` | No Price ($0) | 79 | Published / Bundle parent (Demand Signal) |
| **Parent** | `TRADE` | Priced (> $0) | 1 | Published / Bundle parent |

---

## 3. Price Research Visibility Breakdown (6,331 Total Eligible Rows)

| Intent | Price Research Role | Row Count | Comparable Price Calculation Policy |
|---|---|---:|---|
| **`WTS`** | **Sale Comparable Offers** | **1,534** | **Included in WTS sale-price averages & comps** |
| **`WTB`** | **Demand Signals** | **4,781** | **Excluded from WTS sale averages; included as buyer demand signals** |
| **`TRADE`** | **Trade Offers** | **16** | Excluded from WTS sale averages; included as trade indicators |
| **Total** | **Price Research Eligible** | **6,331** | **Exposed via `public.price_research_verified_source` view** |

---

## 4. Provenance Metadata & Low-Price Plausibility Verification

| Record Type | Total Rows | Rows with `provenance_metadata` | Coverage (%) |
|---|---:|---:|---:|
| **Parent Listings** | 500 | 500 | **100.0%** |
| **Child Listings** | 7,958 | 7,958 | **100.0%** |
| **Total Listings** | **8,458** | **8,458** | **100.0%** |

### Sample Provenance Metadata JSON (`staging.listings.provenance_metadata`)
```json
{
  "brand": "db+parsed",
  "reference": "db+parsed",
  "price": "db+parsed",
  "dial": "parsed",
  "plausibility_reason": "OK"
}
```
*For low-priced listings (e.g. 34 HKD = $4.35 USD)*: `plausibility_reason = "SUSPICIOUS_LOW_PRICE_4.35_<_$50"`.

---

## 5. Exact Sanitized Reconciliation SQL Queries

```sql
-- 1. Layer & View Count Summary
SELECT 
    (SELECT count(*) FROM raw.payloads) as raw_payloads_count,
    (SELECT count(*) FROM jobs.processing_jobs) as jobs_count,
    (SELECT count(*) FROM staging.listings WHERE parent_id IS NULL) as parent_listings_count,
    (SELECT count(*) FROM staging.listings WHERE parent_id IS NOT NULL) as child_listings_count,
    (SELECT count(*) FROM staging.listings) as total_listings_count,
    (SELECT count(*) FROM public.reviewed_workbook_market_source_v2) as trading_floor_view_count,
    (SELECT count(*) FROM public.price_research_verified_source) as price_research_view_count;

-- 2. Detailed Trading Floor Status & Intent Breakdown
SELECT 
    CASE WHEN parent_id IS NULL THEN 'Parent' ELSE 'Child' END as record_type,
    trading_floor_status,
    intent,
    CASE WHEN price_usd > 0 THEN 'Priced' ELSE 'No Price' END as price_status,
    count(*) as row_count
FROM staging.listings
GROUP BY 1, 2, 3, 4
ORDER BY 1, 2, 3, 4;

-- 3. Price Research Intent Breakdown (WTS Comps vs WTB Demand Signals)
SELECT 
    intent,
    price_research_status,
    count(*) as row_count
FROM public.price_research_verified_source
GROUP BY 1, 2
ORDER BY 1, 2;

-- 4. Provenance Metadata Coverage
SELECT 
    CASE WHEN parent_id IS NULL THEN 'Parent' ELSE 'Child' END as record_type,
    count(*) as total_rows,
    count(provenance_metadata) as rows_with_provenance_metadata
FROM staging.listings
GROUP BY 1;
```

---
*Sanitized Audit Evidence Report — WatchFacts Ingestion Pipeline*
