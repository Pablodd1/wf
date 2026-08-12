import unittest
import uuid
import hashlib
import sys
import os

# Add scripts directory to path
sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(__file__)), 'scripts'))
from pipeline_processor import WatchFactsPipelineProcessor

class TestPipelineEndToEnd(unittest.TestCase):
    def setUp(self):
        self.processor = WatchFactsPipelineProcessor()

    def test_e2e_single_listing_flow(self):
        """Test full pipeline flow for a single watch listing."""
        msg_text = "Rolex 116508 John Mayer 2020 Good Condition Watch and card USD 68,000"
        payload_checksum = hashlib.sha256(msg_text.encode('utf-8')).hexdigest()
        raw_payload_id = str(uuid.uuid4())
        job_id = str(uuid.uuid4())

        # 1. Job payload construction
        job_data = {
            "id": job_id,
            "source_id": "test_e2e_001",
            "message_text": msg_text,
            "type": "sale",
            "brand_src": "Rolex",
            "reference_src": "116508",
            "price_src": 68000.0,
            "from_name": "Test Dealer",
            "from_number": "19722176272",
            "phone_code": "1",
            "region": "North America",
            "dealer_rating": 10.0,
            "is_from_verified_user": True,
            "is_from_paid_user": True,
            "is_seller_approved": True,
            "company_id": 26325,
            "catalog_confirmed": True
        }

        # 2. Pipeline processing
        result = self.processor.process_job(job_data)

        # 3. Assert parent listing outputs
        self.assertEqual(result["category"], "WATCH")
        self.assertEqual(result["intent"], "WTS")
        self.assertEqual(result["listing_type"], "SINGLE")
        self.assertFalse(result["is_bundle"])
        self.assertEqual(result["brand_normalized"], "Rolex")
        self.assertEqual(result["reference_normalized"], "116508")
        self.assertEqual(result["price_normalized"], 68000.0)
        self.assertEqual(result["currency_normalized"], "USD")
        self.assertEqual(result["trading_floor_status"], "published")
        self.assertEqual(result["price_research_status"], "eligible")
        self.assertEqual(result["normalization_status"], "normalized")

    def test_e2e_multi_listing_bundle_flow(self):
        """Test full pipeline flow for a multi-listing bundle."""
        msg_text = "Hublot 565.NX.8970.RX 2024 Green 34HKD \n 521.CM.1770.RX 46HKD"
        job_id = str(uuid.uuid4())

        job_data = {
            "id": job_id,
            "source_id": "test_e2e_002",
            "message_text": msg_text,
            "type": "sale",
            "from_name": "SnD watches",
            "from_number": "60164390914",
            "phone_code": "60",
            "region": "Asia",
            "company_id": 26325
        }

        result = self.processor.process_job(job_data)

        # Parent should be marked as bundle_pending_separation
        self.assertTrue(result["is_bundle"])
        self.assertEqual(result["trading_floor_status"], "bundle_pending_separation")
        self.assertEqual(result["price_research_status"], "ineligible_bundle")

        # Normalized children should be published on Trading Floor with parent lineage
        children = result.get("child_listings", [])
        self.assertGreater(len(children), 0)
        for child in children:
            self.assertEqual(child["trading_floor_status"], "published")

    def test_e2e_rm_price_validation(self):
        """Test Richard Mille price validation check."""
        msg_text = "Richard Mille RM011 2020 $385"
        job_id = str(uuid.uuid4())
        job_data = {
            "id": job_id,
            "source_id": "test_e2e_003",
            "message_text": msg_text,
            "brand_src": "Richard Mille",
            "price_src": 385.0
        }

        result = self.processor.process_job(job_data)
        self.assertIn("IMPOSSIBLE_PRICE_RANGE_RM", result["validation_errors"])
        self.assertEqual(result["price_research_status"], "provisional_needs_review")

    def test_e2e_wtb_watch_classification(self):
        """Test WTB watch classification."""
        msg_text = "Looking for Rolex 126333 White Index Oyster BNIB USD 12000"
        job_id = str(uuid.uuid4())
        job_data = {
            "id": job_id,
            "source_id": "test_e2e_004",
            "message_text": msg_text,
            "type": "buy",
            "brand_src": "Rolex",
            "reference_src": "126333",
            "price_src": 12000.0
        }

        result = self.processor.process_job(job_data)
        self.assertEqual(result["category"], "WATCH")
        self.assertEqual(result["trading_floor_status"], "published")
        self.assertEqual(result["price_research_status"], "eligible")

    def test_currency_and_multiplier_handling(self):
        """Test parsing of 34HKD, 475k, and 4.5m values."""
        # 34HKD
        res1 = self.processor.extract_price("Hublot 8970 34HKD")
        self.assertEqual(res1[0], 34.0)
        self.assertEqual(res1[1], "HKD")

        # 475k HKD
        res2 = self.processor.extract_price("Rolex 116508 475k HKD")
        self.assertEqual(res2[0], 475000.0)
        self.assertEqual(res2[1], "HKD")

        # 4.5m HKD
        res3 = self.processor.extract_price("Patek 5980 4.5m HKD")
        self.assertEqual(res3[0], 4500000.0)
        self.assertEqual(res3[1], "HKD")

    def test_bare_dollar_and_numeric_amounts_default_to_usd(self):
        bare_dollar = self.processor.process_job({
            "id": str(uuid.uuid4()),
            "message_text": "WTS Rolex 116500LN $31500",
            "type": "sale",
        })
        self.assertEqual(bare_dollar["price_normalized"], 31500.0)
        self.assertEqual(bare_dollar["currency_normalized"], "USD")
        self.assertEqual(bare_dollar["price_usd"], 31500.0)
        self.assertEqual(bare_dollar["price_research_status"], "eligible")
        self.assertEqual(bare_dollar["provenance_metadata"]["currency_evidence"], "usd_defaulted_by_policy")

        for message, expected in (
            ("WTS Rolex 116688 $37k", 37000.0),
            ("WTS Patek Philippe 336935 60000$", 60000.0),
            ("WTS Rolex 116500LN 18000", 18000.0),
            ("WTS Rolex 126500LN 106000 usdt", 106000.0),
        ):
            result = self.processor.process_job({
                "id": str(uuid.uuid4()), "message_text": message, "type": "sale",
            })
            self.assertEqual(result["price_usd"], expected, message)

        no_price = self.processor.process_job({
            "id": str(uuid.uuid4()),
            "message_text": "WTS Rolex 116500LN DM for price",
            "type": "sale",
        })
        self.assertEqual(no_price["price_normalized"], 0.0)
        self.assertIsNone(no_price["currency_normalized"])
        self.assertIsNone(no_price["price_usd"])
        self.assertEqual(no_price["price_research_status"], "ineligible_no_price")

    def test_asian_currency_aliases_use_dated_verified_fx(self):
        processor = WatchFactsPipelineProcessor(
            fx_rates={"HKD": 0.128, "CNY": 0.139, "JPY": 0.0068},
            fx_observed_at="2026-08-11T00:00:00Z",
            fx_source="test-fixture",
        )
        cases = (
            ("WTS Rolex 116500LN 298,000 HKD", 38144.0, "HKD"),
            ("WTS Rolex 116500LN 305k HKN", 39040.0, "HKD"),
            ("WTS Rolex 116500LN 300000 RMB", 41700.0, "CNY"),
        )
        for message, expected, currency in cases:
            result = processor.process_job({"id": str(uuid.uuid4()), "message_text": message, "type": "sale"})
            self.assertEqual(result["currency_normalized"], currency)
            self.assertEqual(result["price_usd"], expected)
            self.assertEqual(result["conversion_timestamp"], "2026-08-11T00:00:00Z")

    def test_seller_information_public(self):
        """Test that seller information is publicly preserved and unmasked."""
        job_data = {
            "id": str(uuid.uuid4()),
            "message_text": "Rolex 116508 $68,000",
            "from_name": "John Doe Watches",
            "from_number": "+19722176272",
            "phone_code": "1",
            "region": "North America"
        }
        res = self.processor.process_job(job_data)
        self.assertEqual(res["from_name"], "John Doe Watches")
        self.assertEqual(res["from_number"], "+19722176272")


if __name__ == "__main__":
    unittest.main()
