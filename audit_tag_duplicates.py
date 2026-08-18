import openpyxl
import pymysql
import sys
import os
import hashlib
import unicodedata
import re

sys.path.append('scripts')
from pipeline_processor import WatchFactsPipelineProcessor

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

cur.execute("""
    SELECT a.id, a.title, a.description, a.front_image, a.created_on, a.type,
           a.from_name, a.from_number, a.region, a.brand, a.model, a.reference,
           a.dial_color, a.box, a.papers, a.condition_id, a.price, a.reserve_price
    FROM auctions a
    WHERE a.brand IN ('TAG Heuer', 'Tag Heuer', 'Heuer', 'TAG', 'tag heuer', 'TAG HEUER')
       OR a.title LIKE '%TAG Heuer%'
       OR a.title LIKE '%Tag Heuer%'
       OR a.title LIKE '%TAGHeuer%'
    ORDER BY a.created_on ASC; -- Order ASC to detect earlier vs reposts
""")
rows = cur.fetchall()
conn.close()

processor = WatchFactsPipelineProcessor()

seen_exact = {}      # text_hash -> first_seen_id
seen_semantic = {}   # (seller, ref, price) -> count
duplicates_count = 0
unique_count = 0

for r in rows:
    text = (r.get('title') or '') + ' ' + (r.get('description') or '')
    text_clean = re.sub(r'\s+', ' ', text).strip().lower()
    text_hash = hashlib.sha256(text_clean.encode('utf-8')).hexdigest()
    seller = r.get('from_number') or r.get('from_name') or 'unknown'

    if text_hash in seen_exact:
        duplicates_count += 1
    else:
        seen_exact[text_hash] = r['id']
        unique_count += 1

print(f"Total TAG Heuer records: {len(rows)}")
print(f"Unique Initial Listings: {unique_count}")
print(f"Repost / Exact Duplicate Messages: {duplicates_count} ({duplicates_count / len(rows) * 100:.1f}%)")
