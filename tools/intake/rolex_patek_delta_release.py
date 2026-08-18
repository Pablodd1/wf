#!/usr/bin/env python3
"""Fail-closed Rolex/Patek reviewed-workbook delta audit and bounded release.

The workbook's CREATE_NEW label is never sufficient. Rows must pass immutable
raw brand/reference evidence, intent, post-baseline date, unique source-message,
duplicate exclusion, and exact image association. Audit is always read-only;
canary is capped at 10 missing rows; full requires a separate explicit gate.
"""

from __future__ import annotations

from collections import Counter
from datetime import datetime, timezone
from hashlib import sha256
import json
import os
from pathlib import Path
import re
import sys
from urllib.parse import quote
from urllib.request import Request, urlopen
import zipfile
import xml.etree.ElementTree as ET

NS = "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}"
CELL_REF = re.compile(r"([A-Z]+)")
PROJECT_REF = "qnsafosakvonzgfcsphh"
TIER = "QNSA_ROLEX_PATEK_REVIEWED_DELTA_V1"
STATUS = "APPROVED_SINGLE_CANDIDATE"
MULTI_OFFER_STATUS = "APPROVED_MULTI_PARENT_TRADING_FLOOR_ONLY"
MULTI_OFFER_SOURCE_LISTING_ID = "cf859a8b-d17f-42a7-9d6e-5eb2b81d76e2"
MULTI_OFFER_DELTA_ID = "rpdelta_1ac10392cca161ba85a042a2f3efd4ef79cda691ccca2422f8b3280eebbf5972"
EXPECTED_TRADING_FLOOR_COHORT = 813
EXPECTED_REVIEWED_SINGLES = 812
EXPECTED_STRUCTURED_MULTI_OFFER_PARENTS = 1
EXPECTED_PRICE_RESEARCH_MAX = 614
BASELINE = "2026-08-10 10:27:49"
EMPTY_SHA = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
BRANDS = {"Rolex", "Patek Philippe"}
FOREIGN = re.compile(r"(?i)\b(?:HKD|AED|EUR|GBP|JPY|CNY|RMB|SGD|CAD|AUD|CHF)\b|[€£¥]")
NAMED_USD = re.compile(r"(?i)(?:USD|USDT|US\s*\$)")
DOLLAR = re.compile(r"\$\s*[0-9]|[0-9]\s*\$")
K_AMOUNT = re.compile(r"(?i)(?<![A-Z0-9])(?:USD|USDT|US\s*\$|\$)?\s*[0-9]+(?:[.,][0-9]+)?\s*K\b")
ACCESSORY = re.compile(r"(?i)\b(?:wallet|gloves?|empty\s+box|watch\s+box|authentication\s+service|code\s+check)\b")
BAD_REF = re.compile(r"(?i)^(?:UNRESOLVED|ROLEX|PATEK|PATEKPHILIPPE|WATCH|UNKNOWN|N/?A|NONE)$")


def col_index(reference: str) -> int:
    out = 0
    for letter in CELL_REF.match(reference).group(1):
        out = out * 26 + ord(letter) - 64
    return out - 1


def cell_text(cell: ET.Element) -> str:
    inline = cell.find(f"{NS}is")
    if inline is not None:
        return "".join(node.text or "" for node in inline.iter(f"{NS}t"))
    value = cell.find(f"{NS}v")
    return value.text if value is not None and value.text is not None else ""


def sheet_rows(archive: zipfile.ZipFile, index: int):
    with archive.open(f"xl/worksheets/sheet{index}.xml") as stream:
        for _event, element in ET.iterparse(stream, events=("end",)):
            if element.tag != f"{NS}row":
                continue
            cells = {col_index(c.get("r", "A1")): cell_text(c) for c in element.findall(f"{NS}c")}
            if cells:
                yield [cells.get(position, "") for position in range(max(cells) + 1)]
            element.clear()


def file_sha(path: Path) -> str:
    digest = sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def norm_ref(value: str) -> str:
    return re.sub(r"[^A-Z0-9]", "", value.upper())


def brand_supported(brand: str, raw: str) -> bool:
    if brand == "Rolex":
        return bool(re.search(r"(?i)\bRolex\b", raw))
    return bool(re.search(r"(?i)\b(?:Patek(?:\s+Phil(?:ippe|lippe))?|PP)\b", raw))


