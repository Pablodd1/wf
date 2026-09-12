import os
import sys
import psycopg2

db_url = os.environ.get("DATABASE_URL")
if not db_url:
    print("FATAL: DATABASE_URL required.", file=sys.stderr)
    sys.exit(1)

conn = psycopg2.connect(db_url, options="-c timezone=UTC", keepalives=1, keepalives_idle=30, keepalives_interval=10)
cur = conn.cursor()

print("================================================================================")
print("CREATING STAGING TABLES AND V2 CONSUMER VIEWS FOR LISTING DISPLAY CONTRACT")
print("================================================================================\n")

# 1. Create Bundle Children Staging Table
cur.execute("""
    CREATE TABLE IF NOT EXISTS wf_canonical_staging.mariadb_bundle_children_v2 (
      child_listing_id TEXT PRIMARY KEY,
      parent_source_id TEXT NOT NULL,
      child_index INT NOT NULL,
      child_evidence_hash TEXT NOT NULL,
      source_system TEXT NOT NULL,
      source_database TEXT NOT NULL,
      source_table TEXT NOT NULL,
      source_record_id TEXT NOT NULL,
      source_created_on TEXT NOT NULL,
      source_hash TEXT NOT NULL,
      brand TEXT,
      reference TEXT,
      model TEXT,
      year INT,
      condition TEXT,
      intent TEXT,
      original_price_amount NUMERIC,
      original_price_currency TEXT,
      price_usd NUMERIC,
      fx_rate NUMERIC,
      fx_source TEXT,
      fx_date TEXT,
      currency_status TEXT NOT NULL,
      seller_name TEXT,
      seller_contact TEXT,
      image_key TEXT,
      image_evidence_type TEXT NOT NULL,
      trading_floor_status TEXT NOT NULL,
      trading_floor_eligible BOOLEAN NOT NULL,
      price_research_status TEXT NOT NULL,
      price_research_eligible BOOLEAN NOT NULL,
      is_bundle BOOLEAN NOT NULL DEFAULT FALSE,
      included_in_statistics BOOLEAN NOT NULL,
      source_context_text TEXT NOT NULL,
      listing_text_sha256 TEXT,
      reconciliation_category TEXT NOT NULL,
      review_flags JSONB NOT NULL DEFAULT '[]'::jsonb,
      exclusion_reasons JSONB NOT NULL DEFAULT '[]'::jsonb,
      raw_payload JSONB NOT NULL,
      normalized_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS idx_mariadb_bundle_children_v2_parent 
      ON wf_canonical_staging.mariadb_bundle_children_v2 (parent_source_id, child_index);
""")
conn.commit()
print("[OK] Staging table mariadb_bundle_children_v2 created.")

# 2. Create Canary Published Listings Table (52-Field ListingDisplayContract)
cur.execute("""
    CREATE TABLE IF NOT EXISTS wf_canonical_staging.mariadb_canary_published_listings_v2 (
      contract_version TEXT NOT NULL DEFAULT 'v2.0',
      listing_id TEXT PRIMARY KEY,
      parent_listing_id TEXT,
      child_index INT,
      source_id TEXT NOT NULL,
      source_hash TEXT NOT NULL,
      raw_message_id TEXT NOT NULL,
      raw_message_text TEXT,
      source_context_text TEXT,
      source_created_at TIMESTAMPTZ NOT NULL,
      observed_at TIMESTAMPTZ NOT NULL,
      category TEXT NOT NULL DEFAULT 'wristwatches',
      brand TEXT,
      model TEXT,
      reference TEXT,
      dial_color TEXT,
      year INT,
      condition TEXT,
      intent TEXT,
      intent_status TEXT NOT NULL,
      title TEXT,
      description TEXT,
      original_price_text TEXT,
      original_price_amount NUMERIC,
      original_price_currency TEXT,
      price_usd NUMERIC,
      fx_rate NUMERIC,
      fx_source TEXT,
      fx_date TEXT,
      price_status TEXT NOT NULL,
      price_research_eligible BOOLEAN NOT NULL,
      included_in_statistics BOOLEAN NOT NULL,
      statistics_exclusion_reason TEXT,
      image_url TEXT,
      thumbnail_url TEXT,
      image_key TEXT,
      image_evidence_type TEXT NOT NULL,
      image_status TEXT NOT NULL,
      seller_id TEXT,
      seller_display_name TEXT,
      seller_profile_url TEXT,
      seller_review_count INT NOT NULL DEFAULT 0,
      seller_listing_count INT NOT NULL DEFAULT 0,
      seller_wts_count INT NOT NULL DEFAULT 0,
      seller_wtb_count INT NOT NULL DEFAULT 0,
      contact_available BOOLEAN NOT NULL DEFAULT FALSE,
      location_country TEXT,
      location_region TEXT,
      is_bundle BOOLEAN NOT NULL DEFAULT FALSE,
      bundle_child_count INT NOT NULL DEFAULT 0,
      review_status TEXT NOT NULL,
      review_reasons JSONB NOT NULL DEFAULT '[]'::jsonb
    );

    CREATE INDEX IF NOT EXISTS idx_canary_v2_order 
      ON wf_canonical_staging.mariadb_canary_published_listings_v2 (
        price_usd ASC NULLS LAST, 
        original_price_amount ASC NULLS LAST, 
        source_created_at DESC, 
        listing_id ASC
      );
""")
conn.commit()
print("[OK] Staging table mariadb_canary_published_listings_v2 created.")

