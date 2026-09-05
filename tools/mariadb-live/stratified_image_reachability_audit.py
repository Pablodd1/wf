import os
import sys
import json
import hashlib
import urllib.request
import urllib.error
import urllib.parse

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

DO_SPACES_ORIGIN = "https://thecollective-prod.nyc3.digitaloceanspaces.com"

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
    date_windows = [
        ("2025_H1_Early", "2025-01-01", "2025-07-01"),
        ("2025_H2_Mid", "2025-07-01", "2026-01-01"),
        ("2026_YTD_Recent", "2026-01-01", "2027-01-01")
    ]
    for declared_stratum, start_date, end_date in date_windows:
        cur.execute("""
            SELECT source_id, source_created_on, raw_payload->>'front_image'
            FROM wf_canonical_staging.mariadb_authoritative_raw_source_rows
            WHERE source_created_on >= %s AND source_created_on < %s
              AND raw_payload->>'front_image' IS NOT NULL
              AND raw_payload->>'front_image' <> ''
            ORDER BY source_created_on ASC, source_id ASC
            LIMIT 5;
        """, (start_date, end_date))
        for row in cur.fetchall():
            image_records.append({
                "source_id": row[0],
                "created_on": str(row[1] or ""),
                "key": str(row[2] or "").strip(),
                "declared_date_stratum": declared_stratum
            })
    cur.close()
    conn.close()

print(f"Total image records available for stratification: {len(image_records):,}")

def date_stratum(created_on):
    if created_on < "2025-07-01":
        return "2025_H1_Early"
    if created_on < "2026-01-01":
        return "2025_H2_Mid"
    return "2026_YTD_Recent"


def key_format(key):
    lowered = key.lower()
    if lowered.startswith("https://") or lowered.startswith("http://"):
        return "absolute_url"
    if "/" in key or "\\" in key:
        return "path_key"
    return "bare_filename"


def candidate_urls(key):
    """Return canonical resolver candidates without assuming one storage layout."""
    raw = key.strip()
    if raw.lower().startswith(("https://", "http://")):
        return [("source_absolute_url", raw)]

    normalized = raw.replace("\\", "/").lstrip("/")
    filename = normalized.rsplit("/", 1)[-1]
    encoded_filename = urllib.parse.quote(filename)
    candidates = [
        ("canonical_listings_full", f"{DO_SPACES_ORIGIN}/listings/full/{encoded_filename}"),
        ("legacy_listings_root", f"{DO_SPACES_ORIGIN}/listings/{encoded_filename}"),
        ("source_relative_path", f"{DO_SPACES_ORIGIN}/{urllib.parse.quote(normalized, safe='/')}")
    ]
    deduplicated = []
    seen = set()
    for label, url in candidates:
        if url not in seen:
            seen.add(url)
            deduplicated.append((label, url))
    return deduplicated


def test_request(url, method):
    try:
        headers = {"User-Agent": "WatchFacts-ReadOnly-Media-Audit/1.0"}
        if method == "GET":
            headers["Range"] = "bytes=0-0"
        req = urllib.request.Request(url, method=method, headers=headers)
        with urllib.request.urlopen(req, timeout=5) as response:
            content_type = response.headers.get("Content-Type") or ""
            return {
                "http_status": response.status,
                "content_type": content_type,
                "content_length": response.headers.get("Content-Length"),
                "reachable": response.status in (200, 206, 301, 302) and content_type.lower().startswith("image/")
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

# Composite stratification proves both date coverage and key-format coverage.
strata = {}
for record in image_records:
    date_name = record.get("declared_date_stratum") or date_stratum(record["created_on"])
    format_name = record.get("declared_key_format") or key_format(record["key"])
    name = f"{date_name}__{format_name}"
    strata.setdefault(name, []).append(record)

stratified_results = {}
sample_per_stratum = 5

for stratum_name, items in sorted(strata.items()):
    print(f"Testing Stratum: {stratum_name} ({len(items):,} candidate images)...")
    sample = sorted(items, key=lambda row: row["source_id"])[:sample_per_stratum]
    results = []
    for s in sample:
        attempts = []
        resolved_candidate = None
        for candidate_label, url in candidate_urls(s["key"]):
            candidate_reachable = False
            for method in ("HEAD", "GET"):
                response = test_request(url, method)
                attempts.append({
                    "candidate": candidate_label,
                    "method": method,
                    "url_sha256": hashlib.sha256(url.encode("utf-8")).hexdigest(),
                    "http_status": response.get("http_status"),
                    "content_type": response.get("content_type"),
                    "reachable": response.get("reachable", False)
                })
                if response.get("reachable"):
                    candidate_reachable = True
            if candidate_reachable:
                resolved_candidate = candidate_label
                break
        results.append({
            "source_id": s["source_id"],
            "created_on": s["created_on"],
            "key_format": key_format(s["key"]),
            "key_hash": hashlib.sha256(s["key"].encode("utf-8")).hexdigest(),
            "reachable": resolved_candidate is not None,
            "resolved_candidate": resolved_candidate,
            "attempts": attempts
        })
    
    reachable_cnt = sum(1 for r in results if r["reachable"])
    pct = (reachable_cnt / len(results) * 100) if results else 0.0
    stratified_results[stratum_name] = {
        "stratum_total_available": max((item.get("stratum_total_available", len(items)) for item in items), default=0),
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
    "contract": "wf-stratified-image-reachability-v2",
    "timestamp": __import__("datetime").datetime.now(__import__("datetime").timezone.utc).isoformat(),
    "storage_origin": DO_SPACES_ORIGIN,
    "resolver_candidates": ["canonical_listings_full", "legacy_listings_root", "source_relative_path", "source_absolute_url"],
    "request_methods": ["HEAD", "GET_RANGE_0_0"],
    "overall_metrics": {
        "total_sample_candidates_loaded": len(image_records),
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
