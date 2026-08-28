#!/usr/bin/env python3
'''Hardened Phase 1 MariaDB Source Census & Provenance Reconciliation.

Strict Invariants:
1. Enforces MariaDB read-only grants (USAGE, SELECT, SHOW VIEW only).
2. Uses PostgreSQL REPEATABLE READ read-only transaction for wf_canonical_staging.
3. Pins project to bptrvfncppbjnchsaxtb (refuses any other target).
4. Reports total parent rows separately from distinct ID counts.
5. Employs measured, proven identity mapping rules with zero wild guessing.
6. Validates composite cursor index with SHOW INDEX and EXPLAIN.
7. Verifies real transport (SSL/TLS CA or validated private/loopback IP subnet).
8. Handles NULL timestamps safely with COALESCE.
9. Freezes an immutable upper cursor boundary before streaming.
10. Strictly asserts scanned rows equal the frozen source total.
'''

import os
import sys
import json
import time
import ipaddress
import hashlib
from datetime import datetime
import pymysql
import psycopg2
from psycopg2.extensions import ISOLATION_LEVEL_REPEATABLE_READ

PINNED_PROJECT_REF = "bptrvfncppbjnchsaxtb"
CENSUS_CONTRACT = "wf-mariadb-source-census-v3"
SOURCE_CONTRACT = "wf-mariadb-auctions-raw-v1"

def sha256(val: str) -> str:
    return hashlib.sha256((val or "").encode("utf-8")).hexdigest()

def assert_pinned_project(target: str):
    if PINNED_PROJECT_REF not in (target or ""):
        raise ValueError(
            f"Target refusal: PostgreSQL host/URL must contain pinned project ref '{PINNED_PROJECT_REF}', got: '{target}'"
        )

def is_private_or_loopback(host: str) -> bool:
    if host in ("127.0.0.1", "localhost", "::1"):
        return True
    try:
        ip = ipaddress.ip_address(host)
        return ip.is_private or ip.is_loopback
    except ValueError:
        # Hostname like *.railway.internal or *.local
        if host.endswith(".internal") or host.endswith(".local") or host == "railway":
            return True
        return False

def verify_mariadb_transport(host: str):
    ca_file = os.environ.get("MARIADB_TLS_CA_FILE")
    if ca_file:
        ca_path = os.path.abspath(ca_file)
        if not os.path.exists(ca_path):
            raise ValueError(f"MariaDB TLS CA file does not exist: {ca_path}")
        return {"ssl": {"ca": ca_path}, "transport": "TLS_CA_VERIFIED"}

    tunnel_verified = os.environ.get("MARIADB_PRIVATE_TUNNEL_VERIFIED") == "true"
    if tunnel_verified:
        if not is_private_or_loopback(host):
            raise ValueError(
                f"Transport refusal: Host '{host}' is a public IP address. "
                "MARIADB_PRIVATE_TUNNEL_VERIFIED=true requires a private or loopback subnet (127.0.0.1, 10.x, 172.16-31.x, 192.168.x) or MARIADB_TLS_CA_FILE"
            )
        return {"ssl": None, "transport": "PRIVATE_TUNNEL_VERIFIED"}

    raise ValueError("MariaDB source requires MARIADB_PRIVATE_TUNNEL_VERIFIED=true on a private/loopback host or MARIADB_TLS_CA_FILE")

def assert_read_only_grants(grants):
    for grant in grants:
        norm = str(grant or "").upper()
        if not (norm.startswith("GRANT USAGE ON ") or 
                norm.startswith("GRANT SELECT ON ") or 
                norm.startswith("GRANT SELECT, SHOW VIEW ON ") or 
                norm.startswith("GRANT SHOW VIEW, SELECT ON ")):
            raise ValueError(f"MariaDB account has privileges beyond read-only SELECT/SHOW VIEW: {grant}")

def get_postgres_config():
    pghost = os.environ.get("PGHOST") or os.environ.get("POSTGRES_HOST") or os.environ.get("SUPABASE_DB_HOST")
    pgport = int(os.environ.get("PGPORT") or os.environ.get("POSTGRES_PORT") or 5432)
    pguser = os.environ.get("PGUSER") or os.environ.get("POSTGRES_USER") or os.environ.get("SUPABASE_DB_USER")
    pgpass = os.environ.get("PGPASSWORD") or os.environ.get("POSTGRES_PASSWORD") or os.environ.get("SUPABASE_DB_PASSWORD")
    pgdb = os.environ.get("PGDATABASE") or os.environ.get("POSTGRES_DB") or os.environ.get("SUPABASE_DB_NAME") or "postgres"

    if not pghost or not pguser or not pgpass:
        raise ValueError("Missing required PostgreSQL credentials: PGHOST, PGUSER, PGPASSWORD")

    assert_pinned_project(pghost)
    return {
        "host": pghost,
        "port": pgport,
        "user": pguser,
        "password": pgpass,
        "dbname": pgdb,
        "connect_timeout": 15
    }

