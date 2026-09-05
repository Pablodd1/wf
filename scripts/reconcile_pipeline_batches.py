import pymysql
import hashlib
import json
import uuid
import sys
import os
from datetime import datetime

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from pipeline_processor import WatchFactsPipelineProcessor
from pipeline_runner import get_db_connection, db_execute, setup_sqlite_schema

MYSQL_HOST = os.environ.get("MYSQL_HOST", "161.35.0.209")
MYSQL_PORT = int(os.environ.get("MYSQL_PORT", "3306"))
MYSQL_USER = os.environ.get("MYSQL_USER", "john")
MYSQL_PASS = os.environ.get("MYSQL_PASS")
MYSQL_DB = os.environ.get("MYSQL_DB", "thecollective_inventory")

def calculate_checksum(text):
    return hashlib.sha256(text.encode('utf-8', errors='ignore')).hexdigest()

def reconcile_batch(batch_size):
    print(f"\n=======================================================")
    print(f"Starting Empirical Reconciliation for {batch_size}-Record Batch...")
    print(f"=======================================================")
    
    conn_src = pymysql.connect(
        host=MYSQL_HOST,
        port=MYSQL_PORT,
        user=MYSQL_USER,
        password=MYSQL_PASS,
        database=MYSQL_DB,
        connect_timeout=20,
        charset='utf8mb4'
    )
    cursor_src = conn_src.cursor(pymysql.cursors.DictCursor)
    
    cursor_src.execute("""
        SELECT a.id, a.title, a.description, a.front_image, a.type, a.comments,
               a.brand AS brand_src, a.reference AS reference_src, a.dial_color AS dial_src,
               a.condition_id, a.price AS price_src, a.reserve_price, a.min AS price_min,
               a.max AS price_max, a.avg AS price_avg, a.from_name, a.from_number,
               a.phone_code, a.region, a.dealer_rating, a.is_from_verified_user,
               a.is_from_paid_user, a.is_seller_approved, a.company_id,
               a.catalog_confirmed, a.catalog_canonical_confirmed,
               a.are_attributes_extracted, a.identification_status, a.wf_inspection,
               a.report_url, a.times_posted, a.created_on, a.reposted_at
        FROM auctions a
        WHERE (a.description IS NOT NULL AND a.description != '')
           OR (a.title IS NOT NULL AND a.title != '')
        ORDER BY a.id ASC
        LIMIT %s;
    """, (batch_size,))
    
    rows = cursor_src.fetchall()
    print(f"Fetched {len(rows)} raw auctions from MySQL.")
    conn_src.close()
    
    conn_db = get_db_connection()
    cur = conn_db.cursor()
    
    # Process batch
    processor = WatchFactsPipelineProcessor()
    
    metrics = {
        "batch_size": batch_size,
        "run_timestamp": datetime.utcnow().isoformat() + "Z",
        "raw_parents_count": 0,
        "bundle_parents_count": 0,
        "child_listings_count": 0,
        "duplicates_count": 0,
        "failed_jobs_count": 0,
        "wts_count": 0,
        "wtb_count": 0,
        "priced_count": 0,
        "no_price_count": 0,
        "watches_count": 0,
        "non_watches_count": 0,
        "normalization_status": {"normalized": 0, "partially_normalized": 0, "needs_review": 0},
        "trading_floor_status": {"published": 0, "published_pending_verification": 0, "bundle_pending_separation": 0, "suppressed_exact_duplicate": 0},
        "price_research_status": {
            "eligible": 0, "provisional_needs_review": 0, "ineligible_no_price": 0,
            "ineligible_non_watch": 0, "ineligible_bundle": 0, "ineligible_currency": 0,
            "ineligible_identity": 0, "ineligible_wtb": 0
        }
    }
    
    seen_checksums = set()
    
    for idx, row in enumerate(rows):
        msg_text = row['description'] or row['title'] or row['comments'] or ''
        if not msg_text.strip():
            continue
            
        job_id = str(uuid.uuid4())
        checksum = calculate_checksum(msg_text)
        
        is_dup = checksum in seen_checksums
        seen_checksums.add(checksum)
        
        job_data = {
            "id": job_id, "source_id": row['id'], "message_text": msg_text, "type": row['type'] or 'sale',
            "brand_src": row['brand_src'], "reference_src": row['reference_src'], "dial_src": row['dial_src'],
            "condition_id": row['condition_id'], "price_src": row['price_src'], "reserve_price": row['reserve_price'],
            "price_min": row['price_min'], "price_max": row['price_max'], "price_avg": row['price_avg'],
            "front_image": row['front_image'], "from_name": row['from_name'], "from_number": row['from_number'],
            "phone_code": row['phone_code'], "region": row['region'], "dealer_rating": row['dealer_rating'],
            "is_from_verified_user": row['is_from_verified_user'], "is_from_paid_user": row['is_from_paid_user'],
            "is_seller_approved": row['is_seller_approved'], "company_id": row['company_id'],
            "catalog_confirmed": row['catalog_confirmed'], "catalog_canonical_confirmed": row['catalog_canonical_confirmed'],
            "are_attributes_extracted": row['are_attributes_extracted'], "identification_status": row['identification_status'],
            "wf_inspection": row['wf_inspection'], "report_url": row['report_url'],
            "times_posted": row['times_posted'], "reposted_at": row['reposted_at']
        }
        
        res = processor.process_job(job_data)
        metrics["raw_parents_count"] += 1
        
        if is_dup:
            metrics["duplicates_count"] += 1
            res["trading_floor_status"] = "suppressed_exact_duplicate"
            
        if res["is_bundle"]:
            metrics["bundle_parents_count"] += 1
            
        if res["intent"] == "WTS": metrics["wts_count"] += 1
        else: metrics["wtb_count"] += 1
        
        if res["price_usd"] > 0: metrics["priced_count"] += 1
        else: metrics["no_price_count"] += 1
        
        if res["category"] == "WATCH": metrics["watches_count"] += 1
        else: metrics["non_watches_count"] += 1
        
        # Accumulate status metrics
        norm_st = res["normalization_status"]
        metrics["normalization_status"][norm_st] = metrics["normalization_status"].get(norm_st, 0) + 1
        
        tf_st = res["trading_floor_status"]
        metrics["trading_floor_status"][tf_st] = metrics["trading_floor_status"].get(tf_st, 0) + 1
        
        pr_st = res["price_research_status"]
        metrics["price_research_status"][pr_st] = metrics["price_research_status"].get(pr_st, 0) + 1
        
        children = res.get("child_listings", [])
        metrics["child_listings_count"] += len(children)

    # Save to reconciliation_ledger table
    ledger_id = str(uuid.uuid4())
    ledger_table = "reconciliation_ledger" if hasattr(conn_db, "row_factory") else "jobs.reconciliation_ledger"
    
    try:
        ledger_query = f"""
        INSERT INTO {ledger_table} (
            id, run_timestamp, raw_parents_count, bundle_parents_count, child_listings_count,
            duplicates_count, failed_jobs_count, priced_count, no_price_count, watches_count,
            non_watches_count, pr_eligible_count, pr_provisional_count, pr_ineligible_count,
            reconciliation_details, completed_at
        ) VALUES (
            %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s
        );
        """
        if hasattr(conn_db, "row_factory"):
            ledger_query = ledger_query.replace("%s", "?")
            
        ledger_args = (
            ledger_id, metrics["run_timestamp"], metrics["raw_parents_count"], metrics["bundle_parents_count"],
            metrics["child_listings_count"], metrics["duplicates_count"], metrics["failed_jobs_count"],
            metrics["priced_count"], metrics["no_price_count"], metrics["watches_count"], metrics["non_watches_count"],
            metrics["price_research_status"]["eligible"], metrics["price_research_status"]["provisional_needs_review"],
            sum(v for k, v in metrics["price_research_status"].items() if k not in ("eligible", "provisional_needs_review")),
            json.dumps(metrics), datetime.utcnow().isoformat() + "Z"
        )
        db_execute(cur, ledger_query, ledger_args)
        conn_db.commit()
        print(f"Recorded reconciliation entry {ledger_id} in {ledger_table}")
    except Exception as e:
        print(f"Warning: ledger insertion skipped: {e}")
        
    conn_db.close()
    
    # Write durable JSON artifact
    out_dir = r"C:\Users\Owner\.gemini\antigravity\brain\aaaf9af1-6067-468b-bfc7-1bac307799f6\scratch"
    os.makedirs(out_dir, exist_ok=True)
    json_path = os.path.join(out_dir, f"reconciliation_ledger_{batch_size}.json")
    with open(json_path, "w", encoding="utf-8") as f:
        json.dump(metrics, f, indent=2)
    print(f"Saved durable reconciliation ledger artifact: {json_path}")
    
    return metrics

if __name__ == "__main__":
    b_size = int(sys.argv[1]) if len(sys.argv) > 1 else 500
    reconcile_batch(b_size)
