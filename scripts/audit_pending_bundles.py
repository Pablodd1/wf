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
print("AUDITING PENDING MULTI-LISTING (BUNDLE) BROADCASTS IN DATABASE", flush=True)
print("=" * 80, flush=True)

# 1. Total records overview
cur.execute("SELECT COUNT(*) as total FROM auctions")
total_auctions = int(cur.fetchone()['total'])

cur.execute("SELECT COUNT(*) as unparsed FROM auctions WHERE brand IS NULL OR brand = ''")
unparsed_count = int(cur.fetchone()['unparsed'])

cur.execute("SELECT COUNT(*) as parsed FROM auctions WHERE brand IS NOT NULL AND brand != ''")
parsed_count = int(cur.fetchone()['parsed'])

print(f"Total Rows in auctions table         : {total_auctions:,d}", flush=True)
print(f"  ├─ Brand Tagged Records            : {parsed_count:,d}", flush=True)
print(f"  └─ Unparsed Records (brand IS NULL): {unparsed_count:,d}", flush=True)

# 2. Identify Multiline / Multi-listing Bundles in Unparsed (brand IS NULL)
print("\n" + "-" * 80, flush=True)
print("ANALYZING UNPARSED POOL (663,084 ROWS WHERE brand IS NULL):", flush=True)
print("-" * 80, flush=True)

cur.execute("""
    SELECT 
        COUNT(*) as total_unparsed,
        SUM(CASE WHEN description LIKE '%\n%' OR title LIKE '%\n%' THEN 1 ELSE 0 END) as multiline_broadcasts,
        SUM(CASE WHEN (LENGTH(description) - LENGTH(REPLACE(description, '\n', ''))) >= 3 THEN 1 ELSE 0 END) as heavy_bundles_3plus_lines
    FROM auctions
    WHERE brand IS NULL OR brand = ''
""")
unparsed_stats = cur.fetchone()
tot_unp = int(unparsed_stats['total_unparsed'])
multiline_unp = int(unparsed_stats['multiline_broadcasts'])
heavy_unp = int(unparsed_stats['heavy_bundles_3plus_lines'])

print(f"  Total Unparsed Raw Messages        : {tot_unp:,d}", flush=True)
print(f"  Multiline Broadcast Messages       : {multiline_unp:,d} ({(multiline_unp/tot_unp)*100:.1f}%)", flush=True)
print(f"  Heavy Bundles (>= 3 lines/watches) : {heavy_unp:,d} ({(heavy_unp/tot_unp)*100:.1f}%)", flush=True)

# 3. Identify Multi-listing Bundles inside Brand-Tagged rows
print("\n" + "-" * 80, flush=True)
print("ANALYZING BRAND-TAGGED POOL (767,341 ROWS):", flush=True)
print("-" * 80, flush=True)

cur.execute("""
    SELECT 
        brand,
        COUNT(*) as total,
        SUM(CASE WHEN (LENGTH(description) - LENGTH(REPLACE(description, '\n', ''))) >= 2 THEN 1 ELSE 0 END) as multi_watch_posts
    FROM auctions
    WHERE brand IS NOT NULL AND brand != ''
    GROUP BY brand
    ORDER BY total DESC
    LIMIT 10
""")
brand_bundle_stats = cur.fetchall()
for b in brand_bundle_stats:
    tot = int(b['total'])
    mw = int(b['multi_watch_posts'])
    pct = (mw / tot) * 100 if tot else 0
    print(f"  {b['brand']:22s} | Total: {tot:7,d} | Multi-Watch Bundles: {mw:6,d} ({pct:4.1f}%)", flush=True)

# 4. Sample Bundle Examples from Unparsed Pool
print("\n" + "=" * 80, flush=True)
print("SAMPLE PENDING MULTI-LISTING (BUNDLE) BROADCASTS FROM UNPARSED POOL:", flush=True)
print("=" * 80, flush=True)

cur.execute("""
    SELECT id, open_unique_key, from_name, region, title, description, front_image
    FROM auctions
    WHERE (brand IS NULL OR brand = '') 
      AND description IS NOT NULL 
      AND (LENGTH(description) - LENGTH(REPLACE(description, '\n', ''))) >= 4
    LIMIT 4
""")
samples = cur.fetchall()

for i, s in enumerate(samples, 1):
    print(f"\n--- BUNDLE SAMPLE #{i} (ID: {s['id']} | Dealer: {s['from_name']} | Region: {s['region']}) ---", flush=True)
    txt = (s['description'] or s['title'] or '')[:300].strip()
    print(f"Raw Broadcast Text:\n{txt}", flush=True)
    print(f"Parent Front Image: {s['front_image']}", flush=True)

conn.close()
