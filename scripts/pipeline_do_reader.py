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

def calculate_checksum(text):
    return hashlib.sha256(text.encode('utf-8', errors='ignore')).hexdigest()

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

    received_count = len(rows)
    versions_inserted_count = 0
    jobs_inserted_count = 0
    suppressed_count = 0

    conn_tgt, is_sqlite = get_target_db()
    cur_tgt = conn_tgt.cursor()

    payload_table = "payloads" if is_sqlite else "raw.payloads"
    versions_table = "payload_versions" if is_sqlite else "raw.payload_versions"
    jobs_table = "processing_jobs" if is_sqlite else "jobs.processing_jobs"

    for r in rows:
        msg_text = r['description'] or r['title'] or r['comments'] or ''
        if not msg_text.strip():
            suppressed_count += 1
            continue

        source_platform = r.get('type') or 'auction'
        source_group_id = str(r.get('region') or 'default')
        source_msg_id = str(r['id'])

        raw_img = str(r.get('front_image') or '').strip()
        if raw_img.lower() in ('0', 'none', 'null', ''):
            raw_img = ''

        orig_img_refs = [raw_img] if raw_img else []

        # Extract normalized DO object key (only if not an http URL and not invalid)
        if raw_img and not raw_img.lower().startswith('http') and not any(c in raw_img for c in ('..', '/', '\\')):
            do_object_key = raw_img
        else:
            do_object_key = None

        media_fingerprint = hashlib.sha256(raw_img.encode('utf-8')).hexdigest() if raw_img else "no_media"
        orig_ts = str(r['created_on']) if r.get('created_on') else datetime.utcnow().isoformat() + "Z"

        # Stable payload envelope identity (1 row per source message)
        payload_id = str(uuid.uuid5(uuid.NAMESPACE_DNS, f"watchfacts.payload.{source_platform}.{source_group_id}.{source_msg_id}"))
        payload_checksum = hashlib.sha256(f"{source_platform}:{source_group_id}:{source_msg_id}".encode('utf-8')).hexdigest()

        # Immutable version identity (1 row per content version)
        version_material = f"{source_platform}:{source_group_id}:{source_msg_id}:{msg_text}:{media_fingerprint}"
        version_checksum = hashlib.sha256(version_material.encode('utf-8')).hexdigest()
        version_id = str(uuid.uuid5(uuid.NAMESPACE_DNS, f"watchfacts.version.{version_checksum}"))
        job_id = str(uuid.uuid5(uuid.NAMESPACE_DNS, f"watchfacts.job.{version_checksum}"))

        if is_sqlite:
            # 1. Envelope
            cur_tgt.execute(f"""
                INSERT OR IGNORE INTO {payload_table} (
                    id, source_platform, source_group_id, source_group_name, source_message_id,
                    source_sender_id, source_sender_name, original_message_text, original_timestamp, payload_checksum,
                    original_image_references, do_object_key
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);
            """, (
                payload_id, source_platform, source_group_id, r.get('region'),
                source_msg_id, r.get('from_number'), r.get('from_name'), msg_text, orig_ts, payload_checksum,
                json.dumps(orig_img_refs), do_object_key
            ))

            # 2. Version
            cur_tgt.execute(f"""
                INSERT OR IGNORE INTO {versions_table} (
                    id, raw_payload_id, version_checksum, original_message_text, original_timestamp,
                    original_image_references, do_object_key, media_fingerprint
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?);
            """, (
                version_id, payload_id, version_checksum, msg_text, orig_ts,
                json.dumps(orig_img_refs), do_object_key, media_fingerprint
            ))
            if cur_tgt.rowcount > 0:
                versions_inserted_count += 1
                # 3. Job (only on new version)
                cur_tgt.execute(f"""
                    INSERT OR IGNORE INTO {jobs_table} (id, raw_payload_id, payload_version_id, status)
                    VALUES (?, ?, ?, 'queued');
                """, (job_id, payload_id, version_id))
                if cur_tgt.rowcount > 0:
                    jobs_inserted_count += 1
            else:
                suppressed_count += 1

        else:
            # 1. Envelope (PostgreSQL)
            cur_tgt.execute(f"""
                INSERT INTO {payload_table} (
                    id, source_platform, source_group_id, source_group_name, source_message_id,
                    source_sender_id, source_sender_name, original_message_text, original_timestamp, payload_checksum,
                    original_image_references, do_object_key
                ) VALUES (
                    %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s
                ) ON CONFLICT (source_platform, source_group_id, source_message_id) DO UPDATE
                SET original_message_text = EXCLUDED.original_message_text
                RETURNING id;
            """, (
                payload_id, source_platform, source_group_id, r.get('region'),
                source_msg_id, r.get('from_number'), r.get('from_name'), msg_text, orig_ts, payload_checksum,
                orig_img_refs, do_object_key
            ))
            res = cur_tgt.fetchone()
            actual_payload_id = res[0] if res else payload_id

            # 2. Version (PostgreSQL)
            cur_tgt.execute(f"""
                INSERT INTO {versions_table} (
                    id, raw_payload_id, version_checksum, original_message_text, original_timestamp,
                    original_image_references, do_object_key, media_fingerprint
                ) VALUES (
                    %s, %s, %s, %s, %s, %s, %s, %s
                ) ON CONFLICT (version_checksum) DO NOTHING
                RETURNING id;
            """, (
                version_id, actual_payload_id, version_checksum, msg_text, orig_ts,
                orig_img_refs, do_object_key, media_fingerprint
            ))
            v_res = cur_tgt.fetchone()

            if v_res:
                versions_inserted_count += 1
                actual_version_id = v_res[0]
                # 3. Job (PostgreSQL - only on new version)
                cur_tgt.execute(f"""
                    INSERT INTO {jobs_table} (id, raw_payload_id, payload_version_id, status)
                    VALUES (%s, %s, %s, 'queued'::jobs.processing_status)
                    ON CONFLICT (id) DO NOTHING
                    RETURNING id;
                """, (job_id, actual_payload_id, actual_version_id))
                j_res = cur_tgt.fetchone()
                if j_res:
                    jobs_inserted_count += 1
            else:
                suppressed_count += 1

    conn_tgt.commit()
    conn_tgt.close()
    print(f"Reader Summary: received={received_count}, versions_inserted={versions_inserted_count}, jobs_inserted={jobs_inserted_count}, suppressed={suppressed_count}")
    return jobs_inserted_count

if __name__ == "__main__":
    fetch_and_enqueue_source_messages(batch_size=100)
