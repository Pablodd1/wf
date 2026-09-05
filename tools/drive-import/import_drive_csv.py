"""Stream a WatchFacts CSV export into immutable PostgreSQL staging tables.

Designed for a Cloud Run Job. The importer is idempotent: rerunning the same
file skips rows already stored by source row/hash and updates a database-backed
checkpoint. It never writes to public.watch_records.
"""

from __future__ import annotations

import csv
import hashlib
import json
import os
import pathlib
import sys
import tempfile
from typing import Iterator

import psycopg2
from psycopg2.extras import Json, execute_values
import requests


EXPECTED_COLUMNS = {
    "id",
    "raw_message",
    "brand",
    "reference",
    "dial_color",
    "condition",
    "year",
    "price_raw",
    "price_usd",
    "currency",
    "confidence",
    "verdict",
    "source",
    "listing_type",
    "parser_version",
    "created_at",
    "processed_at",
}

INSERT_SQL = """
INSERT INTO staging.drive_watch_records (
  source_file_id, source_row_number, source_record_id, row_sha256,
  raw_message, brand_claimed, reference_claimed, dial_color_claimed,
  condition_claimed, year_claimed, price_raw_claimed, price_usd_claimed,
  currency_claimed, confidence_claimed, verdict_claimed, source_claimed,
  listing_type_claimed, parser_version_claimed, created_at_claimed,
  processed_at_claimed, raw_row
) VALUES %s
ON CONFLICT DO NOTHING
"""


def required(name: str) -> str:
    value = os.getenv(name, "").strip()
    if not value:
        raise RuntimeError(f"Missing required environment variable: {name}")
    return value


def download_source(source_uri: str, destination: pathlib.Path) -> None:
    if source_uri.startswith("gs://"):
        from google.cloud import storage

        bucket_name, object_name = source_uri[5:].split("/", 1)
        storage.Client().bucket(bucket_name).blob(object_name).download_to_filename(destination)
        return

    with requests.get(source_uri, stream=True, timeout=(30, 300)) as response:
        response.raise_for_status()
        with destination.open("wb") as output:
            for chunk in response.iter_content(chunk_size=8 * 1024 * 1024):
                if chunk:
                    output.write(chunk)


def normalized_row(row: dict[str, str | None]) -> dict[str, str]:
    return {str(key): "" if value is None else str(value) for key, value in row.items()}


def row_digest(row: dict[str, str]) -> str:
    payload = json.dumps(row, sort_keys=True, ensure_ascii=False, separators=(",", ":"))
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def row_values(source_file_id: str, row_number: int, row: dict[str, str]) -> tuple:
    return (
        source_file_id,
        row_number,
        row.get("id") or None,
        row_digest(row),
        row.get("raw_message") or None,
        row.get("brand") or None,
        row.get("reference") or None,
        row.get("dial_color") or None,
        row.get("condition") or None,
        row.get("year") or None,
        row.get("price_raw") or None,
        row.get("price_usd") or None,
        row.get("currency") or None,
        row.get("confidence") or None,
        row.get("verdict") or None,
        row.get("source") or None,
        row.get("listing_type") or None,
        row.get("parser_version") or None,
        row.get("created_at") or None,
        row.get("processed_at") or None,
        Json(row),
    )


def batches(reader: Iterator[dict[str, str | None]], size: int) -> Iterator[list[tuple[int, dict[str, str]]]]:
    batch: list[tuple[int, dict[str, str]]] = []
    for row_number, raw_row in enumerate(reader, start=2):
        batch.append((row_number, normalized_row(raw_row)))
        if len(batch) >= size:
            yield batch
            batch = []
    if batch:
        yield batch


def main() -> int:
    database_url = required("DATABASE_URL")
    source_uri = required("SOURCE_URI")
    source_file_id = required("SOURCE_FILE_ID")
    source_name = os.getenv("SOURCE_NAME", "watchfacts_export.csv")
    source_size = int(os.getenv("SOURCE_SIZE_BYTES", "0") or 0)
    batch_size = max(100, min(int(os.getenv("BATCH_SIZE", "5000")), 20000))

    with tempfile.TemporaryDirectory() as temp_dir:
        csv_path = pathlib.Path(temp_dir) / "source.csv"
        print(f"Downloading {source_name} to job-local storage", flush=True)
        download_source(source_uri, csv_path)

        connection = psycopg2.connect(database_url, sslmode="require")
        connection.autocommit = False
        try:
            with connection.cursor() as cursor:
                cursor.execute(
                    """
                    INSERT INTO staging.drive_import_runs (
                      source_file_id, source_name, source_size_bytes, status, started_at, updated_at
                    ) VALUES (%s, %s, %s, 'RUNNING', now(), now())
                    ON CONFLICT (source_file_id) DO UPDATE SET
                      status = 'RUNNING', updated_at = now(), last_error = NULL
                    """,
                    (source_file_id, source_name, source_size or csv_path.stat().st_size),
                )
                connection.commit()

            rows_seen = 0
            rows_inserted = 0
            with csv_path.open("r", encoding="utf-8-sig", errors="replace", newline="") as source:
                reader = csv.DictReader(source)
                columns = set(reader.fieldnames or [])
                missing = sorted(EXPECTED_COLUMNS - columns)
                if missing:
                    raise RuntimeError(f"CSV is missing expected columns: {', '.join(missing)}")

                for batch in batches(reader, batch_size):
                    values = [row_values(source_file_id, row_number, row) for row_number, row in batch]
                    with connection.cursor() as cursor:
                        execute_values(cursor, INSERT_SQL, values, page_size=batch_size)
                        rows_inserted += cursor.rowcount
                        rows_seen += len(batch)
                        cursor.execute(
                            """
                            UPDATE staging.drive_import_runs SET
                              rows_seen = %s,
                              rows_inserted = (SELECT count(*) FROM staging.drive_watch_records WHERE source_file_id = %s),
                              last_source_row = %s,
                              updated_at = now()
                            WHERE source_file_id = %s
                            """,
                            (rows_seen, source_file_id, batch[-1][0], source_file_id),
                        )
                    connection.commit()
                    print(f"rows_seen={rows_seen} inserted_this_run={rows_inserted}", flush=True)

            with connection.cursor() as cursor:
                cursor.execute(
                    """
                    UPDATE staging.drive_import_runs SET
                      status = 'COMPLETE', completed_at = now(), updated_at = now()
                    WHERE source_file_id = %s
                    """,
                    (source_file_id,),
                )
            connection.commit()
            return 0
        except Exception as error:
            connection.rollback()
            with connection.cursor() as cursor:
                cursor.execute(
                    """
                    UPDATE staging.drive_import_runs SET
                      status = 'FAILED', last_error = %s, updated_at = now()
                    WHERE source_file_id = %s
                    """,
                    (str(error)[:2000], source_file_id),
                )
            connection.commit()
            raise
        finally:
            connection.close()


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        print(f"import failed: {exc}", file=sys.stderr, flush=True)
        raise

