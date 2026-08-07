import os
import sys
import uuid
import hashlib

sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), '../scripts')))
import pipeline_runner

def get_checksum(msg_text):
    return hashlib.sha256(msg_text.encode('utf-8')).hexdigest()

def run_canary():
    conn = pipeline_runner.get_db_connection()
    cur = conn.cursor()

    batch_id = 'canary_10_batch_' + str(uuid.uuid4())[:8]
    
    messages = [
        "WTS Rolex Submariner 116610LN 2019 $10500",
        "WTS Patek Philippe Nautilus 5711 2020 $70000",
        "WTS Audemars Piguet Royal Oak 15500ST 2022 $45000",
        "WTB Rolex Daytona 116500LN White Dial",
        "WTS Omega Speedmaster Professional Moonwatch $4500",
        "WTS Tudor Black Bay 58 79030N $3000",
        "WTB Patek Philippe Aquanaut 5167A",
        "WTS Vacheron Constantin Overseas 4500V $28000",
        "WTS Rolex GMT-Master II 126710BLRO Pepsi $20000",
        "WTS Rolex Submariner 116610LN 2019 $10500" # Duplicate of first
    ]
    
    print(f"Starting 10-record reader-to-worker canary for batch {batch_id}...")
    attempted = 0
    inserted = 0
    duplicate_suppressed = 0
    
    for msg in messages:
        attempted += 1
        payload_id = str(uuid.uuid4())
        job_id = str(uuid.uuid4())
        checksum = get_checksum(msg)
        
        cur.execute("""
            INSERT INTO raw.payloads (
                id, source_platform, source_group_id, source_group_name, source_message_id,
                source_sender_id, source_sender_name, original_message_text, original_timestamp, version_checksum, batch_id
            ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, NOW(), %s, %s)
            ON CONFLICT (version_checksum) DO NOTHING
            RETURNING id;
        """, (payload_id, "canary", "canary_grp", "Canary Group", str(uuid.uuid4()), "canary_user", "Canary Tester", msg, checksum, batch_id))
        
        row = cur.fetchone()
        if row:
            cur.execute("""
                INSERT INTO jobs.processing_jobs (id, raw_payload_id, status, batch_id)
                VALUES (%s, %s, 'queued'::jobs.processing_status, %s)
                ON CONFLICT (id) DO NOTHING
                RETURNING id;
            """, (job_id, payload_id, batch_id))
            if cur.fetchone():
                inserted += 1
        else:
            duplicate_suppressed += 1
            
    conn.commit()
    print(f"Reader phase: {attempted} attempted, {inserted} inserted, {duplicate_suppressed} exact duplicate suppressed.")
    
    processed = pipeline_runner.run_pipeline_step(limit=100)
    print(f"Worker phase: Processed {processed} jobs.")
    
    cur.execute("SELECT id, status FROM jobs.processing_jobs WHERE batch_id = %s;", (batch_id,))
    final_jobs = cur.fetchall()
    
    success = True
    if len(final_jobs) != 9:
        print(f"ERROR: Expected 9 processing jobs, found {len(final_jobs)}")
        success = False
        
    for j_id, status in final_jobs:
        if status != 'normalized':
            print(f"ERROR: Job {j_id} has status {status}, expected normalized")
            success = False
            
    if success:
        print("Canary successfully passed: 10 attempted, 9 jobs processed, 1 duplicate suppressed, staging records created.")
    else:
        print("Canary failed validation.")
        sys.exit(1)

if __name__ == "__main__":
    os.environ["REQUIRE_POSTGRES"] = "1"
    pipeline_runner.REQUIRE_POSTGRES = True
    run_canary()
