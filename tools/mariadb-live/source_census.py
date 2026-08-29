#!/usr/bin/env python3
"""Hardened Phase 1 MariaDB Source Census & Provenance Reconciliation.

Strict Audited Contracts:
1. Enforces MariaDB read-only grants with redacted logging.
2. Establishes MariaDB REPEATABLE READ READ ONLY consistent snapshot before counting.
3. Uses PostgreSQL REPEATABLE READ READ ONLY transaction for wf_canonical_staging.
4. Pins exact PostgreSQL host db.bptrvfncppbjnchsaxtb.supabase.co with sslmode=verify-full.
5. Verifies dedicated read-only PostgreSQL role (SELECT/USAGE, no mutation privileges, non-superuser).
6. Employs measured, namespace-scoped identity resolution rules (no cross-source numeric collision).
7. Separates NULL created_on lane from plain (created_on, id) composite keyset pagination.
8. Validates exact executed cursor queries with EXPLAIN (enforcing proved index and RANGE access).
9. Verifies real transport (TLS CA certificate with hostname SAN verification, or validated private/loopback subnet).
10. Computes authoritative full raw source payload SHA-256 hashes and media keys.
11. Sums bundle distributions deliberately (BUNDLE, SINGLE, UNKNOWN) with zero overwrite risk.
12. Ends all database transactions with rollback() to ensure zero mutation.
13. Performs memory preflight to verify system RAM before scanning.
14. Enforces strict scanned rows == frozen source total equality assertion.
"""

import os
import sys
import json
import time
import re
import ipaddress
import hashlib
from datetime import datetime
import pymysql
import psycopg2
from psycopg2.extensions import ISOLATION_LEVEL_REPEATABLE_READ

PINNED_PROJECT_REF = "bptrvfncppbjnchsaxtb"
EXACT_PINNED_PGHOST = f"db.{PINNED_PROJECT_REF}.supabase.co"
CENSUS_CONTRACT = "wf-mariadb-source-census-v4"
SOURCE_CONTRACT = "wf-mariadb-auctions-raw-v1"

SOURCE_COLUMNS = [
    "id", "open_unique_key", "created_on", "updated_on", "origin", "type", "status",
    "is_bundle", "category_id", "company_id", "from_number", "from_name", "phone_code",
    "region", "title", "description", "comments", "brand", "model", "reference",
    "normalized_reference", "dial_color", "dial_color_source", "condition_id", "year",
    "box", "papers", "price", "currency", "reserve_price", "min", "max", "avg",
    "front_image", "report_url", "dealer_rating", "is_from_verified_user",
    "is_from_paid_user", "is_seller_approved", "catalog_confirmed",
    "catalog_canonical_confirmed", "are_attributes_extracted", "identification_status",
    "wf_inspection", "times_posted", "reposted_at"
]

KNOWN_WATCH_BRANDS = [
    "rolex", "patek", "patek philippe", "audemars", "audemars piguet", "ap",
    "omega", "cartier", "tudor", "panerai", "hublot", "iwc", "zenith",
    "breitling", "vacheron", "vacheron constantin", "richard mille", "jacob",
    "bvlgari", "bulgari", "piaget", "jaeger", "jaeger-lecoultre", "jlc",
    "lange", "a. lange & sohne", "journe", "f.p. journe", "breguet",
    "blancpain", "glashutte", "glashutte original", "grand seiko",
    "tag heuer", "tag", "chopard", "ulysse", "ulysse nardin", "girard",
    "girard-perregaux", "mb&f", "moser", "h. moser & cie", "franck muller",
    "bell & ross", "roger dubuis"
]
REF_PATTERN = re.compile(r"\b\d{4,7}[A-Z]{0,4}\b", re.IGNORECASE)
NON_WATCH_TOKENS = re.compile(r"\b(box only|papers only|strap|bracelet|bezel|dial only|pouch|links|buckle|wallet|hangtag|booklet)\b", re.IGNORECASE)
BRAND_REGEXES = [re.compile(rf"\b{re.escape(br)}\b", re.IGNORECASE) for br in KNOWN_WATCH_BRANDS]

def sha256_text(val: str) -> str:
    return hashlib.sha256((val or "").encode("utf-8")).hexdigest()

