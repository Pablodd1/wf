import json
import os
import psycopg2

PGHOST = "db.qnsafosakvonzgfcsphh.supabase.co"
PGPORT = "5432"
PGUSER = "pipeline_worker"
PGPASSWORD = "WatchFactsWorker2026!"
PGDATABASE = "postgres"

def load_canary_into_postgres():
    conn = psycopg2.connect(
        host=PGHOST, port=PGPORT, user=PGUSER, password=PGPASSWORD, dbname=PGDATABASE
    )
    cur = conn.cursor()
    
    print("1. Truncating pipeline tables on live Supabase Postgres...")
    cur.execute("TRUNCATE staging.listings, jobs.processing_jobs, raw.payloads RESTART IDENTITY CASCADE;")
    conn.commit()
    
    json_path = r"C:\Users\Owner\.gemini\antigravity\brain\aaaf9af1-6067-468b-bfc7-1bac307799f6\scratch\canary_json\raw_payloads.json"
    with open(json_path, "r", encoding="utf-8") as f:
        payloads = json.load(f)
        
    print(f"2. Inserting {len(payloads)} raw payloads into raw.payloads...")
    for p in payloads:
        cur.execute("""
            INSERT INTO raw.payloads (
                id, source_platform, source_group_id, source_group_name, 
                source_message_id, source_sender_id, source_sender_name, 
                original_message_text, original_timestamp, payload_checksum
            ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, NOW(), %s)
            ON CONFLICT (id) DO NOTHING;
        """, (
            p['id'], p['source_platform'], p['source_group_id'], p['source_group_name'],
            p['source_message_id'], p['source_sender_id'], p['source_sender_name'],
            p['original_message_text'], p['payload_checksum']
        ))
    conn.commit()
    
    print(f"3. Enqueuing {len(payloads)} jobs into jobs.processing_jobs (status = 'queued')...")
    for p in payloads:
        job_id = p['id']  # standard 1:1 mapping for canary
        cur.execute("""
            INSERT INTO jobs.processing_jobs (id, raw_payload_id, status, created_at, updated_at)
            VALUES (%s, %s, 'queued'::jobs.processing_status, NOW(), NOW())
            ON CONFLICT (id) DO NOTHING;
        """, (job_id, p['id']))
    conn.commit()
    
    cur.execute("SELECT count(*) FROM raw.payloads;")
    r_count = cur.fetchone()[0]
    cur.execute("SELECT count(*) FROM jobs.processing_jobs WHERE status = 'queued';")
    j_count = cur.fetchone()[0]
    cur.execute("SELECT count(*) FROM staging.listings;")
    l_count = cur.fetchone()[0]
    
    print(f"Verification after queuing:")
    print(f"  raw.payloads count: {r_count}")
    print(f"  jobs.processing_jobs queued count: {j_count}")
    print(f"  staging.listings count: {l_count}")
    
    conn.close()
    assert r_count == 500, f"Expected 500 payloads, got {r_count}"
    assert j_count == 500, f"Expected 500 queued jobs, got {j_count}"
    assert l_count == 0, f"Expected 0 listings, got {l_count}"
    print("SUCCESS: 500 raw payloads and 500 queued jobs enqueued in live PostgreSQL.")

if __name__ == "__main__":
    load_canary_into_postgres()
