import os
import sys
import psycopg2
from pathlib import Path

db_url = os.environ.get("DATABASE_URL")
if not db_url:
    print("DATABASE_URL not set.")
    sys.exit(1)

conn = psycopg2.connect(db_url)
conn.autocommit = True
cur = conn.cursor()

cur.execute("""
    CREATE TABLE IF NOT EXISTS supabase_migrations.schema_migrations (
        version varchar(255) PRIMARY KEY,
        statements text[],
        name varchar(255)
    );
""")

migrations_dir = Path("supabase/migrations")
migrations = sorted(list(migrations_dir.glob("*.sql")))

for migration in migrations:
    version = migration.name.split('_')[0]
    cur.execute("SELECT 1 FROM supabase_migrations.schema_migrations WHERE version = %s", (version,))
    if not cur.fetchone():
        print(f"Applying migration: {migration.name}")
        import subprocess
        try:
            print(f"Applying migration via psql: {migration.name}")
            result = subprocess.run(["psql", db_url, "-f", str(migration), "-v", "ON_ERROR_STOP=1"], capture_output=True, text=True)
            if result.returncode != 0:
                print(f"Failed to apply {migration.name}:\n{result.stderr}")
                sys.exit(1)
            cur.execute("INSERT INTO supabase_migrations.schema_migrations (version, name) VALUES (%s, %s)", (version, migration.name))
            print(f"Successfully applied {version}")
        except Exception as e:
            print(f"Failed to apply {migration.name}: {e}")
            sys.exit(1)
    else:
        print(f"Skipping already applied migration: {migration.name}")

print("All migrations applied.")
