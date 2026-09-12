import os
import psycopg2

db_url = os.environ.get("DATABASE_URL")
conn = psycopg2.connect(db_url)
cur = conn.cursor()

cur.execute("""
  SELECT raw_message, raw_payload
  FROM wf_canonical_staging.mariadb_authoritative_raw_source_rows
  WHERE source_id = '8b4a723e-8a83-492b-8b62-d712dfa402e6';
""")
r = cur.fetchone()
payload = r[1]
text = payload.get("title") or payload.get("description") or ""
print("Payload text:")
for idx, l in enumerate(text.split("\n")):
  print(f" {idx}: {l.encode('ascii', 'replace').decode('ascii')}")
