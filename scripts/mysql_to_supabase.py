#!/usr/bin/env python3
"""
mysql_to_supabase.py
Pull fresh listings from production MySQL (READ ONLY) and upsert into Supabase watch_records.
Sources:
  1. thecollective_inventory.auction_watches JOIN auctions (price) -> source='mysql_auction_watches'
  2. thecollective_inventory.market_references WHERE type='sale'   -> source='mysql_market_refs'
Uses Prefer: resolution=ignore-duplicates so existing rows are silently skipped.
"""

import json
import os
import time
import urllib.request
import urllib.error
from decimal import Decimal

import pymysql

# ── Config ──────────────────────────────────────────────────────────────────
MYSQL_HOST = os.environ.get("MYSQL_HOST", "161.35.0.209")
MYSQL_PORT = int(os.environ.get("MYSQL_PORT", "3306"))
MYSQL_USER = os.environ.get("MYSQL_USER", "john")
MYSQL_PASS = os.environ.get("MYSQL_PASS", "")  # Set MYSQL_PASS env var before running

SUPABASE_URL = os.environ.get("SUPABASE_URL", "https://bptrvfncppbjnchsaxtb.supabase.co")
# REQUIRED: export SUPABASE_KEY=<your-service-role-key> before running
SUPABASE_KEY = os.environ.get("SUPABASE_KEY", "")

TABLE = "watch_records"
BATCH_SIZE = 500
PRINT_EVERY = 10  # batches
SKIP_BATCHES = 670  # fast-forward past already-inserted auction_watches batches


# ── Helpers ──────────────────────────────────────────────────────────────────
def clean_str(val):
    """Strip null bytes and non-printable control chars that PostgreSQL rejects."""
    if val is None:
        return None
    if not isinstance(val, str):
        return val
    # Remove null bytes and other control chars except tab/newline
    return val.replace("\x00", "").replace("\u0000", "")


def clean_record(rec: dict) -> dict:
    """Apply clean_str to all string values in a record."""
    return {k: clean_str(v) if isinstance(v, str) else v for k, v in rec.items()}


