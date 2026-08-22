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

# Get the latest 5 incoming live raw messages arriving right now
cur.execute("""
    SELECT a.id, a.title, a.from_name, a.from_number, a.region, a.origin, a.type, a.front_image, a.created_on
    FROM auctions a
    ORDER BY a.created_on DESC
    LIMIT 5;
""")
latest_rows = cur.fetchall()

print("=== 5 MOST RECENT RAW MESSAGES STREAMING IN RIGHT NOW ===")
for r in latest_rows:
    print(f"\n[Timestamp: {r['created_on']}] | Source: {r['origin']} ({r['region']})")
    print(f"  Sender: {r['from_name']} (+{r['from_number']}) | Type: {r['type']}")
    print(f"  Image Key: {r['front_image']}")
    print(f"  RAW MESSAGE TEXT: {r['title']}")

conn.close()