def exact_ref_supported(reference: str, raw: str) -> bool:
    target = norm_ref(reference)
    return len(target) >= 4 and any(char.isdigit() for char in target) and target in norm_ref(raw)


def canonical_source_image_url(url: str) -> str:
    url = (url or "").strip()
    prefix = "https://thecollective-prod.nyc3.digitaloceanspaces.com/listings/"
    if url.startswith(prefix) and not url.startswith(prefix + "full/"):
        return prefix + "full/" + url[len(prefix):]
    return url


def price_policy(raw: str, workbook_price: str, intent: str):
    if intent == "WTB":
        return None, None, "WTB_PRICE_WITHHELD"
    try:
        value = float(workbook_price) if workbook_price else None
    except ValueError:
        value = None
    if not value or value <= 0:
        return None, None, "PRICE_NOT_SUPPLIED"
    if FOREIGN.search(raw):
        return None, None, "NAMED_FOREIGN_CURRENCY_REQUIRES_DATED_FX"
    if NAMED_USD.search(raw):
        return value, "USD", "SOURCE_EXPLICIT_USD_MATCH"
    if K_AMOUNT.search(raw):
        return value, "USD", "OWNER_K_USD_POLICY"
    if DOLLAR.search(raw):
        return value, "USD", "OWNER_DOLLAR_USD_POLICY"
    return None, None, "CURRENCY_AMBIGUOUS_OR_MISSING"


def deterministic_id(row: dict) -> str:
    signature = "|".join([
        row["source_payload_sha256"], row["source_record_id"], row["source_message_id"],
        row["brand"], norm_ref(row["reference"]), row["listing_type"],
    ])
    return "rpdelta_" + sha256(signature.encode()).hexdigest()


