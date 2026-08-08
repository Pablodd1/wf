import json
import os
import sys
import urllib.request
import urllib.parse

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(__file__)), "scripts"))
from pipeline_processor import WatchFactsPipelineProcessor
from pipeline_runner import generate_deterministic_uuid

SUPABASE_URL = os.environ.get("SUPABASE_URL", "https://qnsafosakvonzgfcsphh.supabase.co")
ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFuc2Fmb3Nha3ZvbnpnZmNzcGhoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODYwMjI3NDEsImV4cCI6MjEwMTU5ODc0MX0.YUxMjnTHtgPsiWiWko3TS1A47Sjk33SuHC2TND0Rxmg"
SUPABASE_KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY") or os.environ.get("SUPABASE_ANON_KEY") or ANON_KEY

def rest_post(endpoint, records, schema=None):
    url = f"{SUPABASE_URL}/rest/v1/{endpoint}"
    data_bytes = json.dumps(records).encode('utf-8')
    headers = {
        "apikey": SUPABASE_KEY,
        "Authorization": f"Bearer {SUPABASE_KEY}",
        "Content-Type": "application/json",
        "Prefer": "resolution=merge-duplicates"
    }
    if schema:
        headers["Content-Profile"] = schema
    req = urllib.request.Request(url, data=data_bytes, headers=headers, method='POST')
    try:
        with urllib.request.urlopen(req) as resp:
            return resp.status
    except urllib.error.HTTPError as e:
        print(f"HTTP Error {e.code} on {endpoint}: {e.read().decode('utf-8')}")
        raise

json_path = r"C:\Users\Owner\.gemini\antigravity\brain\aaaf9af1-6067-468b-bfc7-1bac307799f6\scratch\canary_json\raw_payloads.json"
with open(json_path, "r", encoding="utf-8") as f:
    raw_payloads = json.load(f)

print(f"Preparing PostgREST payload ingestion for {len(raw_payloads)} records...")
processor = WatchFactsPipelineProcessor()

payloads_to_insert = []
jobs_to_insert = []
listings_to_insert = []

batch_seen_checksums = set()

for p in raw_payloads:
    payload_id = p["id"]
    job_id = p["id"]
    checksum = p["payload_checksum"]
    
    payloads_to_insert.append({
        "id": payload_id,
        "source_platform": p["source_platform"],
        "source_group_id": p["source_group_id"],
        "source_group_name": p["source_group_name"],
        "source_message_id": p["source_message_id"],
        "source_sender_id": p["source_sender_id"],
        "source_sender_name": p["source_sender_name"],
        "original_message_text": p["original_message_text"],
        "payload_checksum": checksum
    })
    
    jobs_to_insert.append({
        "id": job_id,
        "raw_payload_id": payload_id,
        "status": "normalized"
    })
    
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
    
    parent_record = {
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
        "provenance_metadata": res["provenance_metadata"],
        "verdict": res["verdict"], "normalization_status": res["normalization_status"],
        "trading_floor_status": res["trading_floor_status"], "price_research_status": res["price_research_status"]
    }
    listings_to_insert.append(parent_record)
    
    for idx, child in enumerate(res.get("child_listings", [])):
        child_uuid = generate_deterministic_uuid("watchfacts.listing.child", f"{job_id}:{idx}")
        child_record = {
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
            "provenance_metadata": child["provenance_metadata"],
            "verdict": child["verdict"], "normalization_status": child["normalization_status"],
            "trading_floor_status": child["trading_floor_status"], "price_research_status": child["price_research_status"]
        }
        listings_to_insert.append(child_record)

print(f"Total records to insert: Payloads={len(payloads_to_insert)}, Jobs={len(jobs_to_insert)}, Listings={len(listings_to_insert)}")

# Ingest Payloads
print("Posting raw payloads...")
for i in range(0, len(payloads_to_insert), 100):
    rest_post("payloads", payloads_to_insert[i:i+100], schema="raw")

# Ingest Jobs
print("Posting jobs...")
for i in range(0, len(jobs_to_insert), 100):
    rest_post("processing_jobs", jobs_to_insert[i:i+100], schema="jobs")

# Ingest Listings
print("Posting listings...")
for i in range(0, len(listings_to_insert), 200):
    chunk = listings_to_insert[i:i+200]
    rest_post("listings", chunk, schema="staging")
    print(f"Posted listings {i}..{i+len(chunk)}")

print("Bulk ingestion complete!")
