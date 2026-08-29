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

print("=== COLUMNS IN auctions_whatsapp_group_members ===")
cur.execute("DESCRIBE `auctions_whatsapp_group_members`;")
for col in cur.fetchall():
    print(f"  {col['Field']}: {col['Type']}")

cur.execute("SELECT * FROM `auctions_whatsapp_group_members` LIMIT 5;")
for row in cur.fetchall():
    print("Sample row:", row)

cur.execute("SELECT COUNT(*) FROM `auctions_whatsapp_group_members`;")
print("Total rows:", cur.fetchone())

conn.close()