def extract(path: Path) -> dict:
    holds = Counter()
    candidates = []
    file_digest = file_sha(path)
    with zipfile.ZipFile(path) as archive:
        iterator = sheet_rows(archive, 1)
        headers = next(iterator)
        pos = {name: index for index, name in enumerate(headers)}
        message_counts = Counter()
        provisional = []

        def value(row, key):
            index = pos[key]
            return row[index].strip() if index < len(row) else ""

        for row_number, row in enumerate(iterator, start=2):
            message_id = value(row, "source_message_id")
            message_counts[message_id] += 1
            if value(row, "correction_action") != "CREATE_NEW":
                holds["NOT_CREATE_NEW"] += 1
                continue
            if value(row, "review_status") != "APPROVED":
                holds["NOT_APPROVED"] += 1
                continue
            if value(row, "posting_date") <= BASELINE:
                holds["AT_OR_BEFORE_BASELINE"] += 1
                continue
            raw, brand, reference = value(row, "raw_message"), value(row, "brand"), value(row, "reference")
            intent = value(row, "listing_type")
            if not raw or value(row, "source_payload_sha256") in {"", EMPTY_SHA}:
                holds["RAW_LINEAGE_MISSING"] += 1
                continue
            if brand not in BRANDS or not brand_supported(brand, raw):
                holds["BRAND_EVIDENCE_FAILED"] += 1
                continue
            if not reference or BAD_REF.fullmatch(reference) or not exact_ref_supported(reference, raw):
                holds["REFERENCE_EVIDENCE_FAILED"] += 1
                continue
            if ACCESSORY.search(raw) or intent not in {"WTS", "WTB"}:
                holds["WATCH_OR_INTENT_FAILED"] += 1
                continue
            price, currency, price_status = price_policy(raw, value(row, "normalized_price_usd"), intent)
            provisional.append({
                "source_row_number": row_number,
                "listing_id": value(row, "listing_id"),
                "source_record_id": value(row, "source_record_id") or value(row, "listing_id"),
                "source_message_id": message_id,
                "source_payload_sha256": value(row, "source_payload_sha256"),
                "posting_date": value(row, "posting_date"),
                "brand": brand, "model": value(row, "model"), "reference": reference,
                "dial": value(row, "dial_color"), "condition": value(row, "condition"),
                "listing_type": intent, "raw_message": raw,
                "price_usd": price, "source_currency": currency,
                "source_price_amount": value(row, "source_price_amount"),
                "price_status": price_status,
                "source_image_url": canonical_source_image_url(value(row, "source_image_url")),
            })
        for row in provisional:
            if not row["source_message_id"] or message_counts[row["source_message_id"]] != 1:
                holds["SOURCE_MESSAGE_NOT_SINGLE"] += 1
                continue
            row["id"] = deterministic_id(row)
            candidates.append(row)

        target_ids = {row["listing_id"] for row in candidates}
        duplicate_ids = set()
        for sheet_index in (5,):
            iterator = sheet_rows(archive, sheet_index)
            headers = next(iterator); p = {name: i for i, name in enumerate(headers)}
            for source in iterator:
                duplicate_id = source[p["duplicate_listing_id"]].strip() if p["duplicate_listing_id"] < len(source) else ""
                if duplicate_id in target_ids:
                    duplicate_ids.add(duplicate_id)
        if duplicate_ids:
            candidates = [row for row in candidates if row["listing_id"] not in duplicate_ids]
            holds["DUPLICATE_EXCLUDED"] += len(duplicate_ids)

        image_by_id = {}
        iterator = sheet_rows(archive, 4)
        headers = next(iterator); p = {name: i for i, name in enumerate(headers)}
        for source in iterator:
            listing_id = source[p["listing_id"]].strip() if p["listing_id"] < len(source) else ""
            if listing_id not in target_ids:
                continue
            image_by_id[listing_id] = {
                key: source[p[key]].strip() if p[key] < len(source) else ""
                for key in ("source_message_id", "image_url", "image_evidence_type", "association_status")
            }
        for row in candidates:
            image = image_by_id.get(row["listing_id"], {})
            exact = (image.get("source_message_id") == row["source_message_id"]
                     and canonical_source_image_url(image.get("image_url")) == row["source_image_url"]
                     and image.get("association_status") == "EXACT_LISTING_IMAGE")
            if not exact:
                row["source_image_url"] = ""
                row["image_status"] = "IMAGE_ASSOCIATION_UNVERIFIED"
            else:
                row["image_status"] = "EXACT_SOURCE_MESSAGE_IMAGE"

        linkage_by_id = {}
        iterator = sheet_rows(archive, 3)
        headers = next(iterator); p = {name: i for i, name in enumerate(headers)}
        for source in iterator:
            listing_id = source[p["listing_id"]].strip() if p["listing_id"] < len(source) else ""
            if listing_id not in target_ids:
                continue
            linkage_by_id[listing_id] = {
                key: source[p[key]].strip() if p[key] < len(source) else ""
                for key in ("source_platform", "source_group_id", "source_message_id")
            }
        for row in candidates:
            linkage = linkage_by_id.get(row["listing_id"], {})
            if linkage.get("source_message_id") != row["source_message_id"]:
                row["lineage_status"] = "LINKAGE_MESSAGE_MISMATCH"
            else:
                row["lineage_status"] = "RAW_LINEAGE_VERIFIED"
                row["source_platform"] = linkage.get("source_platform") or None
                row["source_group_id"] = linkage.get("source_group_id") or None

    return {"path": path, "sha256": file_digest, "rows": candidates, "holds": holds}


def load_env(path: Path) -> dict:
    values = {}
    for line in path.read_text(encoding="utf-8").splitlines():
        match = re.match(r"^([^#=\s]+)=(.*)$", line)
        if match:
            values[match.group(1)] = match.group(2).strip().strip("\"'")
    return values


def api_get(base: str, key: str, resource: str, params: str, profile: str | None = None):
    headers = {"apikey": key, "Authorization": f"Bearer {key}"}
    if profile:
        headers["Accept-Profile"] = profile
    request = Request(f"{base}/rest/v1/{resource}?{params}", headers=headers)
    with urlopen(request, timeout=60) as response:
        return json.loads(response.read())


