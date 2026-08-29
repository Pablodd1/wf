#!/usr/bin/env python3
"""Checkpointed, source-read-only 100k immutable MariaDB capture benchmark."""

import csv
import gzip
import hashlib
import json
import os
import sys
import time
from datetime import date, datetime, time as datetime_time
from pathlib import Path

import pymysql

try:
    import resource
except ImportError:  # Windows has no resource module.
    resource = None

sys.path.insert(0, str(Path(__file__).resolve().parent))
from source_census import (  # noqa: E402
    assert_read_only_grants,
    get_available_memory_bytes,
    get_cgroup_available_memory_bytes,
    get_mariadb_config,
)

CONTRACT = "wf-mariadb-immutable-capture-benchmark-v2"
SOURCE_CONTRACT = "wf-mariadb-auctions-raw-v1"
DEFAULT_START = "2025-01-08 13:28:49"


def json_value(value):
    if value is None or isinstance(value, (str, int, float, bool)):
        return value
    if isinstance(value, (datetime, date, datetime_time)):
        return value.isoformat(sep=" ") if isinstance(value, datetime) else value.isoformat()
    if isinstance(value, bytes):
        return {"encoding": "hex", "value": value.hex()}
    return str(value)


def canonical_raw_data(row):
    return {str(key): json_value(value) for key, value in row.items()}


def stable_json(value):
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


def sha256_bytes(value):
    return hashlib.sha256(value).hexdigest()


def source_record(row, captured_at):
    raw_data = canonical_raw_data(row)
    source_id = str(raw_data.get("id") or "")
    source_key = str(raw_data.get("open_unique_key") or "") or None
    if not source_id:
        raise ValueError("SOURCE_ID_MISSING")
    raw_message = None
    raw_message_source = None
    for field in ("description", "title", "comments"):
        candidate = raw_data.get(field)
        if candidate is not None and str(candidate).strip():
            raw_message = candidate
            raw_message_source = field
            break
    raw_payload = stable_json(raw_data).encode("utf-8")
    return {
        "contract": SOURCE_CONTRACT,
        "source_system": "OceanDigital MariaDB",
        "source_database": "thecollective_inventory",
        "source_table": "auctions",
        "source_id": source_id,
        "source_unique_key": source_key,
        "source_record_id": f"mysql_auctions_{source_id}",
        "source_created_on": raw_data.get("created_on"),
        "captured_at": captured_at,
        "raw_message": raw_message,
        "raw_message_source": raw_message_source,
        "raw_sha256": sha256_bytes(raw_payload),
        "raw_data": raw_data,
    }


