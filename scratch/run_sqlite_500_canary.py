import json
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(__file__)), "scripts"))
import pipeline_runner

# Force SQLite mode
pipeline_runner.PGPASSWORD = None
pipeline_runner.DATABASE_URL = None
pipeline_runner.REQUIRE_POSTGRES = False

conn = pipeline_runner.get_db_connection()
pipeline_runner.setup_sqlite_schema(conn)
cur = conn.cursor()

# Clear tables
cur.execute("DELETE FROM listings;")
cur.execute("DELETE FROM processing_jobs;")
cur.execute("DELETE FROM payloads;")
conn.commit()

json_path = r"C:\Users\Owner\.gemini\antigravity\brain\aaaf9af1-6067-468b-bfc7-1bac307799f6\scratch\canary_json\raw_payloads.json"
with open(json_path, "r", encoding="utf-8") as f:
    raw_payloads = json.load(f)

print(f"Seeding {len(raw_payloads)} raw payloads & queued jobs into SQLite...")
for p in raw_payloads:
    cur.execute("""
        INSERT INTO payloads (id, source_platform, source_group_id, source_group_name, source_message_id, source_sender_id, source_sender_name, original_message_text, original_timestamp, payload_checksum)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), ?);
    """, (p["id"], p["source_platform"], p["source_group_id"], p["source_group_name"], p["source_message_id"], p["source_sender_id"], p["source_sender_name"], p["original_message_text"], p["payload_checksum"]))
    
    cur.execute("""
        INSERT INTO processing_jobs (id, raw_payload_id, status)
        VALUES (?, ?, 'queued');
    """, (p["id"], p["id"]))

conn.commit()
conn.close()

print("Seeded successfully. Running pipeline step for 500 jobs...")
processed = pipeline_runner.run_pipeline_step(limit=500)
print(f"Processed {processed} jobs in SQLite!")

# Verify counts in SQLite
conn = pipeline_runner.get_db_connection()
cur = conn.cursor()

cur.execute("SELECT count(*) as cnt FROM listings WHERE parent_id IS NULL;")
parents_cnt = cur.fetchone()['cnt']

cur.execute("SELECT count(*) as cnt FROM listings WHERE parent_id IS NOT NULL;")
children_cnt = cur.fetchone()['cnt']

cur.execute("SELECT count(*) as cnt FROM listings WHERE parent_id IS NULL AND price_research_status = 'eligible';")
pr_eligible_parents = cur.fetchone()['cnt']

cur.execute("SELECT count(*) as cnt FROM listings WHERE parent_id IS NOT NULL AND trading_floor_status = 'published';")
published_children = cur.fetchone()['cnt']

cur.execute("SELECT count(*) as cnt FROM listings WHERE parent_id IS NULL AND intent = 'WTB' AND price_research_status = 'eligible';")
wtb_pr_eligible = cur.fetchone()['cnt']

cur.execute("SELECT count(*) as cnt FROM listings WHERE provenance_metadata IS NOT NULL;")
prov_meta_cnt = cur.fetchone()['cnt']

print(f"\n--- SQLITE CANARY VERIFICATION RESULTS ---")
print(f"Parents Count: {parents_cnt}")
print(f"Children Count: {children_cnt}")
print(f"Total Listings: {parents_cnt + children_cnt}")
print(f"Parents Eligible for Price Research: {pr_eligible_parents}")
print(f"WTB Demand Signals Eligible for Price Research: {wtb_pr_eligible}")
print(f"Published Bundle Children on Trading Floor: {published_children}")
print(f"Listings with Provenance Metadata: {prov_meta_cnt}")
conn.close()