def api_post(base: str, key: str, resource: str, rows: list[dict], conflict="id", ignore=True):
    request = Request(
        f"{base}/rest/v1/{resource}?on_conflict={conflict}",
        data=json.dumps(rows).encode(), method="POST",
        headers={
            "apikey": key, "Authorization": f"Bearer {key}", "Content-Type": "application/json",
            "Prefer": f"resolution={'ignore' if ignore else 'merge'}-duplicates,return=representation", "Content-Profile": "public",
        },
    )
    with urlopen(request, timeout=90) as response:
        return json.loads(response.read() or b"[]")


def api_rpc(base: str, key: str, function: str, payload: dict):
    request = Request(
        f"{base}/rest/v1/rpc/{function}", data=json.dumps(payload).encode(), method="POST",
        headers={"apikey": key, "Authorization": f"Bearer {key}", "Content-Type": "application/json", "Content-Profile": "public"},
    )
    with urlopen(request, timeout=90) as response:
        return json.loads(response.read() or b"null")


def chunks(values, size=75):
    values = list(values)
    for start in range(0, len(values), size):
        yield values[start:start + size]


def exact_live_reconciliation(rows: list[dict], env: dict) -> dict:
    base, key = env.get("SUPABASE_URL", ""), env.get("SUPABASE_SERVICE_ROLE_KEY", "")
    if not base or not key or base.split("//")[-1].split(".")[0] != PROJECT_REF:
        raise RuntimeError("canonical QNSA service environment unavailable")
    staging_ids, reviewed_source_ids, reviewed_delta_ids = set(), set(), set()
    reviewed_message_ids, reviewed_payloads = set(), set()
    for start in range(0, len(rows), 75):
        batch = rows[start:start + 75]
        overlap = api_rpc(base, key, "qnsa_rolex_patek_delta_overlap", {
            "p_listing_ids": [row["listing_id"] for row in batch],
            "p_lineage": [{
                "source_platform": row["source_platform"],
                "source_group_id": row["source_group_id"],
                "source_message_id": row["source_message_id"],
                "payload_checksum": row["source_payload_sha256"],
            } for row in batch],
        }) or {}
        staging_ids.update(overlap.get("listing_ids") or [])
        reviewed_message_ids.update(overlap.get("source_message_ids") or [])
        reviewed_payloads.update(overlap.get("payload_checksums") or [])
    for batch in chunks([row["source_record_id"] for row in rows]):
        values = ",".join(batch)
        for found in api_get(base, key, "reviewed_workbook_inventory", "select=id,source_record_id&source_record_id=in.(" + quote(values, safe=",-") + ")"):
            reviewed_source_ids.add(found.get("source_record_id"))
    for batch in chunks([row["id"] for row in rows]):
        values = ",".join(batch)
        for found in api_get(base, key, "reviewed_workbook_inventory", "select=id&id=in.(" + quote(values, safe=",_-") + ")"):
            reviewed_delta_ids.add(found["id"])
    for field, target in (("source_message_id", reviewed_message_ids), ("source_payload_sha256", reviewed_payloads)):
        for batch in chunks([row[field] for row in rows]):
            values = ",".join(batch)
            for found in api_get(base, key, "reviewed_workbook_inventory", f"select={field}&{field}=in.(" + quote(values, safe=",_:-") + ")"):
                target.add(found.get(field))
    safe = [row for row in rows if row["listing_id"] not in staging_ids
            and row["source_record_id"] not in reviewed_source_ids and row["id"] not in reviewed_delta_ids
            and row["source_message_id"] not in reviewed_message_ids
            and row["source_payload_sha256"] not in reviewed_payloads
            and row.get("lineage_status") == "RAW_LINEAGE_VERIFIED"]
    return {
        "staging_exact_id_present": len(staging_ids),
        "reviewed_source_record_present": len(reviewed_source_ids),
        "reviewed_delta_id_present": len(reviewed_delta_ids),
        "reviewed_source_message_present": len(reviewed_message_ids),
        "reviewed_payload_present": len(reviewed_payloads),
        "safe_missing": safe,
    }


