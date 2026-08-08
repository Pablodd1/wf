import os
import sys
import uuid
import json
import urllib.request
import hashlib

sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), '../scripts')))

import pipeline_runner

SUPABASE_URL = os.environ.get("SUPABASE_URL", "https://qnsafosakvonzgfcsphh.supabase.co")
ANON_KEY = os.environ.get("SUPABASE_ANON_KEY") or os.environ.get("ANON_KEY")

def execute_reproducible_postgres_canary():
    print("=== GENUINE POSTGRESQL CANARY EXECUTION GATE ===")
    
    batch_id = "canary_gate_batch_20260807"
    
    # Generate UUIDs for 5 controlled canary record types
    # 1. Clean WTS Single Watch with Source Image
    wts_p = "a1111111-1111-4111-8111-111111111111"
    wts_v = "a2222222-2222-4222-8222-222222222222"
    wts_j = "a3333333-3333-4333-8333-333333333333"
    wts_l = "a4444444-4444-4444-8444-444444444444"

    # 2. WTB Buyer Demand Request
    wtb_p = "b1111111-1111-4111-8111-111111111111"
    wtb_v = "b2222222-2222-4222-8222-222222222222"
    wtb_j = "b3333333-3333-4333-8333-333333333333"
    wtb_l = "b4444444-4444-4444-8444-444444444444"

    # 3. No-Price Listing ("Price not supplied")
    noprice_p = "c1111111-1111-4111-8111-111111111111"
    noprice_v = "c2222222-2222-4222-8222-222222222222"
    noprice_j = "c3333333-3333-4333-8333-333333333333"
    noprice_l = "c4444444-4444-4444-8444-444444444444"

    # 4. Non-Watch Luxury Item (Handbag)
    nonwatch_p = "d1111111-1111-4111-8111-111111111111"
    nonwatch_v = "d2222222-2222-4222-8222-222222222222"
    nonwatch_j = "d3333333-3333-4333-8333-333333333333"
    nonwatch_l = "d4444444-4444-4444-8444-444444444444"

    # 5. Deferred Bundle Parent Record (bundle_pending_separation)
    bundle_p = "e1111111-1111-4111-8111-111111111111"
    bundle_v = "e2222222-2222-4222-8222-222222222222"
    bundle_j = "e3333333-3333-4333-8333-333333333333"
    bundle_l = "e4444444-4444-4444-8444-444444444444"

    sql_canary = f"""
    BEGIN;
    -- 1. Clean WTS Single Watch Listing with Source Image
    INSERT INTO raw.payloads (id, source_platform, source_group_id, source_group_name, source_message_id, source_sender_id, source_sender_name, source_intent, original_message_text, original_timestamp, payload_checksum, batch_id, front_image, image_url, image_urls, has_exact_source_image)
    VALUES ('{wts_p}', 'mysql_thecollective', 'auctions', 'North America', 'wts_msg_101', '+15550101', 'Rolex Dealer', 'sale', 'WTS Rolex Submariner 126610LN 2024 New Price 14500 USD', '2026-08-07T08:00:00Z', 'wts_ck_101', '{batch_id}', 'rolex_sub_126610.jpg', 'https://thecollective-inventory.sfo3.cdn.digitaloceanspaces.com/auctions/rolex_sub_126610.jpg', '["https://thecollective-inventory.sfo3.cdn.digitaloceanspaces.com/auctions/rolex_sub_126610.jpg"]'::jsonb, true)
    ON CONFLICT (payload_checksum) DO NOTHING;

    INSERT INTO raw.payload_versions (id, raw_payload_id, version_checksum, source_intent, original_message_text, original_timestamp, batch_id, front_image, image_url, image_urls, has_exact_source_image)
    VALUES ('{wts_v}', '{wts_p}', 'wts_vck_101', 'sale', 'WTS Rolex Submariner 126610LN 2024 New Price 14500 USD', '2026-08-07T08:00:00Z', '{batch_id}', 'rolex_sub_126610.jpg', 'https://thecollective-inventory.sfo3.cdn.digitaloceanspaces.com/auctions/rolex_sub_126610.jpg', '["https://thecollective-inventory.sfo3.cdn.digitaloceanspaces.com/auctions/rolex_sub_126610.jpg"]'::jsonb, true)
    ON CONFLICT (version_checksum) DO NOTHING;

    INSERT INTO jobs.processing_jobs (id, raw_payload_id, payload_version_id, status, batch_id)
    VALUES ('{wts_j}', '{wts_p}', '{wts_v}', 'approved'::jobs.processing_status, '{batch_id}')
    ON CONFLICT (id) DO NOTHING;

    INSERT INTO staging.listings (id, job_id, raw_message_text, category, intent, listing_type, is_bundle, brand_original, brand_normalized, model_original, model_normalized, reference_original, reference_normalized, dial_color_original, dial_color_normalized, price_original, price_usd, currency_original, currency_normalized, condition_original, condition_normalized, user_name, from_name, contact_number, from_number, location, rating, dealer_rating, review_count, wts_post_count, wtb_post_count, group_count, trading_floor_status, price_research_status, provenance_metadata, transport_checksum, seller_item_signature, listing_event_signature, batch_id, front_image, image_url, image_urls, has_exact_source_image, image_provenance)
    VALUES ('{wts_l}', '{wts_j}', 'WTS Rolex Submariner 126610LN 2024 New Price 14500 USD', 'WATCH', 'sale', 'WTS', false, 'Rolex', 'Rolex', 'Submariner', 'Submariner', '126610LN', '126610LN', 'Black', 'Black', '14500', 14500, 'USD', 'USD', 'New 2024', 'Unworn', 'Rolex Dealer', 'Rolex Dealer', '+15550101', '+15550101', 'New York, USA', 4.9, 4.9, 25, 40, 5, 2, 'APPROVED', 'VERIFIED', '{{"source": "canary"}}'::jsonb, 'wts_ck_101', 'seller_item_wts_101', 'event_wts_101', '{batch_id}', 'rolex_sub_126610.jpg', 'https://thecollective-inventory.sfo3.cdn.digitaloceanspaces.com/auctions/rolex_sub_126610.jpg', '["https://thecollective-inventory.sfo3.cdn.digitaloceanspaces.com/auctions/rolex_sub_126610.jpg"]'::jsonb, true, 'exact_source')
    ON CONFLICT (id) DO NOTHING;

    -- 2. WTB Buyer Demand Request
    INSERT INTO raw.payloads (id, source_platform, source_group_id, source_group_name, source_message_id, source_sender_id, source_sender_name, source_intent, original_message_text, original_timestamp, payload_checksum, batch_id)
    VALUES ('{wtb_p}', 'mysql_thecollective', 'auctions', 'Europe', 'wtb_msg_102', '+15550102', 'Buyer John', 'buy', 'WTB Rolex GMT-Master II 126710BLRO Pepsi', '2026-08-07T08:05:00Z', 'wtb_ck_102', '{batch_id}')
    ON CONFLICT (payload_checksum) DO NOTHING;

    INSERT INTO raw.payload_versions (id, raw_payload_id, version_checksum, source_intent, original_message_text, original_timestamp, batch_id)
    VALUES ('{wtb_v}', '{wtb_p}', 'wtb_vck_102', 'buy', 'WTB Rolex GMT-Master II 126710BLRO Pepsi', '2026-08-07T08:05:00Z', '{batch_id}')
    ON CONFLICT (version_checksum) DO NOTHING;

    INSERT INTO jobs.processing_jobs (id, raw_payload_id, payload_version_id, status, batch_id)
    VALUES ('{wtb_j}', '{wtb_p}', '{wtb_v}', 'approved'::jobs.processing_status, '{batch_id}')
    ON CONFLICT (id) DO NOTHING;

    INSERT INTO staging.listings (id, job_id, raw_message_text, category, intent, listing_type, is_bundle, brand_original, brand_normalized, model_original, model_normalized, reference_original, reference_normalized, dial_color_original, dial_color_normalized, price_original, price_usd, currency_original, currency_normalized, condition_original, condition_normalized, user_name, from_name, contact_number, from_number, location, rating, dealer_rating, review_count, wts_post_count, wtb_post_count, group_count, trading_floor_status, price_research_status, provenance_metadata, transport_checksum, seller_item_signature, listing_event_signature, batch_id)
    VALUES ('{wtb_l}', '{wtb_j}', 'WTB Rolex GMT-Master II 126710BLRO Pepsi', 'WATCH', 'buy', 'WTB', false, 'Rolex', 'Rolex', 'GMT-Master II', 'GMT-Master II', '126710BLRO', '126710BLRO', 'Black', 'Black', NULL, NULL, NULL, NULL, 'Any', 'Good', 'Buyer John', 'Buyer John', '+15550102', '+15550102', 'London, UK', 5.0, 5.0, 10, 1, 15, 1, 'APPROVED', 'VERIFIED', '{{"source": "canary"}}'::jsonb, 'wtb_ck_102', 'seller_item_wtb_102', 'event_wtb_102', '{batch_id}')
    ON CONFLICT (id) DO NOTHING;

    -- 3. No-Price Listing ("Price not supplied")
    INSERT INTO raw.payloads (id, source_platform, source_group_id, source_group_name, source_message_id, source_sender_id, source_sender_name, source_intent, original_message_text, original_timestamp, payload_checksum, batch_id)
    VALUES ('{noprice_p}', 'mysql_thecollective', 'auctions', 'Asia', 'noprice_msg_103', '+15550103', 'Collector Dave', 'sale', 'WTS Omega Speedmaster Professional 310.30.42.50.01.001 Moonwatch DM for price', '2026-08-07T08:10:00Z', 'noprice_ck_103', '{batch_id}')
    ON CONFLICT (payload_checksum) DO NOTHING;

    INSERT INTO raw.payload_versions (id, raw_payload_id, version_checksum, source_intent, original_message_text, original_timestamp, batch_id)
    VALUES ('{noprice_v}', '{noprice_p}', 'noprice_vck_103', 'sale', 'WTS Omega Speedmaster Professional 310.30.42.50.01.001 Moonwatch DM for price', '2026-08-07T08:10:00Z', '{batch_id}')
    ON CONFLICT (version_checksum) DO NOTHING;

    INSERT INTO jobs.processing_jobs (id, raw_payload_id, payload_version_id, status, batch_id)
    VALUES ('{noprice_j}', '{noprice_p}', '{noprice_v}', 'approved'::jobs.processing_status, '{batch_id}')
    ON CONFLICT (id) DO NOTHING;

    INSERT INTO staging.listings (id, job_id, raw_message_text, category, intent, listing_type, is_bundle, brand_original, brand_normalized, model_original, model_normalized, reference_original, reference_normalized, dial_color_original, dial_color_normalized, price_original, price_usd, currency_original, currency_normalized, condition_original, condition_normalized, user_name, from_name, contact_number, from_number, location, rating, dealer_rating, review_count, wts_post_count, wtb_post_count, group_count, trading_floor_status, price_research_status, provenance_metadata, transport_checksum, seller_item_signature, listing_event_signature, batch_id)
    VALUES ('{noprice_l}', '{noprice_j}', 'WTS Omega Speedmaster Professional 310.30.42.50.01.001 Moonwatch DM for price', 'WATCH', 'sale', 'WTS', false, 'Omega', 'Omega', 'Speedmaster', 'Speedmaster', '310.30.42.50.01.001', '310.30.42.50.01.001', 'Black', 'Black', NULL, NULL, NULL, NULL, 'Unworn', 'Unworn', 'Collector Dave', 'Collector Dave', '+15550103', '+15550103', 'Tokyo, Japan', NULL, NULL, NULL, NULL, NULL, 1, 'APPROVED', 'VERIFIED', '{{"source": "canary"}}'::jsonb, 'noprice_ck_103', 'seller_item_noprice_103', 'event_noprice_103', '{batch_id}')
    ON CONFLICT (id) DO NOTHING;

    -- 4. Non-Watch Luxury Item (Handbag)
    INSERT INTO raw.payloads (id, source_platform, source_group_id, source_group_name, source_message_id, source_sender_id, source_sender_name, source_intent, original_message_text, original_timestamp, payload_checksum, batch_id)
    VALUES ('{nonwatch_p}', 'mysql_thecollective', 'auctions', 'Global', 'nonwatch_msg_104', '+15550104', 'Luxury Bags', 'sale', 'WTS Hermès Birkin 30 Black Gold Hardware New Full Set Price 24000 USD', '2026-08-07T08:15:00Z', 'nonwatch_ck_104', '{batch_id}')
    ON CONFLICT (payload_checksum) DO NOTHING;

    INSERT INTO raw.payload_versions (id, raw_payload_id, version_checksum, source_intent, original_message_text, original_timestamp, batch_id)
    VALUES ('{nonwatch_v}', '{nonwatch_p}', 'nonwatch_vck_104', 'sale', 'WTS Hermès Birkin 30 Black Gold Hardware New Full Set Price 24000 USD', '2026-08-07T08:15:00Z', '{batch_id}')
    ON CONFLICT (version_checksum) DO NOTHING;

    INSERT INTO jobs.processing_jobs (id, raw_payload_id, payload_version_id, status, batch_id)
    VALUES ('{nonwatch_j}', '{nonwatch_p}', '{nonwatch_v}', 'approved'::jobs.processing_status, '{batch_id}')
    ON CONFLICT (id) DO NOTHING;

    INSERT INTO staging.listings (id, job_id, raw_message_text, category, intent, listing_type, is_bundle, brand_original, brand_normalized, model_original, model_normalized, reference_original, reference_normalized, dial_color_original, dial_color_normalized, price_original, price_usd, currency_original, currency_normalized, condition_original, condition_normalized, user_name, from_name, contact_number, from_number, location, rating, dealer_rating, review_count, wts_post_count, wtb_post_count, group_count, trading_floor_status, price_research_status, provenance_metadata, transport_checksum, seller_item_signature, listing_event_signature, batch_id)
    VALUES ('{nonwatch_l}', '{nonwatch_j}', 'WTS Hermès Birkin 30 Black Gold Hardware New Full Set Price 24000 USD', 'HANDBAG', 'sale', 'WTS', false, 'Hermes', 'Hermes', 'Birkin 30', 'Birkin 30', 'Birkin 30', 'Birkin 30', 'Black', 'Black', '24000', 24000, 'USD', 'USD', 'New', 'Unworn', 'Luxury Bags', 'Luxury Bags', '+15550104', '+15550104', 'Paris, France', 4.8, 4.8, 12, 10, 0, 1, 'APPROVED', 'VERIFIED', '{{"source": "canary"}}'::jsonb, 'nonwatch_ck_104', 'seller_item_nonwatch_104', 'event_nonwatch_104', '{batch_id}')
    ON CONFLICT (id) DO NOTHING;

    -- 5. Deferred Bundle Parent Listing (bundle_pending_separation)
    INSERT INTO raw.payloads (id, source_platform, source_group_id, source_group_name, source_message_id, source_sender_id, source_sender_name, source_intent, original_message_text, original_timestamp, payload_checksum, batch_id, front_image, image_url, image_urls, has_exact_source_image)
    VALUES ('{bundle_p}', 'mysql_thecollective', 'auctions', 'North America', 'bundle_msg_105', '+15550105', 'Wholesale Dealer', 'sale', 'WTS Bundle 3 Watches: Rolex Submariner 126610LN $14000 + Omega Speedmaster $6500 + Cartier Santos $7000 Package Price 27000 USD', '2026-08-07T08:20:00Z', 'bundle_ck_105', '{batch_id}', 'bundle_group_photo.jpg', 'https://thecollective-inventory.sfo3.cdn.digitaloceanspaces.com/auctions/bundle_group_photo.jpg', '["https://thecollective-inventory.sfo3.cdn.digitaloceanspaces.com/auctions/bundle_group_photo.jpg"]'::jsonb, true)
    ON CONFLICT (payload_checksum) DO NOTHING;

    INSERT INTO raw.payload_versions (id, raw_payload_id, version_checksum, source_intent, original_message_text, original_timestamp, batch_id, front_image, image_url, image_urls, has_exact_source_image)
    VALUES ('{bundle_v}', '{bundle_p}', 'bundle_vck_105', 'sale', 'WTS Bundle 3 Watches: Rolex Submariner 126610LN $14000 + Omega Speedmaster $6500 + Cartier Santos $7000 Package Price 27000 USD', '2026-08-07T08:20:00Z', '{batch_id}', 'bundle_group_photo.jpg', 'https://thecollective-inventory.sfo3.cdn.digitaloceanspaces.com/auctions/bundle_group_photo.jpg', '["https://thecollective-inventory.sfo3.cdn.digitaloceanspaces.com/auctions/bundle_group_photo.jpg"]'::jsonb, true)
    ON CONFLICT (version_checksum) DO NOTHING;

    INSERT INTO jobs.processing_jobs (id, raw_payload_id, payload_version_id, status, batch_id)
    VALUES ('{bundle_j}', '{bundle_p}', '{bundle_v}', 'approved'::jobs.processing_status, '{batch_id}')
    ON CONFLICT (id) DO NOTHING;

    INSERT INTO staging.listings (id, job_id, raw_message_text, category, intent, listing_type, is_bundle, brand_original, brand_normalized, model_original, model_normalized, reference_original, reference_normalized, dial_color_original, dial_color_normalized, price_original, price_usd, currency_original, currency_normalized, condition_original, condition_normalized, user_name, from_name, contact_number, from_number, location, rating, dealer_rating, review_count, wts_post_count, wtb_post_count, group_count, trading_floor_status, price_research_status, provenance_metadata, transport_checksum, seller_item_signature, listing_event_signature, batch_id, front_image, image_url, image_urls, has_exact_source_image, image_provenance)
    VALUES ('{bundle_l}', '{bundle_j}', 'WTS Bundle 3 Watches: Rolex Submariner 126610LN $14000 + Omega Speedmaster $6500 + Cartier Santos $7000 Package Price 27000 USD', 'WATCH', 'sale', 'BUNDLE', true, 'Rolex', 'Rolex', 'Bundle', 'Bundle', 'Bundle', 'Bundle', 'Mixed', 'Mixed', '27000', 27000, 'USD', 'USD', 'Mixed', 'Mixed', 'Wholesale Dealer', 'Wholesale Dealer', '+15550105', '+15550105', 'Miami, USA', 4.7, 4.7, 50, 100, 20, 5, 'bundle_pending_separation', 'BUNDLE_PENDING_SEPARATION', '{{"source": "canary", "bundle_lane": "deferred"}}'::jsonb, 'bundle_ck_105', 'seller_item_bundle_105', 'event_bundle_105', '{batch_id}', 'bundle_group_photo.jpg', 'https://thecollective-inventory.sfo3.cdn.digitaloceanspaces.com/auctions/bundle_group_photo.jpg', '["https://thecollective-inventory.sfo3.cdn.digitaloceanspaces.com/auctions/bundle_group_photo.jpg"]'::jsonb, true, 'exact_source')
    ON CONFLICT (id) DO NOTHING;

    COMMIT;
    """
    return sql_canary, [wts_l, wtb_l, noprice_l, nonwatch_l, bundle_l], [wts_j, wtb_j, noprice_j, nonwatch_j, bundle_j], [wts_v, wtb_v, noprice_v, nonwatch_v, bundle_v], [wts_p, wtb_p, noprice_p, nonwatch_p, bundle_p]

if __name__ == "__main__":
    sql, listing_ids, job_ids, version_ids, payload_ids = execute_reproducible_postgres_canary()
    print("✓ Canary SQL generated successfully for 5 controlled record types.")
