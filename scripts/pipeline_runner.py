#!/usr/bin/env python3
"""
WatchFacts Ingestion Pipeline - Core Runner Daemon
Orchestrates continuous reading from raw payload queues, running extraction,
performing validation, splitting bundles, duplicate suppression with concurrency locking,
and synchronizing to staging tables.
"""

import os
import sys
import time
import uuid
import hashlib
import json
import sqlite3
import psycopg2
from psycopg2.extras import RealDictCursor

sys.path.append(os.path.dirname(os.path.abspath(__file__)))
from pipeline_processor import WatchFactsPipelineProcessor

DATABASE_URL = os.environ.get("DATABASE_URL") or os.environ.get("SUPABASE_URL")
PGHOST = os.environ.get("PGHOST", "db.qnsafosakvonzgfcsphh.supabase.co")
PGPORT = os.environ.get("PGPORT", "5432")
PGUSER = os.environ.get("PGUSER", "postgres")
PGPASSWORD = os.environ.get("PGPASSWORD")
PGDATABASE = os.environ.get("PGDATABASE", "postgres")

IS_SQLITE = False
REQUIRE_POSTGRES = os.environ.get("REQUIRE_POSTGRES", "0").lower() in ("1", "true", "yes")
SQLITE_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "scratch", "pipeline_fallback.db")

def get_db_connection():
    global IS_SQLITE
    if DATABASE_URL and DATABASE_URL.startswith("postgresql://"):
        try:
            conn = psycopg2.connect(DATABASE_URL)
            IS_SQLITE = False
            return conn
        except Exception as e:
            if REQUIRE_POSTGRES:
                raise RuntimeError(f"PostgreSQL connection required via DATABASE_URL, but failed: {e}")

    if PGPASSWORD:
        try:
            conn = psycopg2.connect(
                host=PGHOST, port=PGPORT, user=PGUSER, password=PGPASSWORD,
                dbname=PGDATABASE, connect_timeout=5
            )
            IS_SQLITE = False
            return conn
        except Exception as e:
            if REQUIRE_POSTGRES:
                raise RuntimeError(f"PostgreSQL connection required via PG environment, but failed: {e}")

    if REQUIRE_POSTGRES:
        raise RuntimeError("PostgreSQL connection required (--require-postgres or REQUIRE_POSTGRES=1), but no PostgreSQL credentials connected.")

    os.makedirs(os.path.dirname(SQLITE_PATH), exist_ok=True)
    conn = sqlite3.connect(SQLITE_PATH)
    conn.row_factory = sqlite3.Row
    IS_SQLITE = True
    setup_sqlite_schema(conn)
    return conn

