#!/usr/bin/env python3
"""Bounded, read-only requalification of generated unbundled XLSX pools.

The generator's labels are untrusted. This tool streams LISTING_CORRECTIONS,
rebuilds a conservative candidate cohort from the exact child raw line, and
writes only a sanitized JSON audit manifest. It never contacts or writes QNSA.
"""

from __future__ import annotations

from collections import Counter
from hashlib import sha256
import argparse
import json
from pathlib import Path
import re
import zipfile
import xml.etree.ElementTree as ET

NS = "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}"
CELL_REF = re.compile(r"([A-Z]+)")
BUY = re.compile(r"(?i)(?:^|\b)(?:WTB|LF|ISO|NTQ|LTB|NEED(?:ED)?|LOOKING(?:\s+FOR)?|WANTED|WANT(?:ED)?\s+TO\s+BUY|BUYING)(?:\b|$)")
SELL = re.compile(r"(?i)(?:^|\b)(?:WTS|LTS|LQT|LTQ|FS|FOR\s+SALE|SELLING|AVAILABLE|IN\s+STOCK)(?:\b|$)")
USD = re.compile(r"(?i)(?:USD|USDT|US\s*\$|\$)\s*([0-9][0-9,]*(?:\.[0-9]+)?)(?![0-9,.]|\s*[KM]\b)|([0-9][0-9,]*(?:\.[0-9]+)?)(?![0-9,.]|\s*[KM]\b)\s*(?:USD|USDT)\b")
EXPLICIT_K_USD = re.compile(r"(?i)(?:(?:USD|USDT|US\s*\$|\$)\s*([0-9]+(?:[.,][0-9]+)?)\s*K\b|([0-9]+(?:[.,][0-9]+)?)\s*K\s*(?:USD|USDT)\b)")
BARE_K = re.compile(r"(?i)(?<![A-Z0-9$])([0-9]+(?:[.,][0-9]+)?)\s*K\b")
KARAT_MATERIAL = re.compile(r"(?i)\b(?:14|18|24)\s*K\s*(?:gold|rose|white|yellow|material|case|bracelet|dial|coins?)\b")
AMBIGUOUS_DOTTED_USD = re.compile(r"(?i)(?:(?:USD|USDT|US\s*\$|\$)\s*\d+\.\d{3}(?!\d|\s*K\b)|\d+\.\d{3}\s*(?:USD|USDT)\b)")
FOREIGN = re.compile(r"(?i)(?:HK|S|C|A)\$|\b(?:HKD|AED|EUR|GBP|JPY|CNY|RMB|SGD|CAD|AUD|CHF)\b|[€£¥]")
ACCESSORY = re.compile(r"(?i)\b(?:box\s+only|empty\s+box|strap\s+only|bracelet\s+only|wallet|bag|jewelry|authentication|appraisal|valuation|service)\b")
BAD_REFERENCE = re.compile(r"(?i)^(?:WATCH|AUTHORIZED|BOTH|NEW|USED|AVAILABLE|WTS|WTB|FS|FULLSET|UNKNOWN|UNRESOLVED|NONE|N/?A)$")

BRAND_PATTERNS = {
    "Rolex": re.compile(r"(?i)\bRolex\b"),
    "Patek Philippe": re.compile(r"(?i)\bPatek(?:\s+Phil(?:ippe|lippe))?\b"),
    "Audemars Piguet": re.compile(r"(?i)\bAudemars\s+Piguet\b"),
    "Richard Mille": re.compile(r"(?i)\bRichard\s+Mille\b"),
    "TAG Heuer": re.compile(r"(?i)\bTAG\s+Heuer\b"),
    "Bell & Ross": re.compile(r"(?i)\bBell\s*(?:&|and)?\s*Ross\b"),
    "F.P. Journe": re.compile(r"(?i)\bF\.?\s*P\.?\s*Journe\b"),
    "H. Moser & Cie": re.compile(r"(?i)\bH\.?\s*Moser(?:\s*&\s*Cie)?\b"),
    "A. Lange & Söhne": re.compile(r"(?i)\bA\.?\s*Lange(?:\s*&\s*S[oö]hne)?\b"),
    "Jaeger-LeCoultre": re.compile(r"(?i)\b(?:Jaeger[- ]?LeCoultre|JLC)\b"),
    "Vacheron Constantin": re.compile(r"(?i)\b(?:Vacheron\s+Constantin|VC)\b"),
    "Girard-Perregaux": re.compile(r"(?i)\bGirard[- ]?Perregaux\b"),
    "Glashütte Original": re.compile(r"(?i)\bGlash(?:ü|u|ue)tte\s+Original\b"),
    "Ulysse Nardin": re.compile(r"(?i)\bUlysse\s+Nardin\b"),
    "Franck Muller": re.compile(r"(?i)\bFranck\s+Muller\b"),
    "Grand Seiko": re.compile(r"(?i)\bGrand\s+Seiko\b"),
}


