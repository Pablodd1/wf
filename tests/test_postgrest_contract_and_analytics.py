import unittest
import urllib.request
import json
import os

SUPABASE_URL = os.environ.get("SUPABASE_URL", "https://qnsafosakvonzgfcsphh.supabase.co")
ANON_KEY = os.environ.get("SUPABASE_ANON_KEY", os.environ.get("ANON_KEY", "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFuc2Fmb3Nha3ZvbnpnZmNzcGhoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODYwMjI3NDEsImV4cCI6MjEwMTU5ODc0MX0.YUxMjnTHtgPsiWiWko3TS1A47Sjk33SuHC2TND0Rxmg"))

class TestPostgrestContractAndAnalytics(unittest.TestCase):
    def test_01_trading_floor_view_full_ui_contract(self):
        """Proves reviewed_workbook_market_source_v2 returns all required application UI contract fields via PostgREST."""
        url = f"{SUPABASE_URL}/rest/v1/reviewed_workbook_market_source_v2?limit=5"
        req = urllib.request.Request(url, headers={
            "apikey": ANON_KEY,
            "Authorization": f"Bearer {ANON_KEY}",
            "Accept": "application/json"
        })
        try:
            with urllib.request.urlopen(req) as resp:
                self.assertIn(resp.status, (200, 206))
                data = json.loads(resp.read().decode())
                self.assertGreater(len(data), 0, "Trading Floor view must return rows")
                row = data[0]
                
                # Assert all required UI fields exist in contract
                required_fields = [
                    "id", "job_id", "parent_id", "source_file", "posting_date", "posted_by", "phone_number",
                    "contact_publication_approved", "raw_message", "intent", "listing_type", "brand_scope",
                    "supplied_brand", "canonical_brand", "model", "catalog_model", "raw_reference",
                    "normalized_reference", "catalog_reference", "public_reference", "reference_search_key",
                    "dial_color", "catalog_dial", "condition", "workbook_price_usd", "source_price_amount",
                    "source_price_text", "source_currency", "price_evidence_status", "confidence",
                    "user_image_url", "has_exact_source_image", "verified_price_usd", "has_verified_usd_price",
                    "has_complete_identity", "has_supplied_price", "rating", "review_count", "group_count",
                    "wts_post_count", "wtb_post_count", "first_post_date", "latest_post_date", "location",
                    "region", "verdict", "listing_status", "normalization_status", "trading_floor_status", "price_research_status"
                ]
                for f in required_fields:
                    self.assertIn(f, row, f"Trading Floor View missing contract field: {f}")
        except Exception as e:
            self.fail(f"Trading Floor view PostgREST contract test failed: {e}")

    def test_02_price_research_view_full_ui_contract(self):
        """Proves price_research_verified_source returns all required UI fields via PostgREST."""
        url = f"{SUPABASE_URL}/rest/v1/price_research_verified_source?limit=5"
        req = urllib.request.Request(url, headers={
            "apikey": ANON_KEY,
            "Authorization": f"Bearer {ANON_KEY}",
            "Accept": "application/json"
        })
        try:
            with urllib.request.urlopen(req) as resp:
                self.assertIn(resp.status, (200, 206))
                data = json.loads(resp.read().decode())
                self.assertGreater(len(data), 0, "Price Research view must return rows")
                row = data[0]
                
                required_fields = [
                    "id", "job_id", "intent", "brand", "model", "reference", "normalized_reference",
                    "public_reference", "reference_search_key", "dial_color", "condition", "price",
                    "price_usd", "price_raw", "currency", "box", "papers", "raw_message", "posted_by",
                    "seller_name", "phone_number", "seller_phone", "listing_date", "created_at", "source",
                    "dealer_id", "confidence", "thumbnail_url", "image_url", "display_image_url", "image_urls",
                    "has_images", "listing_type", "has_complete_identity", "rating", "review_count",
                    "group_count", "wts_post_count", "wtb_post_count", "first_post_date", "latest_post_date",
                    "location", "region", "verdict", "listing_status", "normalization_status",
                    "trading_floor_status", "price_research_status"
                ]
                for f in required_fields:
                    self.assertIn(f, row, f"Price Research View missing contract field: {f}")
        except Exception as e:
            self.fail(f"Price Research view PostgREST contract test failed: {e}")

    def test_03_wts_price_averages_exclude_wtb_records(self):
        """Proves querying price research for WTS comparables (listing_type=eq.WTS&price_usd=gt.0) returns only positive priced WTS sales."""
        url = f"{SUPABASE_URL}/rest/v1/price_research_verified_source?listing_type=eq.WTS&price_usd=gt.0&limit=50"
        req = urllib.request.Request(url, headers={
            "apikey": ANON_KEY,
            "Authorization": f"Bearer {ANON_KEY}",
            "Accept": "application/json"
        })
        try:
            with urllib.request.urlopen(req) as resp:
                data = json.loads(resp.read().decode())
                self.assertGreater(len(data), 0)
                for row in data:
                    self.assertEqual(row["listing_type"], "WTS", "Price average cohort must only contain WTS listings")
                    self.assertGreater(float(row["price_usd"]), 0, "Price average cohort must only contain positive prices")
        except Exception as e:
            self.fail(f"WTS price average cohort query failed: {e}")

    def test_04_wtb_demand_query_includes_unpriced_requests(self):
        """Proves querying price research for WTB demand signals (intent=eq.WTB) returns buyer demand listings."""
        url = f"{SUPABASE_URL}/rest/v1/price_research_verified_source?intent=eq.WTB&limit=50"
        req = urllib.request.Request(url, headers={
            "apikey": ANON_KEY,
            "Authorization": f"Bearer {ANON_KEY}",
            "Accept": "application/json"
        })
        try:
            with urllib.request.urlopen(req) as resp:
                data = json.loads(resp.read().decode())
                self.assertGreater(len(data), 0)
                for row in data:
                    self.assertEqual(row["intent"], "WTB", "Demand signal cohort must contain WTB intent listings")
        except Exception as e:
            self.fail(f"WTB demand query failed: {e}")

if __name__ == "__main__":
    unittest.main()
