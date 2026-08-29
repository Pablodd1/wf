#!/usr/bin/env python3
"""
Phase 2: Enrich normalized Excel files with missing columns, then Phase 3: UPSERT to Supabase.

Columns we already have in normalized files → Supabase mapping:
  Brand → brand
  Model → model  
  Raw Reference → raw_reference (preserved)
  Normalized Reference → reference
  Dial Color → dial_color
  Condition → condition
  Price ($ USD) → price_usd
  Posted By → seller_name
  Phone Number → seller_phone
  Intent / Type → listing_type (WTS/WTB)
  Posting Date → listing_date
  raw_line → raw_message
  Confidence % → confidence
  Verification Status → verdict
  qa_disposition → (flags)
  Final Image URL → image_urls[0]
  trading_floor_eligible → trading_floor_eligible
  price_research_eligible → price_research_eligible
  Currency → currency

NEW columns we need to add to files:
  seller_rating, seller_location, year, box, papers, condition_detail, source, source_file
"""

import openpyxl
import requests
import json
import os
import sys
import glob
import time
import uuid
from datetime import datetime

# ─── CONFIG ───
NORM_DIR = "/mnt/c/Users/jasme/Downloads/WF/ALL watches normalized/3 PP rolex and au"
# Use the main dir files too for non-PP/Rolex/AP brands
MAIN_DIR = "/mnt/c/Users/jasme/Downloads/WF/ALL watches normalized"

# Supabase — guaranteed to have key from wf/.env
SB_KEY = None
with open('/home/jasme/wf/.env') as f:
    for line in f:
        line = line.strip()
        if line.startswith('SUPABASE_SERVICE_ROLE_KEY='):
            SB_KEY = line.split('=', 1)[1].strip().strip('"').strip("'")
            break

if not SB_KEY:
    print("ERROR: Could not find SUPABASE_SERVICE_ROLE_KEY in /home/jasme/wf/.env")
    sys.exit(1)

SB_URL = 'https://bptrvfncppbjnchsaxtb.supabase.co'
SB_HEADERS = {
    'apikey': SB_KEY,
    'Authorization': f'Bearer {SB_KEY}',
    'Content-Type': 'application/json',
    'Prefer': 'resolution=merge-duplicates'
}

BATCH_SIZE = 500
DRY_RUN = False  # Set True for testing

# ─── HELPERS ───

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

def safe_int(v):
    if v is None:
        return None
    try:
        return int(float(v))
    except:
        return None

def normalize_ref(ref):
    """Normalize a reference: lowercase, strip dots, strip spaces"""
    if not ref:
        return None
    return str(ref).replace('.', '').replace(' ', '').strip()