def column_index(reference: str) -> int:
    value = 0
    for letter in CELL_REF.match(reference).group(1):
        value = value * 26 + ord(letter) - 64
    return value - 1


def cell_text(cell: ET.Element) -> str:
    inline = cell.find(f"{NS}is")
    if inline is not None:
        return "".join(node.text or "" for node in inline.iter(f"{NS}t"))
    value = cell.find(f"{NS}v")
    return value.text if value is not None and value.text is not None else ""


def rows(archive: zipfile.ZipFile, sheet_index: int):
    with archive.open(f"xl/worksheets/sheet{sheet_index}.xml") as source:
        for _event, element in ET.iterparse(source, events=("end",)):
            if element.tag != f"{NS}row":
                continue
            cells = {column_index(cell.get("r", "A1")): cell_text(cell) for cell in element.findall(f"{NS}c")}
            if cells:
                yield [cells.get(index, "") for index in range(max(cells) + 1)]
            element.clear()


def normalized(value: str) -> str:
    return re.sub(r"[^A-Z0-9]", "", (value or "").upper())


def supported(value: str, raw: str) -> bool:
    token = normalized(value)
    return bool(token) and token not in {"UNKNOWN", "PREOWNED"} and token in normalized(raw)


def valid_reference(reference: str, raw: str) -> bool:
    resolved, _status = source_reference_resolution(reference, raw)
    token = normalized(resolved or reference)
    return (len(token) >= 4 and any(ch.isdigit() for ch in token)
            and not re.fullmatch(r"(?:19|20)\d{2}", token)
            and not reference_is_price(reference, raw)
            and not BAD_REFERENCE.fullmatch(reference.strip())
            and resolved is not None)


def source_reference_resolution(reference: str, raw: str):
    target = normalized(reference)
    tokens = [(token, normalized(token)) for token in re.findall(r"(?i)\b[A-Z0-9][A-Z0-9./-]{3,30}\b", raw)]
    if re.fullmatch(r"\d+(?:MM|CM)", target):
        prices = explicit_price_tokens(raw)
        alternatives = {}
        for original, clean in tokens:
            comparable = clean[:-1] if re.fullmatch(r"\d+K", clean) else clean
            if clean == target or re.fullmatch(r"\d+(?:G|KG|MM|CM)", clean): continue
            if re.fullmatch(r"(?:19|20)\d{2}", clean): continue
            if not any(char.isdigit() for char in clean): continue
            if (comparable.lstrip("0") or "0") in prices: continue
            alternatives[clean] = original
        if len(alternatives) == 1:
            return next(iter(alternatives.values())), "DIMENSION_REFERENCE_REPLACED_FROM_SOURCE"
        return None, "DIMENSION_REFERENCE_AMBIGUOUS"
    exact = [original for original, clean in tokens if clean == target]
    if exact:
        return exact[0], "EXACT_CHILD_REFERENCE"
    longer = {clean: original for original, clean in tokens if clean.startswith(target) and len(clean) > len(target)}
    if len(longer) == 1:
        return next(iter(longer.values())), "BASE_REFERENCE_ONLY"
    return None, "REFERENCE_NOT_EXACT_IN_CHILD_RAW"


def explicit_price_tokens(raw: str) -> set[str]:
    tokens = set()
    prefix_currency = r"USD|USDT|HKD|AED|EUR|GBP|JPY|CNY|RMB|SGD|CAD|AUD|CHF|US\s*\$|HK\$|S\$|C\$|A\$|\$"
    suffix_currency = r"USD|USDT|HKD|AED|EUR|GBP|JPY|CNY|RMB|SGD|CAD|AUD|CHF"
    for match in re.finditer(rf"(?i)(?:{prefix_currency})\s*([0-9][0-9,.]*)(?:\s*K\b)?|([0-9][0-9,.]*)\s*(?:K|{suffix_currency})\b", raw):
        value = (match.group(1) or match.group(2) or "").replace(",", "").replace(".", "")
        if value: tokens.add(value.lstrip("0") or "0")
    return tokens


def reference_is_price(reference: str, raw: str) -> bool:
    token = normalized(reference)
    return token.isdigit() and (token.lstrip("0") or "0") in explicit_price_tokens(raw)


def plausible_reference_tokens(raw: str) -> set[str]:
    output = set()
    prices = explicit_price_tokens(raw)
    for token in re.findall(r"(?i)\b[A-Z0-9][A-Z0-9./-]{3,20}\b", raw):
        clean = normalized(token)
        if not any(char.isdigit() for char in clean): continue
        if re.fullmatch(r"(?:19|20)\d{2}", clean): continue
        if re.fullmatch(r"\d+(?:G|KG|MM|CM)", clean): continue
        comparable = clean[:-1] if re.fullmatch(r"\d+K", clean) else clean
        if (comparable.lstrip("0") or "0") in prices: continue
        output.add(clean)
    return output


