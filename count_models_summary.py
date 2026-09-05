import os
import sys
import pymysql

sys.stdout.reconfigure(encoding='utf-8')

conn = pymysql.connect(
    host=os.environ['MYSQL_HOST'],
    user=os.environ['MYSQL_USER'],
    password=os.environ['MYSQL_PASS'],
    database='thecollective_inventory',
    cursorclass=pymysql.cursors.DictCursor,
    charset='utf8mb4'
)
cur = conn.cursor()

# 1. Total breakdown by Brand
cur.execute("""
    SELECT brand, COUNT(*) as listing_count,
           SUM(CASE WHEN type='sale' THEN 1 ELSE 0 END) as wts_count,
           SUM(CASE WHEN type='search' THEN 1 ELSE 0 END) as wtb_count
    FROM auctions
    WHERE brand IS NOT NULL AND brand != '' AND brand != 'None'
    GROUP BY brand
    ORDER BY listing_count DESC
    LIMIT 20;
""")
brands = cur.fetchall()

print("=== TOP 20 BRANDS BY TOTAL LISTINGS ===")
for b in brands:
    print(f"Brand: {b['brand']:<25} | Total: {b['listing_count']:>8,} | WTS: {b['wts_count']:>7,} | WTB: {b['wtb_count']:>6,}")

# 2. Total breakdown by Watch Model
cur.execute("""
    SELECT brand, model, COUNT(*) as listing_count,
           SUM(CASE WHEN type='sale' THEN 1 ELSE 0 END) as wts_count,
           SUM(CASE WHEN type='search' THEN 1 ELSE 0 END) as wtb_count
    FROM auctions
    WHERE model IS NOT NULL AND model != '' AND model != 'None'
    GROUP BY brand, model
    ORDER BY listing_count DESC
    LIMIT 40;
""")
models = cur.fetchall()

print("\n=== TOP 40 WATCH MODELS BY TOTAL LISTINGS ===")
for idx, m in enumerate(models, 1):
    brand = m['brand'] or 'Unknown'
    model = m['model'] or 'Unknown'
    print(f"{idx:>2}. {brand:<18} - {model:<30} | Total: {m['listing_count']:>7,} | WTS: {m['wts_count']:>6,} | WTB: {m['wtb_count']:>5,}")

# 3. Total unique models count
cur.execute("""
    SELECT COUNT(DISTINCT model) as total_distinct_models,
           COUNT(DISTINCT brand) as total_distinct_brands,
           COUNT(*) as total_auctions
    FROM auctions;
""")
stats = cur.fetchone()
print("\n=== OVERALL MODEL & BRAND TOTALS IN LIVE DATABASE ===")
print(f"Total Unique Watch Models: {stats['total_distinct_models']:,}")
print(f"Total Unique Watch Brands: {stats['total_distinct_brands']:,}")
print(f"Total Auctions / Listings: {stats['total_auctions']:,}")

conn.close()