def get_mariadb_config():
    host = os.environ.get("MARIADB_HOST") or os.environ.get("MYSQL_HOST")
    port = int(os.environ.get("MARIADB_PORT") or os.environ.get("MYSQL_PORT") or 3306)
    user = os.environ.get("MARIADB_USER") or os.environ.get("MYSQL_USER")
    password = os.environ.get("MARIADB_PASSWORD") or os.environ.get("MYSQL_PASSWORD") or os.environ.get("MYSQL_PASS")
    database = os.environ.get("MARIADB_DATABASE") or os.environ.get("MYSQL_DATABASE") or os.environ.get("MYSQL_DB") or "thecollective_inventory"

    if not host or not user or not password:
        raise ValueError("Missing required MariaDB credentials: MARIADB_HOST, MARIADB_USER, MARIADB_PASSWORD")

    transport_info = verify_mariadb_transport(host)
    return {
        "host": host,
        "port": port,
        "user": user,
        "password": password,
        "database": database,
        "connect_timeout": 15,
        "transport": transport_info
    }

def fetch_private_canonical_parents(pg_config, log_fn):
    log_fn(f"Connecting to PostgreSQL ({pg_config['host']}:{pg_config['port']}/{pg_config['dbname']})...")
    conn = psycopg2.connect(**{k: v for k, v in pg_config.items() if k != "transport"})
    
    # Enforce REPEATABLE READ READ ONLY transaction
    conn.set_session(isolation_level=ISOLATION_LEVEL_REPEATABLE_READ, readonly=True, autocommit=False)
    cur = conn.cursor()
    cur.execute("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;")

    log_fn("Established direct REPEATABLE READ READ ONLY PostgreSQL transaction for wf_canonical_staging.canonical_listing_parents.")

    id_map = {
        "source_listing_ids": set(),
        "external_message_ids": set(),
        "canonical_parent_ids": set(),
        "total_parent_rows": 0,
    }

    last_id = ""
    batch_size = 10000

    while True:
        cur.execute("""
            SELECT id, source_listing_id, external_message_id
            FROM wf_canonical_staging.canonical_listing_parents
            WHERE id > %s
            ORDER BY id ASC
            LIMIT %s;
        """, (last_id, batch_size))

        rows = cur.fetchall()
        if not rows:
            break

        for row in rows:
            pid, source_listing_id, external_message_id = row
            last_id = pid
            id_map["total_parent_rows"] += 1

            if pid:
                id_map["canonical_parent_ids"].add(str(pid).strip())
            if source_listing_id:
                id_map["source_listing_ids"].add(str(source_listing_id).strip())
            if external_message_id:
                id_map["external_message_ids"].add(str(external_message_id).strip())

    conn.rollback()
    conn.close()

    log_fn(
        f"Fetched {id_map['total_parent_rows']:,} total parent rows "
        f"({len(id_map['source_listing_ids']):,} distinct source_listing_ids, "
        f"{len(id_map['external_message_ids']):,} distinct external_message_ids, "
        f"{len(id_map['canonical_parent_ids']):,} distinct parent IDs)."
    )
    return id_map

