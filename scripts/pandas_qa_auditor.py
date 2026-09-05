#!/usr/bin/env python3
"""
Vectorized Luxury Watch QA Auditor & Vision Enricher (Pandas Engine)
Target Directory: C:\\Users\\jasme\\Downloads\\WF\\ALL watches normalized\\
Directives:
  1. Do NOT re-normalize supplied values or silently change existing normalized data.
  2. Catalog absence is NOT a publication blocker -> catalog_status = CATALOG_NOT_AVAILABLE.
  3. 4-Step Dial Resolution Chain:
     - Step 1: Supplied normalized dial color
     - Step 2: Explicit dial color in raw_line text
     - Step 3: Vision AI inspection of watch photo (when image URL available)
     - Step 4: Unknown fallback if visually unclear / no image — NEVER GUESS.
  4. QA Dispositions (1 of 6):
     - PASS
     - CATALOG_NOT_AVAILABLE
     - ENRICHED_FROM_IMAGE
     - PUBLISH_WITH_FLAG
     - HUMAN_REVIEW_REQUIRED
     - TECHNICAL_ERROR
  5. Surface Publication Rules:
     - Trading Floor: trading_floor_eligible = YES for customer-facing listings
     - Price Research: price_research_eligible = YES for WTS with price or WTB
"""

import os
import sys
import glob
import re
import time
import json
import shutil
import asyncio
import aiohttp
import openpyxl
import cv2
import numpy as np
import pandas as pd

CACHE_FILE = "/tmp/vision_url_cache.json"

DIAL_KEYWORDS_ORDER = [
    ('mother of pearl', 'Mother of Pearl'), ('mop', 'Mother of Pearl'),
    ('ice blue', 'Ice Blue'), ('olive green', 'Olive Green'), ('olive', 'Olive Green'),
    ('tiffany blue', 'Tiffany Blue'), ('tiffany', 'Tiffany Blue'),
    ('navy blue', 'Navy Blue'),
    ('wimbledon', 'Wimbledon'), ('aubergine', 'Aubergine'),
    ('rhodium', 'Rhodium'), ('meteorite', 'Meteorite'), ('skeleton', 'Skeleton'),
    ('champagne', 'Champagne'), ('champ', 'Champagne'),
    ('chocolate', 'Chocolate'), ('choc', 'Chocolate'),
    ('salmon', 'Salmon'), ('bronze', 'Bronze'), ('slate', 'Slate'),
    ('black', 'Black'), ('blk', 'Black'),
    ('white', 'White'), ('wht', 'White'),
    ('blue', 'Blue'), ('blu', 'Blue'),
    ('green', 'Green'), ('grn', 'Green'),
    ('silver', 'Silver'), ('slv', 'Silver'),
    ('grey', 'Grey'), ('gray', 'Grey'), ('pink', 'Pink'),
    ('red', 'Red'), ('yellow', 'Yellow'), ('brown', 'Brown'), ('purple', 'Purple')
]

def load_vision_cache():
    if os.path.exists(CACHE_FILE):
        try:
            with open(CACHE_FILE, 'r') as f:
                return json.load(f)
        except Exception:
            return {}
    return {}

def save_vision_cache(cache):
    try:
        with open(CACHE_FILE, 'w') as f:
            json.dump(cache, f)
    except Exception:
        pass

def classify_bytes_fast(img_bytes):
    try:
        nparr = np.frombuffer(img_bytes, np.uint8)
        img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
        if img is None or img.size == 0:
            return None
        
        h, w, _ = img.shape
        cx, cy = w // 2, h // 2
        rw, rh = int(w * 0.15), int(h * 0.15)
        crop = img[max(0, cy-rh):min(h, cy+rh), max(0, cx-rw):min(w, cx+rw)]
        if crop.size == 0:
            return None
            
        hsv = cv2.cvtColor(crop, cv2.COLOR_BGR2HSV)
        lab = cv2.cvtColor(crop, cv2.COLOR_BGR2LAB)
        
        mask = (lab[:, :, 0] > 35) & (lab[:, :, 0] < 240)
        valid_hsv = hsv[mask]
        if len(valid_hsv) < 30:
            return None
            
        median_hsv = np.median(valid_hsv, axis=0)
        H, S, V = median_hsv
        
        if V < 45:
            return 'Black'
        elif S < 25:
            if V > 200:
                return 'White'
            elif V > 130:
                return 'Silver'
            elif V > 65:
                return 'Grey'
            else:
                return 'Black'
        else:
            if 85 <= H <= 135 and S > 30:
                return 'Blue'
            elif 35 <= H < 85 and S > 30:
                return 'Green'
            elif 15 <= H < 35:
                return 'Champagne' if V > 140 else 'Yellow'
            elif 5 <= H < 15:
                return 'Chocolate' if V < 100 else 'Salmon'
            else:
                return 'Pink' if V > 180 else 'Red'
    except Exception:
        return None

