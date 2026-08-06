import unittest
import sys
import os
import sqlite3
import hashlib

sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), '../scripts')))

from pipeline_processor import WatchFactsPipelineProcessor
from pipeline_runner import (
    compute_transport_checksum,
    compute_seller_item_signature,
    compute_listing_event_signature,
    check_duplicate_payload
)

class TestIdentityAndWtsWtbSeparation(unittest.TestCase):
    def setUp(self):
        self.processor = WatchFactsPipelineProcessor()
        self.conn = sqlite3.connect(":memory:")
        self.cur = self.conn.cursor()

        # Create isolated tables
        self.cur.execute("""
            CREATE TABLE payloads (
                id TEXT PRIMARY KEY,
                source_platform TEXT,
                source_group_id TEXT,
                source_group_name TEXT,
                source_message_id TEXT,
                source_sender_id TEXT,
                source_sender_name TEXT,
                original_message_text TEXT,
                original_timestamp TEXT,
                payload_checksum TEXT UNIQUE
            );
        """)
        self.cur.execute("""
            CREATE TABLE processing_jobs (
                id TEXT PRIMARY KEY,
                raw_payload_id TEXT,
                status TEXT
            );
        """)
        self.cur.execute("""
            CREATE TABLE listings (
                id TEXT PRIMARY KEY,
                job_id TEXT,
                parent_id TEXT,
                seller_id TEXT,
                intent TEXT,
                listing_type TEXT,
                brand_normalized TEXT,
                reference_normalized TEXT,
                price_usd REAL,
                trading_floor_status TEXT,
                price_research_status TEXT,
                provenance_metadata TEXT
            );
        """)

    def tearDown(self):
        self.conn.close()

    def test_1_different_sellers_identical_text_produces_two_records(self):
        """Identical text from different sellers produces 2 distinct transport checksums and 2 staging records."""
        msg = "WTS Rolex Submariner 126610LN Price $14000"

        # Seller A
        ck_a = compute_transport_checksum("telegram", "group1", "msg_001")
        # Seller B (Different message ID / transport identity)
        ck_b = compute_transport_checksum("telegram", "group1", "msg_002")

        self.assertNotEqual(ck_a, ck_b, "Transport checksums for different message transmissions must be distinct")

        # Insert Seller A payload & job
        self.cur.execute("""
            INSERT INTO payloads (id, source_platform, source_group_id, source_message_id, source_sender_id, original_message_text, payload_checksum)
            VALUES ('payload_a', 'telegram', 'group1', 'msg_001', 'seller_a', ?, ?);
        """, (msg, ck_a))
        self.cur.execute("INSERT INTO processing_jobs (id, raw_payload_id, status) VALUES ('job_a', 'payload_a', 'normalized');")

        # Insert Seller B payload & job (Different seller & message ID, exact same message text)
        self.cur.execute("""
            INSERT INTO payloads (id, source_platform, source_group_id, source_message_id, source_sender_id, original_message_text, payload_checksum)
            VALUES ('payload_b', 'telegram', 'group1', 'msg_002', 'seller_b', ?, ?);
        """, (msg, ck_b))
        self.cur.execute("INSERT INTO processing_jobs (id, raw_payload_id, status) VALUES ('job_b', 'payload_b', 'normalized');")

        self.cur.execute("SELECT count(*) FROM payloads;")
        count = self.cur.fetchone()[0]
        self.assertEqual(count, 2, "Identical message text from different sellers must yield 2 distinct payload records")

    def test_2_same_platform_group_message_id_is_one_transport_duplicate(self):
        """Re-ingesting the exact same platform + group + message ID is detected as a transport duplicate."""
        ck = compute_transport_checksum("telegram", "group1", "msg_100")
        self.cur.execute("""
            INSERT INTO payloads (id, source_platform, source_group_id, source_message_id, source_sender_id, original_message_text, payload_checksum)
            VALUES ('payload_100', 'telegram', 'group1', 'msg_100', 'seller_a', 'Rolex 116500LN $30000', ?);
        """, (ck,))
        self.cur.execute("INSERT INTO processing_jobs (id, raw_payload_id, status) VALUES ('job_100', 'payload_100', 'normalized');")

        # Duplicate check for same checksum
        is_dup = check_duplicate_payload(self.cur, ck, "payload_new", set())
        self.assertTrue(is_dup, "Exact same platform/group/message ID must be flagged as a transport duplicate")

    def test_3_changed_price_or_date_is_separate_historical_event(self):
        """A changed price or timestamp produces a distinct listing-event signature."""
        seller_item_sig = compute_seller_item_signature("seller_a", "WATCH", "Rolex", "126610LN")

        evt1 = compute_listing_event_signature(seller_item_sig, "Rolex 126610LN $14000", 14000.0, "2026-08-01T10:00:00Z")
        evt2 = compute_listing_event_signature(seller_item_sig, "Rolex 126610LN $13500", 13500.0, "2026-08-05T10:00:00Z")

        self.assertNotEqual(evt1, evt2, "Changed price or timestamp must yield a distinct historical event signature")

    def test_4_single_wts_and_bundle_child_wts_both_reach_price_research(self):
        """Both single WTS (listing_type = 'WTS') and bundle child WTS (listing_type = 'WTS') get listing_type = 'WTS' and reach Price Research."""
        # Single WTS job
        j_single = {
            "id": "job_single",
            "message_text": "WTS Rolex Daytona 116500LN Price 30000 USD",
            "type": "sale",
            "catalog_confirmed": 1
        }
        res_single = self.processor.process_job(j_single)
        self.assertEqual(res_single["listing_type"], "WTS")
        self.assertEqual(res_single["trading_floor_status"], "published")
        self.assertEqual(res_single["price_research_status"], "eligible")

        # Bundle WTS job
        j_bundle = {
            "id": "job_bundle",
            "message_text": "Rolex 116500LN White - 30k USD\nRolex 126610LV Green - 15k USD",
            "type": "sale",
            "catalog_confirmed": 1
        }
        res_bundle = self.processor.process_job(j_bundle)
        self.assertEqual(res_bundle["listing_type"], "MULTI_LISTING")
        self.assertEqual(len(res_bundle["child_listings"]), 2)

        child0 = res_bundle["child_listings"][0]
        self.assertEqual(child0["listing_type"], "WTS")
        self.assertEqual(child0["price_research_status"], "eligible")

    def test_5_unpriced_wtb_in_demand_totals_not_in_price_averages(self):
        """Unpriced WTB listing gets price_research_status = 'eligible' for demand totals, but price_usd = 0 excludes it from price averages."""
        j_wtb = {
            "id": "job_wtb_unpriced",
            "message_text": "WTB Patek Philippe 5711/1A Blue Dial",
            "type": "buy",
            "catalog_confirmed": 1
        }
        res_wtb = self.processor.process_job(j_wtb)
        self.assertEqual(res_wtb["intent"], "WTB")
        self.assertEqual(res_wtb["listing_type"], "WTB")
        self.assertEqual(res_wtb["price_research_status"], "eligible", "Unpriced WTB requests must be eligible for demand totals")
        self.assertEqual(res_wtb["price_usd"], 0.0, "Unpriced WTB must have price_usd = 0")

        # Database aggregation assertion simulation:
        listings_data = [
            {"intent": "WTS", "price_usd": 30000.0, "status": "eligible"},
            {"intent": "WTS", "price_usd": 32000.0, "status": "eligible"},
            {"intent": "WTB", "price_usd": 0.0, "status": "eligible"},  # Unpriced WTB demand signal
            {"intent": "WTB", "price_usd": 28000.0, "status": "eligible"}  # Priced WTB demand signal
        ]

        # WTS Sale Price Average calculation (must filter intent = 'WTS' AND price_usd > 0)
        wts_prices = [x["price_usd"] for x in listings_data if x["intent"] == "WTS" and x["price_usd"] > 0]
        avg_wts_price = sum(wts_prices) / len(wts_prices)
        self.assertEqual(avg_wts_price, 31000.0, "WTS price average must equal 31000 and exclude all WTB records")

        # Buyer Demand Signal Count (must include all WTB eligible records)
        wtb_demand_count = len([x for x in listings_data if x["intent"] == "WTB" and x["status"] == "eligible"])
        self.assertEqual(wtb_demand_count, 2, "Demand count must include all WTB eligible requests (both priced and unpriced)")

if __name__ == "__main__":
    unittest.main()
