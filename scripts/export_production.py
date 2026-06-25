#!/usr/bin/env python3
"""
Export 1.18M records from production MySQL → our Supabase
Runs in batches of 500, ~40 minutes total.
READ ONLY on production — we only SELECT, never modify.
"""
import pymysql, urllib.request, json, time, sys, math

# Production MySQL (READ ONLY)
MYSQL_HOST = '161.35.0.209'
MYSQL_PORT = 3306
MYSQL_USER = 'john'
MYSQL_PASS = 'U0aeAr1zFt2\\'
MYSQL_DB = 'thecollective_inventory'

# Our Supabase
SUPABASE_URL = "https://bptrvfncppbjnchsaxtb.supabase.co"
import os
SUPABASE_KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")

BATCH_SIZE = 2000
OFFSET = 0
TOTAL = 1052183

def insert_batch(records):
    """Insert batch to Supabase watch_records table"""
    if not records:
        return 0
    try:
        body = json.dumps(records).encode()
        req = urllib.request.Request(
            f"{SUPABASE_URL}/rest/v1/watch_records",
            data=body,
            headers={
                'Content-Type': 'application/json',
                'apikey': SUPABASE_KEY,
                'Authorization': f'Bearer {SUPABASE_KEY}',
                'Prefer': 'resolution=ignore-duplicates',
            },
            method='POST'
        )
        with urllib.request.urlopen(req, timeout=30) as resp:
            return len(records)
    except Exception as e:
        print(f"  Insert error: {str(e)[:100]}", flush=True)
        return 0

