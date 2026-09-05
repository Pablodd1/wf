import os
import sys
import json
import subprocess
import psycopg2

os.environ["PGTZ"] = "UTC"

db_url = os.environ.get("DATABASE_URL")
if not db_url:
    print("FATAL: DATABASE_URL required.", file=sys.stderr)
    sys.exit(1)

conn = psycopg2.connect(db_url, options="-c timezone=UTC")
cur = conn.cursor()

print("[Authoritative-10k-Canary] Fetching exactly 10,000 rows directly from wf_canonical_staging.mariadb_authoritative_raw_source_rows...")
cur.execute("""
    SELECT 
        source_id, source_system, source_database, source_table, source_record_id,
        source_created_on, source_hash, raw_message, raw_payload
    FROM wf_canonical_staging.mariadb_authoritative_raw_source_rows
    ORDER BY source_created_on ASC, source_id ASC
    LIMIT 10000;
""")

cols = [desc[0] for desc in cur.description]
rows = []
for r in cur.fetchall():
    row_dict = dict(zip(cols, r))
    rows.append(row_dict)

print(f"  Successfully fetched {len(rows):,} authoritative rows.")
cur.close()
conn.close()

out_dir = "audit-output/mariadb-live/normalization-canary-10k"
os.makedirs(out_dir, exist_ok=True)
input_file = os.path.join(out_dir, "canary_10k_staged_input.json")
with open(input_file, "w") as f:
    json.dump(rows, f)

print(f"  Saved input records to {input_file}. Now running evidence normalizer...")
cmd = ["node", "tools/mariadb-live/run_10k_canary_from_file.cjs"]
res = subprocess.run(cmd, capture_output=True, text=True)
print(res.stdout)
if res.stderr:
    print(res.stderr, file=sys.stderr)
if res.returncode != 0:
    sys.exit(res.returncode)

if os.path.exists(input_file):
    os.remove(input_file)
