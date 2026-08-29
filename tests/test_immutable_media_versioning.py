import unittest
import sqlite3
import os
import sys
import json
import hashlib

sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), '../scripts')))

from pipeline_processor import WatchFactsPipelineProcessor, DO_LISTINGS_BASE
from pipeline_runner import setup_sqlite_schema

class TestImmutableMediaVersioning(unittest.TestCase):

    def setUp(self):
        self.processor = WatchFactsPipelineProcessor()
        self.conn = sqlite3.connect(":memory:")
        self.conn.row_factory = sqlite3.Row
        setup_sqlite_schema(self.conn)

    def tearDown(self):
        self.conn.close()

    def test_raw_schema_contract(self):
        cur = self.conn.cursor()
        cur.execute("PRAGMA table_info(payloads);")
        cols = [r['name'] for r in cur.fetchall()]
        
        # Verify schema contracts
        self.assertIn("original_image_references", cols)
        self.assertIn("do_object_key", cols)
        self.assertNotIn("front_image", cols, "raw.payloads must NOT contain front_image column")

        cur.execute("PRAGMA table_info(payload_versions);")
        v_cols = [r['name'] for r in cur.fetchall()]
        self.assertIn("version_checksum", v_cols)
        self.assertIn("raw_payload_id", v_cols)
        self.assertIn("do_object_key", v_cols)
        self.assertIn("original_image_references", v_cols)

    def test_immutable_version_insertion_and_rerun_idempotency(self):
        cur = self.conn.cursor()
        payload_id = "p-100"
        version_id_1 = "v-100"
        version_checksum_1 = hashlib.sha256(b"msg1:media1").hexdigest()

        # 1. Insert Envelope
        cur.execute("""
            INSERT INTO payloads (id, source_platform, source_group_id, source_message_id, original_message_text, original_timestamp, payload_checksum)
            VALUES (?, 'auction', 'US', 'msg-100', 'WTS Rolex 116500LN $30000', '2026-08-09T00:00:00Z', 'chk-100');
        """, (payload_id,))

        # 2. Insert Version 1
        cur.execute("""
            INSERT INTO payload_versions (id, raw_payload_id, version_checksum, original_message_text, original_timestamp, do_object_key)
            VALUES (?, ?, ?, 'WTS Rolex 116500LN $30000', '2026-08-09T00:00:00Z', 'key_100.jpg');
        """, (version_id_1, payload_id, version_checksum_1))
        
        # Enqueue Job 1
        cur.execute("""
            INSERT INTO processing_jobs (id, raw_payload_id, payload_version_id, status)
            VALUES ('job-100', ?, ?, 'queued');
        """, (payload_id, version_id_1))

        # Re-run attempt with same version_checksum should yield 0 new rows
        cur.execute("""
            INSERT OR IGNORE INTO payload_versions (id, raw_payload_id, version_checksum, original_message_text, original_timestamp)
            VALUES ('v-100-dup', ?, ?, 'WTS Rolex 116500LN $30000', '2026-08-09T00:00:00Z');
        """, (payload_id, version_checksum_1))
        self.assertEqual(cur.rowcount, 0, "Duplicate version insertion must be ignored / suppressed")

        cur.execute("SELECT COUNT(*) as count FROM payload_versions WHERE raw_payload_id = ?;", (payload_id,))
        self.assertEqual(cur.fetchone()['count'], 1)

    def test_media_change_creates_new_version_and_job(self):
        cur = self.conn.cursor()
        payload_id = "p-200"
        
        cur.execute("""
            INSERT INTO payloads (id, source_platform, source_group_id, source_message_id, original_message_text, original_timestamp, payload_checksum)
            VALUES (?, 'auction', 'US', 'msg-200', 'WTS Rolex 116500LN $30000', '2026-08-09T00:00:00Z', 'chk-200');
        """, (payload_id,))

        # Version 1 (no image)
        v1_chk = hashlib.sha256(b"msg200:no_media").hexdigest()
        cur.execute("""
            INSERT INTO payload_versions (id, raw_payload_id, version_checksum, original_message_text, original_timestamp)
            VALUES ('v-200-1', ?, ?, 'WTS Rolex 116500LN $30000', '2026-08-09T00:00:00Z');
        """, (payload_id, v1_chk))

        # Version 2 (new image added)
        v2_chk = hashlib.sha256(b"msg200:key_200.jpg").hexdigest()
        cur.execute("""
            INSERT INTO payload_versions (id, raw_payload_id, version_checksum, original_message_text, original_timestamp, do_object_key)
            VALUES ('v-200-2', ?, ?, 'WTS Rolex 116500LN $30000', '2026-08-09T00:00:00Z', 'key_200.jpg');
        """, (payload_id, v2_chk))

        cur.execute("SELECT COUNT(*) as count FROM payload_versions WHERE raw_payload_id = ?;", (payload_id,))
        self.assertEqual(cur.fetchone()['count'], 2, "Media change must create exactly one new immutable version")

    def test_processor_url_safety_and_no_double_prefixing(self):
        # 1. Valid HTTP URL
        http_url = "https://images.example.com/watch.jpg"
        url, preserved, resolvable = self.processor.resolve_and_validate_image_url(http_url)
        self.assertEqual(url, http_url)
        self.assertTrue(preserved)
        self.assertTrue(resolvable)

        # 2. Valid DO object key
        key = "677ec3e161c64_front_image.jpg"
        url2, preserved2, resolvable2 = self.processor.resolve_and_validate_image_url(key)
        self.assertEqual(url2, DO_LISTINGS_BASE + key)
        self.assertTrue(preserved2)
        self.assertTrue(resolvable2)

        # 3. Path traversal attack -> Fail Closed
        bad_key = "../../../etc/passwd"
        url3, preserved3, resolvable3 = self.processor.resolve_and_validate_image_url(bad_key)
        self.assertEqual(url3, "")
        self.assertFalse(preserved3)
        self.assertFalse(resolvable3)

        # 4. Unsafe scheme -> Fail Closed
        bad_scheme = "javascript:alert(1)"
        url4, preserved4, resolvable4 = self.processor.resolve_and_validate_image_url(bad_scheme)
        self.assertEqual(url4, "")
        self.assertFalse(preserved4)
        self.assertFalse(resolvable4)

        # 5. Double HTTP prefix -> Fail Closed
        double_prefix = DO_LISTINGS_BASE + "https://images.example.com/watch.jpg"
        url5, preserved5, resolvable5 = self.processor.resolve_and_validate_image_url(double_prefix)
        self.assertEqual(url5, "")
        self.assertFalse(preserved5)
        self.assertFalse(resolvable5)

    def test_bundle_child_image_suppression_and_parent_preservation(self):
        job_data = {
            "id": "job-bundle-1",
            "message_text": "Rolex 116500LN White - 31k\nAP 15500ST Blue - 38k",
            "type": "sale",
            "from_name": "Test Dealer",
            "from_number": "1234567",
            "region": "US",
            "front_image": "677ec3e161c64_front_image.jpg",
            "do_object_key": "677ec3e161c64_front_image.jpg"
        }
        res = self.processor.process_job(job_data)
        
        # Parent retains private image URL
        self.assertEqual(res["image_url"], DO_LISTINGS_BASE + "677ec3e161c64_front_image.jpg")

        # Children must have empty image_url
        self.assertTrue(len(res["child_listings"]) >= 2)
        for child in res["child_listings"]:
            self.assertEqual(child["image_url"], "", "Bundle child image_url MUST be empty string")

if __name__ == '__main__':
    unittest.main()
