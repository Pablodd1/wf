import os
import psycopg2

PGHOST = "db.qnsafosakvonzgfcsphh.supabase.co"
PGPORT = "5432"
PGUSER = "pipeline_worker"
PGPASSWORD = "WatchFactsWorker2026!"
PGDATABASE = "postgres"

def load_chunks():
    conn = psycopg2.connect(
        host=PGHOST, port=PGPORT, user=PGUSER, password=PGPASSWORD, dbname=PGDATABASE
    )
    cur = conn.cursor()
    
    sql_dir = r"C:\Users\Owner\.gemini\antigravity\brain\aaaf9af1-6067-468b-bfc7-1bac307799f6\scratch\queued_canary_sql"
    
    print("Loading 500 payloads...")
    for i in range(1, 6):
        file_path = os.path.join(sql_dir, f"payloads_{i}.sql")
        with open(file_path, "r", encoding="utf-8") as f:
            sql = f.read()
        cur.execute(sql)
        print(f"  Inserted payload chunk {i}/5")
    conn.commit()
    
    print("Loading 500 queued jobs...")
    for i in range(1, 6):
        file_path = os.path.join(sql_dir, f"jobs_{i}.sql")
        with open(file_path, "r", encoding="utf-8") as f:
            sql = f.read()
        cur.execute(sql)
        print(f"  Inserted job chunk {i}/5")
    conn.commit()
    
    cur.execute("SELECT count(*) FROM raw.payloads;")
    r_count = cur.fetchone()[0]
    cur.execute("SELECT count(*) FROM jobs.processing_jobs WHERE status = 'queued';")
    j_count = cur.fetchone()[0]
    cur.execute("SELECT count(*) FROM staging.listings;")
    l_count = cur.fetchone()[0]
    
    print(f"\nVerification after enqueuing:")
    print(f"  raw.payloads count: {r_count}")
    print(f"  jobs.processing_jobs queued count: {j_count}")
    print(f"  staging.listings count: {l_count}")
    
    conn.close()
    assert r_count == 500, f"Expected 500 raw payloads, got {r_count}"
    assert j_count == 500, f"Expected 500 queued jobs, got {j_count}"
    assert l_count == 0, f"Expected 0 staging listings, got {l_count}"
    print("\nSUCCESS: Exactly 500 raw payloads and 500 queued jobs enqueued in live PostgreSQL!")

if __name__ == "__main__":
    load_chunks()
