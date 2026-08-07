import unittest
import urllib.request
import json
import uuid
import hashlib
import sys
import os

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(__file__)), 'scripts'))
import pipeline_runner

SUPABASE_URL = os.environ.get("SUPABASE_URL", "https://qnsafosakvonzgfcsphh.supabase.co")
SUPABASE_KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY") or os.environ.get("SUPABASE_ANON_KEY") or os.environ.get("ANON_KEY")

class TestDatabaseAndPostgRESTIntegration(unittest.TestCase):
    def setUp(self):
        if not SUPABASE_KEY:
            self.skipTest("SKIPPED: SUPABASE_ANON_KEY / ANON_KEY not set in environment.")

    def get_rest(self, endpoint, query_params=None, schema=None):
        param_str = f"?{query_params}" if query_params else ""
        url = f"{SUPABASE_URL}/rest/v1/{endpoint}{param_str}"
        headers = {
            "apikey": SUPABASE_KEY,
            "Authorization": f"Bearer {SUPABASE_KEY}"
        }
        if schema:
            headers["Accept-Profile"] = schema
        req = urllib.request.Request(url, headers=headers, method='GET')
        with urllib.request.urlopen(req) as resp:
            return json.loads(resp.read().decode('utf-8'))

    def test_01_trading_floor_view_contract(self):
        """Test PostgREST query on public.reviewed_workbook_market_source_v2 with exact UI columns."""
        cols = [
            'id', 'job_id', 'source_file', 'source_row_number', 'source_record_id',
            'posting_date', 'posted_by', 'phone_number', 'contact_publication_approved',
            'raw_message', 'listing_type', 'brand_scope', 'supplied_brand', 'canonical_brand',
            'model', 'catalog_model', 'raw_reference', 'normalized_reference', 'catalog_reference',
            'dial_color', 'catalog_dial', 'condition', 'workbook_price_usd', 'source_price_amount',
            'source_price_text', 'source_currency', 'price_evidence_status', 'confidence',
            'verification_status', 'user_image_url', 'imported_at', 'has_exact_source_image',
            'verified_price_usd', 'has_verified_usd_price', 'has_complete_identity', 'has_supplied_price'
        ]
        select_param = f"select={','.join(cols)}"
        data = self.get_rest('reviewed_workbook_market_source_v2', f"{select_param}&limit=10")
        self.assertIsInstance(data, list)
        if len(data) > 0:
            for col in cols:
                self.assertIn(col, data[0])

    def test_02_price_research_view_contract(self):
        """Test PostgREST query on public.price_research_verified_source with exact UI columns."""
        cols = [
            'id', 'job_id', 'intent', 'brand', 'model', 'reference', 'normalized_reference',
            'public_reference', 'reference_search_key', 'dial_color', 'condition', 'price',
            'price_usd', 'price_raw', 'currency', 'box', 'papers', 'raw_message', 'posted_by',
            'phone_number', 'listing_date', 'created_at', 'source', 'dealer_id', 'confidence',
            'thumbnail_url', 'image_url', 'display_image_url', 'image_urls', 'has_images',
            'listing_type', 'has_complete_identity'
        ]
        select_param = f"select={','.join(cols)}"
        data = self.get_rest('price_research_verified_source', f"{select_param}&limit=10")
        self.assertIsInstance(data, list)
        if len(data) > 0:
            for col in cols:
                self.assertIn(col, data[0])

    def test_03_sqlite_local_fallback_schema(self):
        """Test SQLite in-memory fallback creates all required tables cleanly."""
        conn = pipeline_runner.get_db_connection()
        cur = conn.cursor()
        cur.execute("SELECT name FROM sqlite_master WHERE type='table';")
        tables = {row[0] for row in cur.fetchall()}
        self.assertIn("payloads", tables)
        self.assertIn("payload_versions", tables)
        self.assertIn("processing_jobs", tables)
        self.assertIn("listings", tables)
        self.assertIn("reconciliation_ledger", tables)

    def test_04_real_worker_step_execution(self):
        """Test execution of worker pipeline step with CTE job claiming."""
        conn = pipeline_runner.get_db_connection()
        cur = conn.cursor()
        t_ck = pipeline_runner.compute_transport_checksum("test_plat", "test_grp", "msg_123")
        p_id = str(uuid.uuid5(uuid.NAMESPACE_DNS, f"watchfacts.payload.{t_ck}"))
        v_ck = hashlib.sha256(f"{t_ck}:test".encode('utf-8')).hexdigest()
        v_id = str(uuid.uuid5(uuid.NAMESPACE_DNS, f"watchfacts.payload_version.{v_ck}"))
        j_id = str(uuid.uuid5(uuid.NAMESPACE_DNS, f"watchfacts.job.{v_ck}"))

        cur.execute("INSERT OR IGNORE INTO payloads (id, source_platform, source_group_id, source_message_id, payload_checksum) VALUES (?, ?, ?, ?, ?);",
                    (p_id, "test_plat", "test_grp", "msg_123", t_ck))
        cur.execute("INSERT OR IGNORE INTO payload_versions (id, raw_payload_id, version_checksum, original_message_text, original_timestamp) VALUES (?, ?, ?, ?, ?);",
                    (v_id, p_id, v_ck, "WTS Rolex Submariner 126610LN Price 14000 USD", "2026-08-01T10:00:00Z"))
        cur.execute("INSERT OR IGNORE INTO processing_jobs (id, raw_payload_id, payload_version_id, status) VALUES (?, ?, ?, 'queued');",
                    (j_id, p_id, v_id))
        conn.commit()

        processed = pipeline_runner.run_pipeline_step(limit=1)
        self.assertGreaterEqual(processed, 1)

    def test_05_sqlite_pipeline_step_with_provenance_metadata(self):
        """Test seeding SQLite pending job, executing run_pipeline_step, and verifying parent insertion with provenance_metadata."""
        conn = pipeline_runner.get_db_connection()
        cur = conn.cursor()
        t_ck = pipeline_runner.compute_transport_checksum("test_plat", "test_grp", "msg_prov_1")
        p_id = str(uuid.uuid5(uuid.NAMESPACE_DNS, f"watchfacts.payload.{t_ck}"))
        v_ck = hashlib.sha256(f"{t_ck}:prov".encode('utf-8')).hexdigest()
        v_id = str(uuid.uuid5(uuid.NAMESPACE_DNS, f"watchfacts.payload_version.{v_ck}"))
        j_id = str(uuid.uuid5(uuid.NAMESPACE_DNS, f"watchfacts.job.{v_ck}"))

        cur.execute("INSERT OR IGNORE INTO payloads (id, source_platform, source_group_id, source_message_id, payload_checksum) VALUES (?, ?, ?, ?, ?);",
                    (p_id, "test_plat", "test_grp", "msg_prov_1", t_ck))
        cur.execute("INSERT OR IGNORE INTO payload_versions (id, raw_payload_id, version_checksum, original_message_text, original_timestamp) VALUES (?, ?, ?, ?, ?);",
                    (v_id, p_id, v_ck, "WTS Rolex GMT 126710BLRO Price 21000 USD", "2026-08-01T10:00:00Z"))
        cur.execute("INSERT OR IGNORE INTO processing_jobs (id, raw_payload_id, payload_version_id, status) VALUES (?, ?, ?, 'queued');",
                    (j_id, p_id, v_id))
        conn.commit()

        processed = pipeline_runner.run_pipeline_step(limit=1)
        self.assertGreaterEqual(processed, 1)

        cur.execute("SELECT provenance_metadata FROM listings WHERE job_id = ?;", (j_id,))
        row = cur.fetchone()
        self.assertIsNotNone(row)
        self.assertIsNotNone(row[0])

if __name__ == '__main__':
    unittest.main()
