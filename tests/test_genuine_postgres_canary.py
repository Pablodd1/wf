import unittest
import os
import sys
import uuid
import urllib.request
import json

sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), '../scripts')))

import pipeline_runner

SUPABASE_URL = "https://qnsafosakvonzgfcsphh.supabase.co"
ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFuc2Fmb3Nha3ZvbnpnZmNzcGhoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODYwMjI3NDEsImV4cCI6MjEwMTU5ODc0MX0.YUxMjnTHtgPsiWiWko3TS1A47Sjk33SuHC2TND0Rxmg"

class TestGenuinePostgresCanary(unittest.TestCase):
    def test_genuine_postgres_canary_execution(self):
        """
        Executes a genuine native PostgreSQL canary with REQUIRE_POSTGRES=1 asserted,
        verifies IS_SQLITE = False, writes a unique payload, runs native worker step,
        reads back from PostgreSQL and PostgREST, and cleans up canary data afterward.
        """
        has_credentials = bool(os.environ.get("PGPASSWORD") or os.environ.get("DATABASE_URL"))
        if not has_credentials:
            self.skipTest("SKIPPED genuine PostgreSQL canary test: PGPASSWORD or DATABASE_URL not set in environment.")

        # 1. Enforce REQUIRE_POSTGRES = 1
        os.environ["REQUIRE_POSTGRES"] = "1"
        pipeline_runner.REQUIRE_POSTGRES = True

        # 2. Get DB connection & assert IS_SQLITE is False
        conn = pipeline_runner.get_db_connection()
        self.assertFalse(pipeline_runner.IS_SQLITE, "IS_SQLITE must be False when running genuine PostgreSQL canary")
        
        cur = conn.cursor()

        # 3. Create unique canary ID & payload checksum
        canary_uuid = str(uuid.uuid4())
        source_msg_id = f"canary_gate_msg_{canary_uuid[:8]}"
        payload_id = str(uuid.uuid5(uuid.NAMESPACE_DNS, f"canary.gate.payload.{canary_uuid}"))
        job_id = str(uuid.uuid5(uuid.NAMESPACE_DNS, f"canary.gate.job.{canary_uuid}"))
        
        checksum = pipeline_runner.compute_transport_checksum("canary_platform", "canary_gate_group", source_msg_id)
        msg_text = f"WTS Rolex GMT-Master II 126710BLRO Pepsi 2024 Price 21500 USD - Canary Gate {canary_uuid}"

        try:
            # 4. Native PostgreSQL INSERT into raw.payloads and jobs.processing_jobs
            cur.execute("""
                INSERT INTO raw.payloads (
                    id, source_platform, source_group_id, source_group_name, source_message_id,
                    source_sender_id, source_sender_name, original_message_text, original_timestamp, payload_checksum
                ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, NOW(), %s)
                ON CONFLICT (payload_checksum) DO NOTHING;
            """, (payload_id, "canary_platform", "canary_gate_group", "Canary Gate Group", source_msg_id, "canary_sender", "Canary Tester", msg_text, checksum))

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

            # 7. Query PostgREST Endpoints
            # A. Trading Floor view readback
            url_tf = f"{SUPABASE_URL}/rest/v1/reviewed_workbook_market_source_v2?job_id=eq.{job_id}"
            req_tf = urllib.request.Request(url_tf, headers={
                "apikey": ANON_KEY,
                "Authorization": f"Bearer {ANON_KEY}",
                "Accept": "application/json"
            })
            with urllib.request.urlopen(req_tf) as resp:
                data_tf = json.loads(resp.read().decode())
                self.assertEqual(len(data_tf), 1, "Canary record must be queryable via Trading Floor view")
                self.assertEqual(data_tf[0]["listing_type"], "WTS")

            # B. Price Research view readback & WTS price average inclusion confirmation
            url_pr = f"{SUPABASE_URL}/rest/v1/price_research_verified_source?job_id=eq.{job_id}"
            req_pr = urllib.request.Request(url_pr, headers={
                "apikey": ANON_KEY,
                "Authorization": f"Bearer {ANON_KEY}",
                "Accept": "application/json"
            })
            with urllib.request.urlopen(req_pr) as resp:
                data_pr = json.loads(resp.read().decode())
                self.assertEqual(len(data_pr), 1, "Canary record must be queryable via Price Research view")
                self.assertEqual(data_pr[0]["listing_type"], "WTS")
                self.assertEqual(float(data_pr[0]["price_usd"]), 21500.0)

        finally:
            # 8. Cleanup canary record
            try:
                cur.execute("DELETE FROM staging.listings WHERE job_id = %s;", (job_id,))
                cur.execute("DELETE FROM jobs.processing_jobs WHERE id = %s;", (job_id,))
                cur.execute("DELETE FROM raw.payloads WHERE id = %s;", (payload_id,))
                conn.commit()
            except Exception:
                pass
            conn.close()

if __name__ == "__main__":
    unittest.main()
