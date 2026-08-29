import gzip
import importlib.util
import json
import tempfile
import unittest
from datetime import datetime
from pathlib import Path


SCRIPT = Path(__file__).parents[1] / "tools" / "mariadb-live" / "capture_benchmark.py"
SPEC = importlib.util.spec_from_file_location("capture_benchmark", SCRIPT)
capture = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(capture)


class CaptureBenchmarkTests(unittest.TestCase):
    def test_source_record_preserves_raw_fields_and_hash(self):
        row = {
            "id": "uuid-1",
            "open_unique_key": "key-1",
            "created_on": datetime(2026, 8, 29, 1, 2, 3),
            "description": "WTS example $100",
            "front_image": "listing/media.jpg",
            "nullable": None,
        }
        record = capture.source_record(row, "2026-08-29T02:00:00Z")
        self.assertEqual(record["raw_message"], row["description"])
        self.assertEqual(record["raw_data"]["nullable"], None)
        expected = capture.sha256_bytes(capture.stable_json(record["raw_data"]).encode("utf-8"))
        self.assertEqual(record["raw_sha256"], expected)

    def test_missing_optional_open_unique_key_is_preserved_as_null(self):
        record = capture.source_record({"id": "uuid-2", "created_on": "2026-08-29"}, "now")
        self.assertIsNone(record["source_unique_key"])

    def test_config_has_hard_100k_ceiling(self):
        with self.assertRaisesRegex(ValueError, "between 1 and 100000"):
            capture.config({"MARIADB_CAPTURE_MAX_ROWS": "100001"})

    def test_capture_validation_reconciles_concatenated_gzip_members(self):
        with tempfile.TemporaryDirectory() as folder:
            paths = capture.output_paths(Path(folder))
            records = [
                capture.source_record({"id": f"id-{i}", "open_unique_key": f"key-{i}", "created_on": "2026-01-01"}, "now")
                for i in range(2)
            ]
            with paths["records"].open("ab") as handle:
                for record in records:
                    line = (json.dumps(record, separators=(",", ":")) + "\n").encode()
                    handle.write(gzip.compress(line, mtime=0))
            result = capture.verify_capture(paths, 2)
            self.assertTrue(result["validation_passed"])
            self.assertEqual(result["invalid_raw_hashes"], 0)


if __name__ == "__main__":
    unittest.main()
