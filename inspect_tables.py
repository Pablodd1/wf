import os
import sys
import pymysql

# Ensure UTF-8 stdout
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

for tbl in ['auctions_whatsapp_groups', 'auctions_whatsapp_group_members', 'auctions']:
    print(f"\n==================== TABLE: {tbl} ====================")
    cur.execute(f"DESCRIBE `{tbl}`;")
    cols = cur.fetchall()
    for c in cols:
        print(f"  {c['Field']}: {c['Type']} (Null: {c['Null']}, Key: {c['Key']}, Default: {c['Default']})")
    
    cur.execute(f"SELECT * FROM `{tbl}` LIMIT 3;")
    rows = cur.fetchall()
    print(f"\nSample Rows from {tbl}:")
    for r in rows:
        print(" ", {k: (str(v)[:60] if v is not None else None) for k, v in r.items()})

cur.execute("SELECT MAX(created_on), MAX(updated_on), COUNT(*) FROM auctions;")
print("\n=== AUCTIONS LIVE STATS ===")
print("Latest created_on / updated_on / total:", cur.fetchone())

cur.execute("SELECT COUNT(*) as total_groups, SUM(members) as total_reported_members FROM auctions_whatsapp_groups;")
print("\n=== GROUPS STATS ===")
print(cur.fetchone())

cur.execute("SELECT COUNT(*) as total_group_members, COUNT(DISTINCT member_phone) as unique_member_phones, COUNT(DISTINCT group_id) as distinct_groups FROM auctions_whatsapp_group_members;")
print("\n=== GROUP MEMBERS STATS ===")
print(cur.fetchone())

conn.close()
