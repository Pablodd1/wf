import os
import sys
import json
import hashlib

print("================================================================================")
print("10,000-ROW NORMALIZATION CANARY CROSS-TABULATION ANALYSIS")
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

print(f"Loaded {len(records):,} normalized proposals from {proposals_path}.\n")

# 1. Analyze all 136 explicit-USD records
usd_records = [r for r in records if r.get("currency_status") == "VERIFIED_EXPLICIT_USD"]
print(f"1. Total Explicit-USD Records: {len(usd_records)}")

usd_analysis = []
usd_rejection_reasons = {}

for r in usd_records:
    # Reason for Price Research ineligibility
    pr_status = r.get("price_research_status")
    tf_status = r.get("trading_floor_status")
    intent = r.get("intent")
    price = r.get("price_usd") or r.get("original_price_amount")
    
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
        "trading_floor_status": tf_status,
        "price_research_status": pr_status,
        "price_research_eligible": r.get("price_research_eligible", False),
        "rejection_reason": reason_summary
    })

print(f"   Explicit-USD Price Research Breakdown:")
for reason, count in usd_rejection_reasons.items():
    print(f"     - {reason}: {count} records")

# 2. Cross-tabulation: Text-Derived Intent vs Raw Payload Type
intent_vs_raw_type = {}
for r in records:
    t_intent = r.get("intent") or "UNKNOWN_INTENT"
    raw_type = r.get("raw_payload", {}).get("type") if isinstance(r.get("raw_payload"), dict) else "<NULL>"
    # If raw_payload not embedded in proposal, check classification
    key = f"Text Intent: {t_intent} | Raw Type: {raw_type}"
    intent_vs_raw_type[key] = intent_vs_raw_type.get(key, 0) + 1

# 3. Identity, Bundle, and Trading Floor Holds Summary
tf_holds = {}
for r in records:
    st = r.get("trading_floor_status")
    tf_holds[st] = tf_holds.get(st, 0) + 1

# 4. Redacted Sample of UNKNOWN_INTENT Records
unknown_intent_records = [r for r in records if r.get("trading_floor_status") == "HELD_INTENT_UNKNOWN"]
unknown_samples = []
for r in unknown_intent_records[:10]:
    unknown_samples.append({
        "source_id": r.get("source_id"),
        "brand": r.get("brand"),
        "reference": r.get("reference"),
        "evidence_sha256": r.get("listing_text_evidence"),
        "trading_floor_status": r.get("trading_floor_status"),
        "hold_reason": "Listing text contains brand/model/details but lacks explicit WTS ('for sale', 'FS', 'available') or WTB ('looking for', 'WTB') tokens"
    })

cross_tab_report = {
    "contract": "wf-authoritative-10k-cross-tab-v1",
    "cohort_size": 10000,
    "explicit_usd_summary": {
        "total_explicit_usd_records": len(usd_records),
        "eligible_for_price_research": sum(1 for r in usd_records if r.get("price_research_eligible")),
        "rejection_breakdown": usd_rejection_reasons,
        "records": usd_analysis
    },
    "trading_floor_holds_summary": tf_holds,
    "unknown_intent_sample_audit": unknown_samples
}

out_dir = "audit-output/mariadb-live/normalization-canary-10k"
json_out = os.path.join(out_dir, "canary-10k-cross-tab-analysis.json")
with open(json_out, "w", encoding="utf-8") as f:
    json.dump(cross_tab_report, f, indent=2)

with open(json_out, "rb") as f:
    json_sha = hashlib.sha256(f.read()).hexdigest()

print(f"\nSaved cross-tab report to {json_out} (SHA-256: {json_sha})")
