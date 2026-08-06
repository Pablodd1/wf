import re
import json
import uuid
from datetime import datetime
from pipeline_bundle_splitter import split_bundle_listing

CONDITIONS_MAP = {
    1: 'New', 2: 'Used - Like New', 3: 'Used - Good',
    4: 'Used - Fair', 5: 'Pre-owned', 6: 'Used'
}

DO_LISTINGS_BASE = "https://thecollective-prod.nyc3.digitaloceanspaces.com/listings/"

BRAND_ALIASES = {
    "pp": "Patek Philippe", "patek": "Patek Philippe",
    "ap": "Audemars Piguet", "audemars": "Audemars Piguet",
    "rm": "Richard Mille",
    "vc": "Vacheron Constantin", "vacheron": "Vacheron Constantin",
    "jlc": "Jaeger-LeCoultre", "jaeger": "Jaeger-LeCoultre",
    "iwc": "IWC", "iwe": "IWC",
    "lange": "A. Lange & Söhne", "al&s": "A. Lange & Söhne",
    "grand seiko": "Grand Seiko", "gs": "Grand Seiko",
    "jacob": "Jacob & Co", "jacob & co": "Jacob & Co", "jacob and co": "Jacob & Co",
}

BRANDS_CANONICAL = [
    "Rolex", "Patek Philippe", "Audemars Piguet", "Richard Mille",
    "Hublot", "Omega", "Cartier", "Vacheron Constantin",
    "Jaeger-LeCoultre", "IWC", "A. Lange & Söhne", "Breguet",
    "Blancpain", "Tudor", "Breitling", "TAG Heuer", "Panerai",
    "Grand Seiko", "Seiko", "Oris", "Zenith", "Chopard",
    "Bulgari", "Chanel", "Roger Dubuis", "Urwerk", "MB&F",
    "FP Journe", "H. Moser & Cie", "Greubel Forsey", "Jacob & Co"
]

NON_WATCH_KEYWORDS = {
    "BAG": [r"\bbirkin\b", r"\bhermes\b", r"\bkelly\b", r"\bchanel bag\b", r"\blv bag\b", r"\blouis vuitton bag\b",
            r"\bclutch\b", r"\btote\b", r"\bhandbag\b", r"\bshoulder bag\b", r"\bpochette\b"],
    "JEWELRY": [r"\bnecklace\b", r"\bbracelet\b", r"\bring\b", r"\bearring\b", r"\bpendant\b", r"\bbangle\b",
                r"\bdiamond ring\b", r"\bgold chain\b", r"\bpearl\b"],
    "ACCESSORY": [r"\bwallet\b", r"\bbelt\b", r"\bsunglasses\b", r"\bcufflinks\b", r"\bpen\b", r"\blighter\b",
                  r"\bperfume\b", r"\bscarf\b", r"\bsilk tie\b"],
}

WATCH_INTENT_KEYWORDS = {
    "WTS": ["wts", "for sale", "selling", "sell", "offer", "available", "asking", "fs"],
    "WTB": ["wtb", "want to buy", "looking for", "buying", "looking to buy", "iso",
            "in search of", "wanted", "need"],
    "TRADE": ["trade", "swap", "exchange", "wtt"],
}

FX_TO_USD = {
    "USD": 1.0, "USDT": 1.0, "HKD": 0.128, "SGD": 0.74,
    "EUR": 1.09, "GBP": 1.27, "CHF": 1.12, "AED": 0.272,
    "CAD": 0.74, "AUD": 0.65, "JPY": 0.0067, "CNY": 0.138,
}

EMOJI_DIGITS = {
    '0️⃣': '0', '1️⃣': '1', '2️⃣': '2', '3️⃣': '3', '4️⃣': '4',
    '5️⃣': '5', '6️⃣': '6', '7️⃣': '7', '8️⃣': '8', '9️⃣': '9',
    '0': '0', '1': '1', '2': '2', '3': '3', '4': '4',
    '5': '5', '6': '6', '7': '7', '8': '8', '9': '9'
}