def classify_structured_multi_offer_parent(rows: list[dict]) -> list[dict]:
    """Fail closed around the one reviewed source that contains two offers.

    The source remains one immutable parent. We do not invent child/image
    associations and do not select either asking price as the parent's price.
    """
    matches = [row for row in rows if row["listing_id"] == MULTI_OFFER_SOURCE_LISTING_ID]
    if len(matches) != 1:
        raise RuntimeError(f"expected exactly one structured multi-offer parent, found {len(matches)}")
    row = matches[0]
    if row["id"] != MULTI_OFFER_DELTA_ID:
        raise RuntimeError("structured multi-offer parent deterministic id drifted")
    offers = re.findall(r"(?i)\$\s*[0-9][0-9,]*(?:\.[0-9]+)?\s*(?:USD|USDT)\b", row["raw_message"])
    if len(offers) != 2:
        raise RuntimeError(f"structured multi-offer parent must retain exactly two raw offers, found {len(offers)}")
    row.update({
        "record_kind": "STRUCTURED_MULTI_OFFER_PARENT",
        "offer_count": 2,
        "listing_type": "MULTI",
        "model": "", "reference": "", "dial": "", "condition": "",
        "price_usd": None, "source_currency": None, "source_price_amount": "",
        "price_status": "MULTI_PARENT_PRICE_WITHHELD",
        "source_image_url": "", "image_status": "MULTI_OFFER_PARENT_IMAGE_WITHHELD",
    })
    return rows


def validate_expected_cohort(rows: list[dict]) -> dict:
    counts = {
        "trading_floor": len(rows),
        "reviewed_singles": sum(r.get("record_kind") != "STRUCTURED_MULTI_OFFER_PARENT" for r in rows),
        "structured_multi_offer_parents": sum(r.get("record_kind") == "STRUCTURED_MULTI_OFFER_PARENT" for r in rows),
        "price_research_max": sum(
            r.get("record_kind") != "STRUCTURED_MULTI_OFFER_PARENT"
            and r["listing_type"] == "WTS"
            and r["price_status"] in {"SOURCE_EXPLICIT_USD_MATCH", "OWNER_DOLLAR_USD_POLICY", "OWNER_K_USD_POLICY"}
            for r in rows
        ),
    }
    expected = {
        "trading_floor": EXPECTED_TRADING_FLOOR_COHORT,
        "reviewed_singles": EXPECTED_REVIEWED_SINGLES,
        "structured_multi_offer_parents": EXPECTED_STRUCTURED_MULTI_OFFER_PARENTS,
        "price_research_max": EXPECTED_PRICE_RESEARCH_MAX,
    }
    if counts != expected:
        raise RuntimeError(f"reviewed cohort count drift: expected {expected}, found {counts}")
    return counts


def source_supported(value: str, raw: str) -> bool:
    target = re.sub(r"[^A-Z0-9]", "", (value or "").upper())
    return bool(target) and target in re.sub(r"[^A-Z0-9]", "", raw.upper())


def inventory_row(row: dict, package: dict, run_key: str) -> dict:
    reasons = ["RAW_LINEAGE_VERIFIED", row["image_status"], row["price_status"]]
    model = row["model"] if source_supported(row["model"], row["raw_message"]) else None
    dial = row["dial"] if source_supported(row["dial"], row["raw_message"]) else None
    condition = row["condition"] if source_supported(row["condition"], row["raw_message"]) else None
    if not model: reasons.append("MODEL_UNVERIFIED")
    if not dial: reasons.append("DIAL_UNVERIFIED")
    if not condition: reasons.append("CONDITION_UNVERIFIED")
    content = sha256((row["id"] + "|" + row["source_payload_sha256"]).encode()).hexdigest()
    image = row["source_image_url"] or None
    is_multi_offer_parent = row.get("record_kind") == "STRUCTURED_MULTI_OFFER_PARENT"
    if is_multi_offer_parent:
        reasons.extend(["STRUCTURED_MULTI_OFFER_PARENT", "TWO_RAW_OFFERS_RETAINED", "MULTI_PARENT_TRADING_FLOOR_ONLY", "PRICE_RESEARCH_EXCLUDED", "UNASSIGNED_MEDIA_WITHHELD"])
    return {
        "id": row["id"], "content_hash": content, "import_run_id": run_key,
        "source_file": package["path"].name, "source_file_sha256": package["sha256"],
        "source_worksheet": "LISTING_CORRECTIONS", "source_row_number": row["source_row_number"],
        "source_record_id": row["source_record_id"], "source_payload_sha256": row["source_payload_sha256"],
        "source_platform": row.get("source_platform"), "source_group_id": row.get("source_group_id"),
        "source_message_id": row["source_message_id"], "posting_date": row["posting_date"].replace(" ", "T") + "Z",
        "posted_by": None, "phone_number": None, "raw_message": row["raw_message"],
        "listing_type": row["listing_type"], "brand_scope": row["brand"], "supplied_brand": row["brand"],
        "canonical_brand": row["brand"], "model": model, "raw_reference": row["reference"] or None,
        "normalized_reference": row["reference"] or None, "catalog_reference": None, "catalog_model": None,
        "dial_color": dial, "catalog_dial": None, "condition": condition,
        "workbook_price_usd": row["price_usd"], "source_price_amount": row["price_usd"],
        "source_price_text": row["source_price_amount"] or None, "source_currency": row["source_currency"],
        "price_evidence_status": row["price_status"], "verification_tier": TIER,
        "confidence": 100, "verification_status": MULTI_OFFER_STATUS if is_multi_offer_parent else STATUS,
        "user_image_url": image, "catalog_image_url": None, "final_image_url": image,
        "display_image_url": image, "image_evidence_type": "SELLER_LISTING_IMAGE" if image else None,
        "review_reasons": sorted(set(reasons)), "contact_publication_approved": False,
        "contact_publication_basis": None,
    }


