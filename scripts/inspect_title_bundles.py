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
print("INSPECTING TITLES AND DESCRIPTIONS IN UNPARSED POOL (663,087 ROWS)", flush=True)
print("=" * 80, flush=True)

cur.execute("""
    SELECT id, open_unique_key, from_name, from_number, region, title, description, front_image, created_on
    FROM auctions
    WHERE (brand IS NULL OR brand = '') AND title IS NOT NULL AND title != ''
    LIMIT 8
""")
rows = cur.fetchall()

for i, r in enumerate(rows, 1):
    print(f"\n[{i}] ID: {r['id']} | Dealer: {r['from_name']} ({r['region']}) | Image: {r['front_image']}", flush=True)
    t = r['title'] or ''
    d = r['description'] or ''
    print(f"Title ({len(t)} chars):\n{t}", flush=True)
    if d and d != t:
        print(f"Description ({len(d)} chars):\n{d[:200]}...", flush=True)
    print("-" * 60, flush=True)

conn.close()
