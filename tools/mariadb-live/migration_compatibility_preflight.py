# tools/mariadb-live/migration_compatibility_preflight.py
import os
import sys
import psycopg2
import json
import datetime
from pathlib import Path

def load_status_contract():
  contract_path = Path(__file__).parent / "normalization-status-contract.json"
  if not contract_path.exists():
    contract_path = Path("tools/mariadb-live/normalization-status-contract.json")
  with open(contract_path, "r", encoding="utf-8") as f:
    return json.load(f)

def run_compatibility_preflight():
  contract = load_status_contract()
  db_url = os.environ.get("DATABASE_URL")
  if not db_url:
    print("FATAL: DATABASE_URL is required for compatibility preflight.", file=sys.stderr)
    sys.exit(1)

  conn = psycopg2.connect(db_url)
  # Explicit read-only transaction
  conn.set_session(readonly=True, autocommit=False)
  cur = conn.cursor()

  def get_distinct_counts(table, col):
    cur.execute(f"SELECT {col}, COUNT(*) FROM wf_canonical_staging.{table} GROUP BY {col} ORDER BY 2 DESC;")
    return cur.fetchall()

  print("Querying distinct stored values in READ ONLY transaction...")

  audits = {
    "intent": get_distinct_counts("mariadb_normalized_children", "intent"),
    "currency_status": get_distinct_counts("mariadb_normalized_children", "currency_status"),
    "trading_floor_status": get_distinct_counts("mariadb_normalized_children", "trading_floor_status"),
    "price_research_status": get_distinct_counts("mariadb_normalized_children", "price_research_status"),
    "reconciliation_category": get_distinct_counts("mariadb_normalized_children", "reconciliation_category"),
    "primary_image_evidence_type": get_distinct_counts("mariadb_normalized_children", "primary_image_evidence_type")
  }

  conn.rollback() # End read-only transaction safely
  cur.close()
  conn.close()

  incompatibilities = []
  breakdown_summary = {}

  for field, counts in audits.items():
    allowed_set = set(contract.get(field, []))
    field_counts = {}
    for val, count in counts:
      key_name = val if val is not None else "NULL"
      field_counts[key_name] = count
      if val is not None and val not in allowed_set:
        incompatibilities.append({
          "field": field,
          "unauthorized_value": val,
          "row_count": count
        })
    breakdown_summary[field] = field_counts

  is_compatible = len(incompatibilities) == 0

  report = {
    "contract": "wf-migration-status-compatibility-preflight-v1",
    "generated_at": datetime.datetime.now(datetime.timezone.utc).isoformat(),
    "status": "COMPATIBLE" if is_compatible else "INCOMPATIBLE_VIOLATIONS_FOUND",
    "total_fields_checked": len(audits),
    "incompatible_values_count": len(incompatibilities),
    "incompatibilities": incompatibilities,
    "stored_canary_status_counts": breakdown_summary,
    "status_contract_vocabulary": contract
  }

  out_path = "audit-output/mariadb-live/canonical-canary-10k/migration_compatibility_preflight.json"
  os.makedirs(os.path.dirname(out_path), exist_ok=True)
  with open(out_path, "w", encoding="utf-8") as f:
    json.dump(report, f, indent=2)

  print("COMPATIBILITY_PREFLIGHT_RESULTS:")
  print(json.dumps(report, indent=2))

  if not is_compatible:
    print(f"FATAL: {len(incompatibilities)} incompatible stored status values found in database!", file=sys.stderr)
    sys.exit(1)
  return report

if __name__ == "__main__":
  run_compatibility_preflight()
