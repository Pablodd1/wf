#!/usr/bin/env python3
"""
Gap-finder v2 (parallel): MySQL raw source vs 354 normalized Excel files.
Step 1: parallel hash extraction from Excel (14 workers).
Step 2: stream MySQL and compare.
Output: /tmp/gap_report.json + /tmp/gap_missing.csv
"""
import os, glob, json, hashlib, subprocess, csv, sys
from concurrent.futures import ProcessPoolExecutor

NORM_DIR = "/mnt/c/Users/jasme/Downloads/WF/ALL watches normalized/3 PP rolex and au"
OUT_JSON = "/tmp/gap_report.json"
OUT_CSV = "/tmp/gap_missing.csv"
MYCNF = "/tmp/.mycnf"

def norm_hash(s):
    if s is None:
        return None
    t = " ".join(str(s).strip().lower().split())
    if not t:
        return None
    return hashlib.md5(t.encode("utf-8", errors="ignore")).hexdigest()

def extract_file(f):
    """Returns (hashes_set, refs_set, row_count) for one Excel file."""
    import openpyxl
    hashes = set()
    refs = set()
    rows_n = 0
    try:
        wb = openpyxl.load_workbook(f, read_only=True)
        ws = wb.active
        it = ws.iter_rows(values_only=True)
        headers = [str(c) if c is not None else "" for c in next(it)]
        raw_idx = headers.index("raw_line") if "raw_line" in headers else -1
        brand_idx = headers.index("Brand") if "Brand" in headers else -1
        ref_idx = headers.index("Normalized Reference") if "Normalized Reference" in headers else -1
        for r in it:
            rows_n += 1
            if raw_idx >= 0:
                h = norm_hash(r[raw_idx])
                if h:
                    hashes.add(h)
            if brand_idx >= 0 and ref_idx >= 0 and r[brand_idx] and r[ref_idx]:
                refs.add((str(r[brand_idx]).strip().lower(), str(r[ref_idx]).strip().lower()))
        wb.close()
    except Exception as e:
        return (set(), set(), 0, f"{os.path.basename(f)}: {e}")
    return (hashes, refs, rows_n, None)

def main():
    files = sorted(glob.glob(os.path.join(NORM_DIR, "*.xlsx")))
    CACHE = "/tmp/norm_hashes_cache.json"
    if os.path.exists(CACHE):
        print("Step 1: loading cached hashes...", flush=True)
        with open(CACHE) as f:
            c = json.load(f)
        norm_hashes = set(c["hashes"])
        norm_refs = set(tuple(x) for x in c["refs"])
        total_rows = c["total_rows"]
        print(f"  DONE (cache): {total_rows:,} rows, {len(norm_hashes):,} hashes, {len(norm_refs):,} pairs", flush=True)
    else:
        print(f"Step 1: {len(files)} files, parallel extract (14 workers)...", flush=True)

        norm_hashes = set()
        norm_refs = set()
        total_rows = 0
        errs = []
        done = 0
        with ProcessPoolExecutor(max_workers=14) as ex:
            for hashes, refs, rows_n, err in ex.map(extract_file, files):
                done += 1
                if err:
                    errs.append(err)
                norm_hashes |= hashes
                norm_refs |= refs
                total_rows += rows_n
                if done % 25 == 0:
                    print(f"  ... {done}/{len(files)} files, {total_rows:,} rows, {len(norm_hashes):,} hashes", flush=True)

        print(f"  DONE: {total_rows:,} rows, {len(norm_hashes):,} unique raw hashes, {len(norm_refs):,} brand+ref pairs, {len(errs)} errors", flush=True)
        with open(CACHE, "w") as f:
            json.dump({"hashes": list(norm_hashes), "refs": [list(x) for x in norm_refs], "total_rows": total_rows}, f)

    # ---------- Step 2: MySQL ----------
    print("Step 2: MySQL auction_watches columns...", flush=True)
    col_q = "SHOW COLUMNS FROM auction_watches;"
    out = subprocess.run(["mysql", f"--defaults-extra-file={MYCNF}", "-B", "-D", "thecollective_inventory", "-e", col_q],
                         capture_output=True, text=True, timeout=60)
    cols = [l.split("\t")[0] for l in out.stdout.strip().split("\n")[1:] if l.strip()]
    raw_col = next((c for c in ["raw_message", "title", "raw_text", "message", "description"] if c in cols), None)
    brand_col = "brand" if "brand" in cols else None
    ref_col = next((c for c in ["reference", "normalized_reference", "ref"] if c in cols), None)
    id_col = "id" if "id" in cols else cols[0]
    print(f"  id={id_col} raw={raw_col} brand={brand_col} ref={ref_col}", flush=True)
    if not raw_col:
        print("FATAL: no raw column", flush=True)
        sys.exit(1)

    sel = f"SELECT `{id_col}`,`{raw_col}`"
    if brand_col: sel += f",`{brand_col}`"
    if ref_col: sel += f",`{ref_col}`"

    CHUNK = 100000
    offset = 0
    mysql_total = 0
    missing_raw = []
    seen_mysql_hashes = set()
    missing_ref_keys = set()

    while True:
        q = f"{sel} FROM auction_watches ORDER BY `{id_col}` LIMIT {CHUNK} OFFSET {offset};"
        out = subprocess.run(["mysql", f"--defaults-extra-file={MYCNF}", "-B", "--raw", "-D", "thecollective_inventory", "-e", q],
                             capture_output=True, timeout=300)
        lines = out.stdout.decode("latin-1").strip().split("\n")
        if len(lines) <= 1:
            break
        for line in lines[1:]:
            parts = line.split("\t")
            if len(parts) < 2:
                continue
            mysql_total += 1
            row_id, raw_txt = parts[0], parts[1]
            brand = parts[2] if brand_col and len(parts) > 2 else ""
            ref = parts[-1] if ref_col and len(parts) > 2 else ""
            h = norm_hash(raw_txt)
            if h:
                seen_mysql_hashes.add(h)
                if h not in norm_hashes:
                    missing_raw.append((row_id, brand, ref, raw_txt[:300]))
            if brand and ref:
                k = (brand.strip().lower(), ref.strip().lower())
                if k not in norm_refs:
                    missing_ref_keys.add(k)
        offset += CHUNK
        print(f"  ... {mysql_total:,} MySQL rows | missing_raw={len(missing_raw):,} missing_ref_pairs={len(missing_ref_keys):,}", flush=True)
        if len(lines) < CHUNK + 1:
            break

    report = {
        "normalized_files": len(files),
        "normalized_rows": total_rows,
        "normalized_unique_raw_hashes": len(norm_hashes),
        "normalized_unique_brand_ref_pairs": len(norm_refs),
        "mysql_rows_scanned": mysql_total,
        "mysql_unique_raw_hashes": len(seen_mysql_hashes),
        "missing_by_raw_hash": len(missing_raw),
        "missing_brand_ref_pairs": len(missing_ref_keys),
        "file_errors": errs if 'errs' in dir() else [],
    }
    with open(OUT_JSON, "w") as f:
        json.dump(report, f, indent=2)

    seen = set()
    with open(OUT_CSV, "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(["mysql_id", "brand", "ref", "raw_excerpt"])
        for row_id, brand, ref, raw in missing_raw:
            k = (brand.lower(), ref.lower(), raw[:100].lower())
            if k in seen:
                continue
            seen.add(k)
            w.writerow([row_id, brand, ref, raw])

    print("\n===== GAP REPORT =====", flush=True)
    print(json.dumps(report, indent=2), flush=True)
    print(f"CSV: {OUT_CSV}", flush=True)

if __name__ == "__main__":
    main()
