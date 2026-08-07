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

from scripts.pipeline_do_reader import process_source_records, setup_sqlite_schema
from scripts.pipeline_runner import run_pipeline

TEST_RECORDS = [
    # 1. Clean WTS listing
    {
        "source_platform": "telegram", "source_group_id": "group_canary", "source_message_id": 1001,
        "from_name": "Canary Seller A", "from_number": "+15550001", "orig_ts": 1770000000,
        "msg_text": "FS Rolex Submariner 116500LN $14500 excellent condition box papers",
        "has_exact_source_image": True, "front_image": "http://img.test/canary1.jpg",
        "storage_key": "media/canary1.jpg", "attachment_keys": ["att1.jpg"], "mime_type": "image/jpeg"
    },
    # 2. Duplicate of #1 -> suppressed exact duplicate
    {
        "source_platform": "telegram", "source_group_id": "group_canary", "source_message_id": 1001,
        "from_name": "Canary Seller A", "from_number": "+15550001", "orig_ts": 1770000000,
        "msg_text": "FS Rolex Submariner 116500LN $14500 excellent condition box papers",
        "has_exact_source_image": True, "front_image": "http://img.test/canary1.jpg",
        "storage_key": "media/canary1.jpg", "attachment_keys": ["att1.jpg"], "mime_type": "image/jpeg"
    },
    # 3. Price change for #1 -> new payload version & new listing event
    {
        "source_platform": "telegram", "source_group_id": "group_canary", "source_message_id": 1001,
        "from_name": "Canary Seller A", "from_number": "+15550001", "orig_ts": 1770000100,
        "msg_text": "FS Rolex Submariner 116500LN REDUCED $14000 excellent condition box papers",
        "has_exact_source_image": True, "front_image": "http://img.test/canary1.jpg",
        "storage_key": "media/canary1.jpg", "attachment_keys": ["att1.jpg"], "mime_type": "image/jpeg"
    },
    # 4. Clean WTB buyer request
    {
        "source_platform": "telegram", "source_group_id": "group_canary", "source_message_id": 1002,
        "from_name": "Canary Buyer B", "from_number": "+15550002", "orig_ts": 1770000200,
        "msg_text": "WTB Omega Speedmaster 311.30.42.30.01.005 budget $4500",
        "has_exact_source_image": False, "front_image": None,
        "storage_key": None, "attachment_keys": [], "mime_type": None
    },
    # 5. Multi-listing / Bundle record -> deferred bundle
    {
        "source_platform": "telegram", "source_group_id": "group_canary", "source_message_id": 1003,
        "from_name": "Canary Dealer C", "from_number": "+15550003", "orig_ts": 1770000300,
        "msg_text": "LOT OF WATCHES: Rolex 116610LN $11000, Tudor Black Bay 79230N $2800",
        "has_exact_source_image": True, "front_image": "http://img.test/bundle.jpg",
        "storage_key": "media/bundle.jpg", "attachment_keys": ["bundle.jpg"], "mime_type": "image/jpeg"
    },
    # 6. WTS listing without price -> no price research, preserved on trading floor
    {
        "source_platform": "telegram", "source_group_id": "group_canary", "source_message_id": 1004,
        "from_name": "Canary Seller D", "from_number": "+15550004", "orig_ts": 1770000400,
        "msg_text": "WTS Patek Philippe Calatrava 5227G PM for price",
        "has_exact_source_image": True, "front_image": "http://img.test/patek.jpg",
        "storage_key": "media/patek.jpg", "attachment_keys": [], "mime_type": "image/jpeg"
    },
    # 7. Non-watch item -> rejected category
    {
        "source_platform": "telegram", "source_group_id": "group_canary", "source_message_id": 1005,
        "from_name": "Canary Seller E", "from_number": "+15550005", "orig_ts": 1770000500,
        "msg_text": "WTS Leather Strap 20mm brown $50",
        "has_exact_source_image": False, "front_image": None,
        "storage_key": None, "attachment_keys": [], "mime_type": None
    },
    # 8. Repost of seller A's item (#3) with new message id -> updates prior status to suppressed_repost
    {
        "source_platform": "telegram", "source_group_id": "group_canary", "source_message_id": 1006,
        "from_name": "Canary Seller A", "from_number": "+15550001", "orig_ts": 1770000600,
        "msg_text": "FS Rolex Submariner 116500LN STILL AVAILABLE $14000",
        "has_exact_source_image": True, "front_image": "http://img.test/canary1.jpg",
        "storage_key": "media/canary1.jpg", "attachment_keys": ["att1.jpg"], "mime_type": "image/jpeg"
    },
    # 9. Clean WTS with missing optional attributes (preserves NULLs)
    {
        "source_platform": "telegram", "source_group_id": "group_canary", "source_message_id": 1007,
        "from_name": "Canary Seller F", "from_number": None, "orig_ts": 1770000700,
        "msg_text": "WTS Cartier Santos 100 XL $6200",
        "has_exact_source_image": False, "front_image": None,
        "storage_key": None, "attachment_keys": [], "mime_type": None
    },
    # 10. Clean WTS Audemars Piguet
    {
        "source_platform": "telegram", "source_group_id": "group_canary", "source_message_id": 1008,
        "from_name": "Canary Seller G", "from_number": "+15550007", "orig_ts": 1770000800,
        "msg_text": "For Sale Audemars Piguet Royal Oak 15500ST $38000 complete set",
        "has_exact_source_image": True, "front_image": "http://img.test/ap.jpg",
        "storage_key": "media/ap.jpg", "attachment_keys": ["ap.jpg"], "mime_type": "image/jpeg"
    }
]

def main():
    batch_id = f"canary_e2e_{time.strftime('%Y%m%d_%H%M%S')}"
    print(f"=== GENUINE E2E PIPELINE CANARY RUNNER ===")
    print(f"Executing REAL pipeline reader for {len(TEST_RECORDS)} records (batch_id: {batch_id})...")
    
    # 1. Run reader
    db_path = "pipeline.db"
    conn = sqlite3.connect(db_path)
    setup_sqlite_schema(conn)
    process_source_records(conn, TEST_RECORDS, batch_id=batch_id)
    
    cursor = conn.cursor()
    cursor.execute("SELECT count(*) FROM raw_payload_versions WHERE batch_id = ?", (batch_id,))
    v_count = cursor.fetchone()[0]
    print(f"[OK] Reader processed & enqueued {v_count} payload versions.")
    conn.close()

    # 2. Run worker
    print(f"Executing REAL pipeline worker runner...")
    run_pipeline(limit=50, is_canary=True, db_path=db_path)
    
    # 3. Verify database state
    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()
    cursor.execute("SELECT count(*) FROM raw_payloads WHERE batch_id = ?", (batch_id,))
    p_cnt = cursor.fetchone()[0]
    cursor.execute("SELECT count(*) FROM raw_payload_versions WHERE batch_id = ?", (batch_id,))
    pv_cnt = cursor.fetchone()[0]
    cursor.execute("SELECT count(*) FROM staging_listings WHERE batch_id = ?", (batch_id,))
    st_cnt = cursor.fetchone()[0]
    
    print("\n--- CANARY RUN RESULTS SUMMARY ---")
    print(f"  Raw Payloads: {p_cnt}")
    print(f"  Payload Versions: {pv_cnt}")
    print(f"  Staging Listings: {st_cnt}")
    
    conn.close()
    print(f"\n=== E2E CANARY COMPLETE (batch_id: {batch_id}) ===")

if __name__ == "__main__":
    main()