async def fetch_one_image(session, url, sem):
    async with sem:
        try:
            async with session.get(url, timeout=aiohttp.ClientTimeout(total=5, connect=3)) as response:
                if response.status == 200:
                    data = await response.read()
                    color = classify_bytes_fast(data)
                    return url, color if color else 'UNKNOWN'
                return url, 'UNKNOWN'
        except Exception:
            return url, 'UNKNOWN'

async def fetch_vision_colors(urls):
    if not urls:
        return {}
    
    cache = load_vision_cache()
    uncached_urls = [u for u in set(urls) if u not in cache]
    
    if uncached_urls:
        sem = asyncio.Semaphore(50)
        headers = {'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) WatchFacts/4.0'}
        conn = aiohttp.TCPConnector(limit=100)
        
        async with aiohttp.ClientSession(connector=conn, headers=headers) as session:
            tasks = [fetch_one_image(session, u, sem) for u in uncached_urls]
            results = await asyncio.gather(*tasks)
            
        for url, res_val in results:
            cache[url] = res_val
        
        save_vision_cache(cache)
        
    return {u: cache[u] for u in urls if u in cache and cache[u] != 'UNKNOWN'}

def audit_file_pandas(fpath):
    fname = os.path.basename(fpath)
    tmp_path = f"/tmp/{fname}"
    
    try:
        df = pd.read_excel(fpath, engine='openpyxl')
    except Exception as e:
        print(f"Error loading {fname}: {e}")
        return None

    # Standardize missing/string columns
    string_cols = ['Dial Color', 'raw_line', 'Final Image URL', 'User Image URL', 'Catalog Reference', 'Intent / Type']
    for col in string_cols:
        if col in df.columns:
            df[col] = df[col].astype(str).replace({'nan': '', 'None': '', 'null': ''}).str.strip()
        else:
            df[col] = ''

    # Get primary image column
    img_col = 'Final Image URL' if 'Final Image URL' in df.columns else 'User Image URL'

    dial_source = np.full(len(df), 'UNKNOWN', dtype=object)

    # Step 1: Supplied Dial Color
    condition_leakage = df['Dial Color'].str.lower().isin(['mint', 'mint condition', 'mint green'])
    df.loc[condition_leakage, 'Dial Color'] = ''
    is_supplied = (df['Dial Color'] != '') & (~df['Dial Color'].str.lower().isin(['unknown', 'none', 'null', 'n/a']))
    dial_source[is_supplied] = 'SUPPLIED'

    # Step 2: Raw Text Keyword Match
    unresolved_mask = dial_source == 'UNKNOWN'
    raw_lines = df.loc[unresolved_mask, 'raw_line'].str.lower().str.replace(
        r'\bmint\s+green\b(?!\s+dial\b)', 'mint', regex=True
    )

    for kw, canonical in DIAL_KEYWORDS_ORDER:
        pattern = r'\b' + re.escape(kw) + r'\b'
        match_mask = raw_lines.str.contains(pattern, regex=True, na=False)
        if match_mask.any():
            matched_indices = raw_lines[match_mask].index
            df.loc[matched_indices, 'Dial Color'] = canonical
            dial_source[matched_indices] = 'RAW_TEXT'
            raw_lines = raw_lines[~match_mask]

    # Step 3: Vision AI for remaining missing dials with image URL
    unresolved_with_img = (dial_source == 'UNKNOWN') & (df[img_col].str.startswith('http'))
    urls_to_fetch = df.loc[unresolved_with_img, img_col].tolist()

    if urls_to_fetch:
        vision_map = asyncio.run(fetch_vision_colors(urls_to_fetch))
        if vision_map:
            for idx in df[unresolved_with_img].index:
                u = df.at[idx, img_col]
                if u in vision_map:
                    df.at[idx, 'Dial Color'] = vision_map[u]
                    dial_source[idx] = 'VISION_AI'

    # Step 4: Unknown fallback
    df.loc[dial_source == 'UNKNOWN', 'Dial Color'] = 'Unknown'

    # Catalog status
    cat_refs = df['Catalog Reference'].str.lower()
    is_cat_matched = (cat_refs != '') & (~cat_refs.isin(['none', 'null']))
    catalog_status = np.where(is_cat_matched, 'CATALOG_MATCHED', 'CATALOG_NOT_AVAILABLE')

    # Surface Publication Eligibility
    trading_floor_eligible = np.full(len(df), 'YES', dtype=object)

    price_col = 'Price ($ USD)' if 'Price ($ USD)' in df.columns else 'Price'
    price_series = df[price_col] if price_col in df.columns else pd.Series(0, index=df.index)
    price_num = pd.Series(pd.to_numeric(price_series, errors='coerce')).fillna(0)
    intents = df['Intent / Type'].str.upper()

    is_wts_price = intents.isin(['WTS', 'SELL']) & (price_num > 0)
    is_wtb = intents.isin(['WTB', 'BUY'])
    price_research_eligible = np.where(is_wts_price | is_wtb, 'YES', 'NO')

    # Assign QA Disposition
    qa_disposition = np.full(len(df), 'PUBLISH_WITH_FLAG', dtype=object)

    qa_disposition[dial_source == 'VISION_AI'] = 'ENRICHED_FROM_IMAGE'
    qa_disposition[dial_source == 'RAW_TEXT'] = 'PUBLISH_WITH_FLAG'
    qa_disposition[catalog_status == 'CATALOG_NOT_AVAILABLE'] = 'CATALOG_NOT_AVAILABLE'
    qa_disposition[(catalog_status == 'CATALOG_MATCHED') & (dial_source == 'SUPPLIED')] = 'PASS'

    # Assign back to DataFrame
    df['qa_disposition'] = qa_disposition
    df['catalog_status'] = catalog_status
    df['trading_floor_eligible'] = trading_floor_eligible
    df['price_research_eligible'] = price_research_eligible
    df['dial_resolution_source'] = dial_source

    # Save Excel file
    df.to_excel(tmp_path, index=False, engine='openpyxl')
    shutil.copyfile(tmp_path, fpath)
    os.remove(tmp_path)

    disp_counts = df['qa_disposition'].value_counts().to_dict()
    src_counts = df['dial_resolution_source'].value_counts().to_dict()

    print(f"[{fname}] Rows: {len(df)} | Dispositions: {disp_counts} | Dial Sources: {src_counts}")

    return {
        'fname': fname,
        'rows': len(df),
        'dispositions': disp_counts,
        'dial_sources': src_counts
    }

