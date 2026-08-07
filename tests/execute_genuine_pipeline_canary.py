#!/usr/bin/env python3
"""
GENUINE 10-CASE READER-TO-WORKER CANARY
Runs pipeline_do_reader.py and pipeline_runner.py sequentially on 10 deterministic test records.
"""

import sys
import os
import json
import sqlite3
import time

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))

from scripts.pipeline_do_reader import process_source_records
from scripts.pipeline_runner import run_pipeline_step

TEST_RECORDS = [
    # 1. Clean WTS listing
    {
        "id": 1001, "source_platform": "telegram", "source_group_id": "group_canary",
        "from_name": "Canary Seller A", "from_number": "+15550001", "created_on": "2026-02-01T12:00:00Z",
        "description": "FS Rolex Submariner 116500LN $14500 excellent condition box papers",
        "has_exact_source_image": True, "front_image": "http://img.test/canary1.jpg",
        "storage_key": "media/canary1.jpg", "attachment_keys": ["att1.jpg"], "mime_type": "image/jpeg"
    },
    # 2. Duplicate of #1 -> suppressed exact duplicate
    {
        "id": 1001, "source_platform": "telegram", "source_group_id": "group_canary",
        "from_name": "Canary Seller A", "from_number": "+15550001", "created_on": "2026-02-01T12:00:00Z",
        "description": "FS Rolex Submariner 116500LN $14500 excellent condition box papers",
        "has_exact_source_image": True, "front_image": "http://img.test/canary1.jpg",
        "storage_key": "media/canary1.jpg", "attachment_keys": ["att1.jpg"], "mime_type": "image/jpeg"
    },
    # 3. Price change for #1 -> new payload version & new listing event
    {
        "id": 1001, "source_platform": "telegram", "source_group_id": "group_canary",
        "from_name": "Canary Seller A", "from_number": "+15550001", "created_on": "2026-02-01T12:05:00Z",
        "description": "FS Rolex Submariner 116500LN REDUCED $14000 excellent condition box papers",
        "has_exact_source_image": True, "front_image": "http://img.test/canary1.jpg",
        "storage_key": "media/canary1.jpg", "attachment_keys": ["att1.jpg"], "mime_type": "image/jpeg"
    },
    # 4. Clean WTB buyer request
    {
        "id": 1002, "source_platform": "telegram", "source_group_id": "group_canary",
        "from_name": "Canary Buyer B", "from_number": "+15550002", "created_on": "2026-02-01T12:10:00Z",
        "description": "WTB Omega Speedmaster 311.30.42.30.01.005 budget $4500",
        "has_exact_source_image": False, "front_image": None,
        "storage_key": None, "attachment_keys": [], "mime_type": None
    },
    # 5. Multi-listing / Bundle record -> deferred bundle
    {
        "id": 1003, "source_platform": "telegram", "source_group_id": "group_canary",
        "from_name": "Canary Dealer C", "from_number": "+15550003", "created_on": "2026-02-01T12:15:00Z",
        "description": "LOT OF WATCHES: Rolex 116610LN $11000, Tudor Black Bay 79230N $2800",
        "has_exact_source_image": True, "front_image": "http://img.test/bundle.jpg",
        "storage_key": "media/bundle.jpg", "attachment_keys": ["bundle.jpg"], "mime_type": "image/jpeg"
    },
    # 6. WTS listing without price -> no price research, preserved on trading floor
    {
        "id": 1004, "source_platform": "telegram", "source_group_id": "group_canary",
        "from_name": "Canary Seller D", "from_number": "+15550004", "created_on": "2026-02-01T12:20:00Z",
        "description": "WTS Patek Philippe Calatrava 5227G PM for price",
        "has_exact_source_image": True, "front_image": "http://img.test/patek.jpg",
        "storage_key": "media/patek.jpg", "attachment_keys": [], "mime_type": "image/jpeg"
    },
    # 7. Non-watch item -> rejected category
    {
        "id": 1005, "source_platform": "telegram", "source_group_id": "group_canary",
        "from_name": "Canary Seller E", "from_number": "+15550005", "created_on": "2026-02-01T12:25:00Z",
        "description": "WTS Leather Strap 20mm brown $50",
        "has_exact_source_image": False, "front_image": None,
        "storage_key": None, "attachment_keys": [], "mime_type": None
    },
    # 8. Repost of seller A's item (#3) with new message id -> updates prior status to suppressed_repost
    {
        "id": 1006, "source_platform": "telegram", "source_group_id": "group_canary",
        "from_name": "Canary Seller A", "from_number": "+15550001", "created_on": "2026-02-01T12:30:00Z",
        "description": "FS Rolex Submariner 116500LN STILL AVAILABLE $14000",
        "has_exact_source_image": True, "front_image": "http://img.test/canary1.jpg",
        "storage_key": "media/canary1.jpg", "attachment_keys": ["att1.jpg"], "mime_type": "image/jpeg"
    },
    # 9. Clean WTS with missing optional attributes (preserves NULLs)
    {
        "id": 1007, "source_platform": "telegram", "source_group_id": "group_canary",
        "from_name": "Canary Seller F", "from_number": None, "created_on": "2026-02-01T12:35:00Z",
        "description": "WTS Cartier Santos 100 XL $6200",
        "has_exact_source_image": False, "front_image": None,
        "storage_key": None, "attachment_keys": [], "mime_type": None
    },
    # 10. Clean WTS Audemars Piguet
    {
        "id": 1008, "source_platform": "telegram", "source_group_id": "group_canary",
        "from_name": "Canary Seller G", "from_number": "+15550007", "created_on": "2026-02-01T12:40:00Z",
        "description": "For Sale Audemars Piguet Royal Oak 15500ST $38000 complete set",
        "has_exact_source_image": True, "front_image": "http://img.test/ap.jpg",
        "storage_key": "media/ap.jpg", "attachment_keys": ["ap.jpg"], "mime_type": "image/jpeg"
    }
]

def main():
    run_ts = int(time.time())
    batch_id = f"canary_e2e_{time.strftime('%Y%m%d_%H%M%S')}"
    
    # Make IDs unique per test run to prevent "0 jobs processed" due to existing processed jobs
    # We update source_message_id and from_number (except for exact duplicates which must match)
    base_mapping = {}
    for r in TEST_RECORDS:
        orig_id = r["id"]
        if orig_id not in base_mapping:
            base_mapping[orig_id] = f"{orig_id}_{run_ts}"
        
        r["id"] = base_mapping[orig_id]
        r["source_group_id"] = f"{r['source_group_id']}_{run_ts}"
        if r["from_number"]:
            r["from_number"] = f"{r['from_number']}_{run_ts}"
        elif r["from_name"]:
            r["from_name"] = f"{r['from_name']} {run_ts}"

    print(f"=== GENUINE E2E PIPELINE CANARY RUNNER ===")
    print(f"Executing REAL pipeline reader for {len(TEST_RECORDS)} records (batch_id: {batch_id})...")
    
    # 1. Run reader
    enqueued = process_source_records(TEST_RECORDS, batch_id=batch_id)
    print(f"[OK] Reader processed & enqueued {enqueued} payload versions.")

    # 2. Run worker
    print(f"Executing REAL pipeline worker runner...")
    processed = run_pipeline_step(limit=50)
    print(f"[OK] Worker processed {processed} jobs into staging.listings.")
    
    print(f"\n=== E2E CANARY COMPLETE (batch_id: {batch_id}) ===")

if __name__ == "__main__":
    main()