def explicit_price_mention_count(raw: str) -> int:
    return len(re.findall(r"(?i)(?:USD|USDT|US\s*\$|\$)\s*[0-9][0-9,.]*(?:\s*K\b)?|[0-9][0-9,.]*\s*(?:USD|USDT)\b|[0-9]+(?:[.,][0-9]+)?\s*K\b", raw))


def brand_reference_compatible(brand: str, reference: str) -> bool:
    token = normalized(reference)
    # TAG Heuer's modern identifiers contain a letter prefix. Numeric Rolex-like
    # references (336933, 226659, etc.) are a demonstrated cross-brand leak.
    if brand == "TAG Heuer":
        return bool(re.fullmatch(r"[A-Z]{1,6}[A-Z0-9]{2,20}", token))
    prefix_owner = (("PAM", "Panerai"), ("RM", "Richard Mille"), ("IW", "IWC"))
    for prefix, owner in prefix_owner:
        if token.startswith(prefix) and brand != owner:
            return False
    if re.fullmatch(r"(?:116|126|136|226|326|336)\d{3}[A-Z]*", token) and brand != "Rolex":
        return False
    if token in {"5205R"} and brand != "Patek Philippe":
        return False
    return True


def brand_supported(brand: str, raw: str) -> bool:
    pattern = BRAND_PATTERNS.get(brand)
    if pattern:
        return bool(pattern.search(raw))
    words = [word for word in re.findall(r"[A-Za-z]{3,}", brand) if word.lower() not in {"and", "cie"}]
    return bool(words) and all(re.search(rf"(?i)\b{re.escape(word)}\b", raw) for word in words)


def price(raw: str):
    if FOREIGN.search(raw):
        return None, "FOREIGN_OR_MIXED_CURRENCY_HELD"
    match = EXPLICIT_K_USD.search(raw)
    if match:
        amount = float((match.group(1) or match.group(2)).replace(",", ".")) * 1000
        return (amount, "OWNER_K_USD_POLICY") if amount > 0 else (None, "INVALID_AMOUNT")
    if AMBIGUOUS_DOTTED_USD.search(raw):
        return None, "AMBIGUOUS_DOTTED_AMOUNT"
    match = USD.search(raw)
    if match:
        amount = float((match.group(1) or match.group(2)).replace(",", ""))
        return (amount, "SOURCE_EXPLICIT_USD") if amount > 0 else (None, "INVALID_AMOUNT")
    material_spans = [match.span() for match in KARAT_MATERIAL.finditer(raw)]
    for match in BARE_K.finditer(raw):
        if any(start <= match.start() and match.end() <= end for start, end in material_spans):
            continue
        amount = float(match.group(1).replace(",", ".")) * 1000
        return (amount, "OWNER_K_USD_POLICY") if amount > 0 else (None, "INVALID_AMOUNT")
    return None, "PRICE_NOT_SUPPLIED"


def qualify(row: dict):
    raw = row.get("raw_message", "").strip()
    brand = row.get("brand", "").strip()
    reference = row.get("reference", "").strip()
    reasons = []
    if not raw: reasons.append("RAW_MISSING")
    if ACCESSORY.search(raw): reasons.append("NON_WATCH_SUBSTANCE")
    if not brand_supported(brand, raw): reasons.append("BRAND_NOT_EXPLICIT_IN_CHILD_RAW")
    resolved_reference, reference_status = source_reference_resolution(reference, raw)
    if not valid_reference(reference, raw): reasons.append("REFERENCE_NOT_EXACT_IN_CHILD_RAW")
    elif not brand_reference_compatible(brand, resolved_reference): reasons.append("BRAND_REFERENCE_CONFLICT")
    # Alternative references are multi-child ambiguity even without prices
    # (for example WTB/NTQ "1205V or 2305V").
    if len(plausible_reference_tokens(raw)) >= 2:
        reasons.append("MULTI_ITEM_LINE_AMBIGUOUS")
    buy = bool(BUY.search(raw))
    amount, price_status = price(raw)
    if buy:
        intent, amount, price_status = "WTB", None, "WTB_PRICE_WITHHELD"
    elif SELL.search(raw) or amount is not None:
        intent = "WTS"
    else:
        intent = ""
        reasons.append("SELL_INTENT_NOT_EXPLICIT")
    if reasons:
        return None, reasons
    raw_hash = sha256(raw.encode("utf-8")).hexdigest()
    source_id = row.get("listing_id", "").strip()
    deterministic = "unbundleq_" + sha256((source_id + "|" + raw_hash + "|" + brand + "|" + normalized(resolved_reference) + "|" + intent).encode()).hexdigest()
    return {
        "candidate_id": deterministic,
        "source_listing_id_sha256": sha256(source_id.encode()).hexdigest(),
        "source_payload_sha256": row.get("source_payload_sha256", "").strip() or raw_hash,
        "raw_line_sha256": raw_hash,
        "brand": brand,
        "reference": resolved_reference,
        "workbook_reference": reference,
        "reference_evidence_status": reference_status,
        "listing_type": intent,
        "model": row.get("model", "").strip() if supported(row.get("model", ""), raw) else None,
        "dial_color": row.get("dial_color", "").strip() if supported(row.get("dial_color", ""), raw) else None,
        "condition": row.get("condition", "").strip() if supported(row.get("condition", ""), raw) else None,
        "price_usd": amount,
        "price_evidence_status": price_status,
        "price_research_eligible": bool(amount is not None and reference_status == "EXACT_CHILD_REFERENCE"),
        "image_url": None,
        "image_status": "UNBUNDLED_CHILD_MEDIA_WITHHELD",
        "contact_publication_approved": False,
    }, []