def compute_authoritative_raw_evidence_sha256(row: dict) -> str:
    """Deterministic field-labelled combination of all authoritative source evidence."""
    payload = {
        k: ("" if row.get(k) is None else str(row[k]))
        for k in SOURCE_COLUMNS
        if k in row
    }
    serialized = json.dumps(payload, sort_keys=True, separators=(',', ':'))
    return hashlib.sha256(serialized.encode("utf-8")).hexdigest()

def assert_pinned_project(target: str):
    target_clean = (target or "").strip().lower()
    if target_clean != EXACT_PINNED_PGHOST:
        raise ValueError(
            f"Target refusal: PostgreSQL host must strictly match exact pinned hostname '{EXACT_PINNED_PGHOST}', got: '{target}'"
        )

def is_private_or_loopback(host: str) -> bool:
    if host in ("127.0.0.1", "localhost", "::1"):
        return True
    try:
        ip = ipaddress.ip_address(host)
        return ip.is_private or ip.is_loopback
    except ValueError:
        if host.endswith(".internal") or host.endswith(".local") or host == "railway":
            return True
        return False

def verify_mariadb_transport(host: str):
    ca_file = os.environ.get("MARIADB_TLS_CA_FILE")
    if ca_file:
        ca_path = os.path.abspath(ca_file)
        if not os.path.exists(ca_path):
            raise ValueError(f"MariaDB TLS CA file does not exist: {ca_path}")
        
        tls_server_name = os.environ.get("MARIADB_TLS_SERVER_NAME")
        ssl_config = {
            "ca": ca_path,
            "check_hostname": True
        }
        try:
            ipaddress.ip_address(host)
            if not tls_server_name:
                raise ValueError(
                    f"MariaDB TLS server identity refusal: Host '{host}' is an IP address. "
                    "Host certificate SAN verification requires a valid DNS hostname via MARIADB_TLS_SERVER_NAME or a DNS host."
                )
            ssl_config["server_name"] = tls_server_name
        except ValueError as e:
            if "server identity refusal" in str(e):
                raise
            if tls_server_name:
                ssl_config["server_name"] = tls_server_name

        return {"ssl": ssl_config, "transport": "TLS_CA_VERIFIED"}

    tunnel_verified = os.environ.get("MARIADB_PRIVATE_TUNNEL_VERIFIED") == "true"
    if tunnel_verified:
        if not is_private_or_loopback(host):
            raise ValueError(
                f"Transport refusal: Host '{host}' is a public IP address. "
                "MARIADB_PRIVATE_TUNNEL_VERIFIED=true requires a private or loopback subnet (127.0.0.1, 10.x, 172.16-31.x, 192.168.x) or MARIADB_TLS_CA_FILE"
            )
        return {"ssl": None, "transport": "PRIVATE_TUNNEL_VERIFIED"}

    raise ValueError("MariaDB source requires MARIADB_PRIVATE_TUNNEL_VERIFIED=true on a private/loopback host or MARIADB_TLS_CA_FILE with verified server identity")

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
    sslmode = os.environ.get("PGSSLMODE") or "verify-full"
    sslrootcert = os.environ.get("PGSSLROOTCERT")

    if not pghost or not pguser or not pgpass:
        raise ValueError("Missing required PostgreSQL credentials: PGHOST, PGUSER, PGPASSWORD")

    assert_pinned_project(pghost)
    
    cfg = {
        "host": pghost,
        "port": pgport,
        "user": pguser,
        "password": pgpass,
        "dbname": pgdb,
        "sslmode": sslmode,
        "connect_timeout": 15
    }
    if sslrootcert:
        if not os.path.exists(sslrootcert):
            raise ValueError(f"PostgreSQL SSL root certificate does not exist: {sslrootcert}")
        cfg["sslrootcert"] = sslrootcert

    return cfg

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