def select_canary(rows: list[dict]) -> list[dict]:
    ordered = sorted(rows, key=lambda row: row["id"])
    def labels(row):
        return {
            f"BRAND:{row['brand']}", f"INTENT:{row['listing_type']}", f"PRICE:{row['price_status']}",
            "IMAGE:EXACT" if row.get("source_image_url") else "IMAGE:NULL",
            "MODEL:VERIFIED" if source_supported(row.get("model", ""), row["raw_message"]) else "MODEL:NULL",
            "DIAL:VERIFIED" if source_supported(row.get("dial", ""), row["raw_message"]) else "DIAL:NULL",
            "CONDITION:VERIFIED" if source_supported(row.get("condition", ""), row["raw_message"]) else "CONDITION:NULL",
            "STRUCTURE:MULTI_OFFER_PARENT" if row.get("record_kind") == "STRUCTURED_MULTI_OFFER_PARENT" else "STRUCTURE:SINGLE",
        }
    available = set().union(*(labels(row) for row in ordered)) if ordered else set()
    required = {label for label in available if label.startswith(("BRAND:", "INTENT:", "PRICE:", "IMAGE:", "MODEL:", "DIAL:", "CONDITION:", "STRUCTURE:"))}
    # The canary must exercise the exceptional parent contract, not only the
    # dominant single-listing path.
    selected = [row for row in ordered if row.get("record_kind") == "STRUCTURED_MULTI_OFFER_PARENT"]
    if len(selected) > 1:
        raise RuntimeError("canary found multiple structured multi-offer parents")
    covered = set().union(*(labels(row) for row in selected)) if selected else set()
    while len(selected) < 10 and required - covered:
        remaining = [row for row in ordered if row not in selected]
        found = max(remaining, key=lambda row: (len(labels(row) & (required - covered)), -ordered.index(row)))
        if not (labels(found) & (required - covered)): break
        selected.append(found); covered |= labels(found)
    for row in ordered:
        if len(selected) == 10: break
        if row not in selected: selected.append(row)
    return selected


def readback(base: str, key: str, expected: list[dict]) -> dict:
    actual = {}
    columns = "id,content_hash,import_run_id,source_file,source_file_sha256,source_worksheet,source_row_number,source_payload_sha256,source_record_id,source_message_id,posting_date,raw_message,listing_type,brand_scope,model,normalized_reference,dial_color,condition,workbook_price_usd,source_currency,price_evidence_status,verification_tier,confidence,verification_status,user_image_url,final_image_url,display_image_url,image_evidence_type,review_reasons,phone_number,contact_publication_approved"
    for batch in chunks([row["id"] for row in expected]):
        values = ",".join(batch)
        for found in api_get(base, key, "reviewed_workbook_inventory", f"select={columns}&id=in.(" + quote(values, safe=",_-") + ")"):
            actual[found["id"]] = found
    drift, exact = Counter(), 0
    fields = columns.split(",")
    for row in expected:
        found = actual.get(row["id"])
        if not found:
            drift["missing"] += 1; continue
        changed = False
        for field in fields:
            left, right = found.get(field), row.get(field)
            if field == "posting_date" and left and right:
                left = str(left).replace("+00:00", "Z")
            if field == "workbook_price_usd" and left is not None and right is not None:
                left, right = float(left), float(right)
            if left != right:
                drift[field] += 1; changed = True
        if not changed: exact += 1
    return {"expected": len(expected), "found": len(actual), "exact": exact, "drift": dict(drift), "ok": exact == len(expected)}