# 3. Create public.trading_floor_ready_view_v2
cur.execute("""
    CREATE OR REPLACE VIEW public.trading_floor_ready_view_v2 AS
    SELECT *
    FROM wf_canonical_staging.mariadb_canary_published_listings_v2
    ORDER BY 
      CASE WHEN price_usd IS NOT NULL THEN 0 ELSE 1 END ASC,
      price_usd ASC NULLS LAST,
      CASE WHEN original_price_amount IS NOT NULL THEN 0 ELSE 1 END ASC,
      original_price_amount ASC NULLS LAST,
      CASE WHEN image_key IS NOT NULL AND TRIM(image_key) <> '' THEN 0 ELSE 1 END ASC,
      source_created_at DESC,
      listing_id ASC;
""")
conn.commit()
print("[OK] Consumer view public.trading_floor_ready_view_v2 created with default sort contract.")

# 4. Create public.price_research_ready_view_v2
cur.execute("""
    CREATE OR REPLACE VIEW public.price_research_ready_view_v2 AS
    SELECT *
    FROM wf_canonical_staging.mariadb_canary_published_listings_v2
    WHERE original_price_amount IS NOT NULL OR price_usd IS NOT NULL
    ORDER BY 
      price_research_eligible DESC,
      included_in_statistics DESC,
      source_created_at DESC,
      listing_id ASC;
""")
conn.commit()
print("[OK] Consumer view public.price_research_ready_view_v2 created.")

# 5. Create public.listing_display_detail_view_v2
cur.execute("""
    CREATE OR REPLACE VIEW public.listing_display_detail_view_v2 AS
    SELECT *
    FROM wf_canonical_staging.mariadb_canary_published_listings_v2;
""")
conn.commit()
print("[OK] Consumer view public.listing_display_detail_view_v2 created.")

# 6. Create public.seller_listing_analytics_view_v2
cur.execute("""
    CREATE OR REPLACE VIEW public.seller_listing_analytics_view_v2 AS
    SELECT 
      seller_display_name,
      seller_id,
      COUNT(*) AS total_listings,
      COUNT(*) FILTER (WHERE intent = 'WTS') AS wts_count,
      COUNT(*) FILTER (WHERE intent = 'WTB') AS wtb_count,
      COUNT(*) FILTER (WHERE price_usd IS NOT NULL) AS priced_listings_count,
      MIN(source_created_at) AS first_seen_at,
      MAX(source_created_at) AS last_seen_at
    FROM wf_canonical_staging.mariadb_canary_published_listings_v2
    GROUP BY seller_display_name, seller_id;
""")
conn.commit()
print("[OK] Consumer view public.seller_listing_analytics_view_v2 created.")

cur.close()
conn.close()
