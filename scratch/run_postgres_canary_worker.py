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
from pipeline_runner import start_continuous_worker, get_db_connection

def run_canary_worker():
    conn = get_db_connection()
    cur = conn.cursor()
    
    cur.execute("SELECT count(*) FROM jobs.processing_jobs WHERE status IN ('queued', 'received');")
    initial_queued = cur.fetchone()[0]
    print(f"Starting Genuine PostgreSQL Pipeline Worker for {initial_queued} queued jobs...")
    conn.close()
    
    start_time = time.time()
    
    # Process until 0 queued jobs remain
    start_continuous_worker(poll_interval=1, once=True, require_postgres=True)
    
    # Run passes until no queued jobs remain
    conn = get_db_connection()
    cur = conn.cursor()
    while True:
        cur.execute("SELECT count(*) FROM jobs.processing_jobs WHERE status IN ('queued', 'received', 'processing');")
        remaining = cur.fetchone()[0]
        if remaining == 0:
            break
        print(f"Remaining active jobs: {remaining}. Running worker step...")
        from pipeline_runner import run_pipeline_step
        run_pipeline_step(limit=100)
        
    duration = time.time() - start_time
    
    cur.execute("SELECT status, count(*) FROM jobs.processing_jobs GROUP BY status;")
    statuses = cur.fetchall()
    
    cur.execute("SELECT count(*) FROM raw.payloads;")
    r_count = cur.fetchone()[0]
    
    cur.execute("SELECT count(*) FROM staging.listings WHERE parent_id IS NULL;")
    parents_count = cur.fetchone()[0]
    
    cur.execute("SELECT count(*) FROM staging.listings WHERE parent_id IS NOT NULL;")
    children_count = cur.fetchone()[0]
    
    cur.execute("SELECT count(*) FROM staging.listings;")
    total_listings = cur.fetchone()[0]
    
    cur.execute("SELECT count(*) FROM public.reviewed_workbook_market_source_v2;")
    tf_count = cur.fetchone()[0]
    
    cur.execute("SELECT count(*) FROM public.price_research_verified_source;")
    pr_count = cur.fetchone()[0]
    
    print("\n=======================================================")
    print("GENUINE CANARY 500 PIPELINE WORKER COMPLETED IN {:.2f}s".format(duration))
    print("=======================================================")
    print(f"Raw Payloads:         {r_count}")
    print(f"Job Statuses Breakdown: {statuses}")
    print(f"Staging Parents:      {parents_count}")
    print(f"Staging Children:     {children_count}")
    print(f"Staging Total:        {total_listings}")
    print(f"Trading Floor View:   {tf_count}")
    print(f"Price Research View:  {pr_count}")
    print("=======================================================")
    
    conn.close()

if __name__ == "__main__":
    run_canary_worker()