def main():
    # Connect to MySQL
    conn = pymysql.connect(
        host=MYSQL_HOST, port=MYSQL_PORT, user=MYSQL_USER,
        password=MYSQL_PASS, database=MYSQL_DB, connect_timeout=15
    )
    cursor = conn.cursor(pymysql.cursors.DictCursor)
    
    # Check if resuming
    try:
        with open('/home/jasme/wf/scripts/migrate_offset.txt', 'r') as f:
            OFFSET = int(f.read().strip())
            print(f"Resuming from offset {OFFSET:,}", flush=True)
    except:
        OFFSET = 0
    
    total_batches = math.ceil((TOTAL - OFFSET) / BATCH_SIZE)
    print(f"Exporting {TOTAL - OFFSET:,} records in {total_batches} batches of {BATCH_SIZE}...", flush=True)
    
    start_time = time.time()
    inserted = 0
    errors = 0
    
    for batch_num in range(total_batches):
        offset = OFFSET + (batch_num * BATCH_SIZE)
        
        cursor.execute("""
            SELECT 
                id, brand, reference, normalized_reference, model, dial_color,
                price, status, origin, title, condition_id, box, papers,
                front_image, from_number, from_name, created_on
            FROM auctions
            WHERE deleted_on IS NULL
            ORDER BY created_on ASC
            LIMIT %s OFFSET %s
        """, (BATCH_SIZE, offset))
        
        rows = cursor.fetchall()
        if not rows:
            print(f"No more records at offset {offset}", flush=True)
            break
        
        # Transform to Supabase format
        records = []
        for row in rows:
            ref = row.get('normalized_reference') or row.get('reference') or ''
            price = float(row.get('price') or 0)
            
            # Derive verdict from status
            status = row.get('status', '')
            if status == 'sold':
                verdict = 'APPROVED'
            elif status == 'ended':
                verdict = 'HUMAN'
            elif status == 'cancelled':
                verdict = 'RECYCLE'
            else:
                verdict = 'HUMAN'
            
            # Derive condition from condition_id
            cond_id = row.get('condition_id')
            condition = None
            if cond_id == 1: condition = 'New'
            elif cond_id in [2, 3, 4, 5, 6]: condition = 'Used'
            elif cond_id == 7: condition = 'Used'
            
            # Extract price from title if price is 0
            if price == 0 and row.get('title'):
                import re
                title = row.get('title', '')
                # Look for patterns like HKD183000, $311,000, USDT311.000, etc.
                hkd_m = re.search(r'HK[D$]?\s*([\d,.]+)', title, re.I)
                usd_m = re.search(r'(?:USD|USDT|\$)\s*([\d,.]+)', title, re.I)
                if hkd_m:
                    try:
                        price = float(hkd_m.group(1).replace(',', '').replace('.', ''))
                    except ValueError:
                        pass
                    currency = 'HKD'
                elif usd_m:
                    price_str = usd_m.group(1).replace(',', '')
                    try:
                        price = float(price_str)
                    except:
                        pass
                    currency = 'USD'
            
            # Compute confidence
            confidence = 0
            if ref: confidence += 40
            if row.get('brand'): confidence += 25
            if row.get('dial_color'): confidence += 10
            if condition: confidence += 8
            if price > 0: confidence += 10
            if row.get('year'): confidence += 4
            year_val = None
            # Try to extract year from title
            if row.get('title'):
                import re
                year_m = re.search(r'\b(20[012]\d)\b', row.get('title', ''))
                if year_m:
                    year_val = int(year_m.group(1))
            confidence = min(100, confidence)
            
            # Production DB price column is ALREADY in USD
            # Only extract from title if price is 0
            currency = 'USD'
            price_raw = price  # Already USD from production DB
            
            if price == 0 and row.get('title'):
                import re
                title = row.get('title', '')
                # Try HKD first (most common in dealer groups)
                hkd_m = re.search(r'HK[D$]?\s*([\d,.]+)', title, re.I)
                usd_m = re.search(r'(?:USD|USDT|\$)\s*([\d,.]+)', title, re.I)
                if hkd_m:
                    try:
                        hkd_price = float(hkd_m.group(1).replace(',', '').replace('.', ''))
                        price_raw = hkd_price
                        currency = 'HKD'
                        price = hkd_price * 0.128  # Convert to USD
                    except ValueError:
                        pass
                elif usd_m:
                    price_str = usd_m.group(1).replace(',', '')
                    try:
                        price = float(price_str)
                        price_raw = price
                        currency = 'USD'
                    except:
                        pass
            
            # price_usd: if currency is HKD, convert. If USD, use as-is.
            if currency == 'HKD' and price_raw and price_raw > 0:
                price_usd = int(price_raw * 0.128)
            elif price > 0:
                price_usd = int(price)
            else:
                price_usd = None
            
            record = {
                'id': f"prod_{row['id'][:20]}",
                'brand': row.get('brand') or 'Unknown',
                'reference': ref,
                'dial_color': row.get('dial_color'),
                'condition': condition,
                'year': year_val,
                'price_raw': price_raw if price_raw and price_raw > 0 else None,
                'price_usd': price_usd,
                'currency': currency,
                'confidence': confidence,
                'verdict': verdict,
                'source': 'production_db',
                'raw_message': (row.get('title') or '')[:2000],
                'flags': [],
            }
            records.append(record)
        
        # Insert to Supabase
        result = insert_batch(records)
        inserted += result
        if result == 0:
            errors += 1
        
        # Save offset for resume
        with open('/home/jasme/wf/scripts/migrate_offset.txt', 'w') as f:
            f.write(str(offset + BATCH_SIZE))
        
        # Progress
        if (batch_num + 1) % 50 == 0 or batch_num == total_batches - 1:
            elapsed = time.time() - start_time
            pct = (batch_num + 1) / total_batches * 100
            rate = inserted / elapsed if elapsed > 0 else 0
            eta = (total_batches - batch_num - 1) * (elapsed / (batch_num + 1))
            print(f"[{batch_num+1}/{total_batches}] {pct:.0f}% — {inserted:,} inserted, {errors} errors, {elapsed:.0f}s elapsed, {rate:.0f} rec/s, ETA {eta:.0f}s", flush=True)
    
    elapsed = time.time() - start_time
    print(f"\n=== MIGRATION COMPLETE ===", flush=True)
    print(f"Inserted: {inserted:,}", flush=True)
    print(f"Errors: {errors}", flush=True)
    print(f"Time: {elapsed:.0f}s ({elapsed/60:.1f}m)", flush=True)
    print(f"Rate: {inserted/elapsed:.0f} records/second", flush=True)
    
    cursor.close()
    conn.close()

if __name__ == '__main__':
    main()
