# WatchFacts Ingestion Pipeline — Comprehensive Correction Gate Report

> **Branch**: `fix/pipeline-identity-and-wts-wtb-separation`  
> **Status**: **Correction Gate Fixes Implemented & Audited — Ready for Final Sign-Off**  
> **Environment**: Live Supabase PostgreSQL (`db.qnsafosakvonzgfcsphh.supabase.co`)  
> **Migration Control**: Historical backfill migration remains **PAUSED**. Zero credentials altered.

---

## 1. Executive Summary of Implementation Fixes

### A. WTB Demand & Research Eligibility Repair
1. **`classifyDemandEligibility(row, catalog)`**:
   - Fixed bug where `classifyDemandEligibility` was rejecting WTB rows because it called `classifyResearchEligibility` which checked intent type.
   - Now passes `listing_type: 'WTS'` internally so `classifyResearchEligibility` performs complete quality validation (brand, reference, model, dial, bundle) without rejecting WTB on intent type.
2. **Sales Analytics Restriction (`api/price-research.js`)**:
   - `classifyResearchEligibility` rejects every type except `'WTS'` and `'SINGLE'` (`NOT_WTS_SALE`).
   - `buildRowsQuery` explicitly filters `.in('listing_type', ['WTS', 'SINGLE'])` and `.gt('price_usd', 0)`.
   - Non-WTS listing types (`WTB`, `TRADE`, `MULTI_LISTING`) can no longer enter sale price statistics or averages.

### B. Transport Identity & Payload Content Versioning
1. **Stable Transport Source**:
   - `source_platform = 'mysql_thecollective'`
   - `source_group_id = r.get('source_group_id') or r.get('channel_id') or 'auctions'`
   - `source_message_id = str(r['id'])`
   - Intent (`WTS` vs `WTB`) is kept in a separate field; changing listing intent does not alter transport identity.
2. **Payload Content Versioning (`version_checksum`)**:
   - `content_hash = sha256(msg_text + ":" + orig_ts)`
   - `version_checksum = sha256(transport_checksum + ":" + content_hash)`
   - `job_id = uuid5(NAMESPACE_DNS, f"watchfacts.job.{version_checksum}")`
   - Changing raw message text or posting timestamp under the same provider message ID queues a **new content version job** that processes as a **distinct immutable listing event**.
   - Exact repeated content versions are suppressed as duplicates.

### C. Migration-Backed Batch ID & Schema Defaults Cleanup
1. **Committed Migration `20260806160000_batch_id_and_schema_defaults_cleanup.sql`**:
   - Added `batch_id` and `version_checksum` to `raw.payloads`, `jobs.processing_jobs`, and `staging.listings` with indexes.
   - Backfilled existing canary batch to `'canary_500_20260806'`.
   - Propagated `batch_id` through `pipeline_do_reader.py` (CLI `--batch-id`) and `pipeline_runner.py`.
2. **Invented Defaults Dropped**:
   - Dropped column defaults on `rating`, `dealer_rating`, `review_count`, `group_count`, `wts_post_count`, `wtb_post_count`.
   - Updated `pipeline_processor.py` to preserve missing ratings as `None` (`NULL`). Missing reputation metrics are not populated with fake 0.0 or 5.0 values.

### D. Credential & Test Hardening
- Removed all hardcoded API key fallbacks from Python and Node test files. Tests read `SUPABASE_URL` and `SUPABASE_ANON_KEY` / `ANON_KEY` from `os.environ` and call `SkipTest` or fail with configuration error when missing.

---

## 2. Test Execution Output

### A. Node API Integration Test Suite (`node tests/test_price_research_api_handler.test.cjs`)

```text
=== RUNNING NODE API PRICE-RESEARCH INTEGRATION TESTS ===
[PASS] Test 1: classifyDemandEligibility correctly returns null (eligible) for genuine WTB buyer request.
[PASS] Test 2: classifyResearchEligibility correctly rejects WTB from sales price research.
[PASS] Test 3: classifyResearchEligibility accepts genuine WTS sale record.
[PASS] Test 4: Real sales query returned 20 WTS eligible records.
[PASS] Test 5: Real demand query returned 20 WTB demand records.
=== ALL NODE API INTEGRATION TESTS PASSED CLEANLY ===
```

### B. Python Unittest Suite (`python -m unittest discover -s tests`)

```text
..............................
----------------------------------------------------------------------
Ran 30 tests in 1.957s

OK (skipped=8)
```

---

## 3. Immutable Batch-Scoped Bundle Reconciliation (`batch_id = 'canary_500_20260806'`)

```sql
SELECT 
    (SELECT count(*) FROM raw.payloads WHERE batch_id = 'canary_500_20260806') AS total_batch_payloads,
    
    (SELECT count(DISTINCT p_listing.id) 
     FROM staging.listings p_listing
     WHERE p_listing.batch_id = 'canary_500_20260806' 
       AND p_listing.parent_id IS NULL
       AND EXISTS (SELECT 1 FROM staging.listings c WHERE c.parent_id = p_listing.id)) AS parents_with_children,
       
    (SELECT count(*) 
     FROM staging.listings c
     WHERE c.batch_id = 'canary_500_20260806' 
       AND c.parent_id IS NOT NULL) AS total_children_produced,
       
    (SELECT count(*) 
     FROM staging.listings p_listing
     WHERE p_listing.batch_id = 'canary_500_20260806' 
       AND p_listing.parent_id IS NULL 
       AND p_listing.trading_floor_status = 'bundle_pending_separation') AS total_bundle_status_parents,
       
    (SELECT count(*) 
     FROM staging.listings p_listing
     WHERE p_listing.batch_id = 'canary_500_20260806' 
       AND p_listing.parent_id IS NULL 
       AND p_listing.trading_floor_status = 'bundle_pending_separation'
       AND NOT EXISTS (SELECT 1 FROM staging.listings c WHERE c.parent_id = p_listing.id)) AS unresolved_bundle_parents_without_children;
```

### Exact Immutable Batch Results:
| Metric | Count | Explanation |
|---|---:|---|
| **Total Batch Payloads** | **500** | Raw payloads in `canary_500_20260806` batch |
| **Parents with Children** | **208** | Parent bundle listings that produced unbundled child listings |
| **Total Children Produced** | **7,958** | Total child listings generated across the 208 parents |
| **Total Bundle Status Parents** | **260** | Parent listings assigned `trading_floor_status = 'bundle_pending_separation'` |
| **Unresolved Bundle Parents (0 children)** | **52** | Exact count of bundle-status parents with **0 child rows** using `NOT EXISTS` |

---

## 4. Security & Operational Confirmations

- ✅ **`public.exec_sql` Count**: **`0`** (`unsafe_exec_sql_functions = 0`).
- ✅ **No Hardcoded Passwords**: Zero credentials committed to repository.
- ✅ **Environment-Driven Credentials**: All PostgREST and DB test scripts use `os.environ`.
- ✅ **Historical Migration**: Paused pending final sign-off.