def audit(paths: list[Path], max_rows: int, manifest_limit: int, start_row: int = 0) -> dict:
    counts, holds, manifest, duplicates = Counter(), Counter(), [], []
    canonical_by_exact = {}
    for path in paths:
        with zipfile.ZipFile(path) as archive:
            workbook = ET.fromstring(archive.read("xl/workbook.xml"))
            names = [sheet.get("name") for sheet in workbook.find(f"{NS}sheets")]
            if "LISTING_CORRECTIONS" not in names:
                holds["WORKBOOK_SCHEMA_MISSING"] += 1
                continue
            iterator = rows(archive, names.index("LISTING_CORRECTIONS") + 1)
            headers = next(iterator); positions = {name: index for index, name in enumerate(headers)}
            required = {"listing_id", "source_payload_sha256", "brand", "model", "reference", "dial_color", "condition", "raw_message"}
            if not required.issubset(positions):
                holds["WORKBOOK_SCHEMA_MISSING"] += 1
                continue
            for row_number, source in enumerate(iterator, start=2):
                if row_number - 2 < start_row:
                    continue
                if counts["rows_scanned"] >= max_rows: break
                counts["rows_scanned"] += 1
                record = {key: (source[pos].strip() if pos < len(source) else "") for key, pos in positions.items()}
                candidate, reasons = qualify(record)
                if not candidate:
                    for reason in set(reasons): holds[reason] += 1
                    continue
                exact_key = (candidate["raw_line_sha256"], candidate["brand"], normalized(candidate["reference"]), candidate["listing_type"])
                canonical = canonical_by_exact.get(exact_key)
                if canonical:
                    counts["duplicate_excluded"] += 1
                    if len(duplicates) < manifest_limit:
                        duplicates.append({"duplicate_candidate_id": candidate["candidate_id"], "canonical_candidate_id": canonical, "exclude_from_analytics": True})
                    continue
                canonical_by_exact[exact_key] = candidate["candidate_id"]
                counts["qualified_unique"] += 1
                counts[f"qualified_{candidate['listing_type'].lower()}"] += 1
                if candidate["listing_type"] == "WTS" and candidate["price_research_eligible"]:
                    counts["price_research_max"] += 1
                if len(manifest) < manifest_limit:
                    candidate.update({"source_file": path.name, "source_row_number": row_number})
                    manifest.append(candidate)
            if counts["rows_scanned"] >= max_rows: break
    return {
        "mode": "READ_ONLY_BOUNDED_UNBUNDLED_REQUALIFICATION",
        "database_writes": 0,
        "source_workbooks_modified": False,
        "bounds": {"start_row": start_row, "max_rows": max_rows, "manifest_limit": manifest_limit},
        "counts": dict(counts),
        "hold_reasons": dict(holds),
        "manifest": manifest,
        "duplicate_manifest": duplicates,
        "publication_status": "DRY_RUN_ONLY_REQUIRES_CANONICAL_QNSA_OVERLAP_AND_HUMAN_REVIEW",
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", action="append", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--max-rows", type=int, default=100_000)
    parser.add_argument("--start-row", type=int, default=0)
    parser.add_argument("--manifest-limit", type=int, default=100)
    args = parser.parse_args()
    if not 1 <= args.max_rows <= 1_000_000 or not 0 <= args.start_row <= 1_000_000 or not 0 <= args.manifest_limit <= 1000:
        raise SystemExit("bounds outside safe limits")
    report = audit([Path(value) for value in args.input], args.max_rows, args.manifest_limit, args.start_row)
    output = Path(args.output); output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"mode": report["mode"], **report["counts"], "database_writes": 0}))


if __name__ == "__main__":
    main()
