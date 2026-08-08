import os
import sys
import time
import psycopg2

os.environ["PGHOST"] = "db.qnsafosakvonzgfcsphh.supabase.co"
os.environ["PGPORT"] = "5432"
os.environ["PGUSER"] = "pipeline_worker"
os.environ["PGPASSWORD"] = "WatchFactsWorker2026!"
os.environ["PGDATABASE"] = "postgres"

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(__file__)), "scripts"))
from pipeline_runner import run_pipeline_step, get_db_connection

def finish_canary():
    conn = get_db_connection()
    cur = conn.cursor()
    
    # Reset any stranded 'processing' jobs back to 'queued' so worker can claim them cleanly
    cur.execute("UPDATE jobs.processing_jobs SET status = 'queued'::jobs.processing_status WHERE status = 'processing'::jobs.processing_status;")
    conn.commit()
    
    print("Running pipeline steps until all jobs reach terminal states...")
    total_processed = 0
    while True:
        cur.execute("SELECT count(*) FROM jobs.processing_jobs WHERE status IN ('queued', 'received', 'processing');")
        remaining = cur.fetchone()[0]
        if remaining == 0:
            break
        print(f"Remaining active jobs: {remaining}. Processing next batch...")
        p = run_pipeline_step(limit=100)
        total_processed += p
        if p == 0:
            time.sleep(1)
            
    print("\nAll 500 jobs processed!")
    cur.execute("SELECT status, count(*) FROM jobs.processing_jobs GROUP BY status;")
    statuses = cur.fetchall()
    print(f"Job Statuses: {statuses}")
    conn.close()

if __name__ == "__main__":
    finish_canary()
