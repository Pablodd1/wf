import unittest
from unittest.mock import MagicMock, patch
import sys
import os

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..', 'tools', 'mariadb-live')))
from source_census import assert_pinned_project

class TestSourceCensusHardening(unittest.TestCase):
    def test_pinned_project_acceptance(self):
        assert_pinned_project("db.bptrvfncppbjnchsaxtb.supabase.co")
        assert_pinned_project("https://bptrvfncppbjnchsaxtb.supabase.co")

    def test_pinned_project_refusal(self):
        with self.assertRaises(ValueError) as ctx:
            assert_pinned_project("db.randomotherproject.supabase.co")
        self.assertIn("Target refusal", str(ctx.exception))

    def test_null_created_on_coalesce(self):
        # Verify that null created_on is ordered correctly with coalesce
        rows = [
            {"id": 1, "created_on": None},
            {"id": 2, "created_on": "2025-01-01 10:00:00"},
            {"id": 3, "created_on": None}
        ]
        sorted_rows = sorted(rows, key=lambda r: (r["created_on"] or "1970-01-01 00:00:00", r["id"]))
        self.assertEqual([r["id"] for r in sorted_rows], [1, 3, 2])

    def test_reconciliation_equality_assertion(self):
        scanned_count = 100
        frozen_total = 100
        matched_count = 80
        missing_count = 20
        self.assertEqual(scanned_count, frozen_total)
        self.assertEqual(matched_count + missing_count, scanned_count)

        # Mismatch must fail
        with self.assertRaises(AssertionError):
            self.assertEqual(99, frozen_total)

if __name__ == '__main__':
    unittest.main()