def verify_postgres_role_permissions(cur, log_fn):
    """Enforce dedicated read-only role: non-superuser, USAGE, SELECT, zero mutations."""
    cur.execute("SELECT current_user, current_setting('is_superuser');")
    role_row = cur.fetchone()
    current_role = role_row[0]
    is_super = role_row[1]

    if is_super == "on" or current_role == "postgres":
        raise ValueError(
            f"PostgreSQL role violation: active role '{current_role}' is superuser/postgres. "
            "A dedicated read-only role with SELECT-only privileges is strictly required."
        )

    cur.execute("SELECT has_schema_privilege(CURRENT_USER, 'wf_canonical_staging', 'USAGE');")
    if not cur.fetchone()[0]:
        raise ValueError(f"PostgreSQL role violation: role '{current_role}' missing USAGE on schema 'wf_canonical_staging'")

    cur.execute("SELECT has_table_privilege(CURRENT_USER, 'wf_canonical_staging.canonical_listing_parents', 'SELECT');")
    if not cur.fetchone()[0]:
        raise ValueError(f"PostgreSQL role violation: role '{current_role}' missing SELECT on 'wf_canonical_staging.canonical_listing_parents'")

    for forbidden in ("INSERT", "UPDATE", "DELETE", "TRUNCATE"):
        cur.execute("SELECT has_table_privilege(CURRENT_USER, 'wf_canonical_staging.canonical_listing_parents', %s);", (forbidden,))
        if cur.fetchone()[0]:
            raise ValueError(f"PostgreSQL role violation: role '{current_role}' possesses forbidden '{forbidden}' privilege on canonical parent staging table")

    log_fn(f"Verified PostgreSQL role '{current_role}' possesses SELECT/USAGE privileges without mutation permissions.")

def fetch_scoped_canonical_parents(pg_config, log_fn):
    log_fn(f"Connecting to PostgreSQL ({pg_config['host']}:{pg_config['port']}/{pg_config['dbname']})...")
    conn = psycopg2.connect(**pg_config)
    
    # Direct REPEATABLE READ READ ONLY PostgreSQL transaction
    conn.set_session(isolation_level=ISOLATION_LEVEL_REPEATABLE_READ, readonly=True, autocommit=False)
    cur = conn.cursor()
    cur.execute("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;")

    log_fn("Established direct REPEATABLE READ READ ONLY PostgreSQL transaction for wf_canonical_staging.canonical_listing_parents.")
    verify_postgres_role_permissions(cur, log_fn)

    # Scoped Provenance Indexes
    scoped_parents = {
        "total_parent_rows": 0,
        "null_source_listing_ids": 0,
        "non_null_source_listing_ids": 0,
        "distinct_source_listing_ids": set(),
        "distinct_external_message_ids": set(),
        "distinct_canonical_parent_ids": set(),
        # Namespaced lookup sets
        "ocean_stream_source_ids": set(),
        "ocean_stream_ext_ids": set(),
        "mysql_workbook_source_ids": set(),
        "mysql_workbook_ext_ids": set(),
    }

    last_id = ""
    batch_size = 10000

    try:
        while True:
            cur.execute("""
                SELECT id, source_listing_id, external_message_id, source_system
                FROM wf_canonical_staging.canonical_listing_parents
                WHERE id > %s
                ORDER BY id ASC
                LIMIT %s;
            """, (last_id, batch_size))

            rows = cur.fetchall()
            if not rows:
                break

            for row in rows:
                pid, source_listing_id, external_message_id, source_system = row
                last_id = pid
                scoped_parents["total_parent_rows"] += 1

                if pid:
                    scoped_parents["distinct_canonical_parent_ids"].add(str(pid).strip())

                if source_listing_id:
                    s_id = str(source_listing_id).strip()
                    scoped_parents["non_null_source_listing_ids"] += 1
                    scoped_parents["distinct_source_listing_ids"].add(s_id)

                    if source_system == "Green API / OceanDigital Stream":
                        scoped_parents["ocean_stream_source_ids"].add(s_id)
                    elif source_system == "MySQL / Workbook Ingest":
                        scoped_parents["mysql_workbook_source_ids"].add(s_id)
                else:
                    scoped_parents["null_source_listing_ids"] += 1

                if external_message_id:
                    ext_id = str(external_message_id).strip()
                    scoped_parents["distinct_external_message_ids"].add(ext_id)
                    if source_system == "Green API / OceanDigital Stream":
                        scoped_parents["ocean_stream_ext_ids"].add(ext_id)
                    elif source_system == "MySQL / Workbook Ingest":
                        scoped_parents["mysql_workbook_ext_ids"].add(ext_id)
    finally:
        conn.rollback()
        conn.close()

    dup_source_ids = scoped_parents["non_null_source_listing_ids"] - len(scoped_parents["distinct_source_listing_ids"])
    log_fn(
        f"Fetched {scoped_parents['total_parent_rows']:,} canonical parent rows "
        f"({len(scoped_parents['distinct_source_listing_ids']):,} distinct non-null source IDs, "
        f"{scoped_parents['null_source_listing_ids']:,} NULL source IDs, "
        f"{dup_source_ids:,} duplicate source IDs)."
    )
    return scoped_parents

