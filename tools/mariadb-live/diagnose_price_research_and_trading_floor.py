# tools/mariadb-live/diagnose_price_research_and_trading_floor.py
import os
import sys
import json
import psycopg2

if hasattr(sys.stdout, "reconfigure"):
  sys.stdout.reconfigure(encoding="utf-8", errors="replace")

def diagnose():
  db_url = os.environ.get("DATABASE_URL")
  if not db_url:
    print("FATAL: DATABASE_URL required.", file=sys.stderr)
    sys.exit(1)

  conn = psycopg2.connect(db_url)
  cur = conn.cursor()
  cur.execute("SET statement_timeout = '600s';")

  print("==================================================================")
  print("1. PRICE RESEARCH & TRADING FLOOR ELIGIBILITY TOTALS")
  print("==================================================================")
  cur.execute("""
    SELECT 
      COUNT(*) AS total_children,
      COUNT(*) FILTER (WHERE price_research_eligible = true) AS pr_eligible,
      COUNT(*) FILTER (WHERE price_research_eligible = false) AS pr_ineligible,
      COUNT(*) FILTER (WHERE trading_floor_eligible = true) AS tf_eligible,
      COUNT(*) FILTER (WHERE trading_floor_eligible = false) AS tf_ineligible
    FROM wf_canonical_staging.mariadb_normalized_children;
  """)
  tot_c, pr_e, pr_ine, tf_e, tf_ine = cur.fetchone()
  print(f"Total Children: {tot_c:,}")
  print(f"Price Research Eligible: {pr_e:,} ({pr_e/tot_c*100:.2f}%) | Ineligible: {pr_ine:,}")
  print(f"Trading Floor Eligible:  {tf_e:,} ({tf_e/tot_c*100:.2f}%) | Ineligible: {tf_ine:,}")

  print("\n==================================================================")
  print("2. PRICE RESEARCH STATUS DISTRIBUTION")
  print("==================================================================")
  cur.execute("""
    SELECT price_research_status, COUNT(*), ROUND(COUNT(*)::numeric / %s * 100, 2) AS pct
    FROM wf_canonical_staging.mariadb_normalized_children
    GROUP BY price_research_status
    ORDER BY COUNT(*) DESC;
  """, (tot_c,))
  pr_dist = cur.fetchall()
  for r in pr_dist:
    print(f"  {r[0]}: {r[1]:,} ({r[2]}%)")

  print("\n==================================================================")
  print("3. CURRENCY STATUS DISTRIBUTION")
  print("==================================================================")
  cur.execute("""
    SELECT currency_status, COUNT(*), ROUND(COUNT(*)::numeric / %s * 100, 2) AS pct
    FROM wf_canonical_staging.mariadb_normalized_children
    GROUP BY currency_status
    ORDER BY COUNT(*) DESC;
  """, (tot_c,))
  curr_dist = cur.fetchall()
  for r in curr_dist:
    print(f"  {r[0]}: {r[1]:,} ({r[2]}%)")

  print("\n==================================================================")
  print("4. TRADING FLOOR STATUS DISTRIBUTION")
  print("==================================================================")
  cur.execute("""
    SELECT trading_floor_status, COUNT(*), ROUND(COUNT(*)::numeric / %s * 100, 2) AS pct
    FROM wf_canonical_staging.mariadb_normalized_children
    GROUP BY trading_floor_status
    ORDER BY COUNT(*) DESC;
  """, (tot_c,))
  tf_dist = cur.fetchall()
  for r in tf_dist:
    print(f"  {r[0]}: {r[1]:,} ({r[2]}%)")

  print("\n==================================================================")
  print("5. INTENT DISTRIBUTION")
  print("==================================================================")
  cur.execute("""
    SELECT intent, COUNT(*), ROUND(COUNT(*)::numeric / %s * 100, 2) AS pct
    FROM wf_canonical_staging.mariadb_normalized_children
    GROUP BY intent
    ORDER BY COUNT(*) DESC;
  """, (tot_c,))
  intent_dist = cur.fetchall()
  for r in intent_dist:
    print(f"  {r[0]}: {r[1]:,} ({r[2]}%)")

  print("\n==================================================================")
  print("6. EXCLUSION REASONS DISTRIBUTION")
  print("==================================================================")
  cur.execute("""
    SELECT reason, COUNT(*)
    FROM wf_canonical_staging.mariadb_normalized_children c,
         jsonb_array_elements_text(CASE WHEN jsonb_typeof(c.exclusion_reasons::jsonb) = 'array' THEN c.exclusion_reasons::jsonb ELSE '[]'::jsonb END) AS reason
    GROUP BY 1
    ORDER BY COUNT(*) DESC
    LIMIT 25;
  """)
  excl_dist = cur.fetchall()
  for r in excl_dist:
    print(f"  {r[0]}: {r[1]:,}")

  print("\n==================================================================")
  print("7. REVIEW FLAGS DISTRIBUTION")
  print("==================================================================")
  cur.execute("""
    SELECT flag, COUNT(*)
    FROM wf_canonical_staging.mariadb_normalized_children c,
         jsonb_array_elements_text(CASE WHEN jsonb_typeof(c.review_flags::jsonb) = 'array' THEN c.review_flags::jsonb ELSE '[]'::jsonb END) AS flag
    GROUP BY 1
    ORDER BY COUNT(*) DESC
    LIMIT 25;
  """)
  flag_dist = cur.fetchall()
  for r in flag_dist:
    print(f"  {r[0]}: {r[1]:,}")

  print("\n==================================================================")
  print("8. SOURCE-BACKED EXAMPLES ACROSS CURRENCIES")
  print("==================================================================")
  target_currencies = ["USD", "USDT", "HKD", "EUR", "GBP", "SGD", "AED", "CHF", "CNY", "JPY"]
  currency_examples = {}

  for curr in target_currencies:
    cur.execute("""
      SELECT c.id, c.parent_source_id, c.brand, c.model, c.reference,
             c.original_price_amount, c.original_price_currency, c.currency_status,
             c.price_usd, c.fx_rate, c.price_research_status, c.price_research_eligible,
             c.trading_floor_status, c.trading_floor_eligible, c.exclusion_reasons, c.review_flags,
             p.raw_message_original
      FROM wf_canonical_staging.mariadb_normalized_children c
      JOIN wf_canonical_staging.mariadb_normalized_parents p ON c.parent_id = p.id
      WHERE (c.original_price_currency = %s OR c.currency_status LIKE %s)
      ORDER BY c.normalized_at DESC
      LIMIT 2;
    """, (curr, f"%{curr}%"))
    rows = cur.fetchall()
    currency_examples[curr] = []
    print(f"\n--- Currency: {curr} (Found: {len(rows)}) ---")
    for r in rows:
      ex = {
        "child_id": str(r[0]),
        "source_id": r[1],
        "brand": r[2],
        "model": r[3],
        "reference": r[4],
        "original_price_amount": float(r[5]) if r[5] is not None else None,
        "original_price_currency": r[6],
        "currency_status": r[7],
        "price_usd": float(r[8]) if r[8] is not None else None,
        "fx_rate": float(r[9]) if r[9] is not None else None,
        "price_research_status": r[10],
        "price_research_eligible": r[11],
        "trading_floor_status": r[12],
        "trading_floor_eligible": r[13],
        "exclusion_reasons": r[14],
        "review_flags": r[15],
        "raw_snippet": (r[16] or "")[:200]
      }
      currency_examples[curr].append(ex)
      print(f"  Brand={ex['brand']} | Ref={ex['reference']} | OrigPrice={ex['original_price_amount']} {ex['original_price_currency']} | Status={ex['currency_status']} | PR_Status={ex['price_research_status']} | Eligible={ex['price_research_eligible']}")
      print(f"    Raw: {ex['raw_snippet'][:120]}...")

  report = {
    "contract": "wf-price-research-and-trading-floor-diagnostics-v1",
    "summary": {
      "total_children": tot_c,
      "price_research_eligible": pr_e,
      "price_research_ineligible": pr_ine,
      "trading_floor_eligible": tf_e,
      "trading_floor_ineligible": tf_ine
    },
    "distributions": {
      "price_research_status": {r[0]: {"count": r[1], "pct": float(r[2])} for r in pr_dist},
      "currency_status": {r[0]: {"count": r[1], "pct": float(r[2])} for r in curr_dist},
      "trading_floor_status": {r[0]: {"count": r[1], "pct": float(r[2])} for r in tf_dist},
      "intent": {r[0]: {"count": r[1], "pct": float(r[2])} for r in intent_dist},
      "top_exclusion_reasons": {r[0]: r[1] for r in excl_dist},
      "top_review_flags": {r[0]: r[1] for r in flag_dist}
    },
    "currency_examples": currency_examples
  }

  out_path = "audit-output/mariadb-live/canonical-scope-contamination/price_research_and_trading_floor_diagnostics.json"
  os.makedirs(os.path.dirname(out_path), exist_ok=True)
  with open(out_path, "w", encoding="utf-8") as f:
    json.dump(report, f, indent=2)

  print(f"\nSaved full diagnostic report to {out_path}")

if __name__ == "__main__":
  diagnose()
