# tools/mariadb-live/migration_compatibility_preflight.py
import os
import sys
import psycopg2
import json
import datetime

NORMALIZATION_STATUS_CONTRACT = {
  "intent": [
    "WTS", "WTB", "PRICE_CHECK", "WITHDRAWN", "UNKNOWN"
  ],
  "currency_status": [
    "VERIFIED_EXPLICIT_USD", "VERIFIED_EXPLICIT_EUR", "VERIFIED_EXPLICIT_GBP", "VERIFIED_EXPLICIT_HKD",
    "VERIFIED_EXPLICIT_SGD", "VERIFIED_EXPLICIT_AED", "VERIFIED_EXPLICIT_SAR", "VERIFIED_EXPLICIT_AUD",
    "VERIFIED_EXPLICIT_JPY", "VERIFIED_EXPLICIT_CHF", "VERIFIED_EXPLICIT_CAD", "VERIFIED_EXPLICIT_CNY",
    "VERIFIED_EXPLICIT_MYR", "VERIFIED_EXPLICIT_USDT_HELD_FOR_FX", "VERIFIED_EXPLICIT_HKD_HELD_FOR_FX",
    "AMBIGUOUS_BARE_DOLLAR_HELD", "MISSING_PRICE", "UNKNOWN_CURRENCY"
  ],
  "trading_floor_status": [
    "ELIGIBLE_WTS", "ELIGIBLE_WTB", "HELD_INTENT_UNKNOWN", "HELD_IDENTITY_INCOMPLETE",
    "HELD_MISSING_SOURCE_TEXT", "HELD_BUNDLE_UNSPLIT", "HELD_WITHDRAWN", "HELD_UNPRICED",
    "HELD_AMBIGUOUS_CURRENCY", "HELD_FOREIGN_CURRENCY", "HELD_UNKNOWN"
  ],
  "price_research_status": [
    "ELIGIBLE_VERIFIED_USD", "INELIGIBLE_TRADING_FLOOR_HOLD", "INELIGIBLE_NOT_WTS",
    "INELIGIBLE_AMBIGUOUS_CURRENCY", "INELIGIBLE_MISSING_PRICE", "INELIGIBLE_IDENTITY_INCOMPLETE",
    "INELIGIBLE_HKD_HELD_FOR_FX", "INELIGIBLE_USDT_HELD_FOR_FX", "INELIGIBLE_OUTLIER_HIGH",
    "INELIGIBLE_OUTLIER_LOW", "INELIGIBLE_FOREIGN_CURRENCY_HELD", "INELIGIBLE_OTHER", "INELIGIBLE_UNKNOWN"
  ],
  "reconciliation_category": [
    "SINGLE_RECORD", "BUNDLE_ITEM", "SPLIT_CHILD", "MULTI_OFFER", "NORMALIZED_PROPOSAL", "REVIEW_REQUIRED"
  ],
  "primary_image_evidence_type": [
    "IMAGE_KEY_PRESERVED_URL_UNVERIFIED", "IMAGE_URL_VERIFIED", "NO_IMAGE", "IMAGE_UNAVAILABLE"
  ]
}

def run_compatibility_preflight():
  conn = psycopg2.connect(os.environ.get("DATABASE_URL"))
  cur = conn.cursor()

  def get_distinct_counts(table, col):
    cur.execute(f"SELECT {col}, COUNT(*) FROM wf_canonical_staging.{table} GROUP BY {col} ORDER BY 2 DESC;")
    return cur.fetchall()

  print("Querying distinct stored values from wf_canonical_staging tables...")

  audits = {
    "intent": get_distinct_counts("mariadb_normalized_children", "intent"),
    "currency_status": get_distinct_counts("mariadb_normalized_children", "currency_status"),
    "trading_floor_status": get_distinct_counts("mariadb_normalized_children", "trading_floor_status"),
    "price_research_status": get_distinct_counts("mariadb_normalized_children", "price_research_status"),
    "reconciliation_category": get_distinct_counts("mariadb_normalized_children", "reconciliation_category"),
    "primary_image_evidence_type": get_distinct_counts("mariadb_normalized_children", "primary_image_evidence_type")
  }

  cur.close()
  conn.close()

  incompatibilities = []
  breakdown_summary = {}

  for field, counts in audits.items():
    allowed_set = set(NORMALIZATION_STATUS_CONTRACT[field])
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
    "status_contract_vocabulary": NORMALIZATION_STATUS_CONTRACT
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