def main(argv):
    inputs, env_file, output, rollback_output, mode, run_key = [], None, None, None, "audit", None
    index = 0
    while index < len(argv):
        if argv[index] == "--input": inputs.append(Path(argv[index + 1])); index += 2
        elif argv[index] == "--env-file": env_file = Path(argv[index + 1]); index += 2
        elif argv[index] == "--output": output = Path(argv[index + 1]); index += 2
        elif argv[index] == "--mode": mode = argv[index + 1]; index += 2
        elif argv[index] == "--rollback-output": rollback_output = Path(argv[index + 1]); index += 2
        elif argv[index] == "--run-key": run_key = argv[index + 1]; index += 2
        else: raise RuntimeError(f"unsupported argument {argv[index]}")
    if len(inputs) != 2 or not env_file or not output or mode not in {"audit", "canary", "full"}:
        raise RuntimeError("two --input values, --env-file, and --output are required")
    packages = [extract(path) for path in inputs]
    rows = [row for package in packages for row in package["rows"]]
    classify_structured_multi_offer_parent(rows)
    cohort = validate_expected_cohort(rows)
    live = exact_live_reconciliation(rows, load_env(env_file))
    safe = live.pop("safe_missing")
    env = load_env(env_file); base, key = env["SUPABASE_URL"], env["SUPABASE_SERVICE_ROLE_KEY"]
    package_by_file = {p["path"].name: p for p in packages}
    source_package = {row["id"]: next(p for p in packages if row in p["rows"]) for row in rows}
    planned_canary = select_canary(safe)
    selected = []
    if mode == "canary":
        if os.environ.get("APPLY_QNSA_ROLEX_PATEK_DELTA") != "true" or os.environ.get("CANARY_QNSA_ROLEX_PATEK_DELTA_CONFIRMATION") != "CANARY_QNSA_ROLEX_PATEK_DELTA":
            raise RuntimeError("canary release confirmation missing")
        selected = planned_canary
        if len(selected) > 10: raise RuntimeError("canary exceeds 10")
    elif mode == "full":
        if os.environ.get("APPLY_QNSA_ROLEX_PATEK_DELTA") != "true" or os.environ.get("FULL_QNSA_ROLEX_PATEK_DELTA_CONFIRMATION") != "FULL_QNSA_ROLEX_PATEK_DELTA":
            raise RuntimeError("full release confirmation missing")
        selected = safe
    if mode != "audit" and (not run_key or not re.fullmatch(r"rpdelta_(?:canary|full)_[A-Za-z0-9._-]{1,80}", run_key)):
        raise RuntimeError("write modes require a bounded --run-key")
    inventory = [inventory_row(row, source_package[row["id"]], run_key or "read_only_audit") for row in selected]
    if mode != "audit" and not rollback_output:
        raise RuntimeError("--rollback-output is required for write modes")
    written = 0; verification = {"expected": 0, "found": 0, "exact": 0, "drift": {}, "ok": True}
    inserted_ids = []
    if mode != "audit" and inventory:
        ledger = {
            "run_key": run_key, "release_mode": mode.upper(), "release_tier": TIER, "status": "RUNNING",
            "workbook_sha256": {p["path"].name: p["sha256"] for p in packages},
            # Register the complete exact rollback set before the first insert;
            # rollback is tier/run constrained, so non-inserted IDs are harmless.
            "inserted_ids": [row["id"] for row in inventory],
            "inserted_content_hashes": [row["content_hash"] for row in inventory],
            "audit_summary": {"source_candidates": len(rows), "safe_missing": len(safe), "selected": len(selected)},
            "updated_at": datetime.now(timezone.utc).isoformat(),
        }
        api_post(base, key, "reviewed_workbook_delta_release_runs", [ledger], "run_key", False)
        try:
            for batch in chunks(inventory, 100):
                inserted = api_post(base, key, "reviewed_workbook_inventory", batch)
                inserted_ids.extend(row["id"] for row in inserted); written += len(inserted)
            verification = readback(base, key, inventory)
            if not verification["ok"]: raise RuntimeError("exact readback failed")
            ledger["status"] = "APPLIED"; ledger["updated_at"] = datetime.now(timezone.utc).isoformat()
            api_post(base, key, "reviewed_workbook_delta_release_runs", [ledger], "run_key", False)
        except Exception:
            api_rpc(base, key, "rollback_qnsa_rolex_patek_delta", {"p_run_key": run_key, "p_ids": inserted_ids})
            raise
    if mode != "audit":
        rollback_output.parent.mkdir(parents=True, exist_ok=True)
        rollback_output.write_text(json.dumps({
            "project_ref": PROJECT_REF, "table": "reviewed_workbook_inventory",
            "inserted_ids": inserted_ids,
            "inserted_content_hashes": [row["content_hash"] for row in inventory if row["id"] in set(inserted_ids)],
        }, indent=2) + "\n", encoding="utf-8")
    report = {
        "mode": {"audit":"READ_ONLY_QNSA_EXACT_DELTA_AUDIT","canary":"BOUNDED_10_ROW_CANARY","full":"RESUMABLE_FULL"}[mode], "project_ref": PROJECT_REF,
        "tier": TIER, "status": STATUS, "source_rows": len(rows),
        "cohort_trading_floor_total": cohort["trading_floor"],
        "cohort_reviewed_singles": cohort["reviewed_singles"],
        "cohort_structured_multi_offer_parents": cohort["structured_multi_offer_parents"],
        "cohort_price_research_max": cohort["price_research_max"],
        "cohort_exact_image_associations": sum(r["image_status"] == "EXACT_SOURCE_MESSAGE_IMAGE" and bool(r["source_image_url"]) for r in rows),
        "image_reachability_semantics": "EXACT_ASSOCIATION_ONLY_NOT_NETWORK_PROBED",
        "safe_missing": len(safe),
        "safe_by_brand_intent": dict(Counter(f"{r['brand']}|{r['listing_type']}" for r in safe)),
        "safe_with_exact_image": sum(bool(r["source_image_url"]) for r in safe),
        "safe_price_research": sum(r.get("record_kind") != "STRUCTURED_MULTI_OFFER_PARENT" and r["listing_type"] == "WTS" and r["price_status"] in {"SOURCE_EXPLICIT_USD_MATCH","OWNER_DOLLAR_USD_POLICY","OWNER_K_USD_POLICY"} for r in safe),
        "reconciliation": live,
        "workbooks": [{"file": p["path"].name, "sha256": p["sha256"], "candidates": len(p["rows"]), "holds": dict(p["holds"])} for p in packages],
        "canary_ids_sha256": [sha256(r["id"].encode()).hexdigest() for r in planned_canary],
        "canary_coverage": sorted(set().union(*({
            f"BRAND:{r['brand']}", f"INTENT:{r['listing_type']}", f"PRICE:{r['price_status']}",
            "IMAGE:EXACT" if r.get("source_image_url") else "IMAGE:NULL",
        } for r in planned_canary))) if planned_canary else [],
        "rows_selected": len(selected), "database_writes": written, "exact_readback": verification,
        "rollback_manifest_written": bool(mode != "audit" and rollback_output),
    }
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({key: report[key] for key in ("mode", "source_rows", "cohort_trading_floor_total", "cohort_reviewed_singles", "cohort_structured_multi_offer_parents", "cohort_price_research_max", "safe_missing", "safe_with_exact_image", "safe_price_research", "database_writes")}))


if __name__ == "__main__":
    try:
        main(sys.argv[1:])
    except Exception as error:
        print(json.dumps({"status": "error", "error": str(error)}), file=sys.stderr)
        raise
