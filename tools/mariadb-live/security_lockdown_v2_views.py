import os, sys, psycopg2

db_url = os.environ.get("DATABASE_URL")
if not db_url:
    print("FATAL: DATABASE_URL required.", file=sys.stderr)
    sys.exit(1)

conn = psycopg2.connect(db_url, options="-c timezone=UTC", keepalives=1, keepalives_idle=30, keepalives_interval=10)
cur = conn.cursor()

print("================================================================================")
print("PHASE 1: EXECUTE IMMEDIATE SECURITY PRIVILEGES LOCKDOWN ON V2 CONSUMER VIEWS")
print("================================================================================\n")

views = [
    "trading_floor_ready_view_v2",
    "price_research_ready_view_v2",
    "listing_display_detail_view_v2",
    "seller_listing_analytics_view_v2"
]

# 1. Revoke all privileges from PUBLIC, anon, and authenticated
print("Step 1: Revoking privileges on v2 views from PUBLIC, anon, and authenticated...")
for v in views:
    cur.execute(f"REVOKE ALL ON public.{v} FROM PUBLIC, anon, authenticated;")
conn.commit()
print("  [OK] Revoked SELECT on all 4 v2 consumer views.")

# 2. Re-create views WITH (security_invoker = true) using explicit safe column lists
print("\nStep 2: Re-creating v2 views WITH (security_invoker = true) and explicit safe column lists...")

cur.execute("""
    CREATE OR REPLACE VIEW public.trading_floor_ready_view_v2 WITH (security_invoker = true) AS
    SELECT 
      contract_version, listing_id, parent_listing_id, child_index, source_id, source_hash,
      raw_message_id, raw_message_text, source_context_text, source_created_at, observed_at,
      category, brand, model, reference, dial_color, year, condition, intent, intent_status,
      title, description, original_price_text, original_price_amount, original_price_currency,
      price_usd, fx_rate, fx_source, fx_date, price_status, price_research_eligible,
      included_in_statistics, statistics_exclusion_reason, image_url, thumbnail_url, image_key,
      image_evidence_type, image_status, seller_id, seller_display_name, seller_profile_url,
      seller_review_count, seller_listing_count, seller_wts_count, seller_wtb_count,
      contact_available, location_country, location_region, is_bundle, bundle_child_count,
      review_status, review_reasons
    FROM wf_canonical_staging.mariadb_canary_published_listings_v2
    ORDER BY 
      (CASE WHEN price_status = 'VERIFIED_USD' AND price_usd IS NOT NULL THEN 1 ELSE 2 END) ASC,
      (CASE WHEN image_status = 'SOURCE_IMAGE_PRESENT' AND image_key IS NOT NULL AND TRIM(image_key) <> '' THEN 1 ELSE 2 END) ASC,
      price_usd DESC NULLS LAST,
      source_created_at DESC,
      listing_id ASC;
""")

cur.execute("""
    CREATE OR REPLACE VIEW public.price_research_ready_view_v2 WITH (security_invoker = true) AS
    SELECT 
      contract_version, listing_id, parent_listing_id, child_index, source_id, source_hash,
      raw_message_id, raw_message_text, source_context_text, source_created_at, observed_at,
      category, brand, model, reference, dial_color, year, condition, intent, intent_status,
      title, description, original_price_text, original_price_amount, original_price_currency,
      price_usd, fx_rate, fx_source, fx_date, price_status, price_research_eligible,
      included_in_statistics, statistics_exclusion_reason, image_url, thumbnail_url, image_key,
      image_evidence_type, image_status, seller_id, seller_display_name, seller_profile_url,
      seller_review_count, seller_listing_count, seller_wts_count, seller_wtb_count,
      contact_available, location_country, location_region, is_bundle, bundle_child_count,
      review_status, review_reasons
    FROM wf_canonical_staging.mariadb_canary_published_listings_v2
    WHERE original_price_amount IS NOT NULL OR price_usd IS NOT NULL
    ORDER BY 
      price_research_eligible DESC,
      included_in_statistics DESC,
      source_created_at DESC,
      listing_id ASC;
""")

cur.execute("""
    CREATE OR REPLACE VIEW public.listing_display_detail_view_v2 WITH (security_invoker = true) AS
    SELECT 
      contract_version, listing_id, parent_listing_id, child_index, source_id, source_hash,
      raw_message_id, raw_message_text, source_context_text, source_created_at, observed_at,
      category, brand, model, reference, dial_color, year, condition, intent, intent_status,
      title, description, original_price_text, original_price_amount, original_price_currency,
      price_usd, fx_rate, fx_source, fx_date, price_status, price_research_eligible,
      included_in_statistics, statistics_exclusion_reason, image_url, thumbnail_url, image_key,
      image_evidence_type, image_status, seller_id, seller_display_name, seller_profile_url,
      seller_review_count, seller_listing_count, seller_wts_count, seller_wtb_count,
      contact_available, location_country, location_region, is_bundle, bundle_child_count,
      review_status, review_reasons
    FROM wf_canonical_staging.mariadb_canary_published_listings_v2;
""")

cur.execute("""
    CREATE OR REPLACE VIEW public.seller_listing_analytics_view_v2 WITH (security_invoker = true) AS
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

# Re-apply explicit REVOKE ALL on newly created views
for v in views:
    cur.execute(f"REVOKE ALL ON public.{v} FROM PUBLIC, anon, authenticated;")
    cur.execute(f"GRANT SELECT ON public.{v} TO service_role;")

conn.commit()
print("  [OK] Re-created all 4 v2 views with security_invoker = true, explicit safe column lists, and service_role grants.")

# 3. Verify SELECT privileges on v2 views
print("\nStep 3: Verifying PostgREST Role Privileges via has_table_privilege...")
roles = ["anon", "authenticated", "service_role"]

for v in views:
    for r in roles:
        cur.execute(f"SELECT has_table_privilege('{r}', 'public.{v}', 'SELECT');")
        can_select = cur.fetchone()[0]
        print(f"  Role: {r:15} | View: {v:35} | SELECT: {can_select}")

cur.close()
conn.close()
