import unittest
from unittest.mock import MagicMock, patch
import sys
import os

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..', 'tools', 'mariadb-live')))
from source_census import (
    assert_pinned_project,
    assert_read_only_grants,
    verify_mariadb_transport,
    resolve_provenance_match,
)

class TestSourceCensusHardeningExtended(unittest.TestCase):
    def test_pinned_project_acceptance(self):
        assert_pinned_project("db.bptrvfncppbjnchsaxtb.supabase.co")
        assert_pinned_project("https://bptrvfncppbjnchsaxtb.supabase.co")

    def test_pinned_project_refusal(self):
        with self.assertRaises(ValueError) as ctx:
            assert_pinned_project("db.otherproject99999.supabase.co")
        self.assertIn("Target refusal", str(ctx.exception))

    def test_read_only_grants_assertion(self):
        # Valid read-only grants
        assert_read_only_grants([
            "GRANT USAGE ON *.* TO 'john'@'%'",
            "GRANT SELECT ON `thecollective_inventory`.* TO 'john'@'%'"
        ])
        assert_read_only_grants([
            "GRANT SELECT, SHOW VIEW ON `thecollective_inventory`.* TO 'john'@'%'"
        ])

        # Write grants must fail
        with self.assertRaises(ValueError) as ctx:
            assert_read_only_grants([
                "GRANT SELECT, INSERT ON `thecollective_inventory`.* TO 'john'@'%'"
            ])
        self.assertIn("privileges beyond read-only", str(ctx.exception))

    def test_public_ip_refusal_without_tls(self):
        with patch.dict(os.environ, {"MARIADB_PRIVATE_TUNNEL_VERIFIED": "true"}, clear=True):
            # Public IP must fail
            with self.assertRaises(ValueError) as ctx:
                verify_mariadb_transport("161.35.0.209")
            self.assertIn("Transport refusal: Host '161.35.0.209' is a public IP address", str(ctx.exception))

            # Private/loopback IP must pass
            res = verify_mariadb_transport("127.0.0.1")
            self.assertEqual(res["transport"], "PRIVATE_TUNNEL_VERIFIED")

            res_priv = verify_mariadb_transport("10.0.1.5")
            self.assertEqual(res_priv["transport"], "PRIVATE_TUNNEL_VERIFIED")

    def test_provenance_resolution_rules(self):
        canonical_parents = {
            "source_listing_ids": {"ocean_abc-123", "wf-def-456", "mysql_auctions_100", "999"},
            "external_message_ids": {"ghi-789"},
            "canonical_parent_ids": {"par_001"}
        }

        # Rule: ocean_<open_key>
        r1 = resolve_provenance_match({"id": 1, "open_unique_key": "abc-123"}, canonical_parents)
        self.assertTrue(r1["matched"])
        self.assertEqual(r1["rule"], "RULE_OCEAN_PREFIX")

        # Rule: wf-<open_key>
        r2 = resolve_provenance_match({"id": 2, "open_unique_key": "def-456"}, canonical_parents)
        self.assertTrue(r2["matched"])
        self.assertEqual(r2["rule"], "RULE_WF_PREFIX")

        # Rule: mysql_auctions_<id>
        r3 = resolve_provenance_match({"id": 100, "open_unique_key": "unknown"}, canonical_parents)
        self.assertTrue(r3["matched"])
        self.assertEqual(r3["rule"], "RULE_MYSQL_AUCTIONS_ID")

        # Rule: raw numeric id
        r4 = resolve_provenance_match({"id": 999, "open_unique_key": "unmatched"}, canonical_parents)
        self.assertTrue(r4["matched"])
        self.assertEqual(r4["rule"], "RULE_EXACT_NUMERIC_ID")

        # Unmatched
        r5 = resolve_provenance_match({"id": 888, "open_unique_key": "unmatched_key"}, canonical_parents)
        self.assertFalse(r5["matched"])
        self.assertEqual(r5["rule"], "UNMATCHED_NEW_SOURCE_ROW")

    def test_null_identity_resolution(self):
        canonical_parents = {"source_listing_ids": set(), "external_message_ids": set(), "canonical_parent_ids": set()}
        r = resolve_provenance_match({"id": "", "open_unique_key": None}, canonical_parents)
        self.assertFalse(r["matched"])
        self.assertEqual(r["rule"], "UNMATCHED_NULL_IDENTITY")

    def test_frozen_boundary_clipping_and_reconciliation(self):
        frozen_total = 3
        rows = [
            {"id": 1, "created_on": "2026-08-01 00:00:00"},
            {"id": 2, "created_on": "2026-08-01 00:00:01"},
            {"id": 3, "created_on": "2026-08-01 00:00:02"},
            # Row 4 created after frozen boundary
            {"id": 4, "created_on": "2026-08-01 00:00:03"},
        ]
        frozen_max_created_on = "2026-08-01 00:00:02"
        frozen_max_id = 3

        clipped = [
            r for r in rows
            if (r["created_on"] < frozen_max_created_on) or 
               (r["created_on"] == frozen_max_created_on and r["id"] <= frozen_max_id)
        ]
        self.assertEqual(len(clipped), frozen_total)
        self.assertEqual(clipped[-1]["id"], 3)

if __name__ == '__main__':
    unittest.main()
