import unittest
import os
import sys
import sqlite3

sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), '../scripts')))

import pipeline_do_reader
import pipeline_runner

class TestPayloadVersioningIntegration(unittest.TestCase):
    def setUp(self):
        self.old_pgpass = os.environ.get("PGPASSWORD")
        self.old_dburl = os.environ.get("DATABASE_URL")
        os.environ["REQUIRE_POSTGRES"] = "0"
        pipeline_runner.REQUIRE_POSTGRES = False
        pipeline_do_reader.IS_SQLITE = True
        if "PGPASSWORD" in os.environ:
            del os.environ["PGPASSWORD"]
        if "DATABASE_URL" in os.environ:
            del os.environ["DATABASE_URL"]

    def tearDown(self):
        if self.old_pgpass:
            os.environ["PGPASSWORD"] = self.old_pgpass
        if self.old_dburl:
            os.environ["DATABASE_URL"] = self.old_dburl

    def test_edited_message_creates_immutable_payload_version_via_real_reader(self):
        """Proves executing real reader (process_source_records) for an edited message under the same transport ID creates a 2nd immutable payload version and distinct listing event."""
        conn = pipeline_runner.get_db_connection()
        self.assertTrue(pipeline_runner.IS_SQLITE)
        cur = conn.cursor()

        # Clear test tables
        cur.execute("DELETE FROM listings;")
        cur.execute("DELETE FROM processing_jobs;")
        cur.execute("DELETE FROM payload_versions;")
        cur.execute("DELETE FROM payloads;")
        conn.commit()

        msg_id = "test_msg_999"
        batch_id = "test_real_reader_batch"

        # Version 1: Original posting ($14,000) ingested via REAL READER
        v1_record = [{
            "id": msg_id,
            "source_group_id": "auctions",
            "channel_id": "auctions",
            "type": "sale",
            "from_name": "Test Dealer",
            "from_number": "+15550199",
            "region": "North America",
            "description": "WTS Rolex Submariner 126610LN New 2024 Price 14000 USD",
            "created_on": "2026-08-01T10:00:00Z"
        }]

        # Execute REAL READER ingestion for Version 1
        enqueued_1 = pipeline_do_reader.process_source_records(v1_record, batch_id=batch_id)
        self.assertEqual(enqueued_1, 1)

        # Run worker step 1
        processed_1 = pipeline_runner.run_pipeline_step(limit=10)
        self.assertGreaterEqual(processed_1, 1)

        # Verify listing event 1
        cur.execute("SELECT id, price_usd, listing_event_signature, batch_id FROM listings;")
        rows1 = cur.fetchall()
        self.assertEqual(len(rows1), 1)
        self.assertEqual(float(rows1[0]["price_usd"]), 14000.0)
        self.assertEqual(rows1[0]["batch_id"], batch_id)
        evt_sig_1 = rows1[0]["listing_event_signature"]

        # Version 2: Seller EDITS message under SAME transport message ID ($13,500) ingested via REAL READER
        v2_record = [{
            "id": msg_id,
            "source_group_id": "auctions",
            "channel_id": "auctions",
            "type": "sale",
            "from_name": "Test Dealer",
            "from_number": "+15550199",
            "region": "North America",
            "description": "WTS Rolex Submariner 126610LN New 2024 Reduced Price 13500 USD",
            "created_on": "2026-08-05T12:00:00Z"
        }]

        # Execute REAL READER ingestion for Version 2
        enqueued_2 = pipeline_do_reader.process_source_records(v2_record, batch_id=batch_id)
        self.assertEqual(enqueued_2, 1)

        # Run worker step 2
        processed_2 = pipeline_runner.run_pipeline_step(limit=10)
        self.assertGreaterEqual(processed_2, 1)

        # Database Assertions
        cur.execute("SELECT count(*) FROM payloads;")
        self.assertEqual(cur.fetchone()[0], 1, "Transport payload table must have exactly 1 stable transport row")

        cur.execute("SELECT count(*) FROM payload_versions;")
        self.assertEqual(cur.fetchone()[0], 2, "payload_versions table must contain 2 distinct immutable content versions")

        cur.execute("SELECT count(*) FROM processing_jobs;")
        self.assertEqual(cur.fetchone()[0], 2, "processing_jobs table must contain 2 distinct jobs for the 2 versions")

        cur.execute("SELECT id, price_usd, listing_event_signature FROM listings ORDER BY created_at ASC;")
        rows2 = cur.fetchall()
        self.assertEqual(len(rows2), 2, "Listings table must contain 2 distinct listing events for the 2 versions")
        
        evt_sig_2 = rows2[1]["listing_event_signature"]
        self.assertEqual(float(rows2[1]["price_usd"]), 13500.0)
        self.assertNotEqual(evt_sig_1, evt_sig_2, "Edited version under same transport ID MUST produce distinct immutable listing event signature")

if __name__ == "__main__":
    unittest.main()
