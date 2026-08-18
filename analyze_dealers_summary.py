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

# Check top posting dealers in auctions
cur.execute("""
    SELECT from_name, from_number, region, COUNT(*) as post_count,
           SUM(CASE WHEN type='sale' THEN 1 ELSE 0 END) as wts_count,
           SUM(CASE WHEN type='search' THEN 1 ELSE 0 END) as wtb_count,
           MAX(created_on) as latest_post
    FROM auctions
    WHERE from_number IS NOT NULL AND from_number != ''
    GROUP BY from_name, from_number, region
    ORDER BY post_count DESC
    LIMIT 20;
""")
top_dealers = cur.fetchall()

print("=== TOP 20 ACTIVE DEALERS FROM LIVE AUCTIONS ===")
for d in top_dealers:
    print(f"Dealer: {d['from_name']} | Phone: +{d['from_number']} | Region: {d['region']} | Posts: {d['post_count']} (WTS: {d['wts_count']}, WTB: {d['wtb_count']}) | Latest: {d['latest_post']}")

# Check total unique dealers across the entire live auctions dataset
cur.execute("""
    SELECT COUNT(DISTINCT from_number) as unique_dealer_phones,
           COUNT(DISTINCT from_name) as unique_dealer_names
    FROM auctions
    WHERE from_number IS NOT NULL AND from_number != '';
""")
print("\n=== TOTAL UNIQUE DEALERS IN LIVE DATABASE ===")
print(cur.fetchone())

conn.close()
