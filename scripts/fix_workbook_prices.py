#!/usr/bin/env python3
"""
Fix workbook staging: populate workbook_price_usd from normalized files,
dedupe by source_record_id, and ensure Price Research works for all refs.
"""
import openpyxl
import requests
import json
import os
import glob
import sys
import time
from collections import defaultdict

# Config
NORM_DIR = "/mnt/c/Users/jasme/Downloads/WF/ALL watches normalized/3 PP rolex and au"
SB_URL = 'https://bptrvfncppbjnchsaxtb.supabase.co'

with open('/home/jasme/wf/.env') as f:
    for line in f:
        line = line.strip()
        if line.startswith('SUPABASE_SERVICE_ROLE_KEY='):
            SB_KEY = line.split('=', 1)[1].strip().strip('"').strip("'")
            break

HEADERS = {
    'apikey': SB_KEY,
    'Authorization': f'Bearer {SB_KEY}',
    'Content-Type': 'application/json'
}

def safe_str(v):
    if v is None:
        return None
    s = str(v).strip()
    return s if s else None

def safe_float(v):
    if v is None:
        return None
    try:
        return float(v)
    except:
        return None

def normalize_ref(ref):
    if not ref:
        return None
    return str(ref).replace('.', '').replace(' ', '').strip()

def extract_price_from_raw(raw_line):
    """Extract price from raw_line text like 'WTS Omega 310.30.42.50.04.001 white 7300.00'"""
    if not raw_line:
        return None
    import re
    # Match patterns like: 7300.00, 7300, $7300, 7300.00 USD, etc.
    patterns = [
        r'\$?(\d{1,3}(?:,\d{3})*(?:\.\d{2})?)\s*(?:USD|USDT|usd|usdt)?\s*$',
        r'\$?(\d{1,3}(?:,\d{3})*(?:\.\d{2})?)\s*(?:HKD|EUR|GBP|hkd|eur|gbp)?\s*$',
        r'(\d{4,6}(?:\.\d{2})?)\s*(?:USD|USDT|HKD|EUR|GBP)',
    ]
    for pattern in patterns:
        match = re.search(pattern, raw_line, re.IGNORECASE)
        if match:
            price_str = match.group(1).replace(',', '')
            try:
                price = float(price_str)
                # Sanity check: watch prices are typically $1,000 - $10,000,000
                if 100 <= price <= 100000000:
                    return price
            except:
                pass
    return None

def process_file(filepath):
    """Extract all rows with prices from a normalized file."""
    fname = os.path.basename(filepath)
    rows = []
    
    try:
        wb = openpyxl.load_workbook(filepath, read_only=True, data_only=True)
        ws = wb.active
        data_rows = ws.iter_rows(values_only=True)
        headers = [str(c) if c else '' for c in next(data_rows)]
        
        # Find column indices
        idx = {}
        for i, h in enumerate(headers):
            idx[h] = i
        
        for r in data_rows:
            brand = safe_str(r[idx.get('Brand', -1)]) if idx.get('Brand', -1) >= 0 else None
            ref = safe_str(r[idx.get('Normalized Reference', -1)]) if idx.get('Normalized Reference', -1) >= 0 else None
            model = safe_str(r[idx.get('Model', -1)]) if idx.get('Model', -1) >= 0 else None
            dial = safe_str(r[idx.get('Dial Color', -1)]) if idx.get('Dial Color', -1) >= 0 else None
            condition = safe_str(r[idx.get('Condition', -1)]) if idx.get('Condition', -1) >= 0 else None
            price = safe_float(r[idx.get('Price ($ USD)', -1)]) if idx.get('Price ($ USD)', -1) >= 0 else None
            seller = safe_str(r[idx.get('Posted By', -1)]) if idx.get('Posted By', -1) >= 0 else None
            phone = safe_str(r[idx.get('Phone Number', -1)]) if idx.get('Phone Number', -1) >= 0 else None
            raw_line = safe_str(r[idx.get('raw_line', -1)]) if idx.get('raw_line', -1) >= 0 else None
            image_url = safe_str(r[idx.get('Final Image URL', -1)]) if idx.get('Final Image URL', -1) >= 0 else None
            intent = safe_str(r[idx.get('Intent / Type', -1)]) if idx.get('Intent / Type', -1) >= 0 else None
            posting_date = safe_str(r[idx.get('Posting Date', -1)]) if idx.get('Posting Date', -1) >= 0 else None
            auction_id = safe_str(r[idx.get('Auction ID', -1)]) if idx.get('Auction ID', -1) >= 0 else None
            
            if not brand or not ref:
                continue
            
            # Extract price from raw_line if not in Price column
            if price is None and raw_line:
                price = extract_price_from_raw(raw_line)
            
            # Determine listing type
            listing_type = 'WTS'
            if intent and 'WTB' in intent.upper():
                listing_type = 'WTB'
            
            rows.append({
                'brand': brand,
                'reference': ref,
                'model': model,
                'dial_color': dial,
                'condition': condition,
                'price_usd': price,
                'seller_name': seller,
                'seller_phone': phone,
                'raw_message': raw_line,
                'image_url': image_url,
                'listing_type': listing_type,
                'posting_date': posting_date,
                'auction_id': auction_id,
                'source_file': fname,
            })
        
        wb.close()
        
    except Exception as e:
        print(f"  Error in {fname}: {e}")
    
    return rows

