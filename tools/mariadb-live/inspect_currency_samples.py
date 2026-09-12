import os
import sys
import json
import psycopg2

if hasattr(sys.stdout, "reconfigure"):
  sys.stdout.reconfigure(encoding="utf-8", errors="replace")

db_url = os.environ.get("DATABASE_URL")
if not db_url:
  print("No DATABASE_URL", file=sys.stderr)
  sys.exit(1)

conn = psycopg2.connect(db_url)
cur = conn.cursor()

print("--- USD Examples ---")
cur.execute("""
  SELECT c.id, c.parent_source_id, c.brand, c.model, c.reference,
         c.original_price_amount, c.original_price_currency, c.currency_status,
         c.price_usd, c.price_research_status, c.price_research_eligible,
         c.trading_floor_status, p.raw_message_original
  FROM wf_canonical_staging.mariadb_normalized_children c
  JOIN wf_canonical_staging.mariadb_normalized_parents p ON c.parent_id = p.id
  WHERE c.currency_status = 'VERIFIED_EXPLICIT_USD'
  LIMIT 3;
""")
for r in cur.fetchall():
  print(f"Child {r[0]}: Brand={r[2]} Ref={r[4]} Price={r[5]} {r[6]} Status={r[7]} PR_Status={r[9]} Eligible={r[10]}")
  print(f"  Raw: {r[12][:150].replace(chr(10), ' ')}")

print("\n--- SGD in Raw Rows ---")
cur.execute("""
  SELECT source_id, raw_message
  FROM wf_canonical_staging.mariadb_raw_source_rows
  WHERE source_table = 'auctions'
    AND (raw_message ILIKE '%sgd%' OR raw_message ILIKE '%s$%')
  LIMIT 2;
""")
for r in cur.fetchall():
  print(f"Source {r[0]}: {r[1][:150].replace(chr(10), ' ')}")

print("\n--- JPY in Raw Rows ---")
cur.execute("""
  SELECT source_id, raw_message
  FROM wf_canonical_staging.mariadb_raw_source_rows
  WHERE source_table = 'auctions'
    AND (raw_message ILIKE '%jpy%' OR raw_message ILIKE '%yen%')
  LIMIT 2;
""")
for r in cur.fetchall():
  print(f"Source {r[0]}: {r[1][:150].replace(chr(10), ' ')}")
