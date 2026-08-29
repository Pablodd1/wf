import unittest
import urllib.request
import json
import uuid
import hashlib
import sys
import os

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(__file__)), 'scripts'))
from pipeline_runner import run_pipeline_step

SUPABASE_URL = os.environ.get("SUPABASE_URL")
SUPABASE_KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY") or os.environ.get("SUPABASE_ANON_KEY")
RUN_LIVE = os.environ.get("RUN_LIVE_SUPABASE_TESTS") == "1" and bool(SUPABASE_URL and SUPABASE_KEY)


class TestDatabaseAndPostgRESTIntegration(unittest.TestCase):
    def get_rest(self, endpoint, query_params=None, schema=None):
        param_str = f"?{query_params}" if query_params else ""
        url = f"{SUPABASE_URL}/rest/v1/{endpoint}{param_str}"
        headers = {"apikey": SUPABASE_KEY, "Authorization": f"Bearer {SUPABASE_KEY}"}
        if schema:
            headers["Accept-Profile"] = schema
        req = urllib.request.Request(url, headers=headers, method='GET')
        with urllib.request.urlopen(req) as resp:
            return json.loads(resp.read().decode('utf-8'))

    def require_live(self, postgres=False):
        if not RUN_LIVE:
            self.skipTest("Set RUN_LIVE_SUPABASE_TESTS=1 and Supabase credentials for live contracts")
        if postgres and not (os.environ.get("DATABASE_URL") or os.environ.get("PGPASSWORD")):
            self.skipTest("Live worker execution also requires PostgreSQL credentials")

    def test_01_trading_floor_view_contract(self):
        self.require_live()
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
        res = self.get_rest("reviewed_workbook_market_source_v2", f"select={','.join(cols)}&limit=5")
        self.assertIsInstance(res, list)

    def test_02_price_research_view_contract(self):
        self.require_live()
        cols = [
            'id', 'brand', 'model', 'reference', 'normalized_reference', 'dial_color',
            'condition', 'price', 'price_usd', 'price_raw', 'currency', 'box', 'papers',
            'raw_message', 'posted_by', 'seller_name', 'phone_number', 'seller_phone',
            'flags', 'listing_date', 'created_at', 'source', 'year', 'dealer_id',
            'confidence', 'overall_confidence', 'thumbnail_url', 'image_url',
            'display_image_url', 'image_urls', 'has_images', 'listing_type', 'listing_status'
        ]
        res = self.get_rest("price_research_verified_source", f"select={','.join(cols)}&limit=5")
        self.assertIsInstance(res, list)

    def test_03_bundle_children_absent_from_public_views(self):
        self.require_live()
        tf_res = self.get_rest("reviewed_workbook_market_source_v2", "trading_floor_status=eq.bundle_child_pending_review")
        self.assertEqual(len(tf_res), 0)
        pr_res = self.get_rest("price_research_verified_source", "price_research_status=eq.ineligible_bundle_child_pending_review")
        self.assertEqual(len(pr_res), 0)

    def test_04_real_worker_step_execution(self):
        self.require_live(postgres=True)
        processed = run_pipeline_step(limit=1)
        self.assertIsInstance(processed, int)

    def test_05_sqlite_pipeline_step_with_provenance_metadata(self):
        import pipeline_runner
        old_pgpass = pipeline_runner.PGPASSWORD
        old_dburl = pipeline_runner.DATABASE_URL
        old_req_pg = pipeline_runner.REQUIRE_POSTGRES
        try:
            pipeline_runner.PGPASSWORD = None
            pipeline_runner.DATABASE_URL = None
            pipeline_runner.REQUIRE_POSTGRES = False
            conn = pipeline_runner.get_db_connection()
            self.assertTrue(pipeline_runner.IS_SQLITE)
            cur = conn.cursor()
            payload_id = str(uuid.uuid4())
            job_id = str(uuid.uuid4())
            checksum = hashlib.sha256(f"SQLite Test Listing Rolex Submariner {payload_id}".encode('utf-8')).hexdigest()
            cur.execute("""
                INSERT INTO payloads (id, source_platform, source_group_id, source_group_name, source_message_id, source_sender_id, source_sender_name, original_message_text, original_timestamp, payload_checksum)
                VALUES (?, 'WTS', 'g1', 'Group1', 'm1', 's1', 'Sender1', 'Rolex Submariner 126610LN 2023 New USD 14000', datetime('now'), ?);
            """, (payload_id, checksum))
            cur.execute("INSERT INTO processing_jobs (id, raw_payload_id, status) VALUES (?, ?, 'queued');", (job_id, payload_id))
            conn.commit()
            conn.close()
            processed = pipeline_runner.run_pipeline_step(limit=1)
            self.assertGreaterEqual(processed, 1)
            conn = pipeline_runner.get_db_connection()
            cur = conn.cursor()
            cur.execute("SELECT id, brand_normalized, provenance_metadata, trading_floor_status FROM listings WHERE job_id = ?;", (job_id,))
            row = cur.fetchone()
            self.assertIsNotNone(row)
            self.assertEqual(row['brand_normalized'], 'Rolex')
            self.assertIsNotNone(row['provenance_metadata'])
            self.assertIn('plausibility_reason', row['provenance_metadata'])
            conn.close()
        finally:
            pipeline_runner.PGPASSWORD = old_pgpass
            pipeline_runner.DATABASE_URL = old_dburl
            pipeline_runner.REQUIRE_POSTGRES = old_req_pg


if __name__ == "__main__":
    unittest.main()
