import json
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(__file__)), "scripts"))
from pipeline_processor import WatchFactsPipelineProcessor
from pipeline_runner import generate_deterministic_uuid

def sql_q(val, is_uuid=False):
    if val is None:
        return "NULL"
    if isinstance(val, bool):
        return "TRUE" if val else "FALSE"
    if isinstance(val, (int, float)):
        return str(val)
    s = str(val).replace("'", "''").replace("\r", " ").replace("\n", " ")
    if is_uuid:
        return f"'{s}'::uuid"
    return f"'{s}'"

json_path = r"C:\Users\Owner\.gemini\antigravity\brain\aaaf9af1-6067-468b-bfc7-1bac307799f6\scratch\canary_json\raw_payloads.json"
with open(json_path, "r", encoding="utf-8") as f:
    raw_payloads = json.load(f)

print(f"Processing {len(raw_payloads)} raw payloads through WatchFactsPipelineProcessor...")
processor = WatchFactsPipelineProcessor()

cols = [
    'id', 'job_id', 'parent_id', 'bundle_position', 'raw_message_text', 'category', 'intent', 'listing_type', 'is_bundle',
    'brand_original', 'brand_normalized', 'model_original', 'model_normalized', 'reference_original', 'reference_normalized',
    'dial_color_original', 'dial_color_normalized', 'dial_color_source', 'price_original', 'currency_original',
    'price_normalized', 'currency_normalized', 'price_usd', 'conversion_rate', 'reserve_price', 'price_min',
    'price_max', 'price_avg', 'condition_original', 'condition_normalized', 'box_original', 'box_normalized',
    'papers_original', 'papers_normalized', 'image_url', 'report_url', 'user_name', 'from_name', 'contact_number',
    'from_number', 'phone_code', 'location', 'rating', 'dealer_rating', 'is_verified_user', 'is_paid_user',
    'is_seller_approved', 'company_id', 'contact_consent', 'catalog_confirmed', 'overall_confidence', 'provenance_metadata', 'verdict',
    'normalization_status', 'trading_floor_status', 'price_research_status'
]
uuids = {'id', 'job_id', 'parent_id'}

payload_rows = []
job_rows = []
listing_rows = []

batch_seen_checksums = set()