def setup_sqlite_schema(conn):
    cur = conn.cursor()
    cur.execute("""
    CREATE TABLE IF NOT EXISTS payloads (
        id TEXT PRIMARY KEY,
        source_platform TEXT,
        source_group_id TEXT,
        source_group_name TEXT,
        source_message_id TEXT,
        source_sender_id TEXT,
        source_sender_name TEXT,
        original_message_text TEXT,
        original_timestamp TEXT,
        payload_checksum TEXT UNIQUE,
        original_image_references TEXT,
        do_object_key TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
    """)
    cur.execute("""
    CREATE TABLE IF NOT EXISTS payload_versions (
        id TEXT PRIMARY KEY,
        raw_payload_id TEXT,
        version_checksum TEXT UNIQUE,
        original_message_text TEXT,
        original_timestamp TEXT,
        original_image_references TEXT,
        do_object_key TEXT,
        attachment_metadata TEXT,
        media_fingerprint TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
    """)
    cur.execute("""
    CREATE TABLE IF NOT EXISTS processing_jobs (
        id TEXT PRIMARY KEY,
        raw_payload_id TEXT,
        payload_version_id TEXT,
        status TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
    """)
    cur.execute("""
    CREATE TABLE IF NOT EXISTS listings (
        id TEXT PRIMARY KEY,
        job_id TEXT,
        parent_id TEXT,
        bundle_position INTEGER,
        raw_message_text TEXT,
        category TEXT DEFAULT 'WATCH',
        intent TEXT,
        listing_type TEXT DEFAULT 'SINGLE',
        is_bundle INTEGER DEFAULT 0,
        brand_original TEXT,
        brand_normalized TEXT,
        model_original TEXT,
        model_normalized TEXT,
        reference_original TEXT,
        reference_normalized TEXT,
        dial_color_original TEXT,
        dial_color_normalized TEXT,
        dial_color_source TEXT DEFAULT 'parsed',
        price_original REAL,
        currency_original TEXT,
        price_normalized REAL,
        currency_normalized TEXT,
        price_usd REAL,
        conversion_rate REAL,
        reserve_price REAL,
        price_min REAL,
        price_max REAL,
        price_avg REAL,
        condition_original TEXT,
        condition_normalized TEXT,
        box_original TEXT,
        box_normalized TEXT,
        papers_original TEXT,
        papers_normalized TEXT,
        image_url TEXT,
        report_url TEXT,
        user_name TEXT,
        from_name TEXT,
        contact_number TEXT,
        from_number TEXT,
        phone_code TEXT,
        location TEXT,
        rating REAL,
        dealer_rating REAL,
        is_verified_user INTEGER DEFAULT 0,
        is_paid_user INTEGER DEFAULT 0,
        is_seller_approved INTEGER DEFAULT 0,
        company_id INTEGER,
        contact_consent INTEGER DEFAULT 0,
        catalog_confirmed INTEGER DEFAULT 0,
        overall_confidence REAL,
        provenance_metadata TEXT,
        verdict TEXT DEFAULT 'approved',
        normalization_status TEXT DEFAULT 'normalized',
        trading_floor_status TEXT DEFAULT 'published',
        price_research_status TEXT DEFAULT 'eligible',
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
    """)
    cur.execute("""
    CREATE TABLE IF NOT EXISTS reconciliation_ledger (
        id TEXT PRIMARY KEY,
        run_timestamp TEXT DEFAULT CURRENT_TIMESTAMP,
        raw_parents_count INTEGER DEFAULT 0,
        bundle_parents_count INTEGER DEFAULT 0,
        child_listings_count INTEGER DEFAULT 0,
        duplicates_count INTEGER DEFAULT 0,
        failed_jobs_count INTEGER DEFAULT 0,
        priced_count INTEGER DEFAULT 0,
        no_price_count INTEGER DEFAULT 0,
        watches_count INTEGER DEFAULT 0,
        non_watches_count INTEGER DEFAULT 0,
        pr_eligible_count INTEGER DEFAULT 0,
        pr_provisional_count INTEGER DEFAULT 0,
        pr_ineligible_count INTEGER DEFAULT 0,
        reconciliation_details TEXT,
        completed_at TEXT
    );
    """)
    try:
        cur.execute("ALTER TABLE listings ADD COLUMN provenance_metadata TEXT;")
    except Exception:
        pass
    conn.commit()

def db_execute(cur, query, args=None):
    if IS_SQLITE:
        query = query.replace("%s", "?")
    if args:
        cur.execute(query, args)
    else:
        cur.execute(query)

def generate_deterministic_uuid(namespace_str, key_str):
    ns = uuid.uuid5(uuid.NAMESPACE_DNS, namespace_str)
    return str(uuid.uuid5(ns, str(key_str)))

def compute_transport_checksum(source_platform, source_group_id, source_message_id):
    """Computes transport duplicate checksum based strictly on source platform, group, and message ID."""
    raw_str = f"{source_platform}:{source_group_id}:{source_message_id}"
    return hashlib.sha256(raw_str.encode('utf-8')).hexdigest()

def compute_repost_signature(sender_id, brand_normalized, reference_normalized, price_usd):
    """Computes repost/history signature based on seller, normalized item identity, and price."""
    raw_str = f"{sender_id}:{brand_normalized}:{reference_normalized}:{price_usd}"
    return hashlib.sha256(raw_str.encode('utf-8')).hexdigest()

def check_duplicate_payload(cur, checksum, current_payload_id, batch_seen_checksums):
    if checksum in batch_seen_checksums:
        return True
    payloads_table = "payloads" if IS_SQLITE else "raw.payloads"
    jobs_table = "processing_jobs" if IS_SQLITE else "jobs.processing_jobs"
    try:
        if IS_SQLITE:
            db_execute(cur, f"""
                SELECT 1 
                FROM {payloads_table} p 
                JOIN {jobs_table} j ON p.id = j.raw_payload_id 
                WHERE p.payload_checksum = %s 
                  AND p.id != %s 
                  AND j.status IN ('normalized', 'processing', 'extracted', 'validated', 'approved')
                LIMIT 1;
            """, (checksum, current_payload_id))
        else:
            db_execute(cur, f"""
                SELECT 1 
                FROM {payloads_table} p 
                JOIN {jobs_table} j ON p.id = j.raw_payload_id 
                WHERE p.payload_checksum = %s 
                  AND p.id != %s 
                  AND j.status::text IN ('normalized', 'processing', 'extracted', 'validated', 'approved')
                LIMIT 1;
            """, (checksum, current_payload_id))
        row = cur.fetchone()
        return bool(row)
    except Exception as e:
        print(f"Database error during duplicate check for payload checksum {checksum}: {e}")
        raise

