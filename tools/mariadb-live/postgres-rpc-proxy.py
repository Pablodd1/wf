"""Localhost-only bridge from the immutable REST importer to PostgreSQL RPCs.

The bridge exists for a one-time self-hosted production import. It never exposes
the database password to Node, never binds a public interface, and accepts only
the two immutable raw-copy functions.
"""

from __future__ import annotations

import argparse
import json
import os
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import psycopg2
from psycopg2.extras import Json
from psycopg2.pool import ThreadedConnectionPool


MAX_BODY_BYTES = 32 * 1024 * 1024
RPC_PATHS = {
    "/rest/v1/rpc/ingest_mariadb_raw_batch": "ingest_mariadb_raw_batch",
    "/rest/v1/rpc/complete_mariadb_raw_import": "complete_mariadb_raw_import",
}


def required(name: str) -> str:
    value = str(os.environ.get(name, "")).strip()
    if not value:
        raise RuntimeError(f"{name} is required")
    return value


def connection_kwargs() -> dict:
    return {
        "host": required("PGHOST"),
        "port": int(os.environ.get("PGPORT", "5432")),
        "user": required("PGUSER"),
        "password": required("PGPASSWORD"),
        "dbname": required("PGDATABASE"),
        "sslmode": os.environ.get("PGSSLMODE", "require"),
        "connect_timeout": 20,
        "application_name": "watchfacts_immutable_raw_import",
    }


class RpcDatabase:
    def __init__(self, pool=None):
        self.pool = pool or ThreadedConnectionPool(1, 4, **connection_kwargs())

    def call(self, function_name: str, body: dict):
        if function_name == "ingest_mariadb_raw_batch":
            query = """
                SELECT public.ingest_mariadb_raw_batch(
                  %s, %s, %s, %s, %s, %s, %s, %s::jsonb
                ) AS result
            """
            values = (
                body.get("p_run_key"),
                body.get("p_batch_token"),
                body.get("p_contract"),
                body.get("p_expected_last_created_on"),
                body.get("p_expected_last_source_id"),
                body.get("p_next_last_created_on"),
                body.get("p_next_last_source_id"),
                Json(body.get("p_records") or []),
            )
        elif function_name == "complete_mariadb_raw_import":
            query = """
                SELECT public.complete_mariadb_raw_import(%s, %s, %s, %s) AS result
            """
            values = (
                body.get("p_run_key"),
                body.get("p_expected_rows"),
                body.get("p_expected_last_created_on"),
                body.get("p_expected_last_source_id"),
            )
        else:
            raise ValueError("RPC is not allowed")

        connection = self.pool.getconn()
        try:
            with connection:
                with connection.cursor() as cursor:
                    cursor.execute(query, values)
                    row = cursor.fetchone()
                    return row[0] if row else None
        finally:
            self.pool.putconn(connection)

    def watch_records_count(self) -> int:
        connection = self.pool.getconn()
        try:
            with connection:
                with connection.cursor() as cursor:
                    cursor.execute("SELECT count(*) FROM public.watch_records")
                    return int(cursor.fetchone()[0])
        finally:
            self.pool.putconn(connection)

    def close(self):
        self.pool.closeall()


class RpcHandler(BaseHTTPRequestHandler):
    server_version = "WatchFactsLocalRpc/1"

    def _reply(self, status: int, payload):
        encoded = json.dumps(payload, separators=(",", ":"), default=str).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(encoded)))
        self.end_headers()
        self.wfile.write(encoded)

    def _authorized(self) -> bool:
        expected = self.server.local_token
        bearer = self.headers.get("Authorization", "")
        api_key = self.headers.get("apikey", "")
        return bool(expected) and api_key == expected and bearer == f"Bearer {expected}"

    def do_GET(self):
        if self.path == "/health":
            return self._reply(200, {"status": "ok", "bind": "localhost"})
        return self._reply(404, {"error": "not_found"})

    def do_POST(self):
        if not self._authorized():
            return self._reply(401, {"error": "unauthorized"})
        function_name = RPC_PATHS.get(self.path)
        if not function_name:
            return self._reply(404, {"error": "rpc_not_allowed"})
        try:
            length = int(self.headers.get("Content-Length", "0"))
            if length <= 0 or length > MAX_BODY_BYTES:
                return self._reply(413, {"error": "invalid_body_size"})
            body = json.loads(self.rfile.read(length))
            result = self.server.database.call(function_name, body)
            return self._reply(200, result)
        except Exception as error:  # fail closed; never include credentials
            self.server.logger(json.dumps({
                "event": "local_rpc_error",
                "rpc": function_name,
                "error_type": type(error).__name__,
                "error": str(error)[:500],
            }))
            return self._reply(500, {"error": "rpc_failed"})

    def log_message(self, _format, *_args):
        return


def serve(port: int):
    token = required("LOCAL_RPC_TOKEN")
    database = RpcDatabase()
    server = ThreadingHTTPServer(("127.0.0.1", port), RpcHandler)
    server.local_token = token
    server.database = database
    server.logger = print
    try:
        print(json.dumps({"event": "local_rpc_ready", "host": "127.0.0.1", "port": port}), flush=True)
        server.serve_forever(poll_interval=0.25)
    finally:
        server.server_close()
        database.close()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("command", choices=["serve", "watch-record-count"])
    parser.add_argument("--port", type=int, default=8765)
    args = parser.parse_args()
    if args.command == "serve":
        serve(args.port)
        return
    database = RpcDatabase()
    try:
        print(json.dumps({"watch_records": database.watch_records_count()}))
    finally:
        database.close()


if __name__ == "__main__":
    main()