def map_row_to_supabase(row_data, headers_dict):
    """Map a normalized Excel row to Supabase watch_records format"""
    def get(col):
        idx = headers_dict.get(col)
        if idx is None:
            return None
        return row_data[idx] if idx < len(row_data) else None
    
    brand = safe_str(get('Brand'))
    model = safe_str(get('Model'))
    raw_ref = safe_str(get('Raw Reference'))
    norm_ref = safe_str(get('Normalized Reference'))
    dial = safe_str(get('Dial Color'))
    condition = safe_str(get('Condition'))
    price_usd = safe_float(get('Price ($ USD)'))
    seller = safe_str(get('Posted By'))
    phone = safe_str(get('Phone Number'))
    intent = safe_str(get('Intent / Type'))
    raw_line = safe_str(get('raw_line'))
    confidence = safe_int(get('Confidence %'))
    status = safe_str(get('Verification Status'))
    qa = safe_str(get('qa_disposition'))
    image_url = safe_str(get('Final Image URL'))
    user_image = safe_str(get('User Image URL'))
    posting_date = safe_str(get('Posting Date'))
    auction_id = safe_str(get('Auction ID'))
    trading = safe_str(get('trading_floor_eligible'))
    price_eligible = safe_str(get('price_research_eligible'))
    currency = safe_str(get('Currency'))
    
    # Skip if no brand or reference — both are required by schema
    if not brand or not norm_ref:
        return None
    
    # Normalize empty references that are just dots or spaces
    if norm_ref.strip() in ('', '.', '-', 'N/A', 'NA'):
        return None
    
    # Build image_urls array
    image_urls = []
    if image_url and image_url.startswith('http'):
        image_urls.append(image_url)
    elif user_image and user_image.startswith('http'):
        image_urls.append(user_image)
    
    has_images = len(image_urls) > 0
    
    # Map verdict
    verdict_map = {
        'Human Review': 'Human Review',
        'Approved': 'APPROVED',
        'APPROVED': 'APPROVED',
    }
    verdict = verdict_map.get(status, 'Human Review')
    
    # Map listing_type
    if intent and 'WTS' in intent.upper():
        listing_type = 'WTS'
    elif intent and 'WTB' in intent.upper():
        listing_type = 'WTB'
    else:
        listing_type = 'WTS'
    
    # Build record — only fields that actually exist in watch_records schema
    record = {
        'id': str(uuid.uuid4()),  # Required: generate UUID
        'brand': brand,
        'model': model,
        'reference': norm_ref,
        'dial_color': dial,
        'condition': condition if condition else 'Unknown',
        'price_usd': price_usd,
        'seller_name': seller,
        'seller_phone': phone,
        'raw_message': raw_line,
        'confidence': confidence or 30,
        'verdict': verdict,
        'listing_type': listing_type,
        'listing_date': posting_date,
        'image_urls': image_urls,
        'has_images': has_images,
        'thumbnail_url': image_urls[0] if image_urls else None,
        'currency': currency if currency else 'USD',
        'source': 'REVIEWED_WORKBOOK_INVENTORY',
        'source_type': 'owner_reviewed_workbook',
        'parser_version': 'jass-v5-workbook',
        'catalog_confirmed': qa in ('PASS', 'PUBLISH_WITH_FLAG') if qa else False,
        'flags': {},
        'human_edited': False,
        'review_reason': None,
        'dealer_photos': [],
        'dealer_id': None,
        'region': None,
        'year': None,
    }
    
    # Store the workbook source info in flags (since no source_record_id column)
    if auction_id:
        record['flags']['workbook_auction_id'] = safe_str(auction_id)
    if price_eligible:
        record['flags']['price_research_eligible'] = price_eligible
    if trading:
        record['flags']['trading_floor_eligible'] = trading
    
    return record


def upsert_batch(records):
    """UPSERT a batch to Supabase watch_records"""
    if not records:
        return 0
    
    # Remove duplicates within batch by brand+ref+seller+price combo
    seen = set()
    unique = []
    for r in records:
        key = (r.get('brand',''), r.get('reference',''), r.get('seller_name',''), r.get('price_usd'))
        if key in seen:
            continue
        seen.add(key)
        unique.append(r)
    
    if DRY_RUN:
        print(f"  [DRY RUN] Would UPSERT {len(unique)} records")
        return len(unique)
    
    # Send in batches of BATCH_SIZE
    total_sent = 0
    for i in range(0, len(unique), BATCH_SIZE):
        batch = unique[i:i+BATCH_SIZE]
        try:
            r = requests.post(
                f'{SB_URL}/rest/v1/watch_records',
                headers=SB_HEADERS,
                json=batch,
                timeout=60
            )
            if r.status_code in (200, 201, 204):
                total_sent += len(batch)
            else:
                print(f"  UPSERT error {r.status_code}: {r.text[:200]}")
                # Try one by one
                for rec in batch:
                    try:
                        r2 = requests.post(
                            f'{SB_URL}/rest/v1/watch_records',
                            headers=SB_HEADERS,
                            json=[rec],
                            timeout=30
                        )
                        if r2.status_code in (200, 201, 204):
                            total_sent += 1
                    except:
                        pass
        except Exception as e:
            print(f"  UPSERT exception: {e}")
    
    return total_sent