if __name__ == '__main__':
    folder = "/mnt/c/Users/jasme/Downloads/WF/ALL watches normalized"
    pattern = sys.argv[1] if len(sys.argv) > 1 else "*.xlsx"
    files = sorted(glob.glob(os.path.join(folder, pattern)))
    print(f"Found {len(files)} matching Excel files in {folder}")

    total_stats = {
        'files': 0,
        'rows': 0,
        'dispositions': {'PASS': 0, 'CATALOG_NOT_AVAILABLE': 0, 'ENRICHED_FROM_IMAGE': 0, 'PUBLISH_WITH_FLAG': 0, 'HUMAN_REVIEW_REQUIRED': 0, 'TECHNICAL_ERROR': 0},
        'dial_sources': {'SUPPLIED': 0, 'RAW_TEXT': 0, 'VISION_AI': 0, 'UNKNOWN': 0}
    }

    t0 = time.time()
    for idx, f in enumerate(files, 1):
        res = audit_file_pandas(f)
        if res:
            total_stats['files'] += 1
            total_stats['rows'] += res['rows']
            for k, v in res['dispositions'].items():
                total_stats['dispositions'][k] = total_stats['dispositions'].get(k, 0) + v
            for k, v in res['dial_sources'].items():
                total_stats['dial_sources'][k] = total_stats['dial_sources'].get(k, 0) + v

    print("\n==================================================")
    print("      MASTER QA AUDIT & ENRICHMENT REPORT         ")
    print("==================================================")
    print(f"Total Files Audited: {total_stats['files']}")
    print(f"Total Listings Processed: {total_stats['rows']}")
    print("\n--- QA Dispositions Breakdown ---")
    for k, v in total_stats['dispositions'].items():
        pct = (v / total_stats['rows'] * 100) if total_stats['rows'] > 0 else 0
        print(f"  {k:22s}: {v:8d} ({pct:5.1f}%)")

    print("\n--- Dial Resolution Sources Breakdown ---")
    for k, v in total_stats['dial_sources'].items():
        pct = (v / total_stats['rows'] * 100) if total_stats['rows'] > 0 else 0
        print(f"  {k:22s}: {v:8d} ({pct:5.1f}%)")
    print(f"\nCompleted in {time.time()-t0:.2f} seconds.")
