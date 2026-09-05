#!/usr/bin/env python3
"""
Gap-finder v3: MySQL `auctions` (dealer messages) vs 354 normalized Excel files.
Stable UUID cursor pagination (id > last_id ORDER BY id).
Output: /tmp/gap_auctions_report.json + /tmp/gap_auctions_missing.csv
"""
import os, json, hashlib, subprocess, csv, sys

OUT_JSON = "/tmp/gap_auctions_report.json"
OUT_CSV = "/tmp/gap_auctions_missing.csv"
MYCNF = "/tmp/.mycnf"
CACHE = "/tmp/norm_hashes_cache.json"

def norm_hash(s):
    if s is None:
        return None
    t = " ".join(str(s).strip().lower().split())
    if not t:
        return None
    return hashlib.md5(t.encode("utf-8", errors="ignore")).hexdigest()

# Load normalized hashes from cache
with open(CACHE) as f:
    c = json.load(f)
norm_hashes = set(c["hashes"])
norm_refs = set(tuple(x) for x in c["refs"])
print(f"Loaded {len(norm_hashes):,} normalized raw hashes, {len(norm_refs):,} brand+ref pairs", flush=True)

CHUNK = 50000
last_id = ""
mysql_total = 0
missing_raw = 0
missing_rows = []
seen_hashes = set()
missing_ref_keys = set()

while True:
    q = ("SELECT `id`,`title`,`brand`,`reference`,`from_name`,`from_number`,`region`,`price`,`status` "
         f"FROM auctions WHERE id > '{last_id}' ORDER BY id LIMIT {CHUNK};")
    out = subprocess.run(["mysql", f"--defaults-extra-file={MYCNF}", "-B", "--raw", "-D", "thecollective_inventory", "-e", q],
                         capture_output=True, timeout=300)
    txt = out.stdout.decode("latin-1").strip()
    lines = txt.split("\n")
    if len(lines) <= 1:
        break
    for line in lines[1:]:
        p = line.split("\t")
        if len(p) < 2:
            continue
        mysql_total += 1
        row_id = p[0]
        title = p[1] if len(p) > 1 else ""
        brand = p[2] if len(p) > 2 else ""
        ref = p[3] if len(p) > 3 else ""
        from_name = p[4] if len(p) > 4 else ""
        from_number = p[5] if len(p) > 5 else ""
        region = p[6] if len(p) > 6 else ""
        price = p[7] if len(p) > 7 else ""
        status = p[8] if len(p) > 8 else ""
        last_id = row_id
        h = norm_hash(title)
        if h:
            seen_hashes.add(h)
            if h not in norm_hashes:
                missing_raw += 1
                if len(missing_rows) < 200000:  # cap CSV
                    missing_rows.append((row_id, brand, ref, from_name, from_number, region, price, status, title[:250]))
        if brand and ref:
            k = (brand.strip().lower(), ref.strip().lower())
            if k not in norm_refs:
                missing_ref_keys.add(k)
    print(f"  ... {mysql_total:,} auctions rows | missing_raw={missing_raw:,} missing_ref_pairs={len(missing_ref_keys):,}", flush=True)
    if len(lines) < CHUNK + 1:
        break

report = {
    "source_table": "auctions",
    "mysql_rows_scanned": mysql_total,
    "mysql_unique_title_hashes": len(seen_hashes),
    "normalized_unique_raw_hashes": len(norm_hashes),
    "missing_by_raw_hash": missing_raw,
    "missing_brand_ref_pairs": len(missing_ref_keys),
    "missing_ref_pair_examples": sorted(list(missing_ref_keys))[:50],
}
with open(OUT_JSON, "w") as f:
    json.dump(report, f, indent=2)

with open(OUT_CSV, "w", newline="", encoding="utf-8") as f:
    w = csv.writer(f)
    w.writerow(["mysql_id", "brand", "ref", "from_name", "from_number", "region", "price", "status", "title_excerpt"])
    for r in missing_rows:
        w.writerow(r)

print("\n===== AUCTIONS GAP REPORT =====", flush=True)
print(json.dumps(report, indent=2), flush=True)
print(f"CSV: {OUT_CSV}", flush=True)