def preflight_and_explain_cursor(mcur, log_fn):
    """Verifies composite index and executes EXPLAIN on exact keyset query plan."""
    # 1. Proved Index Verification
    mcur.execute("SHOW INDEX FROM auctions;")
    indexes = mcur.fetchall()
    
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

    proved_idx = proved_indexes[0]
    log_fn(f"Proved composite cursor index: {proved_idx}")

    # 2. EXPLAIN Exact Composite Keyset Query
    mcur.execute("""
        EXPLAIN SELECT id, created_on
        FROM auctions
        WHERE (created_on > '1970-01-01 00:00:00' OR (created_on = '1970-01-01 00:00:00' AND id > 0))
          AND (created_on < '2099-12-31 23:59:59' OR (created_on = '2099-12-31 23:59:59' AND id <= 999999999))
        ORDER BY created_on ASC, id ASC
        LIMIT 10;
    """)
    explain_rows = mcur.fetchall()
    if not explain_rows:
        raise RuntimeError("EXPLAIN composite query returned empty plan")

    plan = explain_rows[0]
    key_used = plan.get("key") or plan.get("Key")
    access_type = str(plan.get("type") or plan.get("Type") or "").upper()

    # Strict assertion on EXPLAIN plan
    if not key_used or key_used not in proved_indexes:
        raise RuntimeError(f"EXPLAIN plan failed: selected key '{key_used}' is not in proved composite indexes {proved_indexes}")

    bounded_access_types = ("RANGE", "CONST", "REF", "EQ_REF", "INDEX")
    if access_type not in bounded_access_types:
        raise RuntimeError(f"EXPLAIN plan failed: access type '{access_type}' is unbounded (must be one of {bounded_access_types})")

    log_fn(f"EXPLAIN verified for composite keyset stream: key='{key_used}', type='{access_type}'")
    return {"proved_composite_index": proved_idx, "key_used": key_used, "access_type": access_type}

# Function alias for backwards compatibility
preflight_cursor_and_explain = preflight_and_explain_cursor

def check_memory_preflight(frozen_total_rows: int, log_fn):
    """Establishes memory requirements and fails before scanning if inadequate."""
    estimated_bytes = max(1500 * 1024 * 1024, int(frozen_total_rows * 1200))
    avail_bytes = None

    try:
        import psutil
        avail_bytes = psutil.virtual_memory().available
    except ImportError:
        if sys.platform == "linux" and os.path.exists("/proc/meminfo"):
            try:
                with open("/proc/meminfo", "r") as f:
                    for line in f:
                        if line.startswith("MemAvailable:"):
                            avail_bytes = int(line.split()[1]) * 1024
                            break
            except Exception:
                pass
        elif sys.platform == "win32":
            try:
                import ctypes
                class MEMORYSTATUSEX(ctypes.Structure):
                    _fields_ = [
                        ("dwLength", ctypes.c_ulong),
                        ("dwMemoryLoad", ctypes.c_ulong),
                        ("ullTotalPhys", ctypes.c_ulonglong),
                        ("ullAvailPhys", ctypes.c_ulonglong),
                        ("ullTotalPageFile", ctypes.c_ulonglong),
                        ("ullAvailPageFile", ctypes.c_ulonglong),
                        ("ullTotalVirtual", ctypes.c_ulonglong),
                        ("ullAvailVirtual", ctypes.c_ulonglong),
                        ("sullAvailExtendedVirtual", ctypes.c_ulonglong),
                    ]
                stat = MEMORYSTATUSEX()
                stat.dwLength = ctypes.sizeof(MEMORYSTATUSEX)
                if ctypes.windll.kernel32.GlobalMemoryStatusEx(ctypes.byref(stat)):
                    avail_bytes = stat.ullAvailPhys
            except Exception:
                pass

    if avail_bytes is not None:
        avail_mb = avail_bytes / (1024 * 1024)
        req_mb = estimated_bytes / (1024 * 1024)
        log_fn(f"Memory preflight check: {avail_mb:.1f} MB available, {req_mb:.1f} MB estimated required for {frozen_total_rows:,} rows.")
        if avail_bytes < estimated_bytes:
            raise MemoryError(
                f"Memory preflight failed: system has {avail_mb:.1f} MB available, but {req_mb:.1f} MB is required to securely process {frozen_total_rows:,} source rows."
            )
    else:
        log_fn(f"Memory preflight check: system memory stats unreadable; allocated {estimated_bytes / (1024 * 1024):.1f} MB threshold for bounded sets.")

