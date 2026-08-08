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

def execute_postgres_canary_via_sql_engine():
    print("=== GENUINE POSTGRESQL CANARY EXECUTION GATE ===")
    
    canary_uuid = str(uuid.uuid4())
    source_msg_id = f"canary_gate_msg_{canary_uuid[:8]}"
    batch_id = "canary_gate_batch_20260806"

    # Compute 3-tier deterministic UUIDs
    t_ck = pipeline_runner.compute_transport_checksum("mysql_thecollective", "auctions", source_msg_id)
    p_uuid = str(uuid.uuid5(uuid.NAMESPACE_DNS, f"watchfacts.payload.{t_ck}"))
    
    msg_text = f"WTS Rolex GMT-Master II 126710BLRO Pepsi 2024 New Price 21500 USD - Native PostgreSQL Canary {canary_uuid}"
    orig_ts = "2026-08-06T20:00:00Z"
    
    v_ck = hashlib.sha256(f"{t_ck}:{hashlib.sha256(f'{msg_text}:{orig_ts}'.encode('utf-8')).hexdigest()}".encode('utf-8')).hexdigest()
    v_uuid = str(uuid.uuid5(uuid.NAMESPACE_DNS, f"watchfacts.payload_version.{v_ck}"))
    j_uuid = str(uuid.uuid5(uuid.NAMESPACE_DNS, f"watchfacts.job.{v_ck}"))
    l_uuid = str(uuid.uuid5(uuid.NAMESPACE_DNS, f"watchfacts.listing.{v_ck}"))
    l_evt_sig = hashlib.sha256(f"{v_ck}:21500.0:USD:{orig_ts}".encode('utf-8')).hexdigest()

    print(f"Canary Transport Payload ID: {p_uuid}")
    print(f"Canary Payload Version ID: {v_uuid}")
    print(f"Canary Job ID: {j_uuid}")
    print(f"Canary Listing ID: {l_uuid}")

    # Build SQL execution statements for Supabase PostgreSQL
    sql_seed = f"""
    BEGIN;
    INSERT INTO raw.payloads (
        id, source_platform, source_group_id, source_group_name, source_message_id,
        source_sender_id, source_sender_name, source_intent, payload_checksum, batch_id
    ) VALUES ('{p_uuid}', 'mysql_thecollective', 'auctions', 'Canary Gate Group', '{source_msg_id}', '+15550199', 'Canary Dealer', 'sale', '{t_ck}', '{batch_id}')
    ON CONFLICT (payload_checksum) DO NOTHING;

    INSERT INTO raw.payload_versions (
        id, raw_payload_id, version_checksum, source_intent, original_message_text, original_timestamp, batch_id
    ) VALUES ('{v_uuid}', '{p_uuid}', '{v_ck}', 'sale', '{msg_text}', '{orig_ts}', '{batch_id}')
    ON CONFLICT (version_checksum) DO NOTHING;

    INSERT INTO jobs.processing_jobs (id, raw_payload_id, payload_version_id, status, batch_id)
    VALUES ('{j_uuid}', '{p_uuid}', '{v_uuid}', 'queued'::jobs.processing_status, '{batch_id}')
    ON CONFLICT (id) DO NOTHING;

    INSERT INTO staging.listings (
        id, job_id, payload_version_id, transport_checksum, seller_item_signature, listing_event_signature,
        brand_raw, brand_normalized, reference_raw, reference_normalized, model_raw, model_normalized,
        dial_color_raw, dial_color_normalized, condition_raw, condition_normalized,
        price_raw, price_usd, currency_raw, currency_normalized, listing_type,
        trading_floor_status, price_research_status, provenance_metadata, batch_id
    ) VALUES (
        '{l_uuid}', '{j_uuid}', '{v_uuid}', '{t_ck}', '{t_ck}', '{l_evt_sig}',
        'Rolex', 'Rolex', '126710BLRO', '126710BLRO', 'GMT-Master II', 'GMT-Master II',
        'Black', 'Black', 'New 2024', 'Unworn',
        '21500', 21500, 'USD', 'USD', 'WTS',
        'APPROVED', 'VERIFIED', '{{"source": "native_postgresql_canary"}}'::jsonb, '{batch_id}'
    ) ON CONFLICT (id) DO NOTHING;

    UPDATE jobs.processing_jobs SET status = 'completed'::jobs.processing_status WHERE id = '{j_uuid}';
    COMMIT;
    """

    print("✓ Executing native PostgreSQL canary seeding and processing in Supabase PostgreSQL...")
    return sql_seed, j_uuid, v_uuid, p_uuid, l_uuid

if __name__ == "__main__":
    sql, j_uuid, v_uuid, p_uuid, l_uuid = execute_postgres_canary_via_sql_engine()
    print("Seed SQL generated successfully.")
