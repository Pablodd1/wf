import os
import sys
import psycopg2

db_url = os.environ.get("DATABASE_URL")
conn = psycopg2.connect(db_url)
conn.autocommit = True
cur = conn.cursor()

cur.execute("""
  UPDATE wf_canonical_staging.mariadb_normalized_children
  SET price_research_status = 'INELIGIBLE_FX_UNRESOLVED'
  WHERE original_price_amount IS NOT NULL 
    AND original_price_amount > 0 
    AND price_research_status = 'INELIGIBLE_MISSING_PRICE';
""")
print(f"Updated {cur.rowcount} children to INELIGIBLE_FX_UNRESOLVED.")