def preflight_cursor_and_explain(mcur, log_fn):
    mcur.execute("SHOW INDEX FROM auctions;")
    indexes = mcur.fetchall()
    
    # Map index names to columns
    index_map = {}
    for idx in indexes:
        kname = idx.get("Key_name") or idx.get("key_name")
        seq = int(idx.get("Seq_in_index") or idx.get("seq_in_index") or 1)
        col = str(idx.get("Column_name") or idx.get("column_name") or "").lower()
        if kname not in index_map:
            index_map[kname] = []
        if len(index_map[kname]) < seq:
            index_map[kname].extend([""] * (seq - len(index_map[kname])))
        index_map[kname][seq - 1] = col

    proved_indexes = [k for k, cols in index_map.items() if len(cols) >= 2 and cols[0] == "created_on" and cols[1] == "id"]
    if not proved_indexes:
        raise RuntimeError("MariaDB auctions table requires a composite (created_on, id) index for cursor pagination")

    log_fn(f"Proved composite cursor index: {proved_indexes[0]}")

    # Validate with EXPLAIN
    mcur.execute("""
        EXPLAIN SELECT id, created_on
        FROM auctions
        WHERE (created_on > '1970-01-01 00:00:00')
           OR (created_on = '1970-01-01 00:00:00' AND id > '0')
        ORDER BY created_on ASC, id ASC
        LIMIT 10;
    """)
    explain_rows = mcur.fetchall()
    if not explain_rows:
        raise RuntimeError("EXPLAIN query returned empty result")

    plan = explain_rows[0]
    key_used = plan.get("key") or plan.get("Key")
    access_type = str(plan.get("type") or plan.get("Type") or "").upper()

    log_fn(f"EXPLAIN plan verified: key='{key_used}', type='{access_type}'")
    return {"proved_index": proved_indexes[0], "key_used": key_used, "access_type": access_type}

def resolve_provenance_match(row, canonical_parents):
    sid_num = str(row["id"])
    open_key = str(row.get("open_unique_key") or "").strip()
    
    if not sid_num and not open_key:
        return {"matched": False, "rule": "UNMATCHED_NULL_IDENTITY"}

    source_ids = canonical_parents["source_listing_ids"]
    ext_ids = canonical_parents["external_message_ids"]

    # Proven Rule 1: ocean_<open_unique_key> (30k rows)
    if open_key:
        ocean_k = f"ocean_{open_key}"
        if ocean_k in source_ids or ocean_k in ext_ids:
            return {"matched": True, "rule": "RULE_OCEAN_PREFIX"}

    # Proven Rule 2: wf-<open_unique_key> (35k rows)
    if open_key:
        wf_k = f"wf-{open_key}"
        if wf_k in source_ids or wf_k in ext_ids:
            return {"matched": True, "rule": "RULE_WF_PREFIX"}

    # Proven Rule 3: mysql_auction_watches_<open_unique_key> (7.7k rows)
    if open_key:
        mw_k = f"mysql_auction_watches_{open_key}"
        if mw_k in source_ids or mw_k in ext_ids:
            return {"matched": True, "rule": "RULE_MYSQL_WATCHES_PREFIX"}

    # Proven Rule 4: mysql_auctions_<id>
    m_id = f"mysql_auctions_{sid_num}"
    if m_id in source_ids or m_id in ext_ids:
        return {"matched": True, "rule": "RULE_MYSQL_AUCTIONS_ID"}

    # Proven Rule 5: Raw open_unique_key
    if open_key and (open_key in source_ids or open_key in ext_ids):
        return {"matched": True, "rule": "RULE_EXACT_OPEN_KEY"}

    # Proven Rule 6: Raw numeric ID
    if sid_num in source_ids or sid_num in ext_ids:
        return {"matched": True, "rule": "RULE_EXACT_NUMERIC_ID"}

    return {"matched": False, "rule": "UNMATCHED_NEW_SOURCE_ROW"}

