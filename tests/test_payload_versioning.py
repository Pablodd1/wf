import unittest
import os
import sys
import uuid
import hashlib

sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), '../scripts')))

import pipeline_runner

class TestPayloadVersioning(unittest.TestCase):
    def test_edited_message_creates_new_version_and_event(self):
        """Proves changing raw message text under the same transport message ID creates a new content version and distinct listing event signature."""
        transport_ck = pipeline_runner.compute_transport_checksum("mysql_thecollective", "auctions", "msg_1001")
        seller_item_sig = pipeline_runner.compute_seller_item_signature("seller_1", "WATCH", "Rolex", "126610LN")

        # Version 1: Original post at $14000
        msg_v1 = "WTS Rolex 126610LN Price 14000 USD"
        ts_v1 = "2026-08-01T10:00:00Z"
        evt_v1 = pipeline_runner.compute_listing_event_signature(seller_item_sig, msg_v1, 14000.0, "USD", ts_v1, "parent", 0)

        # Version 2: Price drop to $13500 under SAME transport message ID
        msg_v2 = "WTS Rolex 126610LN Price 13500 USD"
        ts_v2 = "2026-08-02T12:00:00Z"
        evt_v2 = pipeline_runner.compute_listing_event_signature(seller_item_sig, msg_v2, 13500.0, "USD", ts_v2, "parent", 0)

        # Content version checksums
        v1_ck = hashlib.sha256(f"{transport_ck}:{hashlib.sha256(f'{msg_v1}:{ts_v1}'.encode('utf-8')).hexdigest()}".encode('utf-8')).hexdigest()
        v2_ck = hashlib.sha256(f"{transport_ck}:{hashlib.sha256(f'{msg_v2}:{ts_v2}'.encode('utf-8')).hexdigest()}".encode('utf-8')).hexdigest()

        # Job UUIDs derived from version checksums
        job_id_v1 = str(uuid.uuid5(uuid.NAMESPACE_DNS, f"watchfacts.job.{v1_ck}"))
        job_id_v2 = str(uuid.uuid5(uuid.NAMESPACE_DNS, f"watchfacts.job.{v2_ck}"))

        self.assertNotEqual(v1_ck, v2_ck, "Changed text/timestamp must yield distinct version checksum")
        self.assertNotEqual(job_id_v1, job_id_v2, "Changed version must produce a distinct new job ID for reprocessing")
        self.assertNotEqual(evt_v1, evt_v2, "Changed version must yield a distinct immutable listing event signature")

if __name__ == "__main__":
    unittest.main()
