import os
import sys
import pymysql

sys.stdout.reconfigure(encoding='utf-8')

conn = pymysql.connect(
    host='161.35.0.209',
    user='john',
    password=os.environ['MYSQL_PASS'],
    database='thecollective_inventory',
    cursorclass=pymysql.cursors.DictCursor
)
cur = conn.cursor()

print("=" * 75)
print("1. BRAND CATALOG COMPLETENESS (AUCTIONS TABLE)")
print("=" * 75)
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
    LIMIT 25
""")
rows = cur.fetchall()
for r in rows:
    tot = int(r['total'])
    mm = int(r['missing_model'])
    mr = int(r['missing_ref'])
    pct_m = (mm / tot) * 100 if tot else 0
    pct_r = (mr / tot) * 100 if tot else 0
    b_name = str(r['brand'])[:22]
    print(f"  {b_name:22s} | Total: {tot:7,d} | Missing Model: {mm:6,d} ({pct_m:4.1f}%) | Missing Ref: {mr:6,d} ({pct_r:4.1f}%)")

print("\n" + "=" * 75)
print("2. UNPARSED RAW BROADCAST LISTINGS (BRAND IS NULL)")
print("=" * 75)
cur.execute("""
    SELECT COUNT(*) as unparsed_count
    FROM auctions
    WHERE brand IS NULL OR brand = ''
""")
unparsed = cur.fetchone()['unparsed_count']
print(f"  Total Raw Broadcast Listings with brand IS NULL: {int(unparsed):,d} listings")

print("\n" + "=" * 75)
print("3. TOP DISCOVERED WATCH BRANDS / MODELS IN UNPARSED MESSAGES")
print("=" * 75)
cur.execute("""
    SELECT 
        SUM(CASE WHEN LOWER(description) LIKE '%rolex%' OR LOWER(title) LIKE '%rolex%' THEN 1 ELSE 0 END) as rolex_mentions,
        SUM(CASE WHEN LOWER(description) LIKE '%patek%' OR LOWER(title) LIKE '%patek%' THEN 1 ELSE 0 END) as patek_mentions,
        SUM(CASE WHEN LOWER(description) LIKE '%audemars%' OR LOWER(description) LIKE '%royal oak%' THEN 1 ELSE 0 END) as ap_mentions,
        SUM(CASE WHEN LOWER(description) LIKE '%richard mille%' OR LOWER(description) LIKE '%rm0%' THEN 1 ELSE 0 END) as rm_mentions,
        SUM(CASE WHEN LOWER(description) LIKE '%cartier%' OR LOWER(description) LIKE '%santos%' THEN 1 ELSE 0 END) as cartier_mentions,
        SUM(CASE WHEN LOWER(description) LIKE '%omega%' OR LOWER(description) LIKE '%speedmaster%' THEN 1 ELSE 0 END) as omega_mentions,
        SUM(CASE WHEN LOWER(description) LIKE '%tudor%' OR LOWER(description) LIKE '%black bay%' THEN 1 ELSE 0 END) as tudor_mentions,
        SUM(CASE WHEN LOWER(description) LIKE '%breitling%' OR LOWER(description) LIKE '%navitimer%' THEN 1 ELSE 0 END) as breitling_mentions,
        SUM(CASE WHEN LOWER(description) LIKE '%iwc%' OR LOWER(description) LIKE '%portugieser%' THEN 1 ELSE 0 END) as iwc_mentions,
        SUM(CASE WHEN LOWER(description) LIKE '%panerai%' OR LOWER(description) LIKE '%submersible%' THEN 1 ELSE 0 END) as panerai_mentions
    FROM auctions
    WHERE (brand IS NULL OR brand = '') AND (description IS NOT NULL OR title IS NOT NULL)
""")
mentions = cur.fetchone()
for k, v in mentions.items():
    print(f"  {k.replace('_', ' ').title():25s}: {int(v):6,d} broadcast messages")

conn.close()
