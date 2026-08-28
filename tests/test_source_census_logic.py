import unittest
from unittest.mock import MagicMock, patch
import sys
import os

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..', 'tools', 'mariadb-live')))
from source_census import (
    assert_pinned_project,
    assert_read_only_grants,
    verify_mariadb_transport,
    resolve_scoped_provenance_match,
    classify_watch_record,
    preflight_and_explain_cursor,
)

class TestSourceCensusHardeningFull(unittest.TestCase):
    def test_pinned_project_acceptance_and_refusal(self):
        assert_pinned_project("db.bptrvfncppbjnchsaxtb.supabase.co")
        assert_pinned_project("https://bptrvfncppbjnchsaxtb.supabase.co")
        with self.assertRaises(ValueError) as ctx:
            assert_pinned_project("db.unauthorizedproject.supabase.co")
        self.assertIn("Target refusal", str(ctx.exception))

    def test_read_only_grants_assertion(self):
        assert_read_only_grants([
            "GRANT USAGE ON *.* TO 'reader'@'%'",
            "GRANT SELECT ON `thecollective_inventory`.* TO 'reader'@'%'"
        ])
        assert_read_only_grants([
            "GRANT SELECT, SHOW VIEW ON `thecollective_inventory`.* TO 'reader'@'%'"
        ])
        with self.assertRaises(ValueError) as ctx:
            assert_read_only_grants([
                "GRANT SELECT, INSERT ON `thecollective_inventory`.* TO 'reader'@'%'"
            ])
        self.assertIn("privileges beyond read-only", str(ctx.exception))

    def test_public_ip_refusal_without_tls(self):
        with patch.dict(os.environ, {"MARIADB_PRIVATE_TUNNEL_VERIFIED": "true"}, clear=True):
            with self.assertRaises(ValueError) as ctx:
                verify_mariadb_transport("161.35.0.209")
            self.assertIn("Transport refusal: Host '161.35.0.209' is a public IP address", str(ctx.exception))

            res = verify_mariadb_transport("127.0.0.1")
            self.assertEqual(res["transport"], "PRIVATE_TUNNEL_VERIFIED")

            res_priv = verify_mariadb_transport("10.0.1.5")
            self.assertEqual(res_priv["transport"], "PRIVATE_TUNNEL_VERIFIED")

    def test_explain_enforces_proved_composite_index(self):
        mcur = MagicMock()
        # Mock SHOW INDEX returning composite (created_on, id)
        mcur.fetchall.side_effect = [
            [
                {"Key_name": "idx_created_id", "Seq_in_index": 1, "Column_name": "created_on"},
                {"Key_name": "idx_created_id", "Seq_in_index": 2, "Column_name": "id"}
            ],
            # EXPLAIN returning valid RANGE plan
            [{"key": "idx_created_id", "type": "RANGE"}]
        ]
        res = preflight_and_explain_cursor(mcur, lambda m: None)
        self.assertEqual(res["proved_composite_index"], "idx_created_id")
        self.assertEqual(res["key_used"], "idx_created_id")
        self.assertEqual(res["access_type"], "RANGE")

    def test_explain_fails_closed_on_unbounded_plan(self):
        mcur = MagicMock()
        # Mock SHOW INDEX
        mcur.fetchall.side_effect = [
            [
                {"Key_name": "idx_created_id", "Seq_in_index": 1, "Column_name": "created_on"},
                {"Key_name": "idx_created_id", "Seq_in_index": 2, "Column_name": "id"}
            ],
            # EXPLAIN returning ALL / null key
            [{"key": None, "type": "ALL"}]
        ]
        with self.assertRaises(RuntimeError) as ctx:
            preflight_and_explain_cursor(mcur, lambda m: None)
        self.assertIn("EXPLAIN plan failed", str(ctx.exception))

    def test_scoped_provenance_isolation_no_cross_system_numeric_collision(self):
        # Setup scoped indexes
        scoped_parents = {
            "ocean_stream_source_ids": {"ocean_open-key-1"},
            "ocean_stream_ext_ids": {"open-key-1"},
            "mysql_workbook_source_ids": {"wf-open-key-2", "mysql_auctions_100", "999"},
            "mysql_workbook_ext_ids": {"open-key-2", "100"},
            # Notice that ID "999" is in mysql_workbook_source_ids, but NOT in ocean_stream
        }

        # Row with open_unique_key matching Green API / OceanDigital Stream
        r1 = resolve_scoped_provenance_match({"id": 50, "open_unique_key": "open-key-1"}, scoped_parents)
        self.assertTrue(r1["matched"])
        self.assertEqual(r1["rule"], "RULE_OCEAN_STREAM_MATCH")
        self.assertEqual(r1["scoped_system"], "Green API / OceanDigital Stream")

        # Row matching MySQL / Workbook Ingest
        r2 = resolve_scoped_provenance_match({"id": 100, "open_unique_key": "unknown"}, scoped_parents)
        self.assertTrue(r2["matched"])
        self.assertEqual(r2["rule"], "RULE_MYSQL_WORKBOOK_AUCTION_ID_MATCH")
        self.assertEqual(r2["scoped_system"], "MySQL / Workbook Ingest")

        # Exact numeric match 999 is scoped to MySQL workbook
        r3 = resolve_scoped_provenance_match({"id": 999, "open_unique_key": None}, scoped_parents)
        self.assertTrue(r3["matched"])
        self.assertEqual(r3["rule"], "RULE_MYSQL_WORKBOOK_EXACT_NUMERIC_ID")

        # Unmatched ID
        r4 = resolve_scoped_provenance_match({"id": 777, "open_unique_key": "new-key-xyz"}, scoped_parents)
        self.assertFalse(r4["matched"])
        self.assertEqual(r4["rule"], "UNMATCHED_NEW_SOURCE_ROW")

    def test_classification_and_token_filtering(self):
        self.assertEqual(classify_watch_record("Rolex Daytona 116500LN", "Rolex", "116500LN"), "WATCH_CANDIDATE")
        self.assertEqual(classify_watch_record("Patek Philippe 5711/1A Nautilus", "Patek", "5711/1A"), "WATCH_CANDIDATE")
        self.assertEqual(classify_watch_record("Rolex box only green wave", "Rolex", ""), "NON_WATCH_ACCESSORY_OR_PART")
        self.assertEqual(classify_watch_record("Luxury leather strap 20mm", "", ""), "NON_WATCH_ACCESSORY_OR_PART")
        self.assertEqual(classify_watch_record("Vintage gold collector item", "Unknown", ""), "AMBIGUOUS_UNIDENTIFIED")

    def test_duplicate_calculation_logic(self):
        # 10 rows: 2 NULL source_listing_ids, 8 non-null (6 distinct, 2 duplicate)
        rows = [None, None, "id1", "id2", "id3", "id4", "id5", "id6", "id1", "id2"]
        total_parent_rows = len(rows)
        null_count = sum(1 for r in rows if r is None)
        non_null_count = total_parent_rows - null_count
        distinct_non_null = len(set(r for r in rows if r is not None))
        duplicate_count = non_null_count - distinct_non_null

        self.assertEqual(total_parent_rows, 10)
        self.assertEqual(null_count, 2)
        self.assertEqual(non_null_count, 8)
        self.assertEqual(distinct_non_null, 6)
        self.assertEqual(duplicate_count, 2)  # Exactly 2 duplicates, NOT overcounted by NULLs

if __name__ == '__main__':
    unittest.main()
