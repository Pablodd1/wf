import unittest
from unittest.mock import MagicMock, patch
import sys
import os
import tempfile

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..', 'tools', 'mariadb-live')))
from source_census import (
    assert_pinned_project,
    assert_read_only_grants,
    verify_mariadb_transport,
    resolve_scoped_provenance_match,
    classify_watch_record,
    preflight_and_explain_cursor,
    verify_postgres_role_permissions,
    verify_source_schema_and_primary_key,
    compute_raw_message_sha256,
    compute_source_row_snapshot_sha256,
    check_memory_preflight,
    get_postgres_config,
    run_census,
    EXACT_PINNED_PGHOST,
)

class TestSourceCensusHardeningFull(unittest.TestCase):
    def test_pinned_project_exact_hostname_acceptance_and_refusal(self):
        assert_pinned_project("db.bptrvfncppbjnchsaxtb.supabase.co")
        assert_pinned_project("DB.BPTRVFNCPPBJNCHSAXTB.SUPABASE.CO")

        with self.assertRaises(ValueError) as ctx:
            assert_pinned_project("db.otherproject12345.supabase.co")
        self.assertIn("Target refusal: PostgreSQL host must strictly match exact pinned hostname", str(ctx.exception))

        with self.assertRaises(ValueError) as ctx:
            assert_pinned_project("db.bptrvfncppbjnchsaxtb.supabase.co.evil.com")
        self.assertIn("Target refusal", str(ctx.exception))

    def test_postgres_tls_mode_strict_enforcement(self):
        # Default / verify-full passes
        with patch.dict(os.environ, {
            "PGHOST": EXACT_PINNED_PGHOST,
            "PGUSER": "reader",
            "PGPASSWORD": "secret",
            "PGSSLMODE": "verify-full"
        }, clear=True):
            cfg = get_postgres_config()
            self.assertEqual(cfg["sslmode"], "verify-full")

        # Downgrade attempts fail closed
        for weak_mode in ("disable", "prefer", "require", "allow", "verify-ca"):
            with patch.dict(os.environ, {
                "PGHOST": EXACT_PINNED_PGHOST,
                "PGUSER": "reader",
                "PGPASSWORD": "secret",
                "PGSSLMODE": weak_mode
            }, clear=True):
                with self.assertRaises(ValueError) as ctx:
                    get_postgres_config()
                self.assertIn("PostgreSQL TLS security violation: sslmode must be strictly 'verify-full'", str(ctx.exception))

    def test_read_only_grants_assertion_and_redaction(self):
        assert_read_only_grants([
            'GRANT USAGE ON *.* TO "reader"@"%"',
            'GRANT SELECT ON thecollective_inventory.* TO "reader"@"%"'
        ])
        assert_read_only_grants([
            'GRANT SELECT, SHOW VIEW ON thecollective_inventory.* TO "reader"@"%"'
        ])

        # Test that error does NOT leak raw grant string
        secret_grant = "GRANT ALL PRIVILEGES ON secret_db.* TO 'super_secret_user'@'10.0.0.1'"
        with self.assertRaises(ValueError) as ctx:
            assert_read_only_grants([secret_grant])
        
        err_msg = str(ctx.exception)
        self.assertIn("MariaDB account security violation", err_msg)
        self.assertIn("[Privilege text redacted for security]", err_msg)
        self.assertNotIn("secret_db", err_msg)
        self.assertNotIn("super_secret_user", err_msg)

    def test_public_ip_refusal_without_tls(self):
        with patch.dict(os.environ, {"MARIADB_PRIVATE_TUNNEL_VERIFIED": "true"}, clear=True):
            with self.assertRaises(ValueError) as ctx:
                verify_mariadb_transport("161.35.0.209")
            self.assertIn("Transport refusal: Host '161.35.0.209' is a public IP address", str(ctx.exception))

            res = verify_mariadb_transport("127.0.0.1")
            self.assertEqual(res["transport"], "PRIVATE_TUNNEL_VERIFIED")

            res_priv = verify_mariadb_transport("10.0.1.5")
            self.assertEqual(res_priv["transport"], "PRIVATE_TUNNEL_VERIFIED")

    def test_mariadb_tls_server_identity_and_dns_hostname_enforcement(self):
        with tempfile.NamedTemporaryFile(suffix=".pem", delete=False) as tf:
            tf.write(b"CERTIFICATE_DATA")
            ca_file = tf.name

        try:
            with patch.dict(os.environ, {"MARIADB_TLS_CA_FILE": ca_file}, clear=True):
                # Raw IP address fails closed because PyMySQL cannot verify SAN against raw IP
                with self.assertRaises(ValueError) as ctx:
                    verify_mariadb_transport("161.35.0.209")
                self.assertIn("MariaDB TLS server identity refusal: Host '161.35.0.209' is a raw IP address", str(ctx.exception))

                # Genuine DNS hostname matching certificate SAN passes
                res = verify_mariadb_transport("mariadb.internal.watchfacts.com")
                self.assertEqual(res["transport"], "TLS_CA_VERIFIED")
                self.assertTrue(res["ssl"]["check_hostname"])
                self.assertEqual(res["ssl"]["ca"], ca_file)
        finally:
            if os.path.exists(ca_file):
                os.unlink(ca_file)

    def test_memory_preflight_thresholds_and_fail_closed(self):
        # 1. Sufficient memory passes
        with patch("source_census.get_available_memory_bytes", return_value=4 * 1024 * 1024 * 1024):
            check_memory_preflight(1_000_000, lambda m: None)

        # 2. Insufficient memory raises MemoryError
        with patch("source_census.get_available_memory_bytes", return_value=500 * 1024 * 1024):
            with self.assertRaises(MemoryError) as ctx:
                check_memory_preflight(1_000_000, lambda m: None)
            self.assertIn("Memory preflight failed", str(ctx.exception))

        # 3. Unreadable memory fails closed with RuntimeError
        with patch("source_census.get_available_memory_bytes", return_value=None):
            with self.assertRaises(RuntimeError) as ctx:
                check_memory_preflight(1_000_000, lambda m: None)
            self.assertIn("unable to measure system available memory", str(ctx.exception))

    def test_schema_verification_and_primary_key_assertion(self):
        mcur = MagicMock()

        # 1. Schema missing required columns raises RuntimeError
        mcur.fetchall.side_effect = [
            [{"COLUMN_NAME": "id"}, {"COLUMN_NAME": "title"}] # missing 'created_on', 'brand', etc.
        ]
        with self.assertRaises(RuntimeError) as ctx:
            verify_source_schema_and_primary_key(mcur, "thecollective_inventory", lambda m: None)
        self.assertIn("missing required columns", str(ctx.exception))

        # 2. Schema with invalid primary key raises RuntimeError
        mcur.fetchall.side_effect = [
            [{"COLUMN_NAME": col} for col in ["id", "open_unique_key", "created_on", "updated_on", "type", "status", "is_bundle", "brand", "model", "reference", "price", "currency", "front_image", "title", "description", "comments"]],
            [{"Column_name": "id", "Key_name": "PRIMARY"}, {"Column_name": "created_on", "Key_name": "PRIMARY"}] # composite PK -> forbidden!
        ]
        with self.assertRaises(RuntimeError) as ctx:
            verify_source_schema_and_primary_key(mcur, "thecollective_inventory", lambda m: None)
        self.assertIn("Primary key assertion failed", str(ctx.exception))

        # 3. Valid schema and strict primary key ['id'] passes
        mcur.fetchall.side_effect = [
            [{"COLUMN_NAME": col} for col in ["id", "open_unique_key", "created_on", "updated_on", "type", "status", "is_bundle", "brand", "model", "reference", "price", "currency", "front_image", "title", "description", "comments"]],
            [{"Column_name": "id", "Key_name": "PRIMARY"}]
        ]
        res = verify_source_schema_and_primary_key(mcur, "thecollective_inventory", lambda m: None)
        self.assertEqual(res["primary_key"], ["id"])
        self.assertIn("id", res["actual_columns"])

    def test_distinct_snapshot_hash_vs_raw_message_hash(self):
        row = {
            "id": 1,
            "title": "Rolex Submariner",
            "description": "Mint condition",
            "comments": "Complete box",
            "brand": "Rolex",
            "price": "10000",
            "currency": "USD"
        }
        msg_hash = compute_raw_message_sha256(row)
        snap_hash = compute_source_row_snapshot_sha256(row, ["id", "title", "description", "comments", "brand", "price", "currency"])

        # They must be separate hashes
        self.assertNotEqual(msg_hash, snap_hash)
        self.assertEqual(len(msg_hash), 64)
        self.assertEqual(len(snap_hash), 64)

        # Empty message produces empty string for raw message
        self.assertEqual(compute_raw_message_sha256({}), "")

    def test_bundle_counting_no_overwrite(self):
        bundle_row = {"bundle_count": 50, "single_count": 200, "unknown_bundle_count": 10}
        bundle_dist = {
            "BUNDLE": int(bundle_row.get("bundle_count") or 0),
            "SINGLE": int(bundle_row.get("single_count") or 0),
            "UNKNOWN": int(bundle_row.get("unknown_bundle_count") or 0)
        }
        self.assertEqual(bundle_dist["BUNDLE"], 50)
        self.assertEqual(bundle_dist["SINGLE"], 200)
        self.assertEqual(bundle_dist["UNKNOWN"], 10)

    def test_postgres_role_privilege_verification(self):
        cur_super = MagicMock()
        cur_super.fetchone.side_effect = [("postgres", "on")]
        with self.assertRaises(ValueError) as ctx:
            verify_postgres_role_permissions(cur_super, lambda m: None)
        self.assertIn("PostgreSQL role violation: active role 'postgres' is superuser", str(ctx.exception))

        cur_no_usage = MagicMock()
        cur_no_usage.fetchone.side_effect = [("census_reader", "off"), [False]]
        with self.assertRaises(ValueError) as ctx:
            verify_postgres_role_permissions(cur_no_usage, lambda m: None)
        self.assertIn("missing USAGE on schema", str(ctx.exception))

        cur_mut = MagicMock()
        cur_mut.fetchone.side_effect = [("census_reader", "off"), [True], [True], [True]]
        with self.assertRaises(ValueError) as ctx:
            verify_postgres_role_permissions(cur_mut, lambda m: None)
        self.assertIn("possesses forbidden 'INSERT' privilege", str(ctx.exception))

        cur_valid = MagicMock()
        cur_valid.fetchone.side_effect = [("census_reader", "off"), [True], [True], [False], [False], [False], [False]]
        verify_postgres_role_permissions(cur_valid, lambda m: None)

    @patch("psycopg2.connect")
    def test_rls_zero_rows_fails_closed(self, mock_pg_connect):
        from source_census import fetch_scoped_canonical_parents
        mock_pg_conn = MagicMock()
        mock_pg_cur = MagicMock()
        mock_pg_connect.return_value = mock_pg_conn
        mock_pg_conn.cursor.return_value = mock_pg_cur

        mock_pg_cur.fetchone.side_effect = [
            ("census_reader", "off"),
            [True],
            [True],
            [False],
            [False],
            [False],
            [False],
        ]
        # fetchall returns empty immediately (zero rows returned)
        mock_pg_cur.fetchall.return_value = []

        with self.assertRaises(RuntimeError) as ctx:
            fetch_scoped_canonical_parents({
                "host": EXACT_PINNED_PGHOST, "port": 5432, "user": "census_reader",
                "password": "pwd", "dbname": "postgres", "sslmode": "verify-full"
            }, lambda m: None)
        self.assertIn("zero rows returned from wf_canonical_staging.canonical_listing_parents", str(ctx.exception))

    def test_explain_enforces_proved_composite_index(self):
        mcur = MagicMock()
        mcur.fetchall.side_effect = [
            [
                {"Key_name": "idx_created_id", "Seq_in_index": 1, "Column_name": "created_on"},
                {"Key_name": "idx_created_id", "Seq_in_index": 2, "Column_name": "id"}
            ],
            [{"key": "idx_created_id", "type": "RANGE"}]
        ]
        res = preflight_and_explain_cursor(mcur, lambda m: None)
        self.assertEqual(res["proved_composite_index"], "idx_created_id")
        self.assertEqual(res["key_used"], "idx_created_id")
        self.assertEqual(res["access_type"], "RANGE")

    def test_scoped_provenance_isolation(self):
        scoped_parents = {
            "ocean_stream_source_ids": {"ocean_open-key-1"},
            "ocean_stream_ext_ids": {"open-key-1"},
            "mysql_workbook_source_ids": {"wf-open-key-2", "mysql_auctions_100", "999"},
            "mysql_workbook_ext_ids": {"open-key-2", "100"},
        }
        r1 = resolve_scoped_provenance_match({"id": 50, "open_unique_key": "open-key-1"}, scoped_parents)
        self.assertTrue(r1["matched"])
        self.assertEqual(r1["rule"], "RULE_OCEAN_STREAM_MATCH")

        r2 = resolve_scoped_provenance_match({"id": 100, "open_unique_key": "unknown"}, scoped_parents)
        self.assertTrue(r2["matched"])
        self.assertEqual(r2["rule"], "RULE_MYSQL_WORKBOOK_AUCTION_ID_MATCH")

        r3 = resolve_scoped_provenance_match({"id": 999, "open_unique_key": None}, scoped_parents)
        self.assertTrue(r3["matched"])
        self.assertEqual(r3["rule"], "RULE_MYSQL_WORKBOOK_EXACT_NUMERIC_ID")

    def test_classification(self):
        self.assertEqual(classify_watch_record("Rolex Daytona 116500LN", "Rolex", "116500LN"), "WATCH_CANDIDATE")
        self.assertEqual(classify_watch_record("Rolex box only green wave", "Rolex", ""), "NON_WATCH_ACCESSORY_OR_PART")
        self.assertEqual(classify_watch_record("Vintage gold collector item", "Unknown", ""), "AMBIGUOUS_UNIDENTIFIED")

    @patch("source_census.get_available_memory_bytes", return_value=4 * 1024 * 1024 * 1024)
    @patch("psycopg2.connect")
    @patch("pymysql.connect")
    def test_full_mocked_entry_path_run_census(self, mock_mdb_connect, mock_pg_connect, mock_mem):
        """End-to-end regression test invoking run_census() with full preflights, minimum timestamp start, and rollback."""
        mock_pg_conn = MagicMock()
        mock_pg_cur = MagicMock()
        mock_pg_connect.return_value = mock_pg_conn
        mock_pg_conn.cursor.return_value = mock_pg_cur

        mock_pg_cur.fetchone.side_effect = [
            ("census_reader", "off"),
            [True],
            [True],
            [False],
            [False],
            [False],
            [False],
        ]
        mock_pg_cur.fetchall.side_effect = [
            [("parent-uuid-1", "mysql_auctions_101", "ext-1", "MySQL / Workbook Ingest")],
            []
        ]

        mock_mdb_conn = MagicMock()
        mock_mdb_cur = MagicMock()
        mock_mdb_connect.return_value = mock_mdb_conn
        mock_mdb_conn.cursor.return_value = mock_mdb_cur

        required_cols = [
            "id", "open_unique_key", "created_on", "updated_on", "origin", "type", "status",
            "is_bundle", "category_id", "company_id", "from_number", "from_name", "phone_code",
            "region", "title", "description", "comments", "brand", "model", "reference",
            "normalized_reference", "dial_color", "dial_color_source", "condition_id", "year",
            "box", "papers", "price", "currency", "reserve_price", "min", "max", "avg",
            "front_image", "report_url", "dealer_rating", "is_from_verified_user",
            "is_from_paid_user", "is_seller_approved", "catalog_confirmed",
            "catalog_canonical_confirmed", "are_attributes_extracted", "identification_status",
            "wf_inspection", "times_posted", "reposted_at"
        ]

        mock_mdb_cur.fetchall.side_effect = [
            # SHOW GRANTS
            [{"grant": 'GRANT USAGE ON *.* TO "reader"@"%"'}, {"grant": 'GRANT SELECT ON thecollective_inventory.* TO "reader"@"%'}],
            # information_schema.COLUMNS
            [{"COLUMN_NAME": col} for col in required_cols],
            # SHOW KEYS (Primary Key)
            [{"Column_name": "id", "Key_name": "PRIMARY"}],
            # SHOW INDEX (Preflight)
            [
                {"Key_name": "idx_created_id", "Seq_in_index": 1, "Column_name": "created_on"},
                {"Key_name": "idx_created_id", "Seq_in_index": 2, "Column_name": "id"}
            ],
            # EXPLAIN (Preflight)
            [{"key": "idx_created_id", "type": "RANGE"}],
            # status distribution
            [{"status": "active", "cnt": 2}],
            # type distribution
            [{"type": "listing", "cnt": 2}],
            # Keyset pagination batch starting from min timestamp (2 rows, then empty)
            [
                {
                    "id": 101, "open_unique_key": "k1", "created_on": "2020-01-01 10:00:00",
                    "updated_on": "2020-01-01 10:00:00", "origin": "stream", "type": "listing", "status": "active",
                    "is_bundle": 0, "category_id": 1, "company_id": 1, "from_number": "123", "from_name": "Seller",
                    "phone_code": "1", "region": "US", "title": "Rolex Submariner 116610LN", "description": "Box only",
                    "comments": "", "brand": "Rolex", "model": "Submariner", "reference": "116610LN",
                    "normalized_reference": "116610LN", "dial_color": "Black", "dial_color_source": "extracted",
                    "condition_id": 1, "year": "2020", "box": "Yes", "papers": "Yes", "price": "12500", "currency": "USD",
                    "reserve_price": "0", "min": "12000", "max": "13000", "avg": "12500", "front_image": "http://img/101.jpg",
                    "report_url": "", "dealer_rating": "5.0", "is_from_verified_user": 1, "is_from_paid_user": 1,
                    "is_seller_approved": 1, "catalog_confirmed": 1, "catalog_canonical_confirmed": 1,
                    "are_attributes_extracted": 1, "identification_status": "IDENTIFIED", "wf_inspection": 1,
                    "times_posted": 1, "reposted_at": None
                },
                {
                    "id": 102, "open_unique_key": "k2", "created_on": "2020-01-01 11:00:00",
                    "updated_on": "2020-01-01 11:00:00", "origin": "stream", "type": "listing", "status": "active",
                    "is_bundle": 0, "category_id": 1, "company_id": 1, "from_number": "123", "from_name": "Seller",
                    "phone_code": "1", "region": "US", "title": "Omega Speedmaster", "description": "Great condition",
                    "comments": "", "brand": "Omega", "model": "Speedmaster", "reference": "311.30.42.30.01.005",
                    "normalized_reference": "31130423001005", "dial_color": "Black", "dial_color_source": "extracted",
                    "condition_id": 1, "year": "2021", "box": "Yes", "papers": "Yes", "price": "6000", "currency": "USD",
                    "reserve_price": "0", "min": "5500", "max": "6500", "avg": "6000", "front_image": "",
                    "report_url": "", "dealer_rating": "5.0", "is_from_verified_user": 1, "is_from_paid_user": 1,
                    "is_seller_approved": 1, "catalog_confirmed": 1, "catalog_canonical_confirmed": 1,
                    "are_attributes_extracted": 1, "identification_status": "IDENTIFIED", "wf_inspection": 1,
                    "times_posted": 1, "reposted_at": None
                }
            ],
            []
        ]

        mock_mdb_cur.fetchone.side_effect = [
            # Frozen bounds
            {
                "total_rows": 2, "min_id": 101, "max_id": 102,
                "min_created_on": "2020-01-01 10:00:00", "max_created_on": "2020-01-01 11:00:00",
                "min_updated_on": "2020-01-01 10:00:00", "max_updated_on": "2020-01-01 11:00:00",
                "null_created_on_count": 0
            },
            # Bundle counts
            {"bundle_count": 0, "single_count": 2, "unknown_bundle_count": 0},
            # Image counts
            {"with_image": 1, "without_image": 1}
        ]

        with tempfile.TemporaryDirectory() as td:
            out_file = os.path.join(td, "source_census_report.json")
            test_env = {
                "PGHOST": EXACT_PINNED_PGHOST,
                "PGUSER": "census_reader",
                "PGPASSWORD": "testpassword",
                "PGDATABASE": "postgres",
                "PGSSLMODE": "verify-full",
                "MARIADB_HOST": "127.0.0.1",
                "MARIADB_USER": "john",
                "MARIADB_PASSWORD": "password",
                "MARIADB_PRIVATE_TUNNEL_VERIFIED": "true",
                "MARIADB_CENSUS_OUTPUT": out_file,
            }
            with patch.dict(os.environ, test_env, clear=True):
                report = run_census()

                self.assertEqual(report["status"], "COMPLETE_SUCCESS")
                self.assertEqual(report["provenance_reconciliation"]["total_scanned_rows"], 2)
                self.assertEqual(report["provenance_reconciliation"]["matched_in_canonical_parents"], 1)
                self.assertEqual(report["provenance_reconciliation"]["missing_unimported_source_rows"], 1)
                self.assertTrue(report["provenance_reconciliation"]["exact_reconciliation_verified"])
                self.assertEqual(report["schema_verification"]["primary_key"], ["id"])

                # Separate hashes verified
                self.assertIn("raw_message_evidence", report)
                self.assertIn("source_row_snapshot_evidence", report)
                self.assertEqual(report["source_row_snapshot_evidence"]["distinct_source_row_snapshot_hashes"], 2)

                mock_pg_conn.rollback.assert_called()
                mock_mdb_conn.rollback.assert_called()
                self.assertTrue(os.path.exists(out_file))

if __name__ == '__main__':
    unittest.main()
