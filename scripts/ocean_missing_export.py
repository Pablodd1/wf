#!/usr/bin/env python3
"""
OceanDigital missing-watches export v2 — single full-table stream, local dedupe.
READ-ONLY. Output: clean Excel + CSV + JSON.
"""
import json, hashlib, subprocess, re, csv

MYCNF = "/tmp/.mycnf"
CACHE = "/tmp/norm_hashes_cache.json"
OUT_CSV = "/tmp/ocean_missing_watches.csv"
OUT_XLSX = "/mnt/c/Users/jasme/Downloads/WF/OceanDigital_missing_watches.xlsx"
OUT_JSON = "/tmp/ocean_missing_summary.json"

def norm_hash(s):
    if s is None: return None
    t = " ".join(str(s).strip().lower().split())
    return hashlib.md5(t.encode("utf-8", errors="ignore")).hexdigest() if t else None

def clean(s):
    if s is None: return ""
    # strip control chars illegal in xlsx
    return re.sub(r'[\x00-\x08\x0b\x0c\x0e-\x1f]', '', str(s))

with open(CACHE) as f:
    norm_hashes = set(json.load(f)["hashes"])
print(f"Loaded {len(norm_hashes):,} normalized hashes", flush=True)

BRANDS = ['rolex','patek','audemars','omega','cartier','tudor','panerai','hublot','iwc','zenith',
          'breitling','vacheron','richard mille','jacob','bvlgari','piaget','jaeger','lange',
          'journe','breguet','blancpain','glashutte','grand seiko','tag heuer',
          'chopard','ulysse','girard','mb&f','moser','franck muller','bell & ross','roger dubuis']
REF_RE = re.compile(r'\b\d{4,7}[A-Z]{0,4}\b')
def is_watch(t):
    tl = t.lower()
    return any(b in tl for b in BRANDS) or bool(REF_RE.search(t))

q = ("SELECT `id`,`title`,`from_name`,`from_number`,`region`,`price`,`status`,`origin`,`deadline` FROM auctions;")
print("Streaming full auctions table (single query)...", flush=True)
proc = subprocess.Popen(["mysql", f"--defaults-extra-file={MYCNF}", "-B", "--raw", "-D", "thecollective_inventory", "-e", q],
                        stdout=subprocess.PIPE)
total = 0
missing_watch = []
seen_titles = set()
first = True
for raw_line in proc.stdout:
    line = raw_line.decode("latin-1").rstrip("\n")
    if first:
        first = False
        continue
    p = line.split("\t")
    if len(p) < 2:
        continue
    total += 1
    row_id, title = p[0], p[1]
    from_name = p[2] if len(p) > 2 else ""
    from_number = p[3] if len(p) > 3 else ""
    region = p[4] if len(p) > 4 else ""
    price = p[5] if len(p) > 5 else ""
    status = p[6] if len(p) > 6 else ""
    origin = p[7] if len(p) > 7 else ""
    deadline = p[8] if len(p) > 8 else ""
    h = norm_hash(title)
    if not h or h in seen_titles:
        continue
    seen_titles.add(h)
    if h in norm_hashes:
        continue
    if is_watch(title):
        missing_watch.append((row_id, from_name, from_number, region, price, status, origin, deadline, title))
    if total % 200000 == 0:
        print(f"  ... {total:,} rows | unique {len(seen_titles):,} | missing {len(missing_watch):,}", flush=True)
proc.wait()

print(f"\nDONE: {total:,} rows, {len(seen_titles):,} unique titles, {len(missing_watch):,} missing watch listings", flush=True)

with open(OUT_CSV, "w", newline="", encoding="utf-8") as f:
    w = csv.writer(f)
    w.writerow(["mysql_id","from_name","from_number","region","price","status","origin","deadline","title"])
    for r in missing_watch:
        w.writerow([clean(x) for x in r])

import openpyxl
wb = openpyxl.Workbook()
ws = wb.active
ws.title = "Missing Watches"
ws.append(["mysql_id","from_name","from_number","region","price","status","origin","deadline","title"])
for r in missing_watch:
    ws.append([clean(x) for x in r])
wb.save(OUT_XLSX)

summary = {"rows_scanned": total, "unique_titles": len(seen_titles),
           "missing_watch_listings": len(missing_watch), "xlsx": OUT_XLSX, "csv": OUT_CSV}
with open(OUT_JSON, "w") as f:
    json.dump(summary, f, indent=2)
print(json.dumps(summary, indent=2), flush=True)
