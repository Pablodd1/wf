import os
import sys
import json
import uuid
import hashlib
from datetime import datetime

# Add scripts path
sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), '../scripts')))

import pipeline_do_reader
import pipeline_runner

def run_genuine_canary():
    print("=== GENUINE E2E PIPELINE CANARY RUNNER ===")
    
    batch_id = f"canary_e2e_{datetime.utcnow().strftime('%Y%m%d_%H%M%S')}"
    
    # Define 10 controlled source records according to CTO requirement 7
    source_records = [
        # 1. Priced WTS watch with source image
        {
            "id": "e2e_msg_201",
            "source_group_id": "auctions",
            "region": "North America",
            "from_number": "+15550201",
            "from_name": "Rolex Dealer",
            "type": "sale",
            "description": "WTS Rolex Submariner 126610LN 2024 New Full Set Price 14500 USD",
            "created_on": "2026-08-07T08:00:00Z",
            "front_image": "rolex_sub_126610.jpg"
        },
        # 2. WTB watch request
        {
            "id": "e2e_msg_202",
            "source_group_id": "auctions",
            "region": "Europe",
            "from_number": "+15550202",
            "from_name": "Buyer John",
            "type": "buy",
            "description": "WTB Rolex GMT-Master II 126710BLRO Pepsi",
            "created_on": "2026-08-07T08:05:00Z",
            "front_image": None
        },
        # 3. No-price WTS watch
        {
            "id": "e2e_msg_203",
            "source_group_id": "auctions",
            "region": "Asia",
            "from_number": "+15550203",
            "from_name": "Collector Dave",
            "type": "sale",
            "description": "WTS Omega Speedmaster Professional 310.30.42.50.01.001 Moonwatch DM for price",
            "created_on": "2026-08-07T08:10:00Z",
            "front_image": None
        },
        # 4. Priced handbag
        {
            "id": "e2e_msg_204",
            "source_group_id": "auctions",
            "region": "Global",
            "from_number": "+15550204",
            "from_name": "Luxury Bags",
            "type": "sale",
            "description": "WTS Hermès Birkin 30 Black Gold Hardware New Full Set Price 24000 USD",
            "created_on": "2026-08-07T08:15:00Z",
            "front_image": None
        },
        # 5. Deferred multi-watch bundle
        {
            "id": "e2e_msg_205",
            "source_group_id": "auctions",
            "region": "North America",
            "from_number": "+15550205",
            "from_name": "Wholesale Dealer",
            "type": "sale",
            "description": "WTS Bundle 3 Watches: Rolex Submariner 126610LN $14000 + Omega Speedmaster $6500 + Cartier Santos $7000 Package Price 27000 USD",
            "created_on": "2026-08-07T08:20:00Z",
            "front_image": "bundle_group_photo.jpg"
        },
        # 6. Exact repeat of record 1 (Same ID & transport checksum & content)
        {
            "id": "e2e_msg_201",
            "source_group_id": "auctions",
            "region": "North America",
            "from_number": "+15550201",
            "from_name": "Rolex Dealer",
            "type": "sale",
            "description": "WTS Rolex Submariner 126610LN 2024 New Full Set Price 14500 USD",
            "created_on": "2026-08-07T08:00:00Z",
            "front_image": "rolex_sub_126610.jpg"
        },
        # 7. Record 1 with a changed price
        {
            "id": "e2e_msg_207",
            "source_group_id": "auctions",
            "region": "North America",
            "from_number": "+15550201",
            "from_name": "Rolex Dealer",
            "type": "sale",
            "description": "WTS Rolex Submariner 126610LN 2024 New Full Set Reduced Price 13900 USD",
            "created_on": "2026-08-07T08:25:00Z",
            "front_image": "rolex_sub_126610.jpg"
        },
        # 8. Record 1 with a changed image
        {
            "id": "e2e_msg_208",
            "source_group_id": "auctions",
            "region": "North America",
            "from_number": "+15550201",
            "from_name": "Rolex Dealer",
            "type": "sale",
            "description": "WTS Rolex Submariner 126610LN 2024 New Full Set Price 14500 USD",
            "created_on": "2026-08-07T08:00:00Z",
            "front_image": "rolex_sub_126610_new_angle.jpg"
        },
        # 9. Same reference offered by a different seller
        {
            "id": "e2e_msg_209",
            "source_group_id": "auctions",
            "region": "North America",
            "from_number": "+15550209",
            "from_name": "Bob's Watches",
            "type": "sale",
            "description": "WTS Rolex Submariner 126610LN 2024 Unworn Price 14200 USD",
            "created_on": "2026-08-07T08:30:00Z",
            "front_image": "rolex_sub_bobs.jpg"
        },
        # 10. Same seller reposting the same item with a new source message ID
        {
            "id": "e2e_msg_210",
            "source_group_id": "auctions",
            "region": "North America",
            "from_number": "+15550201",
            "from_name": "Rolex Dealer",
            "type": "sale",
            "description": "WTS Rolex Submariner 126610LN 2024 New Full Set Price 14500 USD",
            "created_on": "2026-08-07T08:35:00Z",
            "front_image": "rolex_sub_126610.jpg"
        }
    ]

    print(f"Executing REAL pipeline reader for {len(source_records)} records (batch_id: {batch_id})...")
    processed_count = pipeline_do_reader.process_source_records(source_records, batch_id=batch_id)
    print(f"[OK] Reader processed & enqueued {processed_count} payload versions.")

    print("Executing REAL pipeline worker runner...")
    jobs_processed = pipeline_runner.run_pipeline_step(limit=20)
    print(f"[OK] Worker processed {jobs_processed} jobs into staging.listings.")

    import sqlite3
    conn = sqlite3.connect(pipeline_do_reader.SQLITE_PATH)
    conn.row_factory = sqlite3.Row
    cur = conn.cursor()

    cur.execute("SELECT id, source_message_id, payload_checksum, front_image FROM payloads WHERE batch_id = ?", (batch_id,))
    payloads = [dict(r) for r in cur.fetchall()]

    cur.execute("SELECT id, raw_payload_id, version_checksum, front_image FROM payload_versions WHERE batch_id = ?", (batch_id,))
    versions = [dict(r) for r in cur.fetchall()]

    cur.execute("SELECT id, raw_message_text, category, intent, listing_type, price_usd, trading_floor_status, price_research_status, front_image, from_name, from_number, first_posted_at, reposted_at FROM listings WHERE batch_id = ?", (batch_id,))
    listings = [dict(r) for r in cur.fetchall()]

    print(f"\n--- CANARY RUN RESULTS SUMMARY ---")
    print(f"  Raw Payloads: {len(payloads)}")
    print(f"  Payload Versions: {len(versions)}")
    print(f"  Staging Listings: {len(listings)}")

    return batch_id, payloads, versions, listings

if __name__ == "__main__":
    b_id, p_list, v_list, l_list = run_genuine_canary()
    print(f"\n=== E2E CANARY COMPLETE (batch_id: {b_id}) ===")
