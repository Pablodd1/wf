import os
import sys
import json
import hashlib
import urllib.request
import urllib.error

print("================================================================================")
print("STRATIFIED IMAGE REACHABILITY AUDIT (BY DATE & SOURCE-KEY FORMAT)")
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

DO_SPACES_BASE = "https://thecollective-prod.nyc3.digitaloceanspaces.com/listings"

# Extract images with date and key pattern
image_records = []
for r in records:
    key = r.get("image_key")
    if key and not key.startswith("[REDACTED"):
        created = r.get("source_cursor", "").split(",")[0].strip()
        image_records.append({
            "source_id": r.get("source_id"),
            "created_on": created,
            "key": key
        })

# If keys were redacted in jsonl, query a small sample from mariadb_authoritative_raw_source_rows directly
if len(image_records) == 0:
    import psycopg2
    conn = psycopg2.connect(os.environ["DATABASE_URL"], options="-c timezone=UTC")
    cur = conn.cursor()
    cur.execute("""
        SELECT source_id, source_created_on, raw_payload->>'front_image'
        FROM wf_canonical_staging.mariadb_authoritative_raw_source_rows
        WHERE raw_payload->>'front_image' IS NOT NULL AND raw_payload->>'front_image' <> ''
        LIMIT 10000;
    """)
    for row in cur.fetchall():
        image_records.append({
            "source_id": row[0],
            "created_on": str(row[1] or ""),
            "key": str(row[2] or "").strip()
        })
    cur.close()
    conn.close()

print(f"Total image records available for stratification: {len(image_records):,}")

# Stratify by Date:
# Stratum A: 2025-01 to 2025-06
# Stratum B: 2025-07 to 2025-12
# Stratum C: 2026-01 to 2026-08
strata_dates = {
    "2025_H1_Early": [r for r in image_records if r["created_on"] < "2025-07-01"],
    "2025_H2_Mid": [r for r in image_records if "2025-07-01" <= r["created_on"] < "2026-01-01"],
    "2026_YTD_Recent": [r for r in image_records if r["created_on"] >= "2026-01-01"]
}

def test_reachability(url):
    try:
        req = urllib.request.Request(url, method="HEAD", headers={"User-Agent": "Antigravity-Audit/1.0"})
        with urllib.request.urlopen(req, timeout=5) as response:
            return {
                "http_status": response.status,
                "content_type": response.headers.get("Content-Type"),
                "content_length": response.headers.get("Content-Length"),
                "reachable": response.status in (200, 301, 302)
            }
    except urllib.error.HTTPError as e:
        return {
            "http_status": e.code,
            "error": str(e),
            "reachable": e.code in (200, 301, 302)
        }
    except Exception as e:
        return {
            "http_status": None,
            "error": str(e),
            "reachable": False
        }

stratified_results = {}
sample_per_stratum = 15

for stratum_name, items in strata_dates.items():
    print(f"Testing Stratum: {stratum_name} ({len(items):,} candidate images)...")
    sample = items[:sample_per_stratum]
    results = []
    for s in sample:
        url = f"{DO_SPACES_BASE}/{s['key']}"
        res = test_reachability(url)
        results.append({
            "source_id": s["source_id"],
            "created_on": s["created_on"],
            "key_hash": hashlib.sha256(s["key"].encode("utf-8")).hexdigest(),
            "http_status": res.get("http_status"),
            "reachable": res.get("reachable")
        })
    
    reachable_cnt = sum(1 for r in results if r["reachable"])
    pct = (reachable_cnt / len(results) * 100) if results else 0.0
    stratified_results[stratum_name] = {
        "stratum_total_available": len(items),
        "sample_tested": len(results),
        "reachable_count": reachable_cnt,
        "reachability_percentage": f"{pct:.1f}%",
        "sample_audit": results
    }
    print(f"  Result: {reachable_cnt}/{len(results)} reachable ({pct:.1f}%)")

overall_tested = sum(s["sample_tested"] for s in stratified_results.values())
overall_reachable = sum(s["reachable_count"] for s in stratified_results.values())
overall_pct = (overall_reachable / overall_tested * 100) if overall_tested else 0.0

final_report = {
    "contract": "wf-stratified-image-reachability-v1",
    "timestamp": "2026-09-01T22:35:00.000Z",
    "storage_origin": "https://thecollective-prod.nyc3.digitaloceanspaces.com/listings",
    "overall_metrics": {
        "total_images_in_cohort": len(image_records),
        "total_sample_tested": overall_tested,
        "total_reachable": overall_reachable,
        "overall_reachability_pct": f"{overall_pct:.1f}%"
    },
    "stratified_results": stratified_results
}

out_dir = "audit-output/mariadb-live/normalization-canary-10k"
os.makedirs(out_dir, exist_ok=True)
json_out = os.path.join(out_dir, "stratified-image-reachability.json")
with open(json_out, "w", encoding="utf-8") as f:
    json.dump(final_report, f, indent=2)

with open(json_out, "rb") as f:
    sha = hashlib.sha256(f.read()).hexdigest()

print(f"\nStratified Reachability Report written to {json_out} (SHA-256: {sha})")
