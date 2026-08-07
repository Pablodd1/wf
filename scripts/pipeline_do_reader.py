#!/usr/bin/env python3
"""
WatchFacts Ingestion Pipeline - DigitalOcean & MySQL Reader Daemon
Polls raw listing payloads from DigitalOcean Spaces / MySQL source,
creates immutable payload logs in `raw.payloads`, and enqueues jobs into `jobs.processing_jobs`.
"""

import os
import sys
import json
import uuid
import hashlib
import pymysql
import psycopg2
from datetime import datetime

# Environment-driven credentials (NO HARDCODED SECRETS)
MYSQL_HOST = os.environ.get("MYSQL_HOST", "161.35.0.209")
MYSQL_PORT = int(os.environ.get("MYSQL_PORT", "3306"))
MYSQL_USER = os.environ.get("MYSQL_USER", "john")
MYSQL_PASS = os.environ.get("MYSQL_PASS")
MYSQL_DB   = os.environ.get("MYSQL_DB", "thecollective_inventory")

DATABASE_URL = os.environ.get("DATABASE_URL") or os.environ.get("SUPABASE_URL")
PGHOST = os.environ.get("PGHOST", "db.qnsafosakvonzgfcsphh.supabase.co")
PGPORT = os.environ.get("PGPORT", "5432")
PGUSER = os.environ.get("PGUSER", "postgres")
PGPASSWORD = os.environ.get("PGPASSWORD")
PGDATABASE = os.environ.get("PGDATABASE", "postgres")

IS_SQLITE = False
SQLITE_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "scratch", "pipeline_fallback.db")

def get_target_db():
    global IS_SQLITE
    if DATABASE_URL and DATABASE_URL.startswith("postgresql://"):
        try:
            return (psycopg2.connect(DATABASE_URL), False)
        except Exception:
            pass
    if PGPASSWORD:
        try:
            conn = psycopg2.connect(
                host=PGHOST, port=PGPORT, user=PGUSER, password=PGPASSWORD,
                dbname=PGDATABASE, connect_timeout=5
            )
            return (conn, False)
        except Exception:
            pass
    import sqlite3
    os.makedirs(os.path.dirname(SQLITE_PATH), exist_ok=True)
    conn = sqlite3.connect(SQLITE_PATH)
    conn.row_factory = sqlite3.Row
    return (conn, True)

def calculate_checksum(source_platform, source_group_id, source_message_id):
    platform = str(source_platform or 'auction').strip()
    group = str(source_group_id or 'default_group').strip()
    msg_id = str(source_message_id or '').strip()
    if not msg_id:
        raise ValueError("Transport message ID or stable provider identifier is required for payload checksum computation.")
    raw_str = f"{platform}:{group}:{msg_id}"
    return hashlib.sha256(raw_str.encode('utf-8')).hexdigest()

def db_exec(cur, is_sqlite, query, args=None):
    if is_sqlite:
        query = query.replace("%s", "?")
    if args:
        cur.execute(query, args)
    else:
        cur.execute(query)

def fetch_and_enqueue_source_messages(batch_size=100):
    """
    Polls source MySQL auctions, inserts into raw.payloads and enqueues jobs in jobs.processing_jobs.
    """
    print(f"Polling up to {batch_size} source records from MySQL...")
    try:
        conn_src = pymysql.connect(
            host=MYSQL_HOST, port=MYSQL_PORT, user=MYSQL_USER, password=MYSQL_PASS,
            database=MYSQL_DB, connect_timeout=15, charset='utf8mb4'
        )
        cursor_src = conn_src.cursor(pymysql.cursors.DictCursor)
        cursor_src.execute("""
            SELECT a.id, a.title, a.description, a.front_image, a.type, a.comments,
                   a.from_name, a.from_number, a.phone_code, a.region, a.created_on
            FROM auctions a
            WHERE (a.description IS NOT NULL AND a.description != '')
               OR (a.title IS NOT NULL AND a.title != '')
            ORDER BY a.id DESC
            LIMIT %s;
        """, (batch_size,))
        rows = cursor_src.fetchall()
        conn_src.close()
    except Exception as e:
        print(f"Error connecting to source MySQL: {e}")
        return 0

    if not rows:
        print("No source messages found.")
        return 0

    return process_source_records(rows)

