import sys
import pymysql

sys.stdout.reconfigure(encoding='utf-8')

conn = pymysql.connect(
    host='161.35.0.209',
    user='john',
    password='U0aeAr1zFt2\\',
    database='thecollective_inventory',
    cursorclass=pymysql.cursors.DictCursor
)
cur = conn.cursor()

print("=" * 80, flush=True)
print("CATALOG NORMALIZATION AUDIT: WHAT MODELS / WATCHES ARE MISSING?", flush=True)
print("=" * 80, flush=True)

# 1. Overall Brand / Model / Reference missing counts
cur.execute("""
    SELECT brand,
           COUNT(*) as total,
           SUM(CASE WHEN model IS NULL OR model = '' THEN 1 ELSE 0 END) as missing_model,
           SUM(CASE WHEN normalized_reference IS NULL OR normalized_reference = '' THEN 1 ELSE 0 END) as missing_ref,
           SUM(CASE WHEN price IS NULL OR price = 0 THEN 1 ELSE 0 END) as missing_price
    FROM auctions
    WHERE brand IS NOT NULL
    GROUP BY brand
    ORDER BY total DESC
    LIMIT 30
""")
rows = cur.fetchall()
print(f"{'Brand':<24} | {'Total':<10} | {'Missing Model':<16} | {'Missing Ref':<16} | {'Missing Price':<16}", flush=True)
print("-" * 88, flush=True)
for r in rows:
    tot = int(r['total'])
    mm = int(r['missing_model'])
    mr = int(r['missing_ref'])
    mp = int(r['missing_price'])
    pct_m = (mm / tot) * 100 if tot else 0
    pct_r = (mr / tot) * 100 if tot else 0
    pct_p = (mp / tot) * 100 if tot else 0
    b_name = str(r['brand'])[:23]
    print(f"{b_name:<24} | {tot:<10,d} | {mm:<7,d} ({pct_m:4.1f}%) | {mr:<7,d} ({pct_r:4.1f}%) | {mp:<7,d} ({pct_p:4.1f}%)", flush=True)

# 2. Check Unparsed Listings
cur.execute("SELECT COUNT(*) as unparsed FROM auctions WHERE brand IS NULL OR brand = ''")
unparsed = int(cur.fetchone()['unparsed'])
print("\n" + "=" * 80, flush=True)
print(f"UNPARSED BROADCAST LISTINGS: {unparsed:,d} listings (brand IS NULL)", flush=True)
print("=" * 80, flush=True)

# 3. Check sample unresolved references in identified brands
cur.execute("""
    SELECT brand, reference, title, COUNT(*) as c
    FROM auctions
    WHERE brand IS NOT NULL AND (normalized_reference IS NULL OR normalized_reference = '' OR normalized_reference = 'UNRESOLVED')
    GROUP BY brand, reference, title
    ORDER BY c DESC
    LIMIT 15
""")
unresolved_samples = cur.fetchall()
print("\nTOP UNRESOLVED REFERENCES & TITLES IN DATABASE:", flush=True)
for s in unresolved_samples:
    print(f"  [{s['brand']}] Ref: '{s['reference']}' | Title: '{s['title'][:50]}' (Count: {int(s['c']):,d})", flush=True)

conn.close()