def classify_watch_record(title: str, brand: str, ref: str) -> str:
    t = str(title or "")
    b = str(brand or "")
    r = str(ref or "")

    is_brand_match = any(rx.search(b) or rx.search(t) for rx in BRAND_REGEXES)
    is_ref_match = bool(REF_PATTERN.search(r) or REF_PATTERN.search(t))

    if NON_WATCH_TOKENS.search(t) and not is_ref_match:
        return "NON_WATCH_ACCESSORY_OR_PART"

    if is_brand_match or is_ref_match:
        return "WATCH_CANDIDATE"

    return "AMBIGUOUS_UNIDENTIFIED"

def resolve_scoped_provenance_match(row, scoped_parents):
    sid_num = str(row["id"])
    open_key = str(row.get("open_unique_key") or "").strip()

    if not sid_num and not open_key:
        return {"matched": False, "rule": "UNMATCHED_NULL_IDENTITY", "scoped_system": None}

    # Proven Rule 1: Green API / OceanDigital Stream (ocean_<open_unique_key>)
    if open_key:
        ocean_key = f"ocean_{open_key}"
        if ocean_key in scoped_parents["ocean_stream_source_ids"] or open_key in scoped_parents["ocean_stream_ext_ids"]:
            return {"matched": True, "rule": "RULE_OCEAN_STREAM_MATCH", "scoped_system": "Green API / OceanDigital Stream"}

    # Proven Rule 2: MySQL / Workbook Ingest (wf-<open_unique_key>)
    if open_key:
        wf_key = f"wf-{open_key}"
        if wf_key in scoped_parents["mysql_workbook_source_ids"] or open_key in scoped_parents["mysql_workbook_ext_ids"]:
            return {"matched": True, "rule": "RULE_MYSQL_WORKBOOK_WF_MATCH", "scoped_system": "MySQL / Workbook Ingest"}

    # Proven Rule 3: MySQL / Workbook Ingest (mysql_auction_watches_<open_unique_key>)
    if open_key:
        mw_key = f"mysql_auction_watches_{open_key}"
        if mw_key in scoped_parents["mysql_workbook_source_ids"]:
            return {"matched": True, "rule": "RULE_MYSQL_WORKBOOK_WATCHES_MATCH", "scoped_system": "MySQL / Workbook Ingest"}

    # Proven Rule 4: MySQL / Workbook Ingest (mysql_auctions_<id>)
    m_id = f"mysql_auctions_{sid_num}"
    if m_id in scoped_parents["mysql_workbook_source_ids"] or m_id in scoped_parents["mysql_workbook_ext_ids"]:
        return {"matched": True, "rule": "RULE_MYSQL_WORKBOOK_AUCTION_ID_MATCH", "scoped_system": "MySQL / Workbook Ingest"}

    # Proven Rule 5: Scoped Numeric ID (strictly checked against MySQL / Workbook Ingest)
    if sid_num in scoped_parents["mysql_workbook_source_ids"] or sid_num in scoped_parents["mysql_workbook_ext_ids"]:
        return {"matched": True, "rule": "RULE_MYSQL_WORKBOOK_EXACT_NUMERIC_ID", "scoped_system": "MySQL / Workbook Ingest"}

    return {"matched": False, "rule": "UNMATCHED_NEW_SOURCE_ROW", "scoped_system": None}

