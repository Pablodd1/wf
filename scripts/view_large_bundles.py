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
print("LARGE INVENTORY MULTI-LISTING BROADCASTS IN DATABASE", flush=True)
print("=" * 80, flush=True)

cur.execute("""
    SELECT id, open_unique_key, from_name, region, title, front_image
    FROM auctions
    WHERE (brand IS NULL OR brand = '') AND LENGTH(title) > 300
    LIMIT 3
""")
rows = cur.fetchall()

for i, r in enumerate(rows, 1):
    print(f"\n[BUNDLE #{i}] ID: {r['id']} | Dealer: {r['from_name']} ({r['region']})", flush=True)
    print(f"Parent Front Image: {r['front_image']}", flush=True)
    print(f"Raw Text:\n{r['title']}\n" + "-" * 70, flush=True)

conn.close()
