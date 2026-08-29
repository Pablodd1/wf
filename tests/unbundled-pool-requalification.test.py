import importlib.util
from pathlib import Path
import unittest

MODULE = Path(__file__).parents[1] / "tools" / "intake" / "audit-unbundled-pool-requalification.py"
spec = importlib.util.spec_from_file_location("requal", MODULE)
requal = importlib.util.module_from_spec(spec)
spec.loader.exec_module(requal)


def base(raw, reference="126500LN"):
    return {"listing_id": "parent_c1", "source_payload_sha256": "a" * 64,
            "brand": "Rolex", "model": "Daytona", "reference": reference,
            "dial_color": "Black", "condition": "New", "raw_message": raw}


class RequalificationTests(unittest.TestCase):
    def test_buy_intent_overrides_price_and_workbook_intent(self):
        row, reasons = requal.qualify(base("WTB Rolex 126500LN $25,000"))
        self.assertEqual(reasons, [])
        self.assertEqual(row["listing_type"], "WTB")
        self.assertIsNone(row["price_usd"])
        self.assertIsNone(row["image_url"])

    def test_owner_k_policy_and_unsupported_details_are_null(self):
        row, reasons = requal.qualify(base("WTS Rolex 126500LN 25k", "126500LN"))
        self.assertEqual(reasons, [])
        self.assertEqual(row["price_usd"], 25000)
        self.assertIsNone(row["model"])
        self.assertIsNone(row["dial_color"])
        self.assertIsNone(row["condition"])

    def test_junk_reference_and_implicit_sale_are_held(self):
        row, reasons = requal.qualify(base("Rolex watch only 10HKD", "WATCH"))
        self.assertIsNone(row)
        self.assertIn("REFERENCE_NOT_EXACT_IN_CHILD_RAW", reasons)
        self.assertIn("SELL_INTENT_NOT_EXPLICIT", reasons)

    def test_foreign_currency_is_not_price_research_evidence(self):
        row, reasons = requal.qualify(base("WTS Rolex 126500LN HKD 200000"))
        self.assertEqual(reasons, [])
        self.assertIsNone(row["price_usd"])
        self.assertEqual(row["price_evidence_status"], "FOREIGN_OR_MIXED_CURRENCY_HELD")

    def test_k_suffix_takes_precedence_over_plain_usd(self):
        row, reasons = requal.qualify(base("WTS Rolex 126500LN $161k"))
        self.assertEqual(reasons, [])
        self.assertEqual(row["price_usd"], 161000)
        self.assertEqual(row["price_evidence_status"], "OWNER_K_USD_POLICY")

    def test_dotted_three_digit_usdt_is_held(self):
        row, reasons = requal.qualify(base("WTS Rolex 126500LN USDT 60.000"))
        self.assertEqual(reasons, [])
        self.assertIsNone(row["price_usd"])
        self.assertEqual(row["price_evidence_status"], "AMBIGUOUS_DOTTED_AMOUNT")

    def test_two_decimal_dollar_amount_is_allowed(self):
        row, reasons = requal.qualify(base("WTS Rolex 126500LN $60.00"))
        self.assertEqual(reasons, [])
        self.assertEqual(row["price_usd"], 60)
        self.assertEqual(row["price_evidence_status"], "SOURCE_EXPLICIT_USD")

    def test_explicit_k_amount_remains_allowed(self):
        row, reasons = requal.qualify(base("WTS Rolex 126500LN $60k"))
        self.assertEqual(reasons, [])
        self.assertEqual(row["price_usd"], 60000)
        self.assertEqual(row["price_evidence_status"], "OWNER_K_USD_POLICY")

    def test_white_tag_rolex_is_not_tag_heuer(self):
        source = base("WTS Rolex 126500LN white tag $30k")
        source.update({"brand": "TAG Heuer", "reference": "126500LN"})
        row, reasons = requal.qualify(source)
        self.assertIsNone(row)
        self.assertIn("BRAND_NOT_EXPLICIT_IN_CHILD_RAW", reasons)

    def test_tag_heuer_rejects_numeric_rolex_reference(self):
        source = base("WTS TAG Heuer 336933 $22k")
        source.update({"brand": "TAG Heuer", "reference": "336933"})
        row, reasons = requal.qualify(source)
        self.assertIsNone(row)
        self.assertIn("BRAND_REFERENCE_CONFLICT", reasons)

    def test_year_and_appraisal_contexts_are_not_watch_candidates(self):
        source = base("WTS Rolex appraisal 2024 $500", "2024")
        row, reasons = requal.qualify(source)
        self.assertIsNone(row)
        self.assertIn("NON_WATCH_SUBSTANCE", reasons)
        self.assertIn("REFERENCE_NOT_EXACT_IN_CHILD_RAW", reasons)

    def test_need_and_iso_override_usd_as_buy_intent(self):
        for raw in ("Need Rolex 126500LN USD 30000", "ISO Rolex 126500LN $30k"):
            row, reasons = requal.qualify(base(raw))
            self.assertEqual(reasons, [])
            self.assertEqual(row["listing_type"], "WTB")
            self.assertIsNone(row["price_usd"])
            self.assertEqual(row["price_evidence_status"], "WTB_PRICE_WITHHELD")

    def test_two_references_and_two_prices_are_multi_child(self):
        row, reasons = requal.qualify(base("WTS Rolex 126500LN $30k and Rolex 126710BLNR $18k"))
        self.assertIsNone(row)
        self.assertIn("MULTI_ITEM_LINE_AMBIGUOUS", reasons)

    def test_reference_equal_to_price_is_held(self):
        source = base("WTS Rolex 93000 USDT", "93000")
        row, reasons = requal.qualify(source)
        self.assertIsNone(row)
        self.assertIn("REFERENCE_NOT_EXACT_IN_CHILD_RAW", reasons)

    def test_foreign_symbol_precedes_generic_dollar_and_prefix_conflicts(self):
        source = base("VC New Pam01289 full set HK$55000", "PAM01289")
        source.update({"brand": "Vacheron Constantin"})
        row, reasons = requal.qualify(source)
        self.assertIsNone(row)
        self.assertIn("BRAND_REFERENCE_CONFLICT", reasons)
        self.assertEqual(requal.price(source["raw_message"]), (None, "FOREIGN_OR_MIXED_CURRENCY_HELD"))

    def test_alternative_demand_references_are_multi_child(self):
        for raw, reference in (("NTQ Vacheron Constantin 1205V or 2305V", "1205V"),
                               ("NTQ Vacheron Constantin 5500v or 5520v", "5500v")):
            source = base(raw, reference)
            source.update({"brand": "Vacheron Constantin"})
            row, reasons = requal.qualify(source)
            self.assertIsNone(row)
            self.assertIn("MULTI_ITEM_LINE_AMBIGUOUS", reasons)

    def test_base_reference_is_expanded_but_excluded_from_price_research(self):
        source = base("WTS Vacheron Constantin 25558/000G-9405 $25k", "25558/000G")
        source.update({"brand": "Vacheron Constantin"})
        row, reasons = requal.qualify(source)
        self.assertEqual(reasons, [])
        self.assertEqual(row["reference"], "25558/000G-9405")
        self.assertEqual(row["reference_evidence_status"], "BASE_REFERENCE_ONLY")
        self.assertFalse(row["price_research_eligible"])

    def test_explicit_price_outranks_karat_material(self):
        source = base("WTS Vacheron Constantin 6406 watchonly 18K gold coins original total (71g) $70000", "6406")
        source.update({"brand": "Vacheron Constantin"})
        row, reasons = requal.qualify(source)
        self.assertEqual(reasons, [])
        self.assertEqual(row["price_usd"], 70000)
        self.assertEqual(row["price_evidence_status"], "SOURCE_EXPLICIT_USD")

    def test_plain_karat_material_is_not_a_price(self):
        self.assertEqual(requal.price("Vacheron Constantin 6406 18K gold"), (None, "PRICE_NOT_SUPPLIED"))

    def test_dimension_reference_replaced_by_true_omega_reference(self):
        source = base("WTS Omega 131.28.29.20.99.001 29mm $12000", "29MM")
        source.update({"brand": "Omega"})
        row, reasons = requal.qualify(source)
        self.assertEqual(reasons, [])
        self.assertEqual(row["reference"], "131.28.29.20.99.001")
        self.assertEqual(row["reference_evidence_status"], "DIMENSION_REFERENCE_REPLACED_FROM_SOURCE")
        self.assertFalse(row["price_research_eligible"])

    def test_dimension_reference_replaced_by_true_rolex_reference(self):
        source = base("WTB Rolex 227700 31mm", "31MM")
        row, reasons = requal.qualify(source)
        self.assertEqual(reasons, [])
        self.assertEqual(row["reference"], "227700")
        self.assertEqual(row["listing_type"], "WTB")

    def test_patek_reference_cannot_publish_under_rolex_header(self):
        source = base("WTS Rolex header bleed Patek Philippe 5205R $45000", "5205R")
        row, reasons = requal.qualify(source)
        self.assertIsNone(row)
        self.assertIn("BRAND_REFERENCE_CONFLICT", reasons)


if __name__ == "__main__":
    unittest.main()