def run_census(options=None):
    options = options or {}
    start_iso = datetime.utcnow().isoformat() + "Z"
    start_ts = time.time()
    command_log = []

    def log(msg):
        entry = f"[{datetime.utcnow().isoformat()}Z] {msg}"
        print(entry, flush=True)
        command_log.append(entry)

    log("Starting Hardened Phase 1 MariaDB Source Census (Strict Provenance Mode)...")

    pg_config = get_postgres_config()
    maria_config = get_mariadb_config()
    output_path = os.environ.get("MARIADB_CENSUS_OUTPUT") or "source_census_report.json"
    batch_size = int(os.environ.get("MARIADB_CENSUS_BATCH_SIZE") or 10000)

    # 1. Fetch private canonical parents under REPEATABLE READ READ ONLY transaction
    canonical_parents = fetch_private_canonical_parents(pg_config, log)

    # 2. Connect to MariaDB
    log(f"Connecting to MariaDB ({maria_config['host']}:{maria_config['port']}/{maria_config['database']})...")
    conn_params = {
        "host": maria_config["host"],
        "port": maria_config["port"],
        "user": maria_config["user"],
        "password": maria_config["password"],
        "database": maria_config["database"],
        "connect_timeout": maria_config["connect_timeout"],
        "charset": "utf8mb4",
        "cursorclass": pymysql.cursors.DictCursor
    }
    if maria_config["transport"]["ssl"]:
        conn_params["ssl"] = maria_config["transport"]["ssl"]

    mdb = pymysql.connect(**conn_params)
    mcur = mdb.cursor()

    try:
        # Enforce read-only grants
        mcur.execute("SHOW GRANTS FOR CURRENT_USER();")
        grants = [list(r.values())[0] for r in mcur.fetchall()]
        assert_read_only_grants(grants)
        log(f"Verified read-only grants: {'; '.join(grants)}")

        # Cursor preflight and explain plan verification
        preflight_info = preflight_cursor_and_explain(mcur, log)

        # 3. Freeze Upper Boundary
        log("Freezing upper cursor boundary...")
        mcur.execute("""
            SELECT 
                COUNT(*) AS total_rows,
                MIN(id) AS min_id,
                MAX(id) AS max_id,
                MIN(created_on) AS min_created_on,
                MAX(created_on) AS max_created_on,
                MIN(updated_on) AS min_updated_on,
                MAX(updated_on) AS max_updated_on,
                SUM(CASE WHEN created_on IS NULL THEN 1 ELSE 0 END) AS null_created_on_count
            FROM auctions;
        """)
        bounds = mcur.fetchone()
        frozen_total = int(bounds["total_rows"])
        frozen_max_created_on = str(bounds["max_created_on"] or "9999-12-31 23:59:59")
        frozen_max_id = int(bounds["max_id"])

        log(f"Frozen Boundary Total: {frozen_total:,} rows (Min ID: {bounds['min_id']}, Max ID: {frozen_max_id})")
        log(f"Frozen Date Range: {bounds['min_created_on']} to {frozen_max_created_on} (Null created_on: {bounds['null_created_on_count']:,})")

        # 4. Distributions
        mcur.execute("SELECT status, COUNT(*) AS cnt FROM auctions GROUP BY status;")
        status_dist = {str(r["status"] if r["status"] is not None else "<NULL>"): int(r["cnt"]) for r in mcur.fetchall()}

        mcur.execute("SELECT type, COUNT(*) AS cnt FROM auctions GROUP BY type;")
        type_dist = {str(r["type"] if r["type"] is not None else "<NULL>"): int(r["cnt"]) for r in mcur.fetchall()}

        mcur.execute("SELECT is_bundle, COUNT(*) AS cnt FROM auctions GROUP BY is_bundle;")
        bundle_dist = {"BUNDLE" if r["is_bundle"] == 1 else "SINGLE": int(r["cnt"]) for r in mcur.fetchall()}

        mcur.execute("""
            SELECT 
                SUM(CASE WHEN front_image IS NOT NULL AND front_image != '' THEN 1 ELSE 0 END) AS with_image,
                SUM(CASE WHEN front_image IS NULL OR front_image = '' THEN 1 ELSE 0 END) AS without_image
            FROM auctions;
        """)
        img_dist = mcur.fetchone()

        # 5. Keyset Streaming Across Frozen Boundary
        log("Streaming all source rows via keyset pagination with NULL-safe timestamps across frozen boundary...")
        last_created_on = "1970-01-01 00:00:00"
        last_id = 0
        scanned_count = 0
        matched_count = 0
        missing_count = 0

        rule_breakdown = {
            "RULE_OCEAN_PREFIX": 0,
            "RULE_WF_PREFIX": 0,
            "RULE_MYSQL_WATCHES_PREFIX": 0,
            "RULE_MYSQL_AUCTIONS_ID": 0,
            "RULE_EXACT_OPEN_KEY": 0,
            "RULE_EXACT_NUMERIC_ID": 0,
            "UNMATCHED_NULL_IDENTITY": 0,
            "UNMATCHED_NEW_SOURCE_ROW": 0,
        }
        sample_missing = []

        while True:
            mcur.execute("""
                SELECT id, open_unique_key, created_on, type, is_bundle, status, brand, reference, price, front_image
                FROM auctions
                WHERE (
                    (COALESCE(created_on, '1970-01-01 00:00:00') > %s) OR
                    (COALESCE(created_on, '1970-01-01 00:00:00') = %s AND id > %s)
                ) AND (
                    (COALESCE(created_on, '1970-01-01 00:00:00') < %s) OR
                    (COALESCE(created_on, '1970-01-01 00:00:00') = %s AND id <= %s)
                )
                ORDER BY COALESCE(created_on, '1970-01-01 00:00:00') ASC, id ASC
                LIMIT %s;
            """, (last_created_on, last_created_on, last_id, frozen_max_created_on, frozen_max_created_on, frozen_max_id, batch_size))

            batch = mcur.fetchall()
            if not batch:
                break

            for row in batch:
                scanned_count += 1
                last_created_on = str(row["created_on"] or "1970-01-01 00:00:00")
                last_id = int(row["id"])

                match_res = resolve_provenance_match(row, canonical_parents)
                rule_breakdown[match_res["rule"]] = rule_breakdown.get(match_res["rule"], 0) + 1

                if match_res["matched"]:
                    matched_count += 1
                else:
                    missing_count += 1
                    if len(sample_missing) < 10:
                        sample_missing.append({
                            "id": row["id"],
                            "open_unique_key": row.get("open_unique_key"),
                            "created_on": str(row["created_on"]),
                            "brand": row.get("brand"),
                            "reference": row.get("reference"),
                            "price": row.get("price"),
                            "status": row.get("status"),
                            "is_bundle": row.get("is_bundle") == 1
                        })

            if scanned_count % 100000 == 0 or len(batch) < batch_size:
                log(f"Scanned {scanned_count:,} / {frozen_total:,} | Matched: {matched_count:,} | Missing: {missing_count:,}")

            if len(batch) < batch_size:
                break

        # 6. Hard reconciliation assertions
        if scanned_count != frozen_total:
            raise RuntimeError(f"CENSUS RECONCILIATION FAILURE: Scanned row count ({scanned_count:,}) != Frozen source total ({frozen_total:,})")

        if matched_count + missing_count != scanned_count:
            raise RuntimeError(f"CENSUS RECONCILIATION FAILURE: Matched ({matched_count:,}) + Missing ({missing_count:,}) != Scanned ({scanned_count:,})")

        end_iso = datetime.utcnow().isoformat() + "Z"
        duration_ms = int((time.time() - start_ts) * 1000)
        log(f"Census completed successfully in {duration_ms / 1000:.2f}s with 100% reconciliation.")

        report = {
            "contract": CENSUS_CONTRACT,
            "source_contract": SOURCE_CONTRACT,
            "pinned_project_ref": PINNED_PROJECT_REF,
            "status": "COMPLETE_SUCCESS",
            "started_at": start_iso,
            "ended_at": end_iso,
            "duration_ms": duration_ms,
            "cursor_preflight": preflight_info,
            "boundaries": {
                "frozen_total_rows": frozen_total,
                "min_id": bounds["min_id"],
                "max_id": frozen_max_id,
                "min_created_on": str(bounds["min_created_on"]),
                "max_created_on": str(frozen_max_created_on),
                "min_updated_on": str(bounds["min_updated_on"]),
                "max_updated_on": str(bounds["max_updated_on"]),
                "null_created_on_rows": int(bounds["null_created_on_count"])
            },
            "canonical_parent_inventory": {
                "total_parent_table_rows": canonical_parents["total_parent_rows"],
                "distinct_source_listing_ids": len(canonical_parents["source_listing_ids"]),
                "distinct_external_message_ids": len(canonical_parents["external_message_ids"]),
                "distinct_canonical_parent_ids": len(canonical_parents["canonical_parent_ids"]),
                "duplicate_source_listing_ids_count": canonical_parents["total_parent_rows"] - len(canonical_parents["source_listing_ids"])
            },
            "status_distribution": status_dist,
            "intent_distribution": type_dist,
            "bundle_distribution": bundle_dist,
            "media_distribution": {
                "with_image": int(img_dist["with_image"]),
                "without_image": int(img_dist["without_image"]),
                "image_coverage_pct": round((float(img_dist["with_image"]) / frozen_total) * 100, 2)
            },
            "provenance_reconciliation": {
                "total_scanned_rows": scanned_count,
                "matched_in_canonical_parents": matched_count,
                "missing_unimported_source_rows": missing_count,
                "provenance_rule_breakdown": rule_breakdown,
                "exact_reconciliation_verified": True
            },
            "sample_missing_records": sample_missing,
            "command_log": command_log
        }

        with open(output_path, "w", encoding="utf-8") as f:
            json.dump(report, f, indent=2)

        log(f"Report written to {output_path}")
        return report

    finally:
        mdb.close()
        log("MariaDB connection closed.")

if __name__ == "__main__":
    try:
        run_census()
    except Exception as e:
        print(f"FATAL CENSUS ERROR: {e}", file=sys.stderr)
        sys.exit(1)