def supabase_upsert(records: list[dict]) -> int:
    """POST a batch to Supabase with ignore-duplicates semantics.
    Returns the number of rows actually inserted (new rows only)."""
    if not records:
        return 0

    url = f"{SUPABASE_URL}/rest/v1/{TABLE}"
    records = [clean_record(r) for r in records]
    body = json.dumps(records, default=str).encode("utf-8")
    headers = {
        "apikey": SUPABASE_KEY,
        "Authorization": f"Bearer {SUPABASE_KEY}",
        "Content-Type": "application/json",
        "Prefer": "return=minimal,resolution=ignore-duplicates",
    }
    req = urllib.request.Request(url, data=body, headers=headers, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            # 200/201 → success; with return=minimal body is empty
            return len(records)
    except urllib.error.HTTPError as e:
        body_err = e.read().decode("utf-8", errors="replace")
        print(f"  [WARN] Supabase HTTP {e.code}: {body_err[:200]} — skipping batch")
        return 0  # non-fatal: skip this batch and continue


def to_float(val):
    if val is None:
        return None
    try:
        return float(val)
    except (TypeError, ValueError):
        return None


# ── Part 1 – auction_watches ─────────────────────────────────────────────────
def sync_auction_watches(conn):
    print("\n═══ Part 1: auction_watches → watch_records ═══")
    cur = conn.cursor()

    query = """
        SELECT
            aw.id,
            aw.brand,
            aw.reference,
            aw.dial_color,
            aw.year,
            aw.title,
            aw.condition_id,
            a.price
        FROM thecollective_inventory.auction_watches aw
        LEFT JOIN thecollective_inventory.auctions_listings al
            ON al.listing_id = aw.id
        LEFT JOIN thecollective_inventory.auctions a
            ON a.id = al.auction_id
        ORDER BY aw.id
    """
    cur.execute(query)

    total_fetched = 0
    total_inserted = 0
    batch_num = 0

    # Fast-forward past already-processed batches (ignore-duplicates handles them,
    # but skipping saves ~670 wasted Supabase round-trips)
    if SKIP_BATCHES > 0:
        print(f"  Fast-forwarding {SKIP_BATCHES} batches ({SKIP_BATCHES * BATCH_SIZE:,} rows)...")
        for _ in range(SKIP_BATCHES):
            skip_rows = cur.fetchmany(BATCH_SIZE)
            if not skip_rows:
                print("  Nothing left after skip — already fully synced")
                cur.close()
                return 0
            batch_num += 1
            total_fetched += len(skip_rows)
        print(f"  Resumed at batch {batch_num + 1}, row {total_fetched:,}")

    while True:
        rows = cur.fetchmany(BATCH_SIZE)
        if not rows:
            break

        batch_num += 1
        total_fetched += len(rows)

        records = []
        for row in rows:
            (
                rec_id,
                brand,
                reference,
                dial_color,
                year,
                title,
                condition_id,
                price,
            ) = row
            records.append(
                {
                    "id": rec_id,
                    "brand": brand,
                    "reference": reference,
                    "dial_color": dial_color,
                    "year": year,
                    "condition": "New" if condition_id == 1 else "Used",
                    "price_raw": to_float(price),
                    "price_usd": to_float(price),
                    "currency": "USD",
                    "confidence": 0,
                    "verdict": "HUMAN",
                    "source": "mysql_auction_watches",
                    "raw_message": title,
                    "flags": {},
                }
            )

        inserted = supabase_upsert(records)
        total_inserted += inserted

        if batch_num % PRINT_EVERY == 0:
            print(
                f"  [auction_watches] batch {batch_num:>5} | "
                f"fetched so far: {total_fetched:>8,} | "
                f"sent batches: {batch_num:>5}"
            )

    cur.close()
    print(
        f"  ✓ auction_watches done — rows fetched: {total_fetched:,} | "
        f"batches sent: {batch_num:,}"
    )
    return total_fetched


# ── Part 2 – market_references ───────────────────────────────────────────────
def sync_market_references(conn):
    print("\n═══ Part 2: market_references (type=sale) → watch_records ═══")
    cur = conn.cursor()

    query = """
        SELECT
            id,
            reference,
            normalized_reference,
            price,
            `condition`,
            dial_color,
            country,
            region,
            box,
            papers,
            dealer_name
        FROM thecollective_inventory.market_references
        WHERE type = 'sale'
        ORDER BY id
    """
    cur.execute(query)

    total_fetched = 0
    total_inserted = 0
    batch_num = 0

    while True:
        rows = cur.fetchmany(BATCH_SIZE)
        if not rows:
            break

        batch_num += 1
        total_fetched += len(rows)

        records = []
        for row in rows:
            (
                rec_id,
                reference,
                normalized_reference,
                price,
                condition,
                dial_color,
                country,
                region,
                box,
                papers,
                dealer_name,
            ) = row

            # Build a descriptive raw_message from available fields
            parts = []
            if normalized_reference:
                parts.append(f"ref:{normalized_reference}")
            elif reference:
                parts.append(f"ref:{reference}")
            if condition:
                parts.append(f"cond:{condition}")
            if dial_color:
                parts.append(f"dial:{dial_color}")
            if box:
                parts.append(f"box:{box}")
            if papers:
                parts.append(f"papers:{papers}")
            if country:
                parts.append(f"country:{country}")
            if region:
                parts.append(f"region:{region}")
            if dealer_name:
                parts.append(f"dealer:{dealer_name}")
            if price is not None:
                parts.append(f"price:{price}")
            raw_message = " | ".join(parts) if parts else None

            records.append(
                {
                    "id": f"mr_{rec_id}",
                    "brand": None,
                    "reference": normalized_reference or reference,
                    "dial_color": dial_color,
                    "year": None,
                    "condition": condition,
                    "price_raw": to_float(price),
                    "price_usd": to_float(price),
                    "currency": "USD",
                    "confidence": 0,
                    "verdict": "HUMAN",
                    "source": "mysql_market_refs",
                    "raw_message": raw_message,
                    "flags": {},
                }
            )

        inserted = supabase_upsert(records)
        total_inserted += inserted

        if batch_num % PRINT_EVERY == 0:
            print(
                f"  [market_refs] batch {batch_num:>5} | "
                f"fetched so far: {total_fetched:>8,} | "
                f"sent batches: {batch_num:>5}"
            )

    cur.close()
    print(
        f"  ✓ market_references done — rows fetched: {total_fetched:,} | "
        f"batches sent: {batch_num:,}"
    )
    return total_fetched


# ── Main ─────────────────────────────────────────────────────────────────────
def main():
    print("Connecting to MySQL (READ ONLY)…")
    conn = pymysql.connect(
        host=MYSQL_HOST,
        port=MYSQL_PORT,
        user=MYSQL_USER,
        password=MYSQL_PASS,
        connect_timeout=30,
        read_timeout=300,
        write_timeout=300,
        # Ensure we are in a read-only session
        init_command="SET SESSION TRANSACTION READ ONLY",
        cursorclass=pymysql.cursors.SSCursor,
    )
    print("  Connected.")

    t0 = time.time()
    try:
        aw_total = sync_auction_watches(conn)
        mr_total = sync_market_references(conn)
    finally:
        conn.close()

    elapsed = time.time() - t0
    print("\n" + "═" * 55)
    print("  FINAL SUMMARY")
    print("═" * 55)
    print(f"  auction_watches rows fetched : {aw_total:>10,}")
    print(f"  market_references rows fetched: {mr_total:>10,}")
    print(f"  Total rows processed         : {aw_total + mr_total:>10,}")
    print(f"  Elapsed time                 : {elapsed:>10.1f}s")
    print(
        "\n  Note: Supabase upsert with 'ignore-duplicates' means existing rows"
        "\n  are silently skipped — only genuinely new IDs were inserted."
    )
    print("═" * 55)


if __name__ == "__main__":
    main()
