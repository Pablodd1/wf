#!/usr/bin/env python3
"""
Step 3: Write 545,900 parsed OceanDigital rows into brand workbooks (27-col schema).
Creates NEW files: "OceanDigital <Brand> all 1.xlsx" in the normalized folder.
Does NOT touch existing 354 files. Safe + reversible.
"""
import csv, json, os, re
from collections import defaultdict
import openpyxl

IN_CSV = "/tmp/ocean_normalized.csv"
OUT_DIR = "/mnt/c/Users/jasme/Downloads/WF/ALL watches normalized"
STATS = "/tmp/ocean_slot_stats.json"

COLS = ['Auction ID','Posting Date','Posted By','raw_line','Phone Number','Intent / Type','Brand','Model',
        'Raw Reference','Normalized Reference','Catalog Reference','Catalog Model','Dial Color','Catalog Dial',
        'Condition','Price ($ USD)','Verification Tier','Confidence %','Verification Status','User Image URL',
        'Catalog Image URL','Final Image URL','qa_disposition','catalog_status','trading_floor_eligible',
        'price_research_eligible','dial_resolution_source']

def clean(s):
    if s is None: return ""
    return re.sub(r'[\x00-\x08\x0b\x0c\x0e-\x1f]', '', str(s))

# Brand -> output filename base (match existing naming conventions)
def brand_file(brand):
    b = brand if brand and brand != 'Unknown' else 'Other Brands'
    safe = b.replace('/', '-')
    return f"OceanDigital {safe} all 1.xlsx"

def main():
    rows = list(csv.DictReader(open(IN_CSV, encoding='utf-8')))
    print(f"Slotting {len(rows):,} rows into brand workbooks...", flush=True)

    by_brand = defaultdict(list)
    for r in rows:
        by_brand[r['Brand']].append(r)

    stats = {}
    for brand, brows in sorted(by_brand.items(), key=lambda x: -len(x[1])):
        fname = brand_file(brand)
        fpath = os.path.join(OUT_DIR, fname)
        wb = openpyxl.Workbook()
        ws = wb.active
        ws.title = brand[:31]
        ws.append(COLS)
        for r in brows:
            ws.append([clean(r.get(c, '')) for c in COLS])
        wb.save(fpath)
        wts = sum(1 for r in brows if r['Intent / Type'] == 'WTS')
        wtb = sum(1 for r in brows if r['Intent / Type'] == 'WTB')
        priced = sum(1 for r in brows if r['Price ($ USD)'] and str(r['Price ($ USD)']) not in ('0', '0.0', ''))
        with_dial = sum(1 for r in brows if r['Dial Color'] not in ('Unknown', '', None))
        price_ok = sum(1 for r in brows if r['price_research_eligible'] == 'YES')
        stats[brand] = {
            'file': fname, 'rows': len(brows), 'WTS': wts, 'WTB': wtb,
            'with_price': priced, 'with_dial': with_dial, 'price_research_eligible': price_ok,
        }
        print(f"  {brand:25s} {len(brows):7,} rows -> {fname}", flush=True)

    with open(STATS, 'w') as f:
        json.dump(stats, f, indent=2)
    print(f"\nWrote {len(stats)} brand files to {OUT_DIR}", flush=True)

if __name__ == '__main__':
    main()
