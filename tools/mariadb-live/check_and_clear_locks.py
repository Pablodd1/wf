import os
import sys
import psycopg2

db_url = os.environ.get("DATABASE_URL")
conn = psycopg2.connect(db_url)
conn.autocommit = True
cur = conn.cursor()

print("Checking pg_stat_activity...")
cur.execute("""
  SELECT pid, usename, state, wait_event_type, wait_event, query_start, LEFT(query, 100)
  FROM pg_stat_activity
  WHERE pid <> pg_backend_pid()
    AND datname = current_database();
""")
for r in cur.fetchall():
  print(r)

# Terminate any idle-in-transaction connections older than 1 minute
cur.execute("""
  SELECT pg_terminate_backend(pid)
  FROM pg_stat_activity
  WHERE pid <> pg_backend_pid()
    AND datname = current_database()
    AND state IN ('idle in transaction', 'idle in transaction (aborted)', 'active')
    AND query_start < NOW() - INTERVAL '2 minutes';
""")
term = cur.fetchall()
print(f"Terminated {len(term)} stale backends.")
