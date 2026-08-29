import importlib.util
import pathlib
import unittest


MODULE_PATH = pathlib.Path(__file__).parents[1] / "tools" / "mariadb-live" / "postgres-rpc-proxy.py"
SPEC = importlib.util.spec_from_file_location("postgres_rpc_proxy", MODULE_PATH)
PROXY = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(PROXY)


class FakeCursor:
    def __init__(self):
        self.query = None
        self.values = None

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        return False

    def execute(self, query, values=None):
        self.query = query
        self.values = values

    def fetchone(self):
        if "count(*)" in self.query:
            return (15154163,)
        return ({"status": "ok"},)


class FakeConnection:
    def __init__(self):
        self.cursor_instance = FakeCursor()

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        return False

    def cursor(self):
        return self.cursor_instance


class FakePool:
    def __init__(self):
        self.connection = FakeConnection()
        self.returned = 0

    def getconn(self):
        return self.connection

    def putconn(self, _connection):
        self.returned += 1

    def closeall(self):
        return None


class PostgresRpcProxyTests(unittest.TestCase):
    def setUp(self):
        self.pool = FakePool()
        self.database = PROXY.RpcDatabase(pool=self.pool)

    def test_ingest_rpc_uses_all_expected_arguments(self):
        body = {
            "p_run_key": "run-1",
            "p_batch_token": "batch-1",
            "p_contract": "contract-1",
            "p_expected_last_created_on": "1970-01-01 00:00:00",
            "p_expected_last_source_id": "",
            "p_next_last_created_on": "2026-08-10 00:00:00",
            "p_next_last_source_id": "row-1",
            "p_records": [{"source_id": "row-1"}],
        }
        result = self.database.call("ingest_mariadb_raw_batch", body)
        self.assertEqual(result, {"status": "ok"})
        self.assertIn("public.ingest_mariadb_raw_batch", self.pool.connection.cursor_instance.query)
        self.assertEqual(self.pool.connection.cursor_instance.values[:7], tuple(body.values())[:7])
        self.assertEqual(self.pool.returned, 1)

    def test_completion_rpc_and_customer_count_are_read_only(self):
        result = self.database.call("complete_mariadb_raw_import", {
            "p_run_key": "run-1",
            "p_expected_rows": 10,
            "p_expected_last_created_on": "2026-08-10 00:00:00",
            "p_expected_last_source_id": "row-10",
        })
        self.assertEqual(result, {"status": "ok"})
        self.assertIn("public.complete_mariadb_raw_import", self.pool.connection.cursor_instance.query)
        self.assertEqual(self.database.watch_records_count(), 15154163)

    def test_unknown_rpc_fails_closed(self):
        with self.assertRaisesRegex(ValueError, "RPC is not allowed"):
            self.database.call("delete_everything", {})


if __name__ == "__main__":
    unittest.main()
