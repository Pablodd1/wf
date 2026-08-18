import unittest
import sys
import os

# Adjust paths to import scripts
sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), '../scripts')))

from pipeline_processor import WatchFactsPipelineProcessor

class TestWatchFactsPipeline(unittest.TestCase):
    def setUp(self):
        self.processor = WatchFactsPipelineProcessor()

    def test_single_watch_extraction(self):
        msg = "WTS Rolex Daytona 116500LN Dial White 2021 Box & Papers Price 31500 USD"
        res = self.processor.parse_raw_message(msg)
        self.assertEqual(res['brand'], 'Rolex')
        self.assertEqual(res['reference'], '116500LN')
        self.assertEqual(res['price'], 31500.0)
        self.assertEqual(res['currency'], 'USD')
        self.assertEqual(res['box'], 'Yes')
        self.assertEqual(res['papers'], 'Yes')
        self.assertFalse(res['is_bundle'])
        full_set = self.processor.parse_raw_message('WTS Rolex 126500LN White 2025 full set USD 30000')
        self.assertFalse(full_set['is_bundle'])

    def test_bundle_detection(self):
        msg = "Rolex 116500LN White Dial - 31k\nRolex 126610LV Green - 15k\nAP 15500ST Blue - 38k"
        res = self.processor.parse_raw_message(msg)
        self.assertTrue(res['is_bundle'])

    def test_impossible_price_validation(self):
        job_data = {
            "id": "test-uuid-rm",
            "message_text": "WTS Richard Mille RM35-02 NTPT Red 2020 Price 3500 USD",
            "type": "sale",
            "from_name": "Test Dealer",
            "from_number": "12345678",
            "region": "US",
            "dealer_rating": 4.5
        }
        res = self.processor.process_job(job_data)
        self.assertIn("IMPOSSIBLE_PRICE_RANGE_RM", res["validation_errors"])
        self.assertEqual(res["verdict"], "needs_review")
        self.assertEqual(res["normalization_status"], "needs_review")

    def test_three_status_system(self):
        # 1. Priced Watch
        j1 = {"id": "1", "message_text": "WTS Rolex Daytona 116500LN 31500 USD", "type": "sale", "catalog_confirmed": 1}
        res1 = self.processor.process_job(j1)
        self.assertEqual(res1["normalization_status"], "normalized")
        self.assertEqual(res1["trading_floor_status"], "published")
        self.assertEqual(res1["price_research_status"], "eligible")

        # 2. No-Price Watch
        j2 = {"id": "2", "message_text": "WTS Rolex Daytona 116500LN DM for price", "type": "sale"}
        res2 = self.processor.process_job(j2)
        self.assertEqual(res2["trading_floor_status"], "published")
        self.assertEqual(res2["price_research_status"], "ineligible_no_price")

        # 3. WTB Request
        j3 = {"id": "3", "message_text": "WTB Patek 5711 Blue Dial", "type": "buy"}
        res3 = self.processor.process_job(j3)
        self.assertEqual(res3["category"], "WATCH")
        self.assertEqual(res3["intent"], "WTB")
        self.assertEqual(res3["trading_floor_status"], "published")
        self.assertEqual(res3["price_research_status"], "ineligible_no_price")

    def test_source_image_uses_verified_listings_full_path(self):
        job = {
            "id": "image-1",
            "message_text": "WTS Rolex Daytona 116500LN 31500 USD",
            "type": "sale",
            "front_image": "677ec3e161c64_front_image.jpg",
        }
        result = self.processor.process_job(job)
        self.assertEqual(
            result["image_url"],
            "https://thecollective-prod.nyc3.digitaloceanspaces.com/listings/full/677ec3e161c64_front_image.jpg",
        )

    def test_non_watch_categories_use_public_contract_names(self):
        cases = [
            ("WTS Hermes Birkin 30 handbag USD 24000", "HANDBAG"),
            ("WTS Chanel purse USD 8000", "HANDBAG"),
            ("WTS diamond necklace USD 12000", "JEWELRY"),
            ("WTS Louis Vuitton card holder USD 900", "ACCESSORY"),
        ]
        for message, expected in cases:
            with self.subTest(message=message):
                result = self.processor.process_job({"id": message, "message_text": message, "type": "sale"})
                self.assertEqual(result["category"], expected)
                self.assertEqual(result["price_research_status"], "ineligible_non_watch")

    def test_hermes_watch_is_not_classified_as_a_handbag(self):
        result = self.processor.process_job({
            "id": "hermes-watch",
            "message_text": "WTS Hermes H08 watch USD 5000",
            "type": "sale",
        })
        self.assertEqual(result["category"], "WATCH")

    def test_bundle_splitting(self):
        from pipeline_bundle_splitter import detect_brand_header, detect_multi_item_risk, infer_brand, split_bundle_listing

        self.assertEqual(infer_brand("AP 15500ST blue dial USD 38000"), "Audemars Piguet")
        self.assertIsNone(infer_brand("Full set with papers and spare strap USD 38000"))
        self.assertIsNone(detect_brand_header("Papers, strap, and box included"))
        
        msg1 = "🐂🐂🐂PP NEW HK🐂🐂🐂3 ⭐️5980/1400r 4/25 hkd4.5m ⭐️7140r 2/25 hkd475k"
        res1 = split_bundle_listing(msg1)
        self.assertEqual(len(res1), 2)
        self.assertEqual(res1[0]["brand"], "Patek Philippe")
        self.assertIn("5980/1400r", res1[0]["raw_text"])
        self.assertEqual(res1[1]["brand"], "Patek Philippe")
        self.assertIn("7140r", res1[1]["raw_text"])

        msg2 = "⌚ Rolex ⌚\n116508-0013  2018  489K\n                        2022  562K"
        res2 = split_bundle_listing(msg2)
        self.assertEqual(len(res2), 2)
        self.assertEqual(res2[0]["brand"], "Rolex")
        self.assertIn("116508", res2[0]["raw_text"])
        self.assertEqual(res2[1]["brand"], "Rolex")
        self.assertIn("116508", res2[1]["raw_text"])
        self.assertIn("562K", res2[1]["raw_text"])

        self.assertTrue(detect_multi_item_risk(
            "-RM002-V2 usdt 440.000  RM014 usdtt 458.000  RM022 usd 665.000"
        ))
        self.assertTrue(detect_multi_item_risk("Looking for RM001, RM002, RM003"))
        self.assertTrue(detect_multi_item_risk("WTB RM002 /RM003"))
        self.assertTrue(detect_multi_item_risk("Rolex 126610LN USD14k, Patek 5712/1A USD100k"))
        self.assertFalse(detect_multi_item_risk("Rolex 126500LN 2025 full set USD30k"))

if __name__ == '__main__':
    unittest.main()