BRAND_PRICE_PLAUSIBILITY = {
    "Rolex": (3000, 500000),
    "Patek Philippe": (10000, 3000000),
    "Audemars Piguet": (10000, 1500000),
    "Richard Mille": (50000, 3000000),
    "Jacob & Co": (15000, 2000000),
    "Omega": (1000, 150000),
    "Cartier": (1500, 200000),
    "Hublot": (3000, 250000),
    "Tudor": (1000, 30000),
    "Panerai": (2000, 100000)
}


class WatchFactsPipelineProcessor:

    def __init__(self, catalog_refs=None):
        self.catalog_refs = catalog_refs or {}
        self.version = "2.2.3"

    def parse_emoji_numbers(self, text):
        pattern = r'(?:[0-9]️⃣)+'
        def repl(match):
            seq = match.group(0)
            digits = ''.join(EMOJI_DIGITS[char] for char in seq if char in EMOJI_DIGITS)
            return digits
        return re.sub(pattern, repl, text)

    def detect_category(self, text):
        lower = text.lower()
        for cat, patterns in NON_WATCH_KEYWORDS.items():
            for pat in patterns:
                if re.search(pat, lower):
                    return cat
        return "WATCH"

    def detect_intent(self, text, source_type=None):
        lower = text.lower()
        for intent, keywords in WATCH_INTENT_KEYWORDS.items():
            if any(re.search(r'\b' + re.escape(kw) + r'\b', lower) for kw in keywords):
                return intent
        if source_type:
            st = str(source_type).lower()
            if "buy" in st or "search" in st:
                return "WTB"
            if "sale" in st or "sell" in st:
                return "WTS"
        return "WTS"

    def extract_brand(self, text):
        lower = text.lower()
        for alias, canonical in BRAND_ALIASES.items():
            if re.search(r'\b' + re.escape(alias) + r'\b', lower):
                return canonical
        for brand in BRANDS_CANONICAL:
            if re.search(r'\b' + re.escape(brand) + r'\b', text, re.I):
                return brand
        return None

    def extract_reference(self, text):
        ref_match = re.search(
            r'\b(RM\s?\d{2}[-–]\d{2}|[0-9]{4,6}[A-Z]{0,3}|[0-9]{4,6}/[0-9]{1,4}[A-Z]{0,3})\b',
            text, re.I
        )
        if ref_match:
            ref_val = ref_match.group(1).strip().upper().replace(" ", "")
            if ref_val.isdigit() and len(ref_val) == 4 and 1950 <= int(ref_val) <= 2030:
                return None
            return ref_val
        return None

    def extract_dial_color(self, text):
        colors = ["black", "white", "blue", "green", "silver", "grey", "gray",
                  "champagne", "brown", "red", "orange", "yellow", "pink",
                  "slate", "olive", "salmon", "copper", "gold", "chocolate",
                  "panda", "tropical", "meteorite", "skeleton", "skeletonized"]
        lower = text.lower()
        for color in colors:
            if re.search(r'\b' + re.escape(color) + r'\b', lower):
                return color.title()
        return None

    def extract_price(self, text):
        text_parsed = self.parse_emoji_numbers(text)
        text_clean = re.sub(r'(\$\s?|\b)(\d{1,3})\.(\d{3})\b', r'\1\2\3', text_parsed)
        text_clean = re.sub(r'(\d),(\d)', r'\1\2', text_clean)

        lower = text_clean.lower()
        default_curr = "USD"
        if "hkd" in lower: default_curr = "HKD"
        elif "eur" in lower: default_curr = "EUR"
        elif "gbp" in lower: default_curr = "GBP"
        elif "usdt" in lower: default_curr = "USDT"
        elif "sgd" in lower: default_curr = "SGD"
        elif "aed" in lower: default_curr = "AED"
        elif "chf" in lower: default_curr = "CHF"

        m = re.search(r'(\d+(?:\.\d+)?)\s*(k|m|million)\s*(usd|usdt|hkd|eur|gbp|chf|aed|sgd|\$)?\b', text_clean, re.I)
        if m:
            val = float(m.group(1))
            unit = m.group(2).lower()
            val *= 1000 if unit == 'k' else 1_000_000
            curr_match = m.group(3)
            curr = curr_match.upper().replace("$", "USD") if curr_match else default_curr
            return (val, curr)

        m = re.search(r'(?:yours for|price|\$|usd|usdt|hkd|eur|gbp|chf|aed|sgd)\s*:?\s*(\d+(?:\.\d+)?)\s*(usd|usdt|hkd|eur|gbp|chf|aed|sgd|\$)?\b', text_clean, re.I)
        if m:
            val = float(m.group(1))
            if not (1950 <= val <= 2030 and len(str(int(val))) == 4):
                curr_match = m.group(2)
                curr = curr_match.upper().replace("$", "USD") if curr_match else default_curr
                return (val, curr)

        m = re.search(r'\b(\d+(?:\.\d+)?)\s*(usd|usdt|hkd|eur|gbp|chf|aed|sgd|\$)\b', text_clean, re.I)
        if m:
            val = float(m.group(1))
            if not (1950 <= val <= 2030 and len(str(int(val))) == 4):
                curr = m.group(2).upper().replace("$", "USD")
                return (val, curr)

        ref_val = self.extract_reference(text)

        m = re.search(r'\b(\d{3,7})\s*(?:shipped|net|all in|obo|\$)?\b', text_clean, re.I)
        if m:
            val = float(m.group(1))
            if ref_val and str(int(val)) == str(ref_val):
                pass
            elif not (1950 <= val <= 2030 and len(str(int(val))) == 4):
                return (val, default_curr)

        return (0.0, "USD")

    def convert_to_usd(self, price, currency):
        rate = FX_TO_USD.get(str(currency).upper(), None)
        if rate is None:
            return (0.0, None)
        return (round(price * rate, 2), rate)

    def check_price_plausibility(self, brand, price_usd):
        if price_usd <= 0:
            return (False, "NO_PRICE")
        if price_usd < 50.0:
            return (False, f"SUSPICIOUS_LOW_PRICE_${price_usd:.2f}_<_$50")
        if not brand or brand not in BRAND_PRICE_PLAUSIBILITY:
            return (True, "OK")
            
        min_p, max_p = BRAND_PRICE_PLAUSIBILITY[brand]
        if price_usd < min_p:
            return (False, f"SUSPICIOUS_LOW_PRICE_{brand}_${price_usd:.0f}_<_${min_p}")
        if price_usd > max_p:
            return (False, f"SUSPICIOUS_HIGH_PRICE_{brand}_${price_usd:.0f}_>_${max_p}")
        return (True, "OK")

    def extract_condition(self, text, condition_id=None):
        if condition_id and condition_id in CONDITIONS_MAP:
            return CONDITIONS_MAP[condition_id]
        lower = text.lower()
        if re.search(r'\b(new|unworn|sealed|nos|brand new)\b', lower):
            return "New"
        if re.search(r'\b(like new|slider|mint|lnib)\b', lower):
            return "Used - Like New"
        if re.search(r'\b(good|excellent)\b', lower):
            return "Used - Good"
        if re.search(r'\b(fair|worn|polished)\b', lower):
            return "Used - Fair"
        return "Used"

    def parse_raw_message(self, message_text):
        brand = self.extract_brand(message_text)
        reference = self.extract_reference(message_text)
        dial_color = self.extract_dial_color(message_text)
        condition = self.extract_condition(message_text)
        price, currency = self.extract_price(message_text)
        has_box = bool(re.search(r'\bbox\b', message_text, re.I))
        has_papers = bool(re.search(r'\b(papers|card|cert)\b', message_text, re.I))
        segments = split_bundle_listing(message_text)
        lines = [l.strip() for l in message_text.split('\n') if l.strip()]
        is_bundle = len(lines) > 2 or len(segments) >= 2 or bool(
            re.search(r'(x\d+|\bset\b|\bbundle\b|\bpackage\b|\bmultilisting\b|\b\d+\s+pcs\b)', message_text, re.I)
        )

        return {
            "brand": brand,
            "model": None,
            "reference": reference,
            "dial_color": dial_color,
            "condition": condition,
            "price": price,
            "currency": currency,
            "box": "Yes" if has_box else "No",
            "papers": "Yes" if has_papers else "No",
            "is_bundle": is_bundle
        }

    def validate_listing(self, parsed):
        errors = []
        if not parsed.get("brand"):
            errors.append("MISSING_BRAND")
        if not parsed.get("reference"):
            errors.append("MISSING_REFERENCE")
        if parsed.get("price", 0) <= 0:
            errors.append("MISSING_OR_INVALID_PRICE")
            
        if parsed.get("brand") == "Richard Mille" and 0 < parsed.get("price", 0) < 50000:
            errors.append("IMPOSSIBLE_PRICE_RANGE_RM")
            
        return errors

    def assign_statuses(self, parsed, is_bundle, intent, category, catalog_confirmed):
        has_price = parsed["price"] > 0
        has_brand = bool(parsed["brand"])
        has_ref = bool(parsed["reference"])
        known_currency = str(parsed["currency"]).upper() in FX_TO_USD
        is_watch = category == "WATCH"

        price_plausible, plausibility_reason = self.check_price_plausibility(parsed["brand"], parsed.get("price_usd", parsed["price"]))

        if has_brand and has_ref:
            normalization_status = "normalized"
        elif has_brand or has_ref or has_price:
            normalization_status = "partially_normalized"
        else:
            normalization_status = "needs_review"

        if is_bundle:
            trading_floor_status = "bundle_pending_separation"
        elif normalization_status == "needs_review":
            trading_floor_status = "published_pending_verification"
        else:
            trading_floor_status = "published"

        if not is_watch:
            price_research_status = "ineligible_non_watch"
        elif is_bundle:
            price_research_status = "ineligible_bundle"
        elif not has_brand or not has_ref:
            price_research_status = "ineligible_identity"
        elif intent == "WTB":
            # WTB buyer demand requests (priced or unpriced) are eligible as demand signals
            price_research_status = "eligible"
        elif not has_price:
            price_research_status = "ineligible_no_price"
        elif not known_currency:
            price_research_status = "ineligible_currency"
        elif not price_plausible:
            price_research_status = "provisional_needs_review"
        else:
            price_research_status = "eligible"

        return {
            "normalization_status": normalization_status,
            "trading_floor_status": trading_floor_status,
            "price_research_status": price_research_status,
            "price_plausible": price_plausible,
            "plausibility_reason": plausibility_reason
        }

    def compute_confidence(self, parsed, catalog_confirmed, price_plausible=True):
        score = 0.60
        if parsed.get("brand"): score += 0.10
        if catalog_confirmed: score += 0.10
        if parsed.get("reference"): score += 0.10
        if parsed.get("price", 0) > 0 and price_plausible: score += 0.05
        if parsed.get("dial_color"): score += 0.03
        if parsed.get("condition"): score += 0.02
        return round(min(score, 1.0), 2)

    def process_job(self, job_data):
        message_text = job_data.get("message_text", "") or ""

        category = self.detect_category(message_text)
        intent   = self.detect_intent(message_text, source_type=job_data.get("type"))

        brand     = self.extract_brand(message_text) or job_data.get("brand_src") or None
        reference = self.extract_reference(message_text) or job_data.get("reference_src") or None
        dial      = self.extract_dial_color(message_text) or job_data.get("dial_src") or None
        condition = self.extract_condition(message_text, job_data.get("condition_id"))
        price, currency = self.extract_price(message_text)

        if price == 0.0 and job_data.get("price_src", 0):
            price    = float(job_data.get("price_src", 0))
            currency = job_data.get("currency_src", "USD") or "USD"

        price_usd, conversion_rate = self.convert_to_usd(price, currency)
        has_box    = bool(re.search(r'\bbox\b', message_text, re.I))
        has_papers = bool(re.search(r'\b(papers|card|cert)\b', message_text, re.I))
        catalog_confirmed = bool(job_data.get("catalog_confirmed"))
        dial_source = "parsed" if dial else "image_pending"

        parsed_dict = {"brand": brand, "reference": reference, "price": price}
        validation_errors = self.validate_listing(parsed_dict)

        segments  = split_bundle_listing(message_text)
        is_bundle = len(segments) >= 2 or bool(
            re.search(r'(x\d+|\bset\b|\bbundle\b|\bpackage\b|\bmultilisting\b|\b\d+\s+pcs\b)',
                      message_text, re.I)
        )

        statuses = self.assign_statuses(
            {"brand": brand, "reference": reference, "price": price, "currency": currency, "price_usd": price_usd},
            is_bundle, intent, category, catalog_confirmed
        )
        
        # Hard errors (like RM < 50k) override verdict
        if "IMPOSSIBLE_PRICE_RANGE_RM" in validation_errors:
            verdict = "needs_review"
            statuses["normalization_status"] = "needs_review"
            statuses["price_research_status"] = "provisional_needs_review"
        else:
            verdict = "approved"

        overall_confidence = self.compute_confidence(
            {"brand": brand, "reference": reference, "price": price,
             "dial_color": dial, "condition": condition},
            catalog_confirmed, statuses["price_plausible"]
        )

        img_url = ""
        front_image = job_data.get("front_image")
        if front_image and str(front_image) not in ("0", "None", ""):
            img_url = DO_LISTINGS_BASE + str(front_image)

        if is_bundle:
            listing_type = "MULTI_LISTING"
        else:
            listing_type = intent

        from_name = job_data.get("from_name") or job_data.get("user_name") or "Anonymous Dealer"
        from_number = job_data.get("from_number") or job_data.get("contact_number") or None
        rating = float(job_data.get("dealer_rating") or job_data.get("rating") or 0.0)

        child_listings = []
        if is_bundle and len(segments) >= 2:
            for idx, item in enumerate(segments):
                c_brand  = self.extract_brand(item["raw_text"]) or item.get("brand") or brand
                c_ref    = self.extract_reference(item["raw_text"]) or item.get("reference")
                c_dial   = self.extract_dial_color(item["raw_text"])
                c_price, c_currency = self.extract_price(item["raw_text"])
                c_cond   = self.extract_condition(item["raw_text"])
                c_usd, c_rate = self.convert_to_usd(c_price, c_currency)
                c_box    = "yes" if re.search(r'\bbox\b', item["raw_text"], re.I) else "no"
                c_papers = "yes" if re.search(r'\b(papers|card|cert)\b', item["raw_text"], re.I) else "no"
                price_split_req = (c_price == 0.0 and price > 0)
                
                c_parsed = {"brand": c_brand, "reference": c_ref, "price": c_price}
                c_errors = self.validate_listing(c_parsed)
                c_verdict = "approved" if not c_errors else "needs_review"

                c_statuses = self.assign_statuses(
                    {"brand": c_brand, "reference": c_ref, "price": c_price, "currency": c_currency, "price_usd": c_usd},
                    False, intent, "WATCH", False
                )

                if c_statuses["normalization_status"] == "needs_review":
                    c_tf_status = "bundle_child_pending_review"
                    c_pr_status = "ineligible_bundle_child_pending_review"
                else:
                    c_tf_status = "published"
                    c_pr_status = c_statuses["price_research_status"]

                child_listings.append({
                    "raw_text_segment":      item["raw_text"],
                    "bundle_position":       idx,
                    "listing_type":          intent,
                    "brand_original":        c_brand,
                    "brand_normalized":      c_brand,
                    "reference_original":    c_ref,
                    "reference_normalized":  c_ref,
                    "dial_color_normalized": c_dial,
                    "dial_color_source":     "parsed" if c_dial else "image_pending",
                    "condition_normalized":  c_cond,
                    "box_normalized":        c_box,
                    "papers_normalized":     c_papers,
                    "price_original":        c_price,
                    "currency_original":     c_currency,
                    "price_normalized":      c_price,
                    "currency_normalized":   c_currency,
                    "price_usd":             c_usd,
                    "conversion_rate":       c_rate,
                    "price_split_required":  price_split_req,
                    "image_url":             "",
                    "verdict":               c_verdict,
                    "validation_errors":     c_errors,
                    "normalization_status":  c_statuses["normalization_status"],
                    "trading_floor_status":  c_tf_status,
                    "price_research_status": c_pr_status,
                    "provenance_metadata":   {
                        "brand": "parsed" if c_brand else "missing",
                        "reference": "parsed" if c_ref else "missing",
                        "price": "parsed" if c_price > 0 else "missing",
                        "dial": "parsed" if c_dial else "image_pending",
                        "plausibility_reason": c_statuses["plausibility_reason"],
                    },
                    "overall_confidence":    self.compute_confidence(
                        {"brand": c_brand, "reference": c_ref, "price": c_price,
                         "dial_color": c_dial, "condition": c_cond}, False, c_statuses["price_plausible"]
                    ),
                })

        return {
            "job_id":                       job_data["id"],
            "source_auction_id":            str(job_data.get("source_id", "")),
            "raw_message_text":             message_text,
            "category":                     category,
            "intent":                       intent,
            "listing_type":                 listing_type,
            "is_bundle":                    is_bundle,
            "brand_original":               job_data.get("brand_src") or brand,
            "brand_normalized":             brand,
            "model_original":               job_data.get("model_src"),
            "model_normalized":             job_data.get("model_src"),
            "reference_original":           job_data.get("reference_src") or reference,
            "reference_normalized":         reference,
            "dial_color_original":          job_data.get("dial_src") or dial,
            "dial_color_normalized":        dial,
            "dial_color_source":            dial_source,
            "condition_original":           condition,
            "condition_normalized":         condition,
            "box_original":                 "Yes" if has_box else "No",
            "box_normalized":               "yes" if has_box else "no",
            "papers_original":              "Yes" if has_papers else "No",
            "papers_normalized":            "yes" if has_papers else "no",
            "price_original":               price,
            "currency_original":            currency,
            "price_normalized":             price,
            "currency_normalized":          currency,
            "price_usd":                    price_usd,
            "conversion_rate":              conversion_rate,
            "reserve_price":                float(job_data.get("reserve_price") or 0),
            "price_min":                    float(job_data.get("price_min") or 0),
            "price_max":                    float(job_data.get("price_max") or 0),
            "price_avg":                    float(job_data.get("price_avg") or 0),
            "image_url":                    img_url,
            "report_url":                   job_data.get("report_url") or "",
            "user_name":                    from_name,
            "from_name":                    from_name,
            "contact_number":               from_number,
            "from_number":                  from_number,
            "phone_code":                   job_data.get("phone_code"),
            "location":                     job_data.get("region"),
            "rating":                       rating,
            "dealer_rating":                rating,
            "is_verified_user":             bool(job_data.get("is_from_verified_user")),
            "is_paid_user":                 bool(job_data.get("is_from_paid_user")),
            "is_seller_approved":           bool(job_data.get("is_seller_approved")),
            "company_id":                   job_data.get("company_id"),
            "contact_consent":              False,
            "catalog_confirmed":            catalog_confirmed,
            "catalog_canonical_confirmed":  bool(job_data.get("catalog_canonical_confirmed")),
            "are_attributes_extracted":     bool(job_data.get("are_attributes_extracted")),
            "identification_status":        job_data.get("identification_status"),
            "wf_inspection":                bool(job_data.get("wf_inspection")),
            "times_posted":                 int(job_data.get("times_posted") or 1),
            "reposted_at":                  str(job_data.get("reposted_at") or ""),
            "overall_confidence":           overall_confidence,
            "verdict":                      verdict,
            "validation_errors":           validation_errors,
            "normalization_status":         statuses["normalization_status"],
            "trading_floor_status":         statuses["trading_floor_status"],
            "price_research_status":        statuses["price_research_status"],
            "plausibility_reason":          statuses["plausibility_reason"],
            "provenance_metadata":          {
                "brand":     "db+parsed" if job_data.get("brand_src") else "parsed",
                "reference": "db+parsed" if job_data.get("reference_src") else "parsed",
                "price":     "db+parsed" if price > 0 else "missing",
                "dial":      dial_source,
                "plausibility_reason": statuses["plausibility_reason"],
            },
            "child_listings":    child_listings,
        }
