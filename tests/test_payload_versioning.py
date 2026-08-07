import unittest
import os
import sys
import uuid
import sqlite3

sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), '../scripts')))

import pipeline_runner

class TestPayloadVersioningIntegration(unittest.TestCase):
    def setUp(self):
        self.old_pgpass = os.environ.get("PGPASSWORD")
        self.old_dburl = os.environ.get("DATABASE_URL")
        os.environ["REQUIRE_POSTGRES"] = "0"
        pipeline_runner.REQUIRE_POSTGRES = False
        if "PGPASSWORD" in os.environ:
            del os.environ["PGPASSWORD"]
        if "DATABASE_URL" in os.environ:
            del os.environ["DATABASE_URL"]

    def tearDown(self):
        if self.old_pgpass:
            os.environ["PGPASSWORD"] = self.old_pgpass
        if self.old_dburl:
            os.environ["DATABASE_URL"] = self.old_dburl

    def test_edited_message_creates_immutable_payload_version_and_new_listing_event(self):
        """Real reader/database integration test: edited raw message under the same transport ID creates a 2nd immutable payload version and 2nd distinct listing event."""
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
        platform = "mysql_thecollective"
        group = "auctions"
        batch_id = "test_versioning_batch"

        t_ck = pipeline_runner.compute_transport_checksum(platform, group, msg_id)
        p_uuid = str(uuid.uuid5(uuid.NAMESPACE_DNS, f"watchfacts.payload.{t_ck}"))

        # Version 1: Original posting ($14,000)
        v1_text = "WTS Rolex Submariner 126610LN New 2024 Price 14000 USD"
        v1_ts = "2026-08-01T10:00:00Z"
        v1_ck = pipeline_runner.hashlib.sha256(f"{t_ck}:{pipeline_runner.hashlib.sha256(f'{v1_text}:{v1_ts}'.encode('utf-8')).hexdigest()}".encode('utf-8')).hexdigest()
        v1_uuid = str(uuid.uuid5(uuid.NAMESPACE_DNS, f"watchfacts.payload_version.{v1_ck}"))
        j1_uuid = str(uuid.uuid5(uuid.NAMESPACE_DNS, f"watchfacts.job.{v1_ck}"))

        # Insert transport payload 1
        cur.execute("""
            INSERT OR IGNORE INTO payloads (id, source_platform, source_group_id, source_message_id, source_intent, payload_checksum, batch_id)
            VALUES (?, ?, ?, ?, 'sale', ?, ?);
        """, (p_uuid, platform, group, msg_id, t_ck, batch_id))

        # Insert payload version 1
        cur.execute("""
            INSERT OR IGNORE INTO payload_versions (id, raw_payload_id, version_checksum, source_intent, original_message_text, original_timestamp, batch_id)
            VALUES (?, ?, ?, 'sale', ?, ?, ?);
        """, (v1_uuid, p_uuid, v1_ck, v1_text, v1_ts, batch_id))

        # Queue processing job 1
        cur.execute("""
            INSERT OR IGNORE INTO processing_jobs (id, raw_payload_id, payload_version_id, status, batch_id)
            VALUES (?, ?, ?, 'queued', ?);
        """, (j1_uuid, p_uuid, v1_uuid, batch_id))
        conn.commit()

        # Run worker step 1
        processed_1 = pipeline_runner.run_pipeline_step(limit=10)
        self.assertGreaterEqual(processed_1, 1)

        # Verify listing event 1
        cur.execute("SELECT id, price_usd, listing_event_signature, batch_id FROM listings WHERE job_id = ?;", (j1_uuid,))
        row1 = cur.fetchone()
        self.assertIsNotNone(row1)
        self.assertEqual(float(row1["price_usd"]), 14000.0)
        self.assertEqual(row1["batch_id"], batch_id)
        evt_sig_1 = row1["listing_event_signature"]

        # Version 2: Seller EDITS message under SAME transport message ID ($13,500)
        v2_text = "WTS Rolex Submariner 126610LN New 2024 Reduced Price 13500 USD"
        v2_ts = "2026-08-05T12:00:00Z"
        v2_ck = pipeline_runner.hashlib.sha256(f"{t_ck}:{pipeline_runner.hashlib.sha256(f'{v2_text}:{v2_ts}'.encode('utf-8')).hexdigest()}".encode('utf-8')).hexdigest()
        v2_uuid = str(uuid.uuid5(uuid.NAMESPACE_DNS, f"watchfacts.payload_version.{v2_ck}"))
        j2_uuid = str(uuid.uuid5(uuid.NAMESPACE_DNS, f"watchfacts.job.{v2_ck}"))

        # Re-run ingestion under SAME transport message ID
        cur.execute("""
            INSERT OR IGNORE INTO payloads (id, source_platform, source_group_id, source_message_id, source_intent, payload_checksum, batch_id)
            VALUES (?, ?, ?, ?, 'sale', ?, ?);
        """, (p_uuid, platform, group, msg_id, t_ck, batch_id))

        cur.execute("""
            INSERT OR IGNORE INTO payload_versions (id, raw_payload_id, version_checksum, source_intent, original_message_text, original_timestamp, batch_id)
            VALUES (?, ?, ?, 'sale', ?, ?, ?);
        """, (v2_uuid, p_uuid, v2_ck, v2_text, v2_ts, batch_id))

        cur.execute("""
            INSERT OR IGNORE INTO processing_jobs (id, raw_payload_id, payload_version_id, status, batch_id)
            VALUES (?, ?, ?, 'queued', ?);
        """, (j2_uuid, p_uuid, v2_uuid, batch_id))
        conn.commit()

        # Run worker step 2
        processed_2 = pipeline_runner.run_pipeline_step(limit=10)
        self.assertGreaterEqual(processed_2, 1)

        # Assertions
        cur.execute("SELECT count(*) FROM payloads WHERE id = ?;", (p_uuid,))
        self.assertEqual(cur.fetchone()[0], 1, "Transport payload table must have exactly 1 stable transport row")

        cur.execute("SELECT count(*) FROM payload_versions WHERE raw_payload_id = ?;", (p_uuid,))
        self.assertEqual(cur.fetchone()[0], 2, "payload_versions table must contain 2 distinct immutable content versions")

        cur.execute("SELECT count(*) FROM processing_jobs WHERE raw_payload_id = ?;", (p_uuid,))
        self.assertEqual(cur.fetchone()[0], 2, "processing_jobs table must contain 2 distinct jobs for the 2 versions")

        cur.execute("SELECT id, price_usd, listing_event_signature FROM listings WHERE job_id = ?;", (j2_uuid,))
        row2 = cur.fetchone()
        self.assertIsNotNone(row2)
        self.assertEqual(float(row2["price_usd"]), 13500.0)
        evt_sig_2 = row2["listing_event_signature"]

        self.assertNotEqual(evt_sig_1, evt_sig_2, "Edited version under same transport ID MUST produce distinct immutable listing event signature")

if __name__ == "__main__":
    unittest.main()