for p in raw_payloads:
    payload_id = p["id"]
    job_id = p["id"]
    checksum = p["payload_checksum"]
    
    p_rows_str = f"({sql_q(payload_id, True)}, {sql_q(p['source_platform'])}, {sql_q(p['source_group_id'])}, {sql_q(p['source_group_name'])}, {sql_q(p['source_message_id'])}, {sql_q(p['source_sender_id'])}, {sql_q(p['source_sender_name'])}, {sql_q(p['original_message_text'])}, NOW(), {sql_q(checksum)})"
    payload_rows.append(p_rows_str)
    
    j_rows_str = f"({sql_q(job_id, True)}, {sql_q(payload_id, True)}, 'normalized'::jobs.processing_status, NOW(), NOW())"
    job_rows.append(j_rows_str)
    
    job_data = {
        "id": job_id,
        "message_text": p["original_message_text"],
        "type": "sale" if "sale" in str(p["source_platform"]).lower() or "wts" in str(p["original_message_text"]).lower() else "buy",
        "from_name": p["source_sender_name"],
        "from_number": p["source_sender_id"],
        "region": p["source_group_name"],
        "dealer_rating": 5.0
    }
    
    res = processor.process_job(job_data)
    
    if checksum in batch_seen_checksums:
        res["trading_floor_status"] = "suppressed_exact_duplicate"
    batch_seen_checksums.add(checksum)
    
    parent_uuid = generate_deterministic_uuid("watchfacts.listing.parent", job_id)
    
    parent_dict = {
        "id": parent_uuid, "job_id": job_id, "parent_id": None, "bundle_position": None,
        "raw_message_text": res["raw_message_text"], "category": res["category"], "intent": res["intent"],
        "listing_type": res["listing_type"], "is_bundle": res["is_bundle"],
        "brand_original": res["brand_original"], "brand_normalized": res["brand_normalized"],
        "model_original": res["model_original"], "model_normalized": res["model_normalized"],
        "reference_original": res["reference_original"], "reference_normalized": res["reference_normalized"],
        "dial_color_original": res["dial_color_original"], "dial_color_normalized": res["dial_color_normalized"],
        "dial_color_source": res["dial_color_source"], "price_original": res["price_original"],
        "currency_original": res["currency_original"], "price_normalized": res["price_normalized"],
        "currency_normalized": res["currency_normalized"], "price_usd": res["price_usd"],
        "conversion_rate": res["conversion_rate"], "reserve_price": res["reserve_price"],
        "price_min": res["price_min"], "price_max": res["price_max"], "price_avg": res["price_avg"],
        "condition_original": res["condition_original"], "condition_normalized": res["condition_normalized"],
        "box_original": res["box_original"], "box_normalized": res["box_normalized"],
        "papers_original": res["papers_original"], "papers_normalized": res["papers_normalized"],
        "image_url": res["image_url"], "report_url": res["report_url"], "user_name": res["user_name"],
        "from_name": res["from_name"], "contact_number": res["contact_number"], "from_number": res["from_number"],
        "phone_code": res["phone_code"], "location": res["location"], "rating": res["rating"],
        "dealer_rating": res["dealer_rating"], "is_verified_user": res["is_verified_user"],
        "is_paid_user": res["is_paid_user"], "is_seller_approved": res["is_seller_approved"],
        "company_id": res["company_id"], "contact_consent": True, "catalog_confirmed": res["catalog_confirmed"],
        "overall_confidence": res["overall_confidence"],
        "provenance_metadata": json.dumps(res["provenance_metadata"]),
        "verdict": res["verdict"], "normalization_status": res["normalization_status"],
        "trading_floor_status": res["trading_floor_status"], "price_research_status": res["price_research_status"]
    }
    
    p_vals = [sql_q(parent_dict[c], is_uuid=(c in uuids)) for c in cols]
    listing_rows.append(f"({', '.join(p_vals)})")
    
    for idx, child in enumerate(res.get("child_listings", [])):
        child_uuid = generate_deterministic_uuid("watchfacts.listing.child", f"{job_id}:{idx}")
        child_dict = {
            "id": child_uuid, "job_id": job_id, "parent_id": parent_uuid, "bundle_position": child["bundle_position"],
            "raw_message_text": child["raw_text_segment"], "category": "WATCH", "intent": res["intent"],
            "listing_type": child["listing_type"], "is_bundle": False,
            "brand_original": child["brand_normalized"], "brand_normalized": child["brand_normalized"],
            "model_original": None, "model_normalized": None,
            "reference_original": child["reference_normalized"], "reference_normalized": child["reference_normalized"],
            "dial_color_original": child["dial_color_normalized"], "dial_color_normalized": child["dial_color_normalized"],
            "dial_color_source": child["dial_color_source"], "price_original": child["price_normalized"],
            "currency_original": child["currency_normalized"], "price_normalized": child["price_normalized"],
            "currency_normalized": child["currency_normalized"], "price_usd": child["price_usd"],
            "conversion_rate": child["conversion_rate"], "reserve_price": 0.0,
            "price_min": 0.0, "price_max": 0.0, "price_avg": 0.0,
            "condition_original": child["condition_normalized"], "condition_normalized": child["condition_normalized"],
            "box_original": child["box_normalized"], "box_normalized": child["box_normalized"],
            "papers_original": child["papers_normalized"], "papers_normalized": child["papers_normalized"],
            "image_url": "", "report_url": "", "user_name": res["user_name"],
            "from_name": res["from_name"], "contact_number": res["contact_number"], "from_number": res["from_number"],
            "phone_code": res["phone_code"], "location": res["location"], "rating": res["rating"],
            "dealer_rating": res["dealer_rating"], "is_verified_user": res["is_verified_user"],
            "is_paid_user": res["is_paid_user"], "is_seller_approved": res["is_seller_approved"],
            "company_id": res["company_id"], "contact_consent": True, "catalog_confirmed": False,
            "overall_confidence": child["overall_confidence"],
            "provenance_metadata": json.dumps(child["provenance_metadata"]),
            "verdict": child["verdict"], "normalization_status": child["normalization_status"],
            "trading_floor_status": child["trading_floor_status"], "price_research_status": child["price_research_status"]
        }
        c_vals = [sql_q(child_dict[c], is_uuid=(c in uuids)) for c in cols]
        listing_rows.append(f"({', '.join(c_vals)})")

out_dir = r"C:\Users\Owner\.gemini\antigravity\brain\aaaf9af1-6067-468b-bfc7-1bac307799f6\scratch\mcp_full_canary_chunks"
os.makedirs(out_dir, exist_ok=True)

all_queries = []
all_queries.append("TRUNCATE staging.listings, jobs.processing_jobs, raw.payloads RESTART IDENTITY CASCADE;")

# 1. Payloads in chunks of 100
for i in range(0, len(payload_rows), 100):
    sql = "INSERT INTO raw.payloads (id, source_platform, source_group_id, source_group_name, source_message_id, source_sender_id, source_sender_name, original_message_text, original_timestamp, payload_checksum) VALUES " + ",\n".join(payload_rows[i:i+100]) + " ON CONFLICT (id) DO NOTHING;"
    all_queries.append(sql)

# 2. Jobs in chunks of 100
for i in range(0, len(job_rows), 100):
    sql = "INSERT INTO jobs.processing_jobs (id, raw_payload_id, status, created_at, updated_at) VALUES " + ",\n".join(job_rows[i:i+100]) + " ON CONFLICT (id) DO NOTHING;"
    all_queries.append(sql)

# 3. Listings in chunks of 50
for i in range(0, len(listing_rows), 50):
    sql = f"INSERT INTO staging.listings ({', '.join(cols)}) VALUES " + ",\n".join(listing_rows[i:i+50]) + " ON CONFLICT (id) DO NOTHING;"
    all_queries.append(sql)

print(f"Generated {len(all_queries)} total SQL query blocks ({len(listing_rows)} total listings).")

for idx, qsql in enumerate(all_queries):
    with open(os.path.join(out_dir, f"q_{idx+1:03d}.sql"), "w", encoding="utf-8") as f:
        f.write(qsql)

print(f"Wrote all query files to {out_dir}.")