def atomic_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(f"{path.name}.{os.getpid()}.tmp")
    temporary.write_text(json.dumps(value, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    os.replace(temporary, path)


def file_sha256(path):
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def peak_rss_bytes():
    if resource is not None:
        peak = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
        return int(peak if sys.platform == "darwin" else peak * 1024)
    try:
        import psutil

        memory = psutil.Process().memory_info()
        return int(getattr(memory, "peak_wset", memory.rss))
    except (ImportError, OSError):
        return None


def available_memory_bytes():
    values = [value for value in (get_available_memory_bytes(), get_cgroup_available_memory_bytes()) if value is not None]
    return min(values) if values else None


def after_cursor_sql(prefix=""):
    c = f"{prefix}created_on"
    i = f"{prefix}id"
    return f"({c} > %s OR ({c} = %s AND {i} > %s))"


def at_or_before_sql(prefix=""):
    c = f"{prefix}created_on"
    i = f"{prefix}id"
    return f"({c} < %s OR ({c} = %s AND {i} <= %s))"


def tuple_params(cursor):
    return (cursor[0], cursor[0], cursor[1])


def config(env=os.environ):
    max_rows = int(env.get("MARIADB_CAPTURE_MAX_ROWS") or 100000)
    batch_size = int(env.get("MARIADB_CAPTURE_BATCH_SIZE") or 1000)
    if not 1 <= max_rows <= 100000:
        raise ValueError("MARIADB_CAPTURE_MAX_ROWS must be between 1 and 100000")
    if not 100 <= batch_size <= 5000:
        raise ValueError("MARIADB_CAPTURE_BATCH_SIZE must be between 100 and 5000")
    return {
        "max_rows": max_rows,
        "batch_size": batch_size,
        "start_at": env.get("MARIADB_CAPTURE_START_AT") or DEFAULT_START,
        "output": Path(env.get("MARIADB_CAPTURE_OUTPUT") or "audit-output/mariadb-live/benchmark-100k-v2").resolve(),
    }


def output_paths(output):
    return {
        "records": output / "raw-records.jsonl.gz",
        "errors": output / "errors.csv",
        "checkpoint": output / "checkpoint.json",
        "manifest": output / "run-manifest.json",
        "benchmark": output / "benchmark.json",
        "reconciliation": output / "reconciliation.json",
    }


def load_or_initialize(paths, run_config):
    paths["checkpoint"].parent.mkdir(parents=True, exist_ok=True)
    if paths["checkpoint"].exists():
        checkpoint = json.loads(paths["checkpoint"].read_text(encoding="utf-8"))
        if checkpoint.get("contract") != CONTRACT:
            raise RuntimeError("Checkpoint contract mismatch")
        for field in ("start_at", "max_rows", "batch_size"):
            if checkpoint.get(field) != run_config[field]:
                raise RuntimeError(f"Checkpoint configuration mismatch: {field}")
        if checkpoint.get("complete"):
            raise RuntimeError("Capture benchmark is already complete")
        for name, size_field in (("records", "record_bytes"), ("errors", "error_bytes")):
            if paths[name].exists():
                with paths[name].open("r+b") as handle:
                    handle.truncate(int(checkpoint.get(size_field) or 0))
        return checkpoint
    if paths["records"].exists() or paths["errors"].exists():
        raise RuntimeError("Output exists without checkpoint; choose a clean output directory")
    with paths["errors"].open("w", newline="", encoding="utf-8") as handle:
        csv.writer(handle).writerow(["source_id", "source_unique_key", "error_name", "error_message"])
    checkpoint = {
        "contract": CONTRACT,
        "complete": False,
        "started_at": datetime.utcnow().isoformat() + "Z",
        "start_at": run_config["start_at"],
        "max_rows": run_config["max_rows"],
        "batch_size": run_config["batch_size"],
        "input_rows": 0,
        "output_rows": 0,
        "error_rows": 0,
        "record_bytes": 0,
        "error_bytes": paths["errors"].stat().st_size,
        "last_cursor": None,
        "frozen_upper_cursor": None,
        "expected_rows": None,
    }
    atomic_json(paths["checkpoint"], checkpoint)
    return checkpoint


def verify_capture(paths, expected_rows):
    rows = 0
    invalid_hashes = 0
    with gzip.open(paths["records"], "rt", encoding="utf-8") as handle:
        for line in handle:
            record = json.loads(line)
            rows += 1
            expected = sha256_bytes(stable_json(record["raw_data"]).encode("utf-8"))
            if record.get("raw_sha256") != expected:
                invalid_hashes += 1
    return {
        "validated_output_rows": rows,
        "invalid_raw_hashes": invalid_hashes,
        "validation_passed": rows == expected_rows and invalid_hashes == 0,
    }


def run():
    run_config = config()
    paths = output_paths(run_config["output"])
    checkpoint = load_or_initialize(paths, run_config)
    maria = get_mariadb_config()
    start_monotonic = time.monotonic()
    memory_before = available_memory_bytes()
    connection = None
    schema_columns = []
    full_source_rows = None
    try:
        params = {
            "host": maria["host"], "port": maria["port"], "user": maria["user"],
            "password": maria["password"], "database": maria["database"],
            "connect_timeout": maria["connect_timeout"], "charset": "utf8mb4",
            "cursorclass": pymysql.cursors.DictCursor,
        }
        if maria["transport"]["ssl"]:
            params["ssl"] = maria["transport"]["ssl"]
        connection = pymysql.connect(**params)
        cursor = connection.cursor()
        cursor.execute("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY;")
        cursor.execute("START TRANSACTION WITH CONSISTENT SNAPSHOT;")
        cursor.execute("SHOW GRANTS FOR CURRENT_USER();")
        assert_read_only_grants([list(row.values())[0] for row in cursor.fetchall()])
        cursor.execute("SELECT COUNT(*) AS total FROM auctions;")
        full_source_rows = int(cursor.fetchone()["total"])
        cursor.execute("""
            SELECT COLUMN_NAME FROM information_schema.COLUMNS
            WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'auctions'
            ORDER BY ORDINAL_POSITION;
        """)
        schema_columns = [row["COLUMN_NAME"] for row in cursor.fetchall()]
        for required in ("id", "open_unique_key", "created_on"):
            if required not in schema_columns:
                raise RuntimeError(f"Required source column missing: {required}")
        if checkpoint["frozen_upper_cursor"] is None:
            cursor.execute("SELECT COUNT(*) AS total FROM auctions WHERE created_on >= %s;", (run_config["start_at"],))
            eligible = int(cursor.fetchone()["total"])
            target_rows = min(run_config["max_rows"], eligible)
            if target_rows <= 0:
                raise RuntimeError("No source rows available at or after capture start")
            cursor.execute("""
                SELECT created_on, id FROM auctions
                WHERE created_on >= %s
                ORDER BY created_on ASC, id ASC
                LIMIT 1 OFFSET %s;
            """, (run_config["start_at"], target_rows - 1))
            boundary = cursor.fetchone()
            if not boundary:
                raise RuntimeError("Unable to freeze capture upper boundary")
            checkpoint["frozen_upper_cursor"] = [str(boundary["created_on"]), str(boundary["id"])]
            checkpoint["expected_rows"] = target_rows
            atomic_json(paths["checkpoint"], checkpoint)

            cursor.execute(
                "SELECT created_on, id, COUNT(*) AS copies FROM auctions "
                "WHERE created_on >= %s AND " + at_or_before_sql() + " "
                "GROUP BY created_on, id HAVING COUNT(*) > 1 LIMIT 1;",
                (run_config["start_at"], *tuple_params(checkpoint["frozen_upper_cursor"])),
            )
            duplicate_cursor = cursor.fetchone()
            if duplicate_cursor:
                raise RuntimeError(f"Source cursor is not unique inside frozen cohort: {duplicate_cursor}")

        upper = checkpoint["frozen_upper_cursor"]
        remaining = int(checkpoint["expected_rows"]) - int(checkpoint["input_rows"])
        if remaining > 0:
            clauses = ["created_on >= %s", at_or_before_sql()]
            query_params = [run_config["start_at"], *tuple_params(upper)]
            if checkpoint["last_cursor"]:
                clauses.append(after_cursor_sql())
                query_params.extend(tuple_params(checkpoint["last_cursor"]))
            stream = connection.cursor(pymysql.cursors.SSDictCursor)
            stream.execute(
                f"SELECT * FROM auctions WHERE {' AND '.join(clauses)} "
                "ORDER BY created_on ASC, id ASC;",
                tuple(query_params),
            )
            try:
                while remaining > 0:
                    rows = stream.fetchmany(min(run_config["batch_size"], remaining))
                    if not rows:
                        break
                    captured_at = datetime.utcnow().isoformat() + "Z"
                    record_lines = []
                    error_rows = []
                    for row in rows:
                        checkpoint["input_rows"] += 1
                        checkpoint["last_cursor"] = [str(row["created_on"]), str(row["id"])]
                        try:
                            record = source_record(row, captured_at)
                            record_lines.append((json.dumps(record, ensure_ascii=False, separators=(",", ":")) + "\n").encode("utf-8"))
                            checkpoint["output_rows"] += 1
                        except Exception as exc:
                            error_rows.append([row.get("id"), row.get("open_unique_key"), type(exc).__name__, str(exc)])
                            checkpoint["error_rows"] += 1
                    if record_lines:
                        with paths["records"].open("ab") as handle:
                            handle.write(gzip.compress(b"".join(record_lines), compresslevel=6, mtime=0))
                    if error_rows:
                        with paths["errors"].open("a", newline="", encoding="utf-8") as handle:
                            csv.writer(handle).writerows(error_rows)
                    remaining = int(checkpoint["expected_rows"]) - int(checkpoint["input_rows"])
                    checkpoint["record_bytes"] = paths["records"].stat().st_size if paths["records"].exists() else 0
                    checkpoint["error_bytes"] = paths["errors"].stat().st_size
                    checkpoint["updated_at"] = datetime.utcnow().isoformat() + "Z"
                    atomic_json(paths["checkpoint"], checkpoint)
                    print(json.dumps({
                        "event": "capture_checkpoint", "input_rows": checkpoint["input_rows"],
                        "output_rows": checkpoint["output_rows"], "error_rows": checkpoint["error_rows"],
                    }), flush=True)
            finally:
                stream.close()
    finally:
        if connection is not None:
            try:
                connection.rollback()
            finally:
                connection.close()

    runtime_seconds = time.monotonic() - start_monotonic
    reconciled = checkpoint["input_rows"] == checkpoint["output_rows"] + checkpoint["error_rows"]
    complete = checkpoint["input_rows"] == checkpoint["expected_rows"]
    if not reconciled or not complete:
        raise RuntimeError(
            f"Capture reconciliation failed: input={checkpoint['input_rows']} output={checkpoint['output_rows']} "
            f"errors={checkpoint['error_rows']} expected={checkpoint['expected_rows']}"
        )
    validation = verify_capture(paths, checkpoint["output_rows"])
    if not validation["validation_passed"]:
        raise RuntimeError(f"Captured artifact validation failed: {validation}")
    memory_after = available_memory_bytes()
    records_hash = file_sha256(paths["records"])
    errors_hash = file_sha256(paths["errors"])
    rows_per_second = checkpoint["input_rows"] / runtime_seconds if runtime_seconds else 0.0
    reconciliation = {
        "contract": CONTRACT,
        "expected_rows": checkpoint["expected_rows"],
        "input_rows": checkpoint["input_rows"],
        "output_rows": checkpoint["output_rows"],
        "error_rows": checkpoint["error_rows"],
        "difference": checkpoint["input_rows"] - checkpoint["output_rows"] - checkpoint["error_rows"],
        "reconciled": reconciled,
        **validation,
        "production_writes": 0,
        "supabase_writes": 0,
        "watch_records_writes": 0,
    }
    benchmark = {
        "contract": CONTRACT,
        "runtime_seconds": round(runtime_seconds, 3),
        "rows_per_second": round(rows_per_second, 3),
        "peak_rss_bytes": peak_rss_bytes(),
        "available_memory_before_bytes": memory_before,
        "available_memory_after_bytes": memory_after,
        "batch_size": run_config["batch_size"],
        "worker_count": 1,
        "source_query_mode": "FROZEN_TUPLE_BOUNDARY_SERVER_CURSOR",
        "output_bytes": paths["records"].stat().st_size,
        "estimated_full_capture_seconds": round(full_source_rows / rows_per_second, 3) if rows_per_second else None,
        "normalization_status": "NOT_RUN_CAPTURE_ONLY",
        "catalog_status": "NOT_RUN_CAPTURE_ONLY",
        "currency_status": "NOT_RUN_CAPTURE_ONLY",
        "bundle_status": "PRESERVED_SOURCE_FLAG_ONLY",
        "review_disposition": "NOT_RUN_CAPTURE_ONLY",
    }
    manifest = {
        "contract": CONTRACT,
        "source_contract": SOURCE_CONTRACT,
        "source": "thecollective_inventory.auctions",
        "source_mode": "REPEATABLE_READ_READ_ONLY",
        "transport": maria["transport"]["transport"],
        "target": "LOCAL_GZIP_JSONL",
        "started_at": checkpoint["started_at"],
        "completed_at": datetime.utcnow().isoformat() + "Z",
        "start_at": run_config["start_at"],
        "frozen_upper_cursor": checkpoint["frozen_upper_cursor"],
        "full_source_rows_at_snapshot": full_source_rows,
        "schema_columns": schema_columns,
        "records_file": paths["records"].name,
        "records_sha256": records_hash,
        "errors_file": paths["errors"].name,
        "errors_sha256": errors_hash,
        **reconciliation,
    }
    atomic_json(paths["reconciliation"], reconciliation)
    atomic_json(paths["benchmark"], benchmark)
    atomic_json(paths["manifest"], manifest)
    checkpoint["complete"] = True
    checkpoint["completed_at"] = manifest["completed_at"]
    atomic_json(paths["checkpoint"], checkpoint)
    print(json.dumps({"event": "capture_complete", **reconciliation, **benchmark}), flush=True)
    return {"manifest": manifest, "benchmark": benchmark, "reconciliation": reconciliation}


if __name__ == "__main__":
    try:
        run()
    except Exception as exc:
        print(json.dumps({"event": "capture_error", "error_name": type(exc).__name__, "error_message": str(exc)}), file=sys.stderr)
        raise SystemExit(1)