def process_source_records(rows, batch_id=None):
    conn_tgt, is_sqlite = get_target_db()
    cur_tgt = conn_tgt.cursor()

    enqueued_count = 0
    payload_table = "payloads" if is_sqlite else "raw.payloads"
    jobs_table = "processing_jobs" if is_sqlite else "jobs.processing_jobs"

    run_batch_id = batch_id or f"batch_{datetime.utcnow().strftime('%Y%m%d_%H%M%S')}"

    for r in rows:
        msg_text = r.get('description') or r.get('title') or r.get('comments') or r.get('message') or ''
        if not msg_text.strip():
            continue

        source_msg_id = str(r['id'])
        platform_val = 'mysql_thecollective'
        group_val = str(r.get('source_group_id') or r.get('channel_id') or 'auctions')
        source_intent_val = str(r.get('type') or 'sale').lower().strip()
        batch_id_val = run_batch_id
        orig_ts = str(r['created_on']) if r.get('created_on') else datetime.utcnow().isoformat() + "Z"
        
        checksum = calculate_checksum(platform_val, group_val, source_msg_id)
        
        front_image_val = str(r.get('front_image') or '').strip() or None
        if front_image_val:
            if front_image_val.startswith('http://') or front_image_val.startswith('https://'):
                image_url_val = front_image_val
            else:
                clean_path = front_image_val.lstrip('/')
                image_url_val = f"https://thecollective-inventory.sfo3.cdn.digitaloceanspaces.com/auctions/{clean_path}"
            image_urls_val = json.dumps([image_url_val])
            has_exact_source_image_val = True
        else:
            image_url_val = None
            image_urls_val = json.dumps([])
            has_exact_source_image_val = False

        image_fingerprint = hashlib.sha256((front_image_val or '').encode('utf-8')).hexdigest()
        content_hash = hashlib.sha256(f"{msg_text}:{orig_ts}:{image_fingerprint}".encode('utf-8')).hexdigest()
        version_checksum = hashlib.sha256(f"{checksum}:{content_hash}".encode('utf-8')).hexdigest()
        
        payload_id = str(uuid.uuid5(uuid.NAMESPACE_DNS, f"watchfacts.payload.{checksum}"))
        payload_version_id = str(uuid.uuid5(uuid.NAMESPACE_DNS, f"watchfacts.payload_version.{version_checksum}"))
        job_id = str(uuid.uuid5(uuid.NAMESPACE_DNS, f"watchfacts.job.{version_checksum}"))

        versions_table = "payload_versions" if is_sqlite else "raw.payload_versions"
        if is_sqlite:
            cur_tgt.execute(f"""
            INSERT OR IGNORE INTO {payload_table} (
                id, source_platform, source_group_id, source_group_name, source_message_id,
                source_sender_id, source_sender_name, source_intent, payload_checksum, batch_id,
                front_image, image_url, image_urls, has_exact_source_image
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);
            """, (
                payload_id, platform_val, group_val, r.get('region'),
                source_msg_id, r.get('from_number'), r.get('from_name'), source_intent_val, checksum, batch_id_val,
                front_image_val, image_url_val, image_urls_val, 1 if has_exact_source_image_val else 0
            ))

            cur_tgt.execute(f"""
            INSERT OR IGNORE INTO {versions_table} (
                id, raw_payload_id, version_checksum, source_intent, original_message_text, original_timestamp, batch_id,
                front_image, image_url, image_urls, has_exact_source_image
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);
            """, (
                payload_version_id, payload_id, version_checksum, source_intent_val, msg_text, orig_ts, batch_id_val,
                front_image_val, image_url_val, image_urls_val, 1 if has_exact_source_image_val else 0
            ))
            
            cur_tgt.execute(f"""
            INSERT OR IGNORE INTO {jobs_table} (id, raw_payload_id, payload_version_id, status, batch_id)
            VALUES (?, ?, ?, 'queued', ?);
            """, (job_id, payload_id, payload_version_id, batch_id_val))
        else:
            cur_tgt.execute(f"""
            INSERT INTO {payload_table} (
                id, source_platform, source_group_id, source_group_name, source_message_id,
                source_sender_id, source_sender_name, source_intent, payload_checksum, batch_id,
                front_image, image_url, image_urls, has_exact_source_image
            ) VALUES (
                %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s
            ) ON CONFLICT (payload_checksum) DO NOTHING;
            """, (
                payload_id, platform_val, group_val, r.get('region'),
                source_msg_id, r.get('from_number'), r.get('from_name'), source_intent_val, checksum, batch_id_val,
                front_image_val, image_url_val, image_urls_val, has_exact_source_image_val
            ))

            cur_tgt.execute(f"""
            INSERT INTO {versions_table} (
                id, raw_payload_id, version_checksum, source_intent, original_message_text, original_timestamp, batch_id,
                front_image, image_url, image_urls, has_exact_source_image
            ) VALUES (
                %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s
            ) ON CONFLICT (version_checksum) DO NOTHING;
            """, (
                payload_version_id, payload_id, version_checksum, source_intent_val, msg_text, orig_ts, batch_id_val,
                front_image_val, image_url_val, image_urls_val, has_exact_source_image_val
            ))

            cur_tgt.execute(f"""
            INSERT INTO {jobs_table} (id, raw_payload_id, payload_version_id, status, batch_id)
            VALUES (%s, %s, %s, 'queued'::jobs.processing_status, %s)
            ON CONFLICT (id) DO NOTHING;
            """, (job_id, payload_id, payload_version_id, batch_id_val))

        enqueued_count += 1

    conn_tgt.commit()
    conn_tgt.close()
    print(f"Successfully enqueued {enqueued_count} payloads into {jobs_table}.")
    return enqueued_count

if __name__ == "__main__":
    fetch_and_enqueue_source_messages(batch_size=100)
