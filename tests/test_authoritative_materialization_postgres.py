"""PostgreSQL integration test for dependency-preserving authoritative refresh.

This test is deliberately disabled unless MATERIALIZATION_TEST_DATABASE_URL points
to an isolated, disposable PostgreSQL database. It must never target production.
"""

import os
import unittest
import uuid

import psycopg2
from psycopg2 import sql


class AuthoritativeMaterializationPostgresTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.database_url = os.environ.get("MATERIALIZATION_TEST_DATABASE_URL")
        if not cls.database_url:
            raise unittest.SkipTest("MATERIALIZATION_TEST_DATABASE_URL is not configured")
        if "bptrvfncppbjnchsaxtb" in cls.database_url:
            raise RuntimeError("Refusing to run materialization integration test against production")

        cls.schema = "wf_materialization_test_" + uuid.uuid4().hex[:12]
        cls.conn = psycopg2.connect(cls.database_url)
        cls.conn.autocommit = False
        with cls.conn.cursor() as cur:
            cur.execute(sql.SQL("CREATE SCHEMA {}").format(sql.Identifier(cls.schema)))
        cls.conn.commit()

    @classmethod
    def tearDownClass(cls):
        if not getattr(cls, "conn", None):
            return
        with cls.conn.cursor() as cur:
            cur.execute(sql.SQL("DROP SCHEMA {} CASCADE").format(sql.Identifier(cls.schema)))
        cls.conn.commit()
        cls.conn.close()

    def test_global_precedence_and_dependent_view_survive_refresh(self):
        with self.conn.cursor() as cur:
            cur.execute(
                sql.SQL(
                    """
                    CREATE TABLE {}.source_versions (
                      id text PRIMARY KEY,
                      source_id text NOT NULL,
                      source_record_id text NOT NULL,
                      source_created_on text NOT NULL,
                      canonicalization_version text NOT NULL,
                      source_hash text NOT NULL
                    );
                    CREATE TABLE {}.authoritative (
                      id text PRIMARY KEY,
                      source_id text UNIQUE NOT NULL,
                      source_hash text NOT NULL
                    );
                    CREATE VIEW {}.authoritative_consumer AS
                      SELECT source_id, source_hash FROM {}.authoritative;
                    """
                ).format(
                    sql.Identifier(self.schema),
                    sql.Identifier(self.schema),
                    sql.Identifier(self.schema),
                    sql.Identifier(self.schema),
                )
            )
            source_id = "cross-boundary-source"
            cur.execute(
                sql.SQL(
                    """
                    INSERT INTO {}.source_versions VALUES
                      ('page-1', %s, 'legacy-record', '2025-01-01 00:00:00', 'legacy', %s),
                      ('page-2', %s, %s, '2025-01-01T00:00:00.000Z',
                       'v1-json-keys-sorted-compact', %s);
                    CREATE TEMP TABLE authoritative_build ON COMMIT DROP AS
                    SELECT DISTINCT ON (source_id)
                      id, source_id, source_hash
                    FROM {}.source_versions
                    ORDER BY source_id,
                      CASE WHEN source_record_id = 'mysql_auctions_' || source_id THEN 1 ELSE 2 END,
                      CASE WHEN source_created_on LIKE '%%T%%Z' THEN 1 ELSE 2 END,
                      CASE WHEN canonicalization_version = 'v1-json-keys-sorted-compact' THEN 1 ELSE 2 END,
                      source_hash,
                      id;
                    """
                ).format(sql.Identifier(self.schema)),
                (
                    source_id,
                    "f" * 64,
                    source_id,
                    "mysql_auctions_" + source_id,
                    "a" * 64,
                ),
            )

            # This is the production promotion pattern: preserve the stable table
            # OID, refresh it transactionally, then read through an attached view.
            cur.execute(sql.SQL("LOCK TABLE {}.authoritative IN ACCESS EXCLUSIVE MODE").format(sql.Identifier(self.schema)))
            cur.execute(sql.SQL("TRUNCATE TABLE {}.authoritative").format(sql.Identifier(self.schema)))
            cur.execute(
                sql.SQL(
                    "INSERT INTO {}.authoritative SELECT id, source_id, source_hash FROM authoritative_build"
                ).format(sql.Identifier(self.schema))
            )
            cur.execute(sql.SQL("SELECT id, source_hash FROM {}.authoritative").format(sql.Identifier(self.schema)))
            self.assertEqual(cur.fetchone(), ("page-2", "a" * 64))
            cur.execute(sql.SQL("SELECT source_id, source_hash FROM {}.authoritative_consumer").format(sql.Identifier(self.schema)))
            self.assertEqual(cur.fetchone(), (source_id, "a" * 64))
        self.conn.rollback()


if __name__ == "__main__":
    unittest.main()