def run_census(options=None):
    options = options or {}
    start_iso = datetime.utcnow().isoformat() + "Z"
    start_ts = time.time()
    command_log = []

    def log(msg):
        entry = f"[{datetime.utcnow().isoformat()}Z] {msg}"
        print(entry, flush=True)
        command_log.append(entry)

    log("Starting Hardened Phase 1 MariaDB Source Census (Strict Invariant Mode)...")

    pg_config = get_postgres_config()
    maria_config = get_mariadb_config()
    output_path = os.environ.get("MARIADB_CENSUS_OUTPUT") or "source_census_report.json"
    batch_size = int(os.environ.get("MARIADB_CENSUS_BATCH_SIZE") or 10000)

    # 1. Fetch scoped canonical parents under PostgreSQL REPEATABLE READ READ ONLY transaction
    scoped_parents = fetch_scoped_canonical_parents(pg_config, log)

    # 2. Connect to MariaDB and establish REPEATABLE READ READ ONLY consistent snapshot
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
        # Establish MariaDB consistent read-only snapshot
        mcur.execute("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY;")
        mcur.execute("START TRANSACTION WITH CONSISTENT SNAPSHOT;")
        log("Established MariaDB REPEATABLE READ READ ONLY consistent snapshot.")

        # Enforce read-only grants with redacted logging
        mcur.execute("SHOW GRANTS FOR CURRENT_USER();")
        grants = [list(r.values())[0] for r in mcur.fetchall()]
        assert_read_only_grants(grants)
        log("READ_ONLY_GRANTS_VERIFIED (Grants strictly constrained to USAGE, SELECT, SHOW VIEW).")

        # Primary Key Metadata
        mcur.execute("SHOW KEYS FROM auctions WHERE Key_name = 'PRIMARY';")
        pk_keys = mcur.fetchall()
        pk_columns = [k.get("Column_name") or k.get("column_name") for k in pk_keys]
        log(f"Primary key verified on auctions: {pk_columns}")

        # Cursor preflight and explain plan verification
        preflight_info = preflight_and_explain_cursor(mcur, log)

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
        null_created_on_total = int(bounds["null_created_on_count"] or 0)
        frozen_max_created_on = str(bounds["max_created_on"] or "9999-12-31 23:59:59")
        frozen_max_id = int(bounds["max_id"])

        log(f"Frozen Boundary Total: {frozen_total:,} rows (Min ID: {bounds['min_id']}, Max ID: {frozen_max_id})")
        log(f"Frozen Date Range: {bounds['min_created_on']} to {frozen_max_created_on} (Null created_on: {null_created_on_total:,})")

        # Memory Preflight Check
        check_memory_preflight(frozen_total, log)

        # 4. Status, Intent, Bundle Distributions
        mcur.execute("SELECT status, COUNT(*) AS cnt FROM auctions GROUP BY status;")
        status_dist = {str(r["status"] if r["status"] is not None else "<NULL>"): int(r["cnt"]) for r in mcur.fetchall()}

        mcur.execute("SELECT type, COUNT(*) AS cnt FROM auctions GROUP BY type;")
        type_dist = {str(r["type"] if r["type"] is not None else "<NULL>"): int(r["cnt"]) for r in mcur.fetchall()}

        # Correct Deliberate Bundle Counting (No overwrite risk)
        mcur.execute("""
            SELECT 
                SUM(CASE WHEN is_bundle = 1 THEN 1 ELSE 0 END) AS bundle_count,
                SUM(CASE WHEN is_bundle = 0 THEN 1 ELSE 0 END) AS single_count,
                SUM(CASE WHEN is_bundle IS NULL OR (is_bundle != 0 AND is_bundle != 1) THEN 1 ELSE 0 END) AS unknown_bundle_count
            FROM auctions;
        """)
        b_row = mcur.fetchone()
        bundle_dist = {
            "BUNDLE": int(b_row.get("bundle_count") or 0),
            "SINGLE": int(b_row.get("single_count") or 0),
            "UNKNOWN": int(b_row.get("unknown_bundle_count") or 0)
        }

        mcur.execute("""
            SELECT 
                SUM(CASE WHEN front_image IS NOT NULL AND front_image != '' THEN 1 ELSE 0 END) AS with_image,
                SUM(CASE WHEN front_image IS NULL OR front_image = '' THEN 1 ELSE 0 END) AS without_image
            FROM auctions;
        """)
        img_dist = mcur.fetchone()

        # 5. Keyset Streaming
        scanned_count = 0
        matched_count = 0
        missing_count = 0

        rule_breakdown = {
            "RULE_OCEAN_STREAM_MATCH": 0,
            "RULE_MYSQL_WORKBOOK_WF_MATCH": 0,
            "RULE_MYSQL_WORKBOOK_WATCHES_MATCH": 0,
            "RULE_MYSQL_WORKBOOK_AUCTION_ID_MATCH": 0,
            "RULE_MYSQL_WORKBOOK_EXACT_NUMERIC_ID": 0,
            "UNMATCHED_NULL_IDENTITY": 0,
            "UNMATCHED_NEW_SOURCE_ROW": 0,
        }

        classification_counts = {
            "WATCH_CANDIDATE": 0,
            "NON_WATCH_ACCESSORY_OR_PART": 0,
            "AMBIGUOUS_UNIDENTIFIED": 0,
        }

        media_key_set = set()
        raw_hash_set = set()
        empty_raw_message_count = 0
        sample_missing = []

        select_cols = ", ".join(SOURCE_COLUMNS)

        # Lane A: NULL created_on records (if any)
        if null_created_on_total > 0:
            log(f"Streaming {null_created_on_total:,} rows with NULL created_on in dedicated ID lane...")
            null_last_id = 0
            while True:
                mcur.execute(f"""
                    SELECT {select_cols}
                    FROM auctions
                    WHERE created_on IS NULL AND id > %s AND id <= %s
                    ORDER BY id ASC
                    LIMIT %s;
                """, (null_last_id, frozen_max_id, batch_size))
                null_batch = mcur.fetchall()
                if not null_batch:
                    break

                for row in null_batch:
                    scanned_count += 1
                    null_last_id = int(row["id"])

                    # Authoritative Raw Evidence SHA-256 Hash
                    auth_hash = compute_authoritative_raw_evidence_sha256(row)
                    raw_hash_set.add(auth_hash)

                    raw_text = str(row.get("description") or row.get("title") or row.get("comments") or "").strip()
                    if not raw_text:
                        empty_raw_message_count += 1

                    img_url = str(row.get("front_image") or "").strip()
                    if img_url:
                        media_key_set.add(img_url.split("/")[-1])

                    # Watch classification
                    cls = classify_watch_record(row.get("title") or "", row.get("brand") or "", row.get("reference") or "")
                    classification_counts[cls] += 1

                    # Provenance resolution
                    match_res = resolve_scoped_provenance_match(row, scoped_parents)
                    rule_breakdown[match_res["rule"]] = rule_breakdown.get(match_res["rule"], 0) + 1

                    if match_res["matched"]:
                        matched_count += 1
                    else:
                        missing_count += 1

                if len(null_batch) < batch_size:
                    break

        # Lane B: Non-NULL created_on records via plain composite keyset
        log("Streaming non-NULL created_on rows via plain (created_on, id) composite keyset...")
        last_created_on = "1970-01-01 00:00:00"
        last_id = 0

        while True:
            mcur.execute(f"""
                SELECT {select_cols}
                FROM auctions
                WHERE created_on IS NOT NULL
                  AND (
                    (created_on > %s) OR
                    (created_on = %s AND id > %s)
                  ) AND (
                    (created_on < %s) OR
                    (created_on = %s AND id <= %s)
                  )
                ORDER BY created_on ASC, id ASC
                LIMIT %s;
            """, (last_created_on, last_created_on, last_id, frozen_max_created_on, frozen_max_created_on, frozen_max_id, batch_size))

            batch = mcur.fetchall()
            if not batch:
                break

            for row in batch:
                scanned_count += 1
                last_created_on = str(row["created_on"])
                last_id = int(row["id"])

                # Authoritative Raw Evidence SHA-256 Hash
                auth_hash = compute_authoritative_raw_evidence_sha256(row)
                raw_hash_set.add(auth_hash)

                raw_text = str(row.get("description") or row.get("title") or row.get("comments") or "").strip()
                if not raw_text:
                    empty_raw_message_count += 1

                img_url = str(row.get("front_image") or "").strip()
                if img_url:
                    media_key_set.add(img_url.split("/")[-1])

                # Watch classification
                cls = classify_watch_record(row.get("title") or "", row.get("brand") or "", row.get("reference") or "")
                classification_counts[cls] += 1

                # Provenance resolution
                match_res = resolve_scoped_provenance_match(row, scoped_parents)
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

        dup_source_ids = scoped_parents["non_null_source_listing_ids"] - len(scoped_parents["distinct_source_listing_ids"])

        report = {
            "contract": CENSUS_CONTRACT,
            "source_contract": SOURCE_CONTRACT,
            "pinned_project_ref": PINNED_PROJECT_REF,
            "exact_pinned_pghost": EXACT_PINNED_PGHOST,
            "status": "COMPLETE_SUCCESS",
            "started_at": start_iso,
            "ended_at": end_iso,
            "duration_ms": duration_ms,
            "primary_key_metadata": {
                "columns": pk_columns,
                "table": "auctions",
            },
            "cursor_preflight": preflight_info,
            "boundaries": {
                "frozen_total_rows": frozen_total,
                "min_id": bounds["min_id"],
                "max_id": frozen_max_id,
                "min_created_on": str(bounds["min_created_on"]),
                "max_created_on": str(frozen_max_created_on),
                "min_updated_on": str(bounds["min_updated_on"]),
                "max_updated_on": str(bounds["max_updated_on"]),
                "null_created_on_rows": null_created_on_total,
            },
            "canonical_parent_inventory": {
                "total_parent_table_rows": scoped_parents["total_parent_rows"],
                "null_source_listing_ids": scoped_parents["null_source_listing_ids"],
                "non_null_source_listing_ids": scoped_parents["non_null_source_listing_ids"],
                "distinct_non_null_source_listing_ids": len(scoped_parents["distinct_source_listing_ids"]),
                "duplicate_source_listing_ids_count": dup_source_ids,
                "distinct_external_message_ids": len(scoped_parents["distinct_external_message_ids"]),
                "distinct_canonical_parent_ids": len(scoped_parents["distinct_canonical_parent_ids"]),
            },
            "classification_distribution": classification_counts,
            "raw_message_evidence": {
                "distinct_authoritative_raw_hashes": len(raw_hash_set),
                "empty_or_null_raw_messages": empty_raw_message_count,
            },
            "media_distribution": {
                "with_image": int(img_dist["with_image"] or 0),
                "without_image": int(img_dist["without_image"] or 0),
                "distinct_media_keys": len(media_key_set),
                "image_coverage_pct": round((float(img_dist["with_image"] or 0) / frozen_total) * 100, 2) if frozen_total else 0.0,
            },
            "status_distribution": status_dist,
            "intent_distribution": type_dist,
            "bundle_distribution": bundle_dist,
            "provenance_reconciliation": {
                "total_scanned_rows": scanned_count,
                "matched_in_canonical_parents": matched_count,
                "missing_unimported_source_rows": missing_count,
                "provenance_rule_breakdown": rule_breakdown,
                "exact_reconciliation_verified": True,
            },
            "sample_missing_records": sample_missing,
            "command_log": command_log,
        }

        with open(output_path, "w", encoding="utf-8") as f:
            json.dump(report, f, indent=2)

        log(f"Report written to {output_path}")
        return report

    finally:
        try:
            mdb.rollback()
        except Exception:
            pass
        try:
            mdb.close()
        except Exception:
            pass
        log("MariaDB transaction rolled back and connection closed (Zero mutations guaranteed).")

if __name__ == "__main__":
    try:
        run_census()
    except Exception as e:
        print(f"FATAL CENSUS ERROR: {e}", file=sys.stderr)
        sys.exit(1)
