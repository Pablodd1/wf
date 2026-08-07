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
        source_intent TEXT,
        payload_checksum TEXT UNIQUE,
        batch_id TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
    """)
    cur.execute("""
    CREATE TABLE IF NOT EXISTS payload_versions (
        id TEXT PRIMARY KEY,
        raw_payload_id TEXT,
        version_checksum TEXT UNIQUE,
        source_intent TEXT,
        original_message_text TEXT,
        original_timestamp TEXT,
        batch_id TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
    """)
    cur.execute("""
    CREATE TABLE IF NOT EXISTS processing_jobs (
        id TEXT PRIMARY KEY,
        raw_payload_id TEXT,
        payload_version_id TEXT,
        status TEXT,
        batch_id TEXT,
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
        transport_checksum TEXT,
        seller_item_signature TEXT,
        listing_event_signature TEXT,
        batch_id TEXT,
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
    for col in ["source_intent TEXT", "batch_id TEXT"]:
        try:
            cur.execute(f"ALTER TABLE payloads ADD COLUMN {col};")
        except Exception:
            pass
    for col in ["payload_version_id TEXT", "batch_id TEXT"]:
        try:
            cur.execute(f"ALTER TABLE processing_jobs ADD COLUMN {col};")
        except Exception:
            pass
    for col in ["provenance_metadata TEXT", "transport_checksum TEXT", "seller_item_signature TEXT", "listing_event_signature TEXT", "batch_id TEXT", "front_image TEXT", "image_urls TEXT", "has_exact_source_image INTEGER", "image_provenance TEXT", "storage_key TEXT", "attachment_keys TEXT", "mime_type TEXT", "media_fingerprint TEXT", "source_image_preserved INTEGER", "image_url_resolvable INTEGER", "visually_verified INTEGER", "first_posted_at TEXT", "reposted_at TEXT"]:
        try:
            cur.execute(f"ALTER TABLE listings ADD COLUMN {col};")
        except Exception:
            pass
    for col in ["front_image TEXT", "image_url TEXT", "image_urls TEXT", "has_exact_source_image INTEGER", "storage_key TEXT", "attachment_keys TEXT", "media_fingerprint TEXT"]:
        try:
            cur.execute(f"ALTER TABLE payloads ADD COLUMN {col};")
        except Exception:
            pass
        try:
            cur.execute(f"ALTER TABLE payload_versions ADD COLUMN {col};")
        except Exception:
            pass
    conn.commit()

def db_execute(cur, query, args=None):
    if IS_SQLITE or str(type(cur)).lower().find("sqlite") != -1:
        query = query.replace("%s", "?")
    if args:
        cur.execute(query, args)
    else:
        cur.execute(query)

def generate_deterministic_uuid(namespace_str, key_str):
    ns = uuid.uuid5(uuid.NAMESPACE_DNS, namespace_str)
    return str(uuid.uuid5(ns, str(key_str)))

def compute_transport_checksum(source_platform, source_group_id, source_message_id):
    """
    1. Transport message identity: platform + group + message_id.
    Never falls back to raw message text alone.
    """
    platform = str(source_platform or 'auction').strip()
    group = str(source_group_id or 'default_group').strip()
    msg_id = str(source_message_id or '').strip()
    if not msg_id:
        raise ValueError("Transport message ID or stable provider identifier is required for transport checksum computation.")
    raw_str = f"{platform}:{group}:{msg_id}"
    return hashlib.sha256(raw_str.encode('utf-8')).hexdigest()

def compute_seller_item_signature(seller_id, category, brand_normalized, reference_normalized):
    """
    2. Seller/item identity: seller + normalized category/brand/reference.
    """
    s_id = str(seller_id or 'unknown_seller').strip()
    cat = str(category or 'WATCH').strip()
    b = str(brand_normalized or 'OTHER').strip()
    r = str(reference_normalized or 'UNKNOWN').strip()
    raw_str = f"{s_id}:{cat}:{b}:{r}"
    return hashlib.sha256(raw_str.encode('utf-8')).hexdigest()

def compute_listing_event_signature(seller_item_sig, message_text, price_usd, currency, posting_timestamp, record_kind="parent", bundle_position=0):
    """
    Listing-event identity: seller/item identity + exact raw-message hash + price + currency + posting timestamp + record_kind + bundle_position.
    Ensures changed price, currency, timestamp, or message text remains a separate historical event,
    and identical items within a bundle do not collide with each other or the parent.
    """
    msg_hash = hashlib.sha256(str(message_text or '').encode('utf-8')).hexdigest()
    p_str = str(price_usd or 0)
    curr_str = str(currency or 'USD').upper().strip()
    ts_str = str(posting_timestamp or '')
    kind_str = str(record_kind or 'parent').lower().strip()
    pos_str = str(bundle_position or 0)
    
    raw_str = f"{seller_item_sig}:{msg_hash}:{p_str}:{curr_str}:{ts_str}:{kind_str}:{pos_str}"
    return hashlib.sha256(raw_str.encode('utf-8')).hexdigest()

def check_duplicate_payload(cur, checksum, current_payload_id, batch_seen_checksums):
    if checksum in batch_seen_checksums:
        return True
    is_sqlite = IS_SQLITE or "sqlite" in str(type(cur)).lower()
    payloads_table = "payloads" if is_sqlite else "raw.payloads"
    jobs_table = "processing_jobs" if is_sqlite else "jobs.processing_jobs"
    try:
        query = f"""
            SELECT 1 
            FROM {payloads_table} p 
            JOIN {jobs_table} j ON p.id = j.raw_payload_id 
            WHERE p.payload_checksum = %s 
              AND p.id != %s 
              AND j.status IN ('normalized', 'processing', 'extracted', 'validated', 'approved')
            LIMIT 1;
        """
        db_execute(cur, query, (checksum, current_payload_id))
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
            SELECT j.id as job_id, p.id as payload_id,
                   COALESCE(pv.original_message_text, p.original_message_text) as message_text,
                   p.source_sender_name as from_name, p.source_sender_id as from_number,
                   p.source_group_name as region,
                   COALESCE(pv.source_intent, p.source_platform) as type,
                   p.payload_checksum,
                   COALESCE(pv.original_timestamp, p.original_timestamp) as original_timestamp,
                   p.source_platform, p.source_group_id, p.source_message_id,
                   COALESCE(pv.batch_id, j.batch_id, p.batch_id) as batch_id,
                   COALESCE(pv.front_image, p.front_image) as front_image,
                   COALESCE(pv.image_url, p.image_url) as image_url,
                   COALESCE(pv.image_urls, p.image_urls) as image_urls,
                   COALESCE(pv.has_exact_source_image, p.has_exact_source_image) as has_exact_source_image
            FROM processing_jobs j
            JOIN payloads p ON j.raw_payload_id = p.id
            LEFT JOIN payload_versions pv ON j.payload_version_id = pv.id
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
                SELECT j.id, j.raw_payload_id, j.payload_version_id, j.batch_id
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
            LEFT JOIN raw.payload_versions pv ON t.payload_version_id = pv.id
            WHERE j.id = t.id
            RETURNING j.id as job_id, p.id as payload_id,
                      COALESCE(pv.original_message_text, p.original_message_text) as message_text,
                      p.source_sender_name as from_name, p.source_sender_id as from_number,
                      p.source_group_name as region,
                      COALESCE(pv.source_intent, p.source_platform) as type,
                      p.payload_checksum,
                      COALESCE(pv.original_timestamp, p.original_timestamp) as original_timestamp,
                      p.source_platform, p.source_group_id, p.source_message_id,
                      COALESCE(pv.batch_id, t.batch_id, p.batch_id) as batch_id,
                      COALESCE(pv.front_image, p.front_image) as front_image,
                      COALESCE(pv.image_url, p.image_url) as image_url,
                      COALESCE(pv.image_urls, p.image_urls) as image_urls,
                      COALESCE(pv.has_exact_source_image, p.has_exact_source_image) as has_exact_source_image;
        """, (limit,))
        raw_jobs = cur.fetchall()
        jobs = []
        for r in raw_jobs:
            jobs.append({
                "job_id": r[0], "payload_id": r[1], "message_text": r[2],
                "from_name": r[3], "from_number": r[4], "region": r[5], "type": r[6],
                "payload_checksum": r[7], "original_timestamp": r[8],
                "source_platform": r[9], "source_group_id": r[10], "source_message_id": r[11],
                "batch_id": r[12] if len(r) > 12 else None,
                "front_image": r[13] if len(r) > 13 else None,
                "image_url": r[14] if len(r) > 14 else None,
                "image_urls": r[15] if len(r) > 15 else None,
                "has_exact_source_image": r[16] if len(r) > 16 else None
            })
        conn.commit()

    if not jobs:
        conn.close()
        return 0

    processor = WatchFactsPipelineProcessor()

    for job in jobs:
        job_id = job["job_id"]
        payload_id = job["payload_id"]
        batch_id_val = job.get("batch_id")
        checksum = job.get("payload_checksum") or compute_transport_checksum(job.get("source_platform"), job.get("source_group_id"), job.get("source_message_id"))

        job_data = {
            "id": job_id,
            "message_text": job["message_text"],
            "type": "buy" if str(job.get("type", "")).lower() in ("buy", "wtb") else "sale",
            "from_name": job["from_name"],
            "from_number": job["from_number"],
            "region": job["region"]
        }

        try:
            res = processor.process_job(job_data)
            
            front_img = job.get("front_image")
            img_url = job.get("image_url") or (f"https://thecollective-inventory.sfo3.cdn.digitaloceanspaces.com/auctions/{front_img.lstrip('/')}" if front_img else None)
            img_urls = job.get("image_urls") if isinstance(job.get("image_urls"), str) else json.dumps(job.get("image_urls") or ([img_url] if img_url else []))
            has_exact = bool(job.get("has_exact_source_image") or img_url or front_img)

            res["front_image"] = front_img
            res["image_url"] = img_url or res.get("image_url")
            res["image_urls"] = img_urls
            res["has_exact_source_image"] = has_exact

            is_exact_duplicate = check_duplicate_payload(cur, checksum, payload_id, batch_seen_checksums)
            batch_seen_checksums.add(checksum)
            if is_exact_duplicate:
                res["trading_floor_status"] = "suppressed_exact_duplicate"
                res["price_research_status"] = "SUPPRESSED_EXACT_DUPLICATE"
            elif res.get("is_bundle"):
                res["trading_floor_status"] = "bundle_pending_separation"
                res["price_research_status"] = "BUNDLE_PENDING_SEPARATION"
                res["child_listings"] = []

            seller_id = res.get("contact_number") or res.get("from_number") or res.get("user_name") or res.get("from_name") or "unknown_seller"
            posting_ts = job.get("original_timestamp") or job.get("created_at") or datetime.utcnow().isoformat() + "Z"
            
            p_seller_item_sig = compute_seller_item_signature(seller_id, res["category"], res["brand_normalized"], res["reference_normalized"])
            p_listing_event_sig = compute_listing_event_signature(p_seller_item_sig, res["raw_message_text"], res["price_usd"], res["currency_normalized"], posting_ts, "parent", 0)

            parent_uuid = generate_deterministic_uuid("watchfacts.listing.parent", p_listing_event_sig)
            listings_table = "listings" if IS_SQLITE else "staging.listings"
            
            # Check for reposts by same seller & reference
            first_posted_at = posting_ts
            reposted_at = None
            if not is_exact_duplicate and res["category"] == "WATCH" and res["brand_normalized"] and res["reference_normalized"]:
                try:
                    check_repost_query = f"SELECT id, created_at, first_posted_at FROM {listings_table} WHERE seller_item_signature = %s AND id != %s ORDER BY created_at ASC;"
                    db_execute(cur, check_repost_query, (p_seller_item_sig, parent_uuid))
                    prior_reposts = cur.fetchall()
                    if prior_reposts:
                        reposted_at = posting_ts
                        row_dict = dict(prior_reposts[0])
                        first_posted_at = row_dict.get("first_posted_at") or row_dict.get("created_at") or posting_ts
                        # Suppress prior reposts for this seller/item signature
                        suppress_query = f"UPDATE {listings_table} SET trading_floor_status = 'suppressed_repost', price_research_status = 'SUPPRESSED_REPOST' WHERE seller_item_signature = %s AND id != %s;"
                        db_execute(cur, suppress_query, (p_seller_item_sig, parent_uuid))
                except Exception as e:
                    print(f"Warning during repost check: {e}")

            storage_key_val = str(job.get("storage_key") or front_img or '').strip() or None
            attachment_keys_val = job.get("attachment_keys") if isinstance(job.get("attachment_keys"), str) else json.dumps(job.get("attachment_keys") or [])
            mime_type_val = job.get("mime_type") or ("image/jpeg" if front_img else None)
            media_fp = hashlib.sha256(f"{front_img or ''}:{attachment_keys_val}".encode('utf-8')).hexdigest()
            source_img_preserved = bool(front_img or img_url)
            img_resolvable = bool(img_url)
            visually_verified = False

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
                normalization_status, trading_floor_status, price_research_status,
                transport_checksum, seller_item_signature, listing_event_signature, batch_id,
                front_image, image_urls, has_exact_source_image, image_provenance,
                storage_key, attachment_keys, mime_type, media_fingerprint,
                source_image_preserved, image_url_resolvable, visually_verified,
                first_posted_at, reposted_at
            ) VALUES (
                %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s,
                %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s,
                %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s,
                %s, %s, %s, %s, %s, %s, %s, %s,
                %s, %s, %s, %s, %s, %s, %s, %s, %s
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
                res["trading_floor_status"], res["price_research_status"],
                checksum, p_seller_item_sig, p_listing_event_sig, batch_id_val,
                res["front_image"], res["image_urls"], bool_val(res["has_exact_source_image"]), "exact_source",
                storage_key_val, attachment_keys_val, mime_type_val, media_fp,
                bool_val(source_img_preserved), bool_val(img_resolvable), bool_val(visually_verified),
                first_posted_at, reposted_at
            )
            db_execute(cur, parent_query, parent_args)

            for idx, child in enumerate(res.get("child_listings", [])):
                c_seller_item_sig = compute_seller_item_signature(seller_id, "WATCH", child["brand_normalized"], child["reference_normalized"])
                c_listing_event_sig = compute_listing_event_signature(c_seller_item_sig, child["raw_text_segment"], child["price_usd"], child["currency_normalized"], posting_ts, "child", idx)
                child_uuid = generate_deterministic_uuid("watchfacts.listing.child", c_listing_event_sig)
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
                    normalization_status, trading_floor_status, price_research_status,
                    transport_checksum, seller_item_signature, listing_event_signature, batch_id
                ) VALUES (
                    %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s,
                    %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s,
                    %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s,
                    %s, %s, %s, %s
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
                    child["trading_floor_status"], child["price_research_status"],
                    checksum, c_seller_item_sig, c_listing_event_sig, batch_id_val
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

