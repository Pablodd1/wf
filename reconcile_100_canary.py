import os
import json
import hashlib
import sys
sys.path.append('scripts')
import pymysql
import pymysql.cursors
from pipeline_processor import WatchFactsPipelineProcessor

MYSQL_HOST = os.environ.get("MYSQL_HOST")
MYSQL_PORT = int(os.environ.get("MYSQL_PORT", "3306"))
MYSQL_USER = os.environ.get("MYSQL_USER")
MYSQL_PASS = os.environ.get("MYSQL_PASS")
MYSQL_DB   = os.environ.get("MYSQL_DB", "thecollective_inventory")

if not (MYSQL_HOST and MYSQL_USER and MYSQL_PASS):
    print("Error: Missing required environment variables (MYSQL_HOST, MYSQL_USER, MYSQL_PASS)")
    sys.exit(1)

my_conn = pymysql.connect(
    host=MYSQL_HOST, port=MYSQL_PORT, user=MYSQL_USER, password=MYSQL_PASS,
    database=MYSQL_DB, cursorclass=pymysql.cursors.DictCursor
)
my_cur = my_conn.cursor()
my_cur.execute("""
    SELECT a.id, a.title, a.description, a.front_image, a.created_on, a.type, a.from_name, a.from_number, a.region
    FROM auctions a 
    WHERE ((a.description IS NOT NULL AND a.description != '') OR (a.title IS NOT NULL AND a.title != ''))
    ORDER BY a.created_on DESC LIMIT 100;
""")
source_rows = my_cur.fetchall()
my_conn.close()

processor = WatchFactsPipelineProcessor()
audit_table = []
seen_checksums = set()

for idx, row in enumerate(source_rows):
    text = (row.get('title') or '') + ' ' + (row.get('description') or '')
    text_checksum = hashlib.sha256(text.strip().encode('utf-8')).hexdigest()
    
    raw_img = str(row.get('front_image') or '').strip()
    if raw_img.lower() in ('0', 'none', 'null', ''):
        raw_img = ''
    orig_refs = [raw_img] if raw_img else []

    job_data = {
        "id": f"canary_100_full_{idx+1}",
        "source_id": str(row['id']),
        "message_text": text,
        "type": row.get('type') or 'sale',
        "from_name": row.get('from_name'),
        "from_number": row.get('from_number'),
        "region": row.get('region'),
        "dealer_rating": None,
        "rating": None,
        "front_image": raw_img,
        "original_image_references": orig_refs
    }
    
    res = processor.process_job(job_data)
    
    # Duplicate check
    is_duplicate = text_checksum in seen_checksums
    seen_checksums.add(text_checksum)

    discrepancy = None
    if not res.get("brand_normalized"):
        discrepancy = "MISSING_BRAND"
    elif not res.get("reference_normalized"):
        discrepancy = "MISSING_REFERENCE"
    elif res.get("price_normalized", 0) <= 0 and res["intent"] == "WTS":
        discrepancy = "NO_PRICE_WTS"

    record = {
        "row_num": idx + 1,
        "source_id": str(row['id']),
        "raw_text_checksum": text_checksum[:12],
        "intent": res['intent'],
        "category": res['category'],
        "brand": res['brand_normalized'] or "Unspecified",
        "reference": res['reference_normalized'] or "Unspecified",
        "year": res.get('year') or "Unstated",
        "dial": res['dial_color_normalized'] or "Unspecified",
        "price": res['price_normalized'],
        "currency": res['currency_normalized'],
        "price_usd": res['price_usd'],
        "condition": res['condition_normalized'],
        "seller_name": res.get('from_name') or "Anonymous",
        "seller_phone": res.get('from_number') or "Unstated",
        "source_timestamp": str(row.get('created_on')),
        "source_image": bool(res['image_url']),
        "bundle_status": "bundle_parent" if res['is_bundle'] else "single",
        "duplicate_status": "repost_duplicate" if is_duplicate else "original",
        "trading_floor_eligibility": res['trading_floor_status'],
        "price_research_eligibility": res['price_research_status'],
        "discrepancy_reason": discrepancy or "NONE"
    }
    audit_table.append(record)

print(json.dumps({
    "total_audited_records": len(audit_table),
    "records": audit_table
}, indent=2))
