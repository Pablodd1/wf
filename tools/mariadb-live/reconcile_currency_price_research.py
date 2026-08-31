# tools/mariadb-live/reconcile_currency_price_research.py
import os
import sys
import json
from datetime import datetime, timezone
import psycopg2

if hasattr(sys.stdout, "reconfigure"):
  sys.stdout.reconfigure(encoding="utf-8", errors="replace")

def reconcile():
  db_url = os.environ.get("DATABASE_URL")
  if not db_url:
    print("FATAL: DATABASE_URL required.", file=sys.stderr)
    sys.exit(1)

  conn = psycopg2.connect(db_url)
  cur = conn.cursor()
  cur.execute("SET statement_timeout = '600s';")

  print("==================================================================")
  print("1. EXTRACTING PURE SOURCE-BACKED CURRENCY EVIDENCE")
  print("==================================================================")
  currencies = [
    ("USD", "c.currency_status = 'VERIFIED_EXPLICIT_USD'"),
    ("USDT", "c.currency_status = 'VERIFIED_EXPLICIT_USDT_HELD_FOR_FX'"),
    ("HKD", "c.currency_status = 'VERIFIED_EXPLICIT_HKD_HELD_FOR_FX'"),
    ("EUR", "c.currency_status = 'VERIFIED_EXPLICIT_EUR'"),
    ("GBP", "c.currency_status = 'VERIFIED_EXPLICIT_GBP'"),
    ("AED", "c.currency_status = 'VERIFIED_EXPLICIT_AED'"),
    ("CHF", "c.currency_status = 'VERIFIED_EXPLICIT_CHF'"),
    ("CNY", "c.currency_status = 'VERIFIED_EXPLICIT_CNY'")
  ]

  evidence_samples = {}

  for code, filter_sql in currencies:
    cur.execute(f"""
      SELECT 
        c.id, c.brand, c.model, c.reference,
        c.original_price_amount, c.original_price_currency, c.currency_status,
        c.price_usd, c.fx_rate, c.intent, c.trading_floor_status, c.price_research_status,
        c.exclusion_reasons, c.review_flags, p.raw_message_original
      FROM wf_canonical_staging.mariadb_normalized_children c
      JOIN wf_canonical_staging.mariadb_normalized_parents p ON c.parent_id = p.id
      WHERE {filter_sql}
      ORDER BY c.normalized_at DESC
      LIMIT 2;
    """)
    rows = cur.fetchall()
    evidence_samples[code] = []
    print(f"\n--- Currency: {code} ({len(rows)} samples) ---")
    for r in rows:
      sample = {
        "child_id": str(r[0]),
        "brand": r[1],
        "model": r[2],
        "reference": r[3],
        "original_price_amount": float(r[4]) if r[4] is not None else None,
        "original_price_currency": r[5],
        "currency_status": r[6],
        "price_usd": float(r[7]) if r[7] is not None else None,
        "fx_rate": float(r[8]) if r[8] is not None else None,
        "intent": r[9],
        "trading_floor_status": r[10],
        "price_research_status": r[11],
        "exclusion_reasons": r[12],
        "review_flags": r[13],
        "raw_message": r[14]
      }
      evidence_samples[code].append(sample)
      print(f"  Brand: {sample['brand']} | Ref: {sample['reference']} | Amount: {sample['original_price_amount']} {sample['original_price_currency']}")
      print(f"  Status: {sample['currency_status']} | Intent: {sample['intent']} | PR_Status: {sample['price_research_status']}")
      print(f"  Raw Snippet: {sample['raw_message'][:120].replace(chr(10), ' ')}...")

  decision_tree_explanation = {
    "PR_ELIGIBILITY_PIPELINE_STAGES": [
      {
        "stage": "1. Trading Floor Hold Check",
        "condition": "trading_floor_status <> 'ELIGIBLE_WTS' and trading_floor_status <> 'ELIGIBLE_WTB'",
        "assigned_status": "INELIGIBLE_TRADING_FLOOR_HOLD",
        "description": "General inventory broadcast listings without explicit WTS/WTB intent cannot be published to Price Research."
      },
      {
        "stage": "2. WTS Intent Check",
        "condition": "intent <> 'WTS'",
        "assigned_status": "INELIGIBLE_NOT_WTS",
        "description": "Price Research only tracks sell offers (WTS). Buyer inquiries (WTB) are excluded."
      },
      {
        "stage": "3. Currency Verification & FX Gating",
        "condition": "currency_status in (VERIFIED_EXPLICIT_HKD_HELD_FOR_FX, VERIFIED_EXPLICIT_USDT_HELD_FOR_FX, AMBIGUOUS_BARE_DOLLAR_HELD)",
        "assigned_status": "INELIGIBLE_HKD_HELD_FOR_FX / INELIGIBLE_USDT_HELD_FOR_FX / INELIGIBLE_AMBIGUOUS_CURRENCY",
        "description": "HKD and USDT listings are held until dated historical FX rates are applied. Bare dollar '$' is strictly held as ambiguous."
      },
      {
        "stage": "4. Explicit Foreign Currencies (EUR, GBP, AED, CHF, CNY, etc.)",
        "condition": "original_price_currency in (EUR, GBP, AED, CHF, CNY) AND price_usd is NULL",
        "assigned_status": "INELIGIBLE_MISSING_PRICE (or held until FX enrichment)",
        "description": "Before the dated FX conversion table is joined, non-USD currencies do not have price_usd populated, so Price Research treats the USD price as missing."
      },
      {
        "stage": "5. USD Eligibility & Outlier Gate",
        "condition": "currency_status = 'VERIFIED_EXPLICIT_USD' AND structured reference resolved AND price within range",
        "assigned_status": "ELIGIBLE_VERIFIED_USD",
        "description": "Records with explicit USD pricing, recognized watch reference, and valid market range are immediately eligible."
      }
    ]
  }

  report = {
    "contract": "wf-currency-price-research-reconciliation-v1",
    "generated_at": datetime.now(timezone.utc).isoformat(),
    "decision_tree": decision_tree_explanation,
    "pure_evidence_samples": evidence_samples
  }

  out_path = "audit-output/mariadb-live/canonical-scope-contamination/currency_price_research_reconciliation.json"
  os.makedirs(os.path.dirname(out_path), exist_ok=True)
  with open(out_path, "w", encoding="utf-8") as f:
    json.dump(report, f, indent=2)

  print(f"\nSaved currency Price Research reconciliation artifact to {out_path}")

if __name__ == "__main__":
  reconcile()
