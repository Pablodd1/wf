import urllib.request
import json
import os

SUPABASE_URL = "https://qnsafosakvonzgfcsphh.supabase.co"
ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFuc2Fmb3Nha3ZvbnpnZmNzcGhoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODYwMjI3NDEsImV4cCI6MjEwMTU5ODc0MX0.YUxMjnTHtgPsiWiWko3TS1A47Sjk33SuHC2TND0Rxmg"

def query_postgrest(endpoint, query_params="select=id&limit=1", schema=None):
    url = f"{SUPABASE_URL}/rest/v1/{endpoint}?{query_params}"
    headers = {
        "apikey": ANON_KEY,
        "Authorization": f"Bearer {ANON_KEY}",
        "Prefer": "count=exact"
    }
    if schema:
        headers["Accept-Profile"] = schema
        headers["Content-Profile"] = schema
        
    req = urllib.request.Request(url, headers=headers, method="GET")
    with urllib.request.urlopen(req) as resp:
        content_range = resp.headers.get("Content-Range")
        data = json.loads(resp.read().decode("utf-8"))
        total = None
        if content_range and "/" in content_range:
            total = int(content_range.split("/")[1])
        return {
            "endpoint": endpoint,
            "schema": schema or "public",
            "content_range": content_range,
            "total_count": total,
            "sample_row": data[0] if data else None
        }

print("Querying PostgREST endpoints...")
res_raw = query_postgrest("payloads", "select=id&limit=1", schema="raw")
res_jobs = query_postgrest("processing_jobs", "select=id,status&limit=1", schema="jobs")
res_staging_total = query_postgrest("listings", "select=id&limit=1", schema="staging")
res_staging_parents = query_postgrest("listings", "parent_id=is.null&select=id&limit=1", schema="staging")
res_staging_children = query_postgrest("listings", "parent_id=not.is.null&select=id&limit=1", schema="staging")
res_tf = query_postgrest("reviewed_workbook_market_source_v2", "select=id,contact_publication_approved&limit=1")
res_pr = query_postgrest("price_research_verified_source", "select=id,listing_status&limit=1")

summary = {
    "raw_payloads": res_raw,
    "processing_jobs": res_jobs,
    "staging_listings_total": res_staging_total,
    "staging_listings_parents": res_staging_parents,
    "staging_listings_children": res_staging_children,
    "trading_floor_view": res_tf,
    "price_research_view": res_pr
}

print("\n--- EXACT POSTGREST COUNT AUDIT RESULTS ---")
print(json.dumps(summary, indent=2))

with open(r"C:\Users\Owner\.gemini\antigravity\brain\aaaf9af1-6067-468b-bfc7-1bac307799f6\scratch\postgrest_audit.json", "w") as f:
    json.dump(summary, f, indent=2)
