import os
import sys
import json
import psycopg2

os.environ["PGTZ"] = "UTC"

db_url = os.environ.get("DATABASE_URL")
if not db_url:
    print("FATAL: DATABASE_URL required.", file=sys.stderr)
    sys.exit(1)

conn = psycopg2.connect(db_url, options="-c timezone=UTC")
conn.autocommit = True
cur = conn.cursor()

print("================================================================================")
print("READ-ONLY AUTHORITATIVE COHORT GLOBAL CENSUS")
print("================================================================================\n")

# 1. Total authoritative rows and uniqueness
cur.execute("""
  SELECT 
    COUNT(*) as total_rows,
    COUNT(DISTINCT source_id) as distinct_source_ids,
    MIN(source_created_on) as min_created_on,
    MAX(source_created_on) as max_created_on
  FROM wf_canonical_staging.mariadb_authoritative_raw_source_rows;
""")
r = cur.fetchone()
total_rows = r[0]
distinct_ids = r[1]
min_created_on = r[2]
max_created_on = r[3]

print(f"1. Authoritative Cohort Rows: {total_rows:,}")
print(f"   Distinct Source IDs:       {distinct_ids:,}")
print(f"   Date Range:                {min_created_on} to {max_created_on}")

# 2. Namespace verification
cur.execute("""
  SELECT source_system, source_database, source_table, COUNT(*)
  FROM wf_canonical_staging.mariadb_authoritative_raw_source_rows
  GROUP BY source_system, source_database, source_table;
""")
namespaces = cur.fetchall()
print("\n2. Namespaces Verified:")
for ns in namespaces:
    print(f"   {ns[0]} / {ns[1]} / {ns[2]}: {ns[3]:,} rows")

# 3. Type distribution (WTS / WTB / other) in raw_payload
cur.execute("""
  SELECT 
    COALESCE(raw_payload->>'type', '<NULL>') as listing_type,
    COUNT(*) as count
  FROM wf_canonical_staging.mariadb_authoritative_raw_source_rows
  GROUP BY raw_payload->>'type'
  ORDER BY count DESC;
""")
types = cur.fetchall()
print("\n3. Listing Type (Intent) Distribution:")
type_map = {}
for t in types:
    print(f"   {t[0]}: {t[1]:,} rows")
    type_map[t[0]] = t[1]

# 4. Currency distribution in raw_payload
cur.execute("""
  SELECT 
    COALESCE(raw_payload->>'currency', '<NULL>') as currency,
    COUNT(*) as count
  FROM wf_canonical_staging.mariadb_authoritative_raw_source_rows
  GROUP BY raw_payload->>'currency'
  ORDER BY count DESC
  LIMIT 10;
""")
currencies = cur.fetchall()
print("\n4. Currency Distribution (Top 10):")
currency_map = {}
for c in currencies:
    print(f"   {c[0]}: {c[1]:,} rows")
    currency_map[c[0]] = c[1]

# 5. Alternate versions & Error ledger
cur.execute("SELECT COUNT(*) FROM wf_canonical_staging.mariadb_raw_source_alternate_versions;")
alt_count = cur.fetchone()[0]

cur.execute("SELECT COUNT(*) FROM wf_canonical_staging.mariadb_raw_import_errors WHERE run_key = 'full-capture-auctions-1788028958313';")
err_count = cur.fetchone()[0]

print(f"\n5. Provenance Ledgers:")
print(f"   Alternate versions preserved: {alt_count:,}")
print(f"   Capture errors in ledger:     {err_count:,}")

census_report = {
    "contract": "wf-mariadb-authoritative-cohort-census-v1",
    "timestamp": "2026-09-01T22:20:00.000Z",
    "cohort_metrics": {
        "total_authoritative_rows": total_rows,
        "distinct_source_ids": distinct_ids,
        "is_strictly_unique": total_rows == distinct_ids,
        "date_range": {
            "min_created_on": min_created_on,
            "max_created_on": max_created_on
        }
    },
    "provenance_reconciliation": {
        "authoritative_rows": total_rows,
        "alternate_versions_retained": alt_count,
        "lossless_errors_routed": err_count,
        "total_raw_inputs_represented": total_rows + alt_count + err_count
    },
    "type_distribution": type_map,
    "top_currency_distribution": currency_map
}

out_dir = "audit-output/mariadb-live"
os.makedirs(out_dir, exist_ok=True)
with open(f"{out_dir}/authoritative_cohort_census.json", "w") as f:
    json.dump(census_report, f, indent=2)

print(f"\nCensus report written to {out_dir}/authoritative_cohort_census.json")
cur.close()
conn.close()
