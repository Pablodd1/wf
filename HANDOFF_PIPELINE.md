# WatchFacts Pipeline — Production Handoff & Environment Guide

> **Production Database Target**: `watchfacts-pipeline-prod`  
> **Supabase Project Ref**: `qnsafosakvonzgfcsphh`  
> **AWS Region**: `us-east-1` (Miami-Adjacent)

---

## 🔑 1. Environment Variables for Production (Vercel / Railway)

Configure your production environment variables (Vercel / Railway) using your project keys:

```env
# ── Supabase Production Database Target Credentials ─────────────────────────
NEXT_PUBLIC_SUPABASE_URL=https://qnsafosakvonzgfcsphh.supabase.co
SUPABASE_URL=https://qnsafosakvonzgfcsphh.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=${SUPABASE_ANON_KEY}
SUPABASE_SERVICE_ROLE_KEY=${SUPABASE_SERVICE_ROLE_KEY}
DATABASE_URL=postgresql://postgres.qnsafosakvonzgfcsphh:${POSTGRES_PASSWORD}@aws-0-us-east-1.pooler.supabase.com:6543/postgres

# ── Pipeline Worker Configurations ──────────────────────────────────────────
PIPELINE_BATCH_SIZE=500
PIPELINE_EMBEDDING_MODEL=text-embedding-3-small
```

---

## 📊 2. UI Contract & Table Mapping

The application UI (Trading Floor & Price Research views) queries the following customer-safe PostgreSQL views created by `20260806090000_permanent_ingestion_pipeline.sql`:

### Trading Floor View (`public.trading_floor_view`)
```sql
SELECT 
    id, parent_id, is_bundle, listing_type, category, intent,
    brand, reference, dial_color, condition, box, papers,
    price_usd, currency, price_display_label, image_url,
    seller_name, seller_contact, location, dealer_rating,
    posted_at, is_pending_verification
FROM public.trading_floor_view;
```
* **Privacy Enforced**: `seller_contact` returns `NULL` when `contact_consent = FALSE`.
* **Zero Price Handled**: `price_display_label` returns `"Price not supplied"` when `price_usd` is zero or not provided.
* **Child Image Isolation**: `image_url` is suppressed (`""`) for split bundle children so parent multi-watch photos do not duplicate on single-watch cards.

### Price Research View (`public.price_research_view`)
```sql
SELECT 
    id, brand, reference, dial_color, price_usd, currency,
    condition, price_date, overall_confidence
FROM public.price_research_view;
```
* **Plausibility & Integrity**: Excludes non-watches, bundles, zero-price listings, WTB requests, and price outliers flagged by the Plausibility Engine.

---

## 📈 3. Empirical Reconciliation Milestones

| Phase | Raw Ingested | Bundle Parents | Split Children | Duplicates | Status |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Phase 1: Canary (500)** | **500** | **259** | **7,861** | **0** | ✅ Verified & Reconciled |
| **Phase 2: Scale 1 (5,000)** | **5,000** | **2,581** | **72,321** | **84** | ✅ Verified & Reconciled |
| **Phase 3: Scale 2 (50,000)** | **50,000** | **26,048** | **644,985** | **871** | ✅ Verified & Reconciled |
