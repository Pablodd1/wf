import os
import sys
import json
import hashlib
import psycopg2

print("================================================================================")
print("REBUILDING 10,000-ROW NORMALIZATION CANARY CROSS-TABULATION MATRIX")
print("================================================================================\n")

proposals_path = "audit-output/mariadb-live/normalization-canary-10k/proposals.jsonl"
if not os.path.exists(proposals_path):
    print(f"FATAL: {proposals_path} does not exist.", file=sys.stderr)
    sys.exit(1)

records = []
with open(proposals_path, "r", encoding="utf-8") as f:
    for line in f:
        line = line.strip()
        if line:
            records.append(json.loads(line))

print(f"Loaded {len(records):,} normalized proposals from {proposals_path}.")

# Connect to DB to join 10k source_ids to raw_payload->>'type'
conn = psycopg2.connect(os.environ["DATABASE_URL"], options="-c timezone=UTC")
cur = conn.cursor()

source_ids = [r["source_id"] for r in records]

cur.execute("""
    SELECT source_id, raw_payload->>'type'
    FROM wf_canonical_staging.mariadb_authoritative_raw_source_rows
    WHERE source_id = ANY(%s);
""", (source_ids,))

raw_type_map = {row[0]: (row[1] if row[1] is not None else "<NULL>") for row in cur.fetchall()}
cur.close()
conn.close()

print(f"Retrieved raw_payload->>'type' for {len(raw_type_map):,} records.")

# Rebuild 2D Matrix: Text-Derived Intent vs Raw Payload Type
# Rows: Text-Derived Intent ('WTS', 'WTB', 'UNKNOWN_INTENT')
# Columns: Raw Payload Type ('sale', 'search', '<NULL>')
matrix = {
    "WTS": {"sale": 0, "search": 0, "<NULL>": 0, "total": 0},
    "WTB": {"sale": 0, "search": 0, "<NULL>": 0, "total": 0},
    "UNKNOWN_INTENT": {"sale": 0, "search": 0, "<NULL>": 0, "total": 0}
}

for r in records:
    text_intent = r.get("intent") or "UNKNOWN_INTENT"
    raw_type = raw_type_map.get(r["source_id"], "<NULL>")
    
    if text_intent not in matrix:
        matrix[text_intent] = {"sale": 0, "search": 0, "<NULL>": 0, "total": 0}
    if raw_type not in matrix[text_intent]:
        matrix[text_intent][raw_type] = 0
        
    matrix[text_intent][raw_type] += 1
    matrix[text_intent]["total"] += 1

# Analyze Explicit-USD Records
usd_records = [r for r in records if r.get("currency_status") == "VERIFIED_EXPLICIT_USD"]
usd_analysis = []
usd_rejection_reasons = {}

for r in usd_records:
    pr_status = r.get("price_research_status")
    tf_status = r.get("trading_floor_status")
    intent = r.get("intent")
    price = r.get("price_usd") or r.get("original_price_amount")
    raw_t = raw_type_map.get(r["source_id"], "<NULL>")
    
    reasons = []
    if pr_status != "ELIGIBLE_VERIFIED_USD":
        if tf_status == "HELD_INTENT_UNKNOWN":
            reasons.append("Trading Floor hold: text-derived intent is unknown/unconfirmed")
        elif tf_status == "HELD_BUNDLE_UNSPLIT":
            reasons.append("Trading Floor hold: multi-offer bundle requires splitting before pricing")
        elif tf_status == "HELD_IDENTITY_INCOMPLETE":
            reasons.append("Trading Floor hold: brand/reference identity incomplete")
        elif intent == "WTB":
            reasons.append("WTB buyer inquiry (Price Research only accepts WTS seller offers)")
        elif pr_status == "INELIGIBLE_AMBIGUOUS_CURRENCY":
            reasons.append("Ambiguous bare-dollar currency token held")
        elif pr_status == "INELIGIBLE_MISSING_PRICE":
            reasons.append("Price amount missing or zero")
        else:
            reasons.append(f"Status: {pr_status}")

    reason_summary = "; ".join(reasons) if reasons else "ELIGIBLE"
    usd_rejection_reasons[reason_summary] = usd_rejection_reasons.get(reason_summary, 0) + 1

    usd_analysis.append({
        "source_id": r.get("source_id"),
        "brand": r.get("brand"),
        "reference": r.get("reference"),
        "price_usd": price,
        "text_derived_intent": intent,
        "raw_payload_type": raw_t,
        "trading_floor_status": tf_status,
        "price_research_status": pr_status,
        "price_research_eligible": r.get("price_research_eligible", False),
        "rejection_reason": reason_summary
    })

# Redacted UNKNOWN_INTENT sample
unknown_intent_records = [r for r in records if r.get("trading_floor_status") == "HELD_INTENT_UNKNOWN"]
unknown_samples = []
for r in unknown_intent_records[:10]:
    unknown_samples.append({
        "source_id": r.get("source_id"),
        "brand": r.get("brand"),
        "reference": r.get("reference"),
        "raw_payload_type": raw_type_map.get(r["source_id"], "<NULL>"),
        "evidence_sha256": r.get("listing_text_evidence"),
        "trading_floor_status": r.get("trading_floor_status"),
        "hold_reason": "Listing text contains brand/model details but lacks explicit WTS/WTB tokens in text"
    })

cross_tab_report = {
    "contract": "wf-authoritative-10k-cross-tab-v2",
    "timestamp": "2026-09-01T22:45:00.000Z",
    "cohort_size": 10000,
    "intent_vs_raw_type_matrix": matrix,
    "explicit_usd_summary": {
        "total_explicit_usd_records": len(usd_records),
        "eligible_for_price_research": sum(1 for r in usd_records if r.get("price_research_eligible")),
        "rejection_breakdown": usd_rejection_reasons,
        "records": usd_analysis
    },
    "unknown_intent_sample_audit": unknown_samples
}

out_dir = "audit-output/mariadb-live/normalization-canary-10k"
json_out = os.path.join(out_dir, "canary-10k-cross-tab-analysis.json")
with open(json_out, "w", encoding="utf-8") as f:
    json.dump(cross_tab_report, f, indent=2)

with open(json_out, "rb") as f:
    json_sha = hashlib.sha256(f.read()).hexdigest()

print("\nMatrix Summary:")
print(json.dumps(matrix, indent=2))
print(f"\nSaved cross-tab analysis report to {json_out} (SHA-256: {json_sha})")
