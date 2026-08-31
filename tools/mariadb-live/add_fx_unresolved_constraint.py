import os
import sys
import psycopg2

db_url = os.environ.get("DATABASE_URL")
if not db_url:
  print("No DATABASE_URL", file=sys.stderr)
  sys.exit(1)

conn = psycopg2.connect(db_url)
conn.autocommit = False
cur = conn.cursor()

print("Updating check constraint on mariadb_normalized_children...")
cur.execute("""
  ALTER TABLE wf_canonical_staging.mariadb_normalized_children
    DROP CONSTRAINT IF EXISTS chk_mariadb_children_price_research_status;

  ALTER TABLE wf_canonical_staging.mariadb_normalized_children
    ADD CONSTRAINT chk_mariadb_children_price_research_status CHECK (price_research_status IN (
      'ELIGIBLE_VERIFIED_USD', 'INELIGIBLE_TRADING_FLOOR_HOLD', 'INELIGIBLE_NOT_WTS',
      'INELIGIBLE_AMBIGUOUS_CURRENCY', 'INELIGIBLE_MISSING_PRICE', 'INELIGIBLE_IDENTITY_INCOMPLETE',
      'INELIGIBLE_HKD_HELD_FOR_FX', 'INELIGIBLE_USDT_HELD_FOR_FX', 'INELIGIBLE_FX_UNRESOLVED',
      'INELIGIBLE_OUTLIER_EXCLUDED', 'INELIGIBLE_FOREIGN_CURRENCY_HELD', 'INELIGIBLE_OTHER', 'INELIGIBLE_UNKNOWN'
    ));
""")

cur.execute("""
  ALTER TABLE wf_canonical_staging.mariadb_quarantine_canonical_children
    DROP CONSTRAINT IF EXISTS chk_mariadb_quarantine_children_price_research_status;

  ALTER TABLE wf_canonical_staging.mariadb_quarantine_canonical_children
    ADD CONSTRAINT chk_mariadb_quarantine_children_price_research_status CHECK (price_research_status IN (
      'ELIGIBLE_VERIFIED_USD', 'INELIGIBLE_TRADING_FLOOR_HOLD', 'INELIGIBLE_NOT_WTS',
      'INELIGIBLE_AMBIGUOUS_CURRENCY', 'INELIGIBLE_MISSING_PRICE', 'INELIGIBLE_IDENTITY_INCOMPLETE',
      'INELIGIBLE_HKD_HELD_FOR_FX', 'INELIGIBLE_USDT_HELD_FOR_FX', 'INELIGIBLE_FX_UNRESOLVED',
      'INELIGIBLE_OUTLIER_EXCLUDED', 'INELIGIBLE_FOREIGN_CURRENCY_HELD', 'INELIGIBLE_OTHER', 'INELIGIBLE_UNKNOWN'
    ));
""")

conn.commit()
print("Constraint updated successfully with INELIGIBLE_FX_UNRESOLVED.")