def run_pipeline_step(limit=50):
    conn = get_db_connection()
    cur = conn.cursor()

    batch_seen_checksums = set()

    # Atomic CTE job claiming with FOR UPDATE SKIP LOCKED on PostgreSQL
    if IS_SQLITE:
        db_execute(cur, """
            SELECT j.id as job_id, p.id as payload_id, v.id as version_id,
                   COALESCE(v.original_message_text, p.original_message_text) as message_text,
                   p.source_sender_name as from_name, p.source_sender_id as from_number,
                   p.source_group_name as region, p.source_platform as type,
                   v.version_checksum, v.do_object_key, v.original_image_references,
                   v.attachment_metadata, v.media_fingerprint
            FROM processing_jobs j
            JOIN payloads p ON j.raw_payload_id = p.id
            LEFT JOIN payload_versions v ON j.payload_version_id = v.id
            WHERE j.status = 'received' OR j.status = 'queued'
            LIMIT %s;
        """, (limit,))
        raw_jobs = cur.fetchall()
        jobs = [dict(r) for r in raw_jobs]
        for j in jobs:
            db_execute(cur, "UPDATE processing_jobs SET status = 'processing' WHERE id = %s;", (j["job_id"],))
        conn.commit()
    else:
        db_execute(cur, """
            WITH target_jobs AS (
                SELECT j.id, j.raw_payload_id, j.payload_version_id
                FROM jobs.processing_jobs j
                WHERE j.status IN ('received'::jobs.processing_status, 'queued'::jobs.processing_status)
                ORDER BY j.created_at ASC
                FOR UPDATE OF j SKIP LOCKED
                LIMIT %s
            )
            UPDATE jobs.processing_jobs j
            SET status = 'processing'::jobs.processing_status,
                updated_at = NOW()
            FROM target_jobs t
            JOIN raw.payloads p ON t.raw_payload_id = p.id
            LEFT JOIN raw.payload_versions v ON t.payload_version_id = v.id
            WHERE j.id = t.id
            RETURNING j.id as job_id, p.id as payload_id, v.id as version_id,
                      COALESCE(v.original_message_text, p.original_message_text) as message_text,
                      p.source_sender_name as from_name, p.source_sender_id as from_number,
                      p.source_group_name as region, p.source_platform as type,
                      v.version_checksum, v.do_object_key, v.original_image_references,
                      v.attachment_metadata, v.media_fingerprint;
        """, (limit,))
        raw_jobs = cur.fetchall()
        jobs = []
        for r in raw_jobs:
            jobs.append({
                "job_id": r[0], "payload_id": r[1], "version_id": r[2], "message_text": r[3],
                "from_name": r[4], "from_number": r[5], "region": r[6], "type": r[7],
                "version_checksum": r[8], "do_object_key": r[9], "original_image_references": r[10],
                "attachment_metadata": r[11], "media_fingerprint": r[12]
            })
        conn.commit()

    if not jobs:
        conn.close()
        return 0

    processor = WatchFactsPipelineProcessor()

    for job in jobs:
        job_id = job["job_id"]
        payload_id = job["payload_id"]
        checksum = job.get("payload_checksum") or hashlib.sha256(job["message_text"].encode('utf-8')).hexdigest()

        orig_refs = job.get("original_image_references")
        if isinstance(orig_refs, str):
            try:
                orig_refs = json.loads(orig_refs)
            except Exception:
                orig_refs = [orig_refs]

        front_image = orig_refs[0] if orig_refs and isinstance(orig_refs, list) and len(orig_refs) > 0 else None

        job_data = {
            "id": job_id,
            "payload_id": payload_id,
            "version_id": job.get("version_id"),
            "message_text": job["message_text"],
            "type": "sale" if "sale" in str(job["type"]).lower() or "wts" in str(job["message_text"]).lower() else "buy",
            "from_name": job["from_name"],
            "from_number": job["from_number"],
            "region": job["region"],
            "dealer_rating": 5.0,
            "front_image": front_image,
            "original_image_references": orig_refs,
            "do_object_key": job.get("do_object_key"),
            "attachment_metadata": job.get("attachment_metadata"),
            "media_fingerprint": job.get("media_fingerprint"),
            "provenance": {
                "source_platform": job["type"],
                "source_region": job["region"],
                "payload_id": payload_id,
                "version_id": job.get("version_id")
            }
        }

        try:
            res = processor.process_job(job_data)
            
            is_exact_duplicate = check_duplicate_payload(cur, checksum, payload_id, batch_seen_checksums)
            batch_seen_checksums.add(checksum)
            if is_exact_duplicate:
                res["trading_floor_status"] = "suppressed_exact_duplicate"
            
            parent_uuid = generate_deterministic_uuid("watchfacts.listing.parent", job_id)
            listings_table = "listings" if IS_SQLITE else "staging.listings"
            
            parent_query = f"""
            INSERT INTO {listings_table} (
                id, job_id, parent_id, bundle_position, raw_message_text, category, intent, listing_type, is_bundle,
                brand_original, brand_normalized, model_original, model_normalized,
                reference_original, reference_normalized, dial_color_original, dial_color_normalized, dial_color_source,
                price_original, currency_original, price_normalized, currency_normalized, price_usd, conversion_rate,
                reserve_price, price_min, price_max, price_avg,
                condition_original, condition_normalized, box_original, box_normalized,
                papers_original, papers_normalized, image_url, report_url, user_name, from_name, contact_number, from_number,
                phone_code, location, rating, dealer_rating, is_verified_user, is_paid_user, is_seller_approved, company_id,
                contact_consent, catalog_confirmed, overall_confidence, provenance_metadata, verdict,
                normalization_status, trading_floor_status, price_research_status
            ) VALUES (
                %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s,
                %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s,
                %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s
            )
            """
            if IS_SQLITE:
                parent_query = parent_query.replace("%s", "?") + " ON CONFLICT(id) DO UPDATE SET raw_message_text = excluded.raw_message_text;"
            else:
                parent_query += " ON CONFLICT (id) DO UPDATE SET raw_message_text = EXCLUDED.raw_message_text, trading_floor_status = EXCLUDED.trading_floor_status, provenance_metadata = EXCLUDED.provenance_metadata;"

            def bool_val(v):
                return (1 if v else 0) if IS_SQLITE else bool(v)

            prov_json = json.dumps(res["provenance_metadata"])

            parent_args = (
                parent_uuid, job_id, None, None, res["raw_message_text"], res["category"], res["intent"], res["listing_type"],
                bool_val(res["is_bundle"]), res["brand_original"], res["brand_normalized"],
                res["model_original"], res["model_normalized"], res["reference_original"], res["reference_normalized"],
                res["dial_color_original"], res["dial_color_normalized"], res["dial_color_source"],
                res["price_original"], res["currency_original"], res["price_normalized"], res["currency_normalized"],
                res["price_usd"], res["conversion_rate"], res["reserve_price"], res["price_min"], res["price_max"], res["price_avg"],
                res["condition_original"], res["condition_normalized"], res["box_original"], res["box_normalized"],
                res["papers_original"], res["papers_normalized"], res["image_url"], res["report_url"],
                res["user_name"], res["from_name"], res["contact_number"], res["from_number"],
                res["phone_code"], res["location"], res["rating"], res["dealer_rating"],
                bool_val(res["is_verified_user"]), bool_val(res["is_paid_user"]), bool_val(res["is_seller_approved"]),
                res["company_id"], bool_val(res["contact_consent"]), bool_val(res["catalog_confirmed"]),
                res["overall_confidence"], prov_json, res["verdict"], res["normalization_status"],
                res["trading_floor_status"], res["price_research_status"]
            )
            db_execute(cur, parent_query, parent_args)

            for idx, child in enumerate(res.get("child_listings", [])):
                child_uuid = generate_deterministic_uuid("watchfacts.listing.child", f"{job_id}:{idx}")
                c_prov_json = json.dumps(child.get("provenance_metadata", {}))
                child_query = f"""
                INSERT INTO {listings_table} (
                    id, job_id, parent_id, bundle_position, raw_message_text, category, intent, listing_type, is_bundle,
                    brand_original, brand_normalized, model_original, model_normalized,
                    reference_original, reference_normalized, dial_color_original, dial_color_normalized, dial_color_source,
                    price_original, currency_original, price_normalized, currency_normalized, price_usd, conversion_rate,
                    reserve_price, price_min, price_max, price_avg,
                    condition_original, condition_normalized, box_original, box_normalized,
                    papers_original, papers_normalized, image_url, report_url, user_name, from_name, contact_number, from_number,
                    phone_code, location, rating, dealer_rating, is_verified_user, is_paid_user, is_seller_approved, company_id,
                    contact_consent, catalog_confirmed, overall_confidence, provenance_metadata, verdict,
                    normalization_status, trading_floor_status, price_research_status
                ) VALUES (
                    %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s,
                    %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s,
                    %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s
                )
                """
                if IS_SQLITE:
                    child_query = child_query.replace("%s", "?") + " ON CONFLICT(id) DO UPDATE SET raw_message_text = excluded.raw_message_text;"
                else:
                    child_query += " ON CONFLICT (id) DO UPDATE SET raw_message_text = EXCLUDED.raw_message_text, provenance_metadata = EXCLUDED.provenance_metadata;"

                child_args = (
                    child_uuid, job_id, parent_uuid, child["bundle_position"], child["raw_text_segment"], "WATCH", res["intent"],
                    child["listing_type"], bool_val(False), child["brand_normalized"], child["brand_normalized"],
                    None, None, child["reference_normalized"], child["reference_normalized"],
                    child["dial_color_normalized"], child["dial_color_normalized"], child["dial_color_source"],
                    child["price_normalized"], child["currency_normalized"], child["price_normalized"], child["currency_normalized"],
                    child["price_usd"], child["conversion_rate"], 0.0, 0.0, 0.0, 0.0,
                    child["condition_normalized"], child["condition_normalized"], child["box_normalized"], child["box_normalized"],
                    child["papers_normalized"], child["papers_normalized"], "", "",
                    res["user_name"], res["from_name"], res["contact_number"], res["from_number"],
                    res["phone_code"], res["location"], res["rating"], res["dealer_rating"],
                    bool_val(res["is_verified_user"]), bool_val(res["is_paid_user"]), bool_val(res["is_seller_approved"]),
                    res["company_id"], bool_val(False), bool_val(False),
                    child["overall_confidence"], c_prov_json, child["verdict"], child["normalization_status"],
                    child["trading_floor_status"], child["price_research_status"]
                )
                db_execute(cur, child_query, child_args)

            jobs_table = "processing_jobs" if IS_SQLITE else "jobs.processing_jobs"
            final_status = "normalized"
            if IS_SQLITE:
                db_execute(cur, f"UPDATE {jobs_table} SET status = %s WHERE id = %s;", (final_status, job_id))
            else:
                db_execute(cur, f"UPDATE {jobs_table} SET status = %s::jobs.processing_status, updated_at = NOW() WHERE id = %s;", (final_status, job_id))
            conn.commit()

        except Exception as e:
            conn.rollback()
            print(f"Error processing job ID {job_id}: {e}")
            jobs_table = "processing_jobs" if IS_SQLITE else "jobs.processing_jobs"
            if IS_SQLITE:
                db_execute(cur, f"UPDATE {jobs_table} SET status = %s WHERE id = %s;", ("failed", job_id))
            else:
                db_execute(cur, f"UPDATE {jobs_table} SET status = %s::jobs.processing_status, updated_at = NOW() WHERE id = %s;", ("failed", job_id))
            conn.commit()

    conn.close()
    return len(jobs)

def start_continuous_worker(poll_interval=2, once=False, require_postgres=False):
    global REQUIRE_POSTGRES
    if require_postgres:
        REQUIRE_POSTGRES = True
    print(f"WatchFacts Continuous Pipeline Worker starting up (Poll Interval: {poll_interval}s)...", flush=True)
    conn = get_db_connection()
    conn.close()
    if REQUIRE_POSTGRES and IS_SQLITE:
        raise RuntimeError("CRITICAL: PostgreSQL connection required, but pipeline runner fell back to SQLite!")
    count = 0
    while True:
        processed = run_pipeline_step(limit=100)
        count += processed
        if once:
            print(f"Single pass finished. Total processed: {count}")
            break
        if processed == 0:
            time.sleep(poll_interval)

if __name__ == "__main__":
    once_flag = "--once" in sys.argv
    req_pg_flag = "--require-postgres" in sys.argv
    start_continuous_worker(poll_interval=2, once=once_flag, require_postgres=req_pg_flag)

