import os
import sys
import json
import uuid
import hashlib
import pymysql
import psycopg2
import psycopg2.extras
from datetime import datetime
import argparse
import time

# Environment-driven credentials
MYSQL_HOST = os.environ.get("MYSQL_HOST")
MYSQL_PORT = int(os.environ.get("MYSQL_PORT", "3306"))
MYSQL_USER = os.environ.get("MYSQL_USER")
MYSQL_PASS = os.environ.get("MYSQL_PASS")
MYSQL_DB   = os.environ.get("MYSQL_DB", "thecollective_inventory")

DATABASE_URL = os.environ.get("DATABASE_URL") or os.environ.get("SUPABASE_URL")
PGHOST = os.environ.get("PGHOST")
PGPORT = os.environ.get("PGPORT", "5432")
PGUSER = os.environ.get("PGUSER")
PGPASSWORD = os.environ.get("PGPASSWORD")
PGDATABASE = os.environ.get("PGDATABASE", "postgres")

def get_target_db():
    if DATABASE_URL and DATABASE_URL.startswith("postgresql://"):
        try:
            return psycopg2.connect(DATABASE_URL)
        except Exception:
            pass
    if PGPASSWORD:
        try:
            conn = psycopg2.connect(
                host=PGHOST, port=PGPORT, user=PGUSER, password=PGPASSWORD,
                dbname=PGDATABASE, connect_timeout=15
            )
            return conn
        except Exception as e:
            print(f"Postgres connection error: {e}")
            raise e
    raise Exception("No Postgres credentials")

def sanitize_text(text):
    if text is None:
        return ""
    return str(text).replace('\x00', '')