def upsert_batch(records):
    """UPSERT to watch_records with deduplication."""
    if not records:
        return 0
    
    # Dedupe by brand+ref+seller+price
    seen = set()
    unique = []
    for r in records:
        key = (r['brand'], r['reference'], r.get('seller_name'), r.get('price_usd'))
        if key in seen:
            continue
        seen.add(key)
        unique.append(r)
    
    # Build Supabase records
    sb_records = []
    for r in unique:
        import uuid
        record = {
            'id': str(uuid.uuid4()),
            'brand': r['brand'],
            'model': r['model'],
            'reference': r['reference'],
            'dial_color': r['dial_color'],
            'condition': r['condition'] or 'Unknown',
            'price_usd': r['price_usd'],
            'seller_name': r['seller_name'],
            'seller_phone': r['seller_phone'],
            'raw_message': r['raw_message'],
            'currency': 'USD',
            'confidence': 30,
            'verdict': 'Human Review',
            'listing_type': r['listing_type'],
            'listing_date': r['posting_date'],
            'image_urls': [r['image_url']] if r['image_url'] else [],
            'has_images': bool(r['image_url']),
            'thumbnail_url': r['image_url'],
            'source': 'REVIEWED_WORKBOOK_INVENTORY',
            'source_type': 'owner_reviewed_workbook',
            'parser_version': 'jass-v5-workbook',
            'catalog_confirmed': False,
            'flags': {'workbook_auction_id': r['auction_id'], 'source_file': r['source_file']},
            'human_edited': False,
            'dealer_photos': [],
        }
        sb_records.append(record)
    
    # Send in batches of 500
    total_sent = 0
    for i in range(0, len(sb_records), 500):
        batch = sb_records[i:i+500]
        try:
            r = requests.post(
                f'{SB_URL}/rest/v1/watch_records',
                headers=HEADERS,
                json=batch,
                timeout=60
            )
            if r.status_code in (200, 201, 204):
                total_sent += len(batch)
            else:
                print(f"    UPSERT error {r.status_code}: {r.text[:100]}")
        except Exception as e:
            print(f"    UPSERT exception: {e}")
    
    return total_sent

def main():
    files = sorted(glob.glob(os.path.join(NORM_DIR, "*.xlsx")))
    print(f"Processing {len(files)} files...")
    
    total_rows = 0
    total_upserted = 0
    start_time = time.time()
    
    for i, fpath in enumerate(files):
        fname = os.path.basename(fpath)
        rows = process_file(fpath)
        total_rows += len(rows)
        
        if rows:
            sent = upsert_batch(rows)
            total_upserted += sent
        
        if (i + 1) % 10 == 0:
            elapsed = time.time() - start_time
            print(f"  [{i+1}/{len(files)}] {total_rows:,} rows, {total_upserted:,} upserted, {elapsed/60:.1f}m")
    
    elapsed = time.time() - start_time
    print(f"\nDONE: {total_rows:,} rows, {total_upserted:,} upserted in {elapsed/60:.1f} minutes")

if __name__ == '__main__':
    main()
