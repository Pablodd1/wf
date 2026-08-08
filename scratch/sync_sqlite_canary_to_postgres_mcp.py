import sqlite3
import json
import os

db_path = r"C:\Users\Owner\.gemini\antigravity\playground\nascent-glenn\wf_repo\scratch\pipeline_fallback.db"
conn = sqlite3.connect(db_path)
conn.row_factory = sqlite3.Row
cur = conn.cursor()

def sql_q(val, is_uuid=False):
    if val is None:
        return "NULL"
    if isinstance(val, bool):
        return "TRUE" if val else "FALSE"
    if isinstance(val, (int, float)):
        return str(val)
    s = str(val).replace("'", "''").replace("\r", " ").replace("\n", " ")
    if is_uuid:
        return f"'{s}'::uuid"
    return f"'{s}'"

cols = [
    'id', 'job_id', 'parent_id', 'bundle_position', 'raw_message_text', 'category', 'intent', 'listing_type', 'is_bundle',
    'brand_original', 'brand_normalized', 'model_original', 'model_normalized', 'reference_original', 'reference_normalized',
    'dial_color_original', 'dial_color_normalized', 'dial_color_source', 'price_original', 'currency_original',
    'price_normalized', 'currency_normalized', 'price_usd', 'conversion_rate', 'reserve_price', 'price_min',
    'price_max', 'price_avg', 'condition_original', 'condition_normalized', 'box_original', 'box_normalized',
    'papers_original', 'papers_normalized', 'image_url', 'report_url', 'user_name', 'from_name', 'contact_number',
    'from_number', 'phone_code', 'location', 'rating', 'dealer_rating', 'is_verified_user', 'is_paid_user',
    'is_seller_approved', 'company_id', 'contact_consent', 'catalog_confirmed', 'overall_confidence', 'provenance_metadata', 'verdict',
    'normalization_status', 'trading_floor_status', 'price_research_status'
]
uuids = {'id', 'job_id', 'parent_id'}

# Read payloads
cur.execute("SELECT id, source_platform, source_group_id, source_group_name, source_message_id, source_sender_id, source_sender_name, original_message_text, payload_checksum FROM payloads;")
payload_rows = cur.fetchall()

# Read jobs
cur.execute("SELECT id, raw_payload_id, status FROM processing_jobs;")
job_rows = cur.fetchall()

# Read listings
cur.execute("SELECT * FROM listings;")
listing_rows = cur.fetchall()

conn.close()

print(f"Read from SQLite: Payloads={len(payload_rows)}, Jobs={len(job_rows)}, Listings={len(listing_rows)}")

out_dir = r"C:\Users\Owner\.gemini\antigravity\brain\aaaf9af1-6067-468b-bfc7-1bac307799f6\scratch\mcp_sync_blocks"
os.makedirs(out_dir, exist_ok=True)

bool_cols = {'is_bundle', 'is_verified_user', 'is_paid_user', 'is_seller_approved', 'contact_consent', 'catalog_confirmed'}

# Build payload SQLs
p_statements = []
for p in payload_rows:
    p_statements.append(f"({sql_q(p['id'], True)}, {sql_q(p['source_platform'])}, {sql_q(p['source_group_id'])}, {sql_q(p['source_group_name'])}, {sql_q(p['source_message_id'])}, {sql_q(p['source_sender_id'])}, {sql_q(p['source_sender_name'])}, {sql_q(p['original_message_text'])}, NOW(), {sql_q(p['payload_checksum'])})")

# Build job SQLs
j_statements = []
for j in job_rows:
    j_statements.append(f"({sql_q(j['id'], True)}, {sql_q(j['raw_payload_id'], True)}, {sql_q(j['status'])}::jobs.processing_status, NOW(), NOW())")

# Build listing SQLs
l_statements = []
for l in listing_rows:
    vals = []
    for c in cols:
        val = l[c]
        if c in bool_cols:
            vals.append("TRUE" if bool(val) else "FALSE")
        else:
            vals.append(sql_q(val, is_uuid=(c in uuids)))
    l_statements.append(f"({', '.join(vals)})")

blocks = []
# TRUNCATE block
blocks.append("TRUNCATE staging.listings, jobs.processing_jobs, raw.payloads RESTART IDENTITY CASCADE;")

# Payloads (chunks of 100)
for i in range(0, len(p_statements), 100):
    blocks.append("INSERT INTO raw.payloads (id, source_platform, source_group_id, source_group_name, source_message_id, source_sender_id, source_sender_name, original_message_text, original_timestamp, payload_checksum) VALUES " + ",\n".join(p_statements[i:i+100]) + " ON CONFLICT (id) DO NOTHING;")

# Jobs (chunks of 100)
for i in range(0, len(j_statements), 100):
    blocks.append("INSERT INTO jobs.processing_jobs (id, raw_payload_id, status, created_at, updated_at) VALUES " + ",\n".join(j_statements[i:i+100]) + " ON CONFLICT (id) DO NOTHING;")

# Listings (chunks of 50)
for i in range(0, len(l_statements), 50):
    blocks.append(f"INSERT INTO staging.listings ({', '.join(cols)}) VALUES " + ",\n".join(l_statements[i:i+50]) + " ON CONFLICT (id) DO NOTHING;")

print(f"Generated {len(blocks)} total SQL blocks for Postgres execution.")

for idx, bsql in enumerate(blocks):
    with open(os.path.join(out_dir, f"block_{idx+1:03d}.sql"), "w", encoding="utf-8") as f:
        f.write(bsql)

print(f"Wrote all sync blocks to {out_dir}.")
