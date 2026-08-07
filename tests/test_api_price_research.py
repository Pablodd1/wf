import unittest
import os
import sys
import json
import urllib.request

sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), '../scripts')))

SUPABASE_URL = os.environ.get("SUPABASE_URL", "https://qnsafosakvonzgfcsphh.supabase.co")
ANON_KEY = os.environ.get("SUPABASE_ANON_KEY") or os.environ.get("ANON_KEY")

class TestPriceResearchAPIHandler(unittest.TestCase):
    def setUp(self):
        if not ANON_KEY:
            self.skipTest("SKIPPED: SUPABASE_ANON_KEY / ANON_KEY not set in environment.")

    def test_01_wts_only_for_sales_averages(self):
        """Proves sales price research queries reject WTB listings and zero prices."""
        url = f"{SUPABASE_URL}/rest/v1/price_research_verified_source?brand=eq.Rolex&listing_type=eq.WTS&price_usd=gt.0&limit=50"
        req = urllib.request.Request(url, headers={
            "apikey": ANON_KEY,
            "Authorization": f"Bearer {ANON_KEY}",
            "Accept": "application/json"
        })
        try:
            with urllib.request.urlopen(req) as resp:
                self.assertIn(resp.status, (200, 206))
                data = json.loads(resp.read().decode())
                self.assertGreater(len(data), 0)
                for row in data:
                    self.assertEqual(row.get("listing_type"), "WTS", "Sales cohort must only contain WTS records")
                    self.assertGreater(float(row.get("price_usd", 0)), 0, "Sales cohort must contain only positive USD prices")
        except Exception as e:
            self.fail(f"Sales price research query failed: {e}")

    def test_02_wtb_buyer_demand_endpoint(self):
        """Proves WTB buyer requests are available as demand signals."""
        url = f"{SUPABASE_URL}/rest/v1/price_research_verified_source?intent=eq.WTB&limit=50"
        req = urllib.request.Request(url, headers={
            "apikey": ANON_KEY,
            "Authorization": f"Bearer {ANON_KEY}",
            "Accept": "application/json"
        })
        try:
            with urllib.request.urlopen(req) as resp:
                self.assertIn(resp.status, (200, 206))
                data = json.loads(resp.read().decode())
                self.assertGreater(len(data), 0)
                for row in data:
                    self.assertEqual(row.get("intent"), "WTB", "Demand query must return WTB intent records")
        except Exception as e:
            self.fail(f"WTB demand query failed: {e}")

    def test_03_trading_floor_view_has_seller_name_and_phone(self):
        """Proves reviewed_workbook_market_source_v2 exposes seller_name and seller_phone."""
        url = f"{SUPABASE_URL}/rest/v1/reviewed_workbook_market_source_v2?limit=5"
        req = urllib.request.Request(url, headers={
            "apikey": ANON_KEY,
            "Authorization": f"Bearer {ANON_KEY}",
            "Accept": "application/json"
        })
        try:
            with urllib.request.urlopen(req) as resp:
                data = json.loads(resp.read().decode())
                self.assertGreater(len(data), 0)
                row = data[0]
                self.assertIn("seller_name", row, "Trading Floor view must expose seller_name")
                self.assertIn("seller_phone", row, "Trading Floor view must expose seller_phone")
                self.assertIn("posted_by", row)
                self.assertIn("phone_number", row)
        except Exception as e:
            self.fail(f"Trading Floor view query failed: {e}")

if __name__ == "__main__":
    unittest.main()
