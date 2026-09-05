import os
import sys
import pymysql
import pandas as pd

sys.stdout.reconfigure(encoding='utf-8')

conn = pymysql.connect(
    host=os.environ.get('MYSQL_HOST', '161.35.0.209'),
    user=os.environ.get('MYSQL_USER', 'john'),
    password=os.environ['MYSQL_PASS'],
    database='thecollective_inventory',
    cursorclass=pymysql.cursors.DictCursor,
    charset='utf8mb4'
)

try:
    with conn.cursor() as cursor:
        cursor.execute("""
            SELECT brand, COUNT(*) as count 
            FROM auctions 
            WHERE brand NOT IN ('Rolex', 'Patek Philippe')
            GROUP BY brand 
            ORDER BY count DESC
        """)
        rows = cursor.fetchall()
        df = pd.DataFrame(rows)
        print("=== ALL BRANDS IN DB (Excluding Rolex & Patek Philippe) ===")
        print(df.to_string(index=False))
finally:
    conn.close()
