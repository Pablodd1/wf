import os
import pymysql

conn = pymysql.connect(
    host=os.environ.get('MYSQL_HOST', '161.35.0.209'),
    user=os.environ.get('MYSQL_USER', 'john'),
    password=os.environ.get('MYSQL_PASS', 'U0aeAr1zFt2\\'),
    database='thecollective_inventory',
    cursorclass=pymysql.cursors.DictCursor
)

with conn.cursor() as cur:
    cur.execute("""
        SELECT brand, COUNT(*) as cnt
        FROM auctions
        WHERE brand IS NOT NULL AND brand != ''
        GROUP BY brand
        ORDER BY cnt DESC
        LIMIT 40;
    """)
    rows = cur.fetchall()
conn.close()

print(f"{'Brand':<30} | {'Record Count':<12}")
print("-" * 45)
for r in rows:
    print(f"{r['brand']:<30} | {r['cnt']:<12}")
