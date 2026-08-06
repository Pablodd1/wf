import unittest
import os
import sys
import uuid
import urllib.request
import json
import psycopg2

sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), '../scripts')))

import pipeline_runner

class TestGenuinePostgresCanary(unittest.TestCase):
    def test_genuine_postgres_canary_execution(self):
        """
        Executes a genuine native PostgreSQL canary with REQUIRE_POSTGRES=1 asserted,
        verifies IS_SQLITE = False, writes a unique payload, runs the worker step,
        and reads back the record from PostgreSQL and PostgREST endpoints.
        """
        # 1. Enforce REQUIRE_POSTGRES = 1
        os.environ["REQUIRE_POSTGRES"] = "1"
        pipeline_runner.REQUIRE_POSTGRES = True

        # 2. Get DB connection & assert IS_SQLITE is False when credentials are available
        has_credentials = bool(os.environ.get("PGPASSWORD") or os.environ.get("DATABASE_URL"))
        if not has_credentials:
            with self.assertRaises(RuntimeError, msg="REQUIRE_POSTGRES=1 without credentials must fail closed"):
                pipeline_runner.get_db_connection()
            return

        conn = pipeline_runner.get_db_connection()
        self.assertFalse(pipeline_runner.IS_SQLITE, "IS_SQLITE must be False when running genuine PostgreSQL canary")
        
        cur = conn.cursor()

        # 3. Create unique canary ID & payload checksum
        canary_uuid = str(uuid.uuid4())
        source_msg_id = f"canary_msg_{canary_uuid[:8]}"
        payload_id = str(uuid.uuid5(uuid.NAMESPACE_DNS, f"canary.payload.{canary_uuid}"))
        job_id = str(uuid.uuid5(uuid.NAMESPACE_DNS, f"canary.job.{canary_uuid}"))
        
        checksum = pipeline_runner.compute_transport_checksum("canary_platform", "canary_group", source_msg_id)
        msg_text = f"WTS Rolex GMT-Master II 126710BLRO Pepsi 2024 Price 21500 USD - Canary Test {canary_uuid}"

        # 4. Native PostgreSQL INSERT into raw.payloads and jobs.processing_jobs
        cur.execute("""
            INSERT INTO raw.payloads (
                id, source_platform, source_group_id, source_group_name, source_message_id,
                source_sender_id, source_sender_name, original_message_text, original_timestamp, payload_checksum
            ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, NOW(), %s)
            ON CONFLICT (payload_checksum) DO NOTHING;
        """, (payload_id, "canary_platform", "canary_group", "Canary Group", source_msg_id, "canary_sender", "Canary Tester", msg_text, checksum))

        cur.execute("""
            INSERT INTO jobs.processing_jobs (id, raw_payload_id, status)
            VALUES (%s, %s, 'queued'::jobs.processing_status)
            ON CONFLICT (id) DO NOTHING;
        """, (job_id, payload_id))

        conn.commit()

        # 5. Execute native worker step via run_pipeline_step() in PostgreSQL mode
        processed_count = pipeline_runner.run_pipeline_step(limit=10)
        self.assertGreaterEqual(processed_count, 1, "Native PostgreSQL worker step must process at least 1 job")

        # 6. Read back the processed listing directly from PostgreSQL staging.listings
        cur.execute("""
            SELECT id, job_id, brand_normalized, reference_normalized, price_usd, listing_type, trading_floor_status, price_research_status, provenance_metadata
            FROM staging.listings
            WHERE job_id = %s;
        """, (job_id,))
        row = cur.fetchone()
        self.assertIsNotNone(row, "Processed canary record must exist in staging.listings in PostgreSQL")
        
        listing_id, fetched_job_id, brand, ref, price, listing_type, tf_status, pr_status, prov_meta = row
        self.assertEqual(fetched_job_id, job_id)
        self.assertEqual(brand, "Rolex")
        self.assertEqual(ref, "126710BLRO")
        self.assertEqual(price, 21500.0)
        self.assertEqual(listing_type, "WTS", "Single WTS listing must have listing_type = 'WTS'")
        self.assertEqual(tf_status, "published")
        self.assertEqual(pr_status, "eligible")
        self.assertIsNotNone(prov_meta, "provenance_metadata must be stored on listing")

        conn.close()

        # 7. Query PostgREST Endpoint to verify public view exposure
        url = f"https://qnsafosakvonzgfcsphh.supabase.co/rest/v1/price_research_verified_source?job_id=eq.{job_id}"
        req = urllib.request.Request(url, headers={
            "apikey": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFuc2Fmb3Nha3ZvbnpnZmNzcGhoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTQ0ODE5NDEsImV4cCI6MjA3MDA1Nzk0MX0.S66N-WJ_xT0K2mY6fKjMvV3S13l-zU6T5J0Y0_Z5M6Q",
            "Accept": "application/json"
        })
        try:
            with urllib.request.urlopen(req) as resp:
                data = json.loads(resp.read().decode())
                self.assertEqual(len(data), 1, "Canary record must be queryable via PostgREST Price Research endpoint")
                self.assertEqual(data[0]["job_id"], job_id)
                self.assertEqual(data[0]["listing_type"], "WTS")
        except Exception as e:
            self.fail(f"PostgREST query for canary record failed: {e}")

if __name__ == "__main__":
    unittest.main()