def process_file(filepath, do_upsert=True):
    """Process one Excel file: read, map, upsert"""
    fname = os.path.basename(filepath)
    print(f"\n{'='*60}")
    print(f"Processing: {fname}")
    
    try:
        wb = openpyxl.load_workbook(filepath, read_only=True, data_only=True)
        ws = wb.active
        rows = ws.iter_rows(values_only=True)
        headers = [str(c) if c else "" for c in next(rows)]
        headers_dict = {h: i for i, h in enumerate(headers)}
        
        # Validate we have the key columns
        required = ['Brand', 'Normalized Reference']
        missing = [r for r in required if r not in headers_dict]
        if missing:
            print(f"  SKIP: missing columns: {missing}")
            wb.close()
            return 0
        
        records = []
        row_count = 0
        skipped = 0
        
        for r in rows:
            row_count += 1
            rec = map_row_to_supabase(r, headers_dict)
            if rec:
                records.append(rec)
            else:
                skipped += 1
            
            # Upsert every 5000 rows to avoid memory issues
            if len(records) >= 5000 and do_upsert:
                sent = upsert_batch(records)
                print(f"  [{row_count:,} rows scanned] UPSERT batch: {sent}/{len(records)}")
                records = []
        
        # Final batch
        if records and do_upsert:
            sent = upsert_batch(records)
            print(f"  [{row_count:,} total] Final UPSERT: {sent}/{len(records)}")
        
        wb.close()
        print(f"  Summary: {row_count:,} rows, {skipped} skipped, {row_count - skipped} mapped")
        return row_count - skipped
        
    except Exception as e:
        print(f"  ERROR: {e}")
        import traceback
        traceback.print_exc()
        return 0


def main():
    # Collect files from both directories
    all_files = []
    
    # PP/Rolex/AP subfolder (388 files - the enriched ones)
    sub = os.path.join(NORM_DIR, "*.xlsx") if os.path.exists(NORM_DIR) else None
    if sub:
        all_files.extend(glob.glob(sub))
        print(f"Subfolder files: {len(glob.glob(sub))}")
    
    # Also process Omega, Rolex etc from main dir
    main_patterns = [
        os.path.join(MAIN_DIR, "Omega*.xlsx"),
        os.path.join(MAIN_DIR, "Rolex*.xlsx"),
        os.path.join(MAIN_DIR, "Patek*.xlsx"),
        os.path.join(MAIN_DIR, "Audemars*.xlsx"),
        os.path.join(MAIN_DIR, "AP*.xlsx"),
        os.path.join(MAIN_DIR, "Richard*.xlsx"),
        os.path.join(MAIN_DIR, "Cartier*.xlsx"),
        os.path.join(MAIN_DIR, "FP*.xlsx"),
        os.path.join(MAIN_DIR, "Vacheron*.xlsx"),
        os.path.join(MAIN_DIR, "Tudor*.xlsx"),
        os.path.join(MAIN_DIR, "IWC*.xlsx"),
        os.path.join(MAIN_DIR, "Breitling*.xlsx"),
        os.path.join(MAIN_DIR, "Hublot*.xlsx"),
        os.path.join(MAIN_DIR, "Panerai*.xlsx"),
        os.path.join(MAIN_DIR, "Zenith*.xlsx"),
        os.path.join(MAIN_DIR, "A Lange*.xlsx"),
        os.path.join(MAIN_DIR, "Jaeger*.xlsx"),
    ]
    for pat in main_patterns:
        files = glob.glob(pat)
        for f in files:
            if f not in all_files:
                all_files.append(f)
    
    # Remove duplicates
    all_files = list(set(all_files))
    all_files.sort()
    print(f"\nTotal unique files to process: {len(all_files)}")
    
    if DRY_RUN:
        print("*** DRY RUN MODE — no data will be written ***")
    
    total_mapped = 0
    start_time = time.time()
    
    for i, fpath in enumerate(all_files):
        fname = os.path.basename(fpath)
        mapped = process_file(fpath, do_upsert=not DRY_RUN)
        total_mapped += mapped
        elapsed = time.time() - start_time
        print(f"  [{i+1}/{len(all_files)}] {fname}: {mapped:,} mapped | Total: {total_mapped:,} | Elapsed: {elapsed/60:.1f}m")
    
    elapsed = time.time() - start_time
    print(f"\n{'='*60}")
    print(f"DONE. {total_mapped:,} records mapped from {len(all_files)} files in {elapsed/60:.1f} minutes")
    
    if DRY_RUN:
        print("DRY RUN — no data was written. Set DRY_RUN=False to execute.")


if __name__ == '__main__':
    main()
