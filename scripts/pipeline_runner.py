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
PGHOST = os.environ.get("PGHOST")
PGPORT = os.environ.get("PGPORT", "5432")
PGUSER = os.environ.get("PGUSER")
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
    return False

def run_pipeline_step(limit=1000):
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
        # Step 1: Claim jobs quickly without joining large tables
        db_execute(cur, """
            WITH target_jobs AS (
                SELECT id, raw_payload_id, payload_version_id
                FROM jobs.processing_jobs
                WHERE status IN ('received'::jobs.processing_status, 'queued'::jobs.processing_status)
                ORDER BY created_at ASC
                FOR UPDATE SKIP LOCKED
                LIMIT %s
            )
            UPDATE jobs.processing_jobs j
            SET status = 'processing'::jobs.processing_status,
                updated_at = NOW()
            FROM target_jobs t
            WHERE j.id = t.id
            RETURNING j.id as job_id, t.raw_payload_id, t.payload_version_id;
        """, (limit,))
        claimed_jobs = cur.fetchall()
        
        jobs = []
        if claimed_jobs:
            version_ids = [r[2] for r in claimed_jobs if r[2]]
            
            # Step 2: Fetch exact payload and version details using version_id
            db_execute(cur, """
                SELECT v.id as version_id, p.id as payload_id,
                       COALESCE(v.original_message_text, p.original_message_text) as message_text,
                       p.source_sender_name as from_name, p.source_sender_id as from_number,
                       p.source_group_name as region, p.source_platform as type,
                       v.version_checksum, v.do_object_key, v.original_image_references,
                       v.attachment_metadata, v.media_fingerprint
                FROM raw.payload_versions v
                JOIN raw.payloads p ON v.raw_payload_id = p.id
                WHERE v.id = ANY(%s::uuid[])
            """, (version_ids,))
            
            version_details = {r[0]: r for r in cur.fetchall()}
            missing_version_job_ids = []
            
            for r in claimed_jobs:
                v_details = version_details.get(r[2])
                if not v_details:
                    missing_version_job_ids.append(r[0])
                    continue
                jobs.append({
                    "job_id": r[0], "payload_id": v_details[1], "version_id": v_details[0], "message_text": v_details[2],
                    "from_name": v_details[3], "from_number": v_details[4], "region": v_details[5], "type": v_details[6],
                    "version_checksum": v_details[7], "do_object_key": v_details[8], "original_image_references": v_details[9],
                    "attachment_metadata": v_details[10], "media_fingerprint": v_details[11]
                })

            if missing_version_job_ids:
                if IS_SQLITE:
                    for jid in missing_version_job_ids:
                        db_execute(cur, f"UPDATE processing_jobs SET status = 'failed' WHERE id = %s;", (jid,))
                else:
                    cur.execute(f"UPDATE jobs.processing_jobs SET status = 'failed'::jobs.processing_status, updated_at = NOW() WHERE id = ANY(%s::uuid[]);", (list(missing_version_job_ids),))

        conn.commit()
        
    conn.close()

    if not jobs:
        return 0

    processor = WatchFactsPipelineProcessor()
    
    parent_records = []
    child_records = []
    job_record_map = {} # job_id -> list of record tuples
    successful_job_ids = []
    failed_job_ids = []

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
            "dealer_rating": job.get("dealer_rating") or job.get("rating"),
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
            
            p_rec = (
                res["id"], res["job_id"], None, 0, res["raw_message_text"], res["category"], res["intent"], res["listing_type"], res["is_bundle"],
                res["brand_original"], res["brand_normalized"], res["model_original"], res["model_normalized"],
                res["reference_original"], res["reference_normalized"], res["dial_color_original"], res["dial_color_normalized"], res["dial_color_source"],
                res["price_original"], res["currency_original"], res["price_normalized"], res["currency_normalized"], res["price_usd"], res["conversion_rate"],
                res["reserve_price"], res["price_min"], res["price_max"], res["price_avg"],
                res["condition_original"], res["condition_normalized"], res["box_original"], res["box_normalized"],
                res["papers_original"], res["papers_normalized"], res["image_url"], res["report_url"], res["user_name"], res["from_name"], res["contact_number"], res["from_number"],
                res["phone_code"], res["location"], res["rating"], res["dealer_rating"], res["is_verified_user"], res["is_paid_user"], res["is_seller_approved"], res["company_id"],
                res["contact_consent"], res["catalog_confirmed"], res["overall_confidence"], json.dumps(res["provenance_metadata"]), res["verdict"],
                res["normalization_status"], res["trading_floor_status"], res["price_research_status"]
            )
            parent_records.append(p_rec)
            job_record_map[job_id] = [p_rec]
            successful_job_ids.append(job_id)
        except Exception as e:
            print(f"Error processing job ID {job_id}: {e}")
            failed_job_ids.append(job_id)

    # Batch Database Insertion with Bounded Sub-batches / Poison Job Isolation
    conn = get_db_connection()
    cur = conn.cursor()
    listings_table = "listings" if IS_SQLITE else "staging.listings"
    jobs_table = "processing_jobs" if IS_SQLITE else "jobs.processing_jobs"
    
    insert_query = f"""
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
        ) VALUES %s
    """
    if IS_SQLITE:
        insert_query += " ON CONFLICT(id) DO UPDATE SET raw_message_text = excluded.raw_message_text;"
    else:
        insert_query += """ ON CONFLICT (id) DO UPDATE SET 
            raw_message_text = EXCLUDED.raw_message_text,
            brand_normalized = EXCLUDED.brand_normalized,
            reference_normalized = EXCLUDED.reference_normalized,
            dial_color_normalized = EXCLUDED.dial_color_normalized,
            price_normalized = EXCLUDED.price_normalized,
            currency_normalized = EXCLUDED.currency_normalized,
            price_usd = EXCLUDED.price_usd,
            conversion_rate = EXCLUDED.conversion_rate,
            image_url = EXCLUDED.image_url,
            from_name = EXCLUDED.from_name,
            from_number = EXCLUDED.from_number,
            dealer_rating = EXCLUDED.dealer_rating,
            trading_floor_status = EXCLUDED.trading_floor_status,
            price_research_status = EXCLUDED.price_research_status,
            provenance_metadata = EXCLUDED.provenance_metadata;
        """
        # If batch insert fails, we mark all as failed to prevent poison pills from blocking the queue
        if failed_job_ids or successful_job_ids:
            try:
                new_conn = get_db_connection()
                new_cur = new_conn.cursor()
                all_ids = failed_job_ids + successful_job_ids
                if IS_SQLITE:
                    for jid in all_ids:
                        db_execute(new_cur, f"UPDATE {jobs_table} SET status = 'failed' WHERE id = %s;", (jid,))
                else:
                    new_cur.execute(f"UPDATE {jobs_table} SET status = 'failed'::jobs.processing_status, updated_at = NOW() WHERE id = ANY(%s::uuid[]);", (list(all_ids),))
                new_conn.commit()
                new_conn.close()
            except Exception as inner_e:
                print(f"Failed to even mark jobs as failed: {inner_e}")

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
        try:
            processed = run_pipeline_step(limit=1000)
            count += processed
        except Exception as e:
            print(f"Pipeline loop encountered an error: {e}. Retrying in {poll_interval}s...")
            processed = 0
        
        if once:
            print(f"Single pass finished. Total processed: {count}")
            break
        if processed == 0:
            time.sleep(poll_interval)

if __name__ == "__main__":
    once_flag = "--once" in sys.argv
    req_pg_flag = "--require-postgres" in sys.argv
    start_continuous_worker(poll_interval=2, once=once_flag, require_postgres=req_pg_flag)