def fetch_and_enqueue_source_messages(batch_size=1000):
    conn_tgt = get_target_db()
    cur_tgt = conn_tgt.cursor()

    # 1. Active-Migration Locking
    cur_tgt.execute("SELECT pg_try_advisory_lock(9999);")
    locked = cur_tgt.fetchone()[0]
    if not locked:
        print("Another reader is already running (failed to acquire advisory lock).")
        conn_tgt.close()
        return -1

    # 2. Backpressure check
    cur_tgt.execute("SELECT count(*) FROM jobs.processing_jobs WHERE status IN ('queued', 'processing');")
    queue_depth = cur_tgt.fetchone()[0]
    if queue_depth > 25000:
        print(f"Queue depth is {queue_depth}. Pausing ingestion...")
        conn_tgt.close()
        return 0

    # 3. Retrieve or Initialize Migration State
    cur_tgt.execute("SELECT id, max_source_id, current_cursor FROM jobs.migration_state WHERE status = 'active' LIMIT 1")
    state = cur_tgt.fetchone()

    if not state:
        print("No active migration state found. Initializing...")
        try:
            conn_src = pymysql.connect(
                host=MYSQL_HOST, port=MYSQL_PORT, user=MYSQL_USER, password=MYSQL_PASS,
                database=MYSQL_DB, connect_timeout=15, charset='utf8mb4'
            )
            cursor_src = conn_src.cursor(pymysql.cursors.DictCursor)
            cursor_src.execute("SELECT COUNT(*) as max_id FROM auctions")
            max_id = cursor_src.fetchone()['max_id'] or 0
            conn_src.close()
            
            cur_tgt.execute(
                "INSERT INTO jobs.migration_state (max_source_id, current_cursor, status) VALUES (%s, %s, 'active') RETURNING id, max_source_id, current_cursor",
                (max_id, 0)
            )
            state = cur_tgt.fetchone()
            conn_tgt.commit()
            print(f"Initialized migration state: total_records={max_id}")
        except Exception as e:
            print(f"Error connecting to MySQL to init state: {e}")
            conn_tgt.close()
            return 0

    state_id, max_source_id, current_cursor = state

    if max_source_id > 0 and current_cursor >= max_source_id:
        print("Migration complete (cursor reached max_source_id).")
        cur_tgt.execute("UPDATE jobs.migration_state SET status = 'completed', completed_at = CURRENT_TIMESTAMP WHERE id = %s", (state_id,))
        conn_tgt.commit()
        conn_tgt.close()
        return -1

    print(f"Polling up to {batch_size} source records from MySQL (offset={current_cursor}, total={max_source_id})...")
    
    try:
        conn_src = pymysql.connect(
            host=MYSQL_HOST, port=MYSQL_PORT, user=MYSQL_USER, password=MYSQL_PASS,
            database=MYSQL_DB, connect_timeout=15, charset='utf8mb4'
        )
        cursor_src = conn_src.cursor(pymysql.cursors.DictCursor)
        # Offset Pagination
        cursor_src.execute("""
            SELECT a.id, a.title, a.description, a.front_image, a.type, a.comments,
                   a.from_name, a.from_number, a.phone_code, a.region, a.created_on
            FROM auctions a
            WHERE ((a.description IS NOT NULL AND a.description != '')
               OR (a.title IS NOT NULL AND a.title != ''))
            ORDER BY a.created_on DESC
            LIMIT %s OFFSET %s;
        """, (batch_size, current_cursor))
        rows = cursor_src.fetchall()
        conn_src.close()

    except Exception as e:
        print(f"Error connecting to source MySQL: {e}")
        conn_tgt.close()
        return 0

    received_count = len(rows)
    print(f"Received {received_count} raw records from MySQL...")
    if received_count == 0:
        print("No more records returned from MySQL.")
        cur_tgt.execute("UPDATE jobs.migration_state SET status = 'completed', completed_at = CURRENT_TIMESTAMP WHERE id = %s", (state_id,))
        conn_tgt.commit()
        conn_tgt.close()
        return -1

    payloads_data = []
    versions_data = []
    jobs_data = []
    skipped_count = 0

    for r in rows:
        msg_text = sanitize_text(r['description'] or r['title'] or r['comments'] or '')
        if not msg_text.strip():
            skipped_count += 1
            continue

        source_platform = r.get('type') or 'auction'
        source_group_id = str(r.get('region') or 'default')
        source_msg_id = str(r['id'])

        raw_img = str(r.get('front_image') or '').strip()
        if raw_img.lower() in ('0', 'none', 'null', ''):
            raw_img = ''

        orig_img_refs = [raw_img] if raw_img else []

        if raw_img and not raw_img.lower().startswith('http') and not any(c in raw_img for c in ('..', '/', '\\')):
            do_object_key = raw_img
        else:
            do_object_key = None

        media_fingerprint = hashlib.sha256(raw_img.encode('utf-8')).hexdigest() if raw_img else "no_media"
        orig_ts = str(r['created_on']) if r.get('created_on') else datetime.utcnow().isoformat() + "Z"

        payload_id = str(uuid.uuid5(uuid.NAMESPACE_DNS, f"watchfacts.payload.{source_platform}.{source_group_id}.{source_msg_id}"))
        payload_checksum = hashlib.sha256(f"{source_platform}:{source_group_id}:{source_msg_id}".encode('utf-8')).hexdigest()

        version_material = f"{source_platform}:{source_group_id}:{source_msg_id}:{msg_text}:{media_fingerprint}"
        version_checksum = hashlib.sha256(version_material.encode('utf-8')).hexdigest()
        version_id = str(uuid.uuid5(uuid.NAMESPACE_DNS, f"watchfacts.version.{version_checksum}"))
        job_id = str(uuid.uuid5(uuid.NAMESPACE_DNS, f"watchfacts.job.{version_checksum}"))

        payloads_data.append((
            payload_id, source_platform, source_group_id, r.get('region'),
            source_msg_id, sanitize_text(r.get('from_number')), sanitize_text(r.get('from_name')), msg_text, orig_ts, payload_checksum,
            orig_img_refs, do_object_key
        ))

        versions_data.append((
            version_id, payload_id, version_checksum, msg_text, orig_ts,
            orig_img_refs, do_object_key, media_fingerprint
        ))

        jobs_data.append((job_id, payload_id, version_id, 'queued'))

    if not payloads_data:
        # Move cursor forward
        new_cursor = current_cursor + received_count
        cur_tgt.execute(
            "UPDATE jobs.migration_state SET current_cursor = %s, received_count = received_count + %s, suppressed_count = suppressed_count + %s WHERE id = %s", 
            (new_cursor, received_count, skipped_count, state_id)
        )
        conn_tgt.commit()
        conn_tgt.close()
        return received_count

    try:
        psycopg2.extras.execute_values(
            cur_tgt,
            """
            INSERT INTO raw.payloads (
                id, source_platform, source_group_id, source_group_name, source_message_id,
                source_sender_id, source_sender_name, original_message_text, original_timestamp, payload_checksum,
                original_image_references, do_object_key
            ) VALUES %s
            ON CONFLICT (source_platform, source_group_id, source_message_id) DO UPDATE
            SET original_message_text = EXCLUDED.original_message_text
            """,
            payloads_data
        )

        psycopg2.extras.execute_values(
            cur_tgt,
            """
            INSERT INTO raw.payload_versions (
                id, raw_payload_id, version_checksum, original_message_text, original_timestamp,
                original_image_references, do_object_key, media_fingerprint
            ) VALUES %s
            ON CONFLICT (version_checksum) DO NOTHING
            """,
            versions_data
        )

        psycopg2.extras.execute_values(
            cur_tgt,
            """
            INSERT INTO jobs.processing_jobs (id, raw_payload_id, payload_version_id, status)
            VALUES %s
            ON CONFLICT (id) DO NOTHING
            """,
            jobs_data
        )

        new_cursor = current_cursor + received_count
        cur_tgt.execute(
            "UPDATE jobs.migration_state SET current_cursor = %s, received_count = received_count + %s, inserted_count = inserted_count + %s, suppressed_count = suppressed_count + %s, updated_at = CURRENT_TIMESTAMP WHERE id = %s",
            (new_cursor, received_count, len(payloads_data), skipped_count, state_id)
        )

        conn_tgt.commit()
        conn_tgt.close()
        
        print(f"Batch inserted. Updated cursor to {new_cursor}")

    except Exception as e:
        print(f"Error inserting to Postgres: {e}")
        conn_tgt.rollback()
        cur_tgt.execute("UPDATE jobs.migration_state SET failed_count = failed_count + %s WHERE id = %s", (received_count, state_id))
        conn_tgt.commit()
        conn_tgt.close()
        return 0

    return received_count

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="WatchFacts Historical Migration Reader")
    parser.add_argument("--canary", type=int, default=None, help="Process a fixed number of records and stop")
    parser.add_argument("--batch-size", type=int, default=1000, help="Batch size for polling MySQL")
    args = parser.parse_args()

    print("Starting continuous reader daemon...")
    processed_total = 0

    while True:
        try:
            batch_limit = args.batch_size
            if args.canary:
                remaining = args.canary - processed_total
                if remaining <= 0:
                    print(f"Canary limit of {args.canary} reached. Exiting.")
                    break
                batch_limit = min(batch_limit, remaining)

            received = fetch_and_enqueue_source_messages(batch_size=batch_limit)
            
            if received == -1:
                break # Locked or Completed
            
            if received > 0:
                processed_total += received
                time.sleep(0.1)
            else:
                time.sleep(10)
                
        except KeyboardInterrupt:
            print("Stopping...")
            break
