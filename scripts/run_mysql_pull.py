#!/usr/bin/env python3
"""
run_mysql_pull.py — launcher for mysql_to_supabase.py

USAGE:
  export SUPABASE_KEY="<your-service-role-key>"
  export SUPABASE_URL="https://bptrvfncppbjnchsaxtb.supabase.co"
  export MYSQL_PASS="<mysql-password>"
  python3 scripts/run_mysql_pull.py

All credentials MUST be set as environment variables before running.
Never hardcode keys in this file.
"""
import os, runpy, sys

# Validate required env vars before launching
required = ['SUPABASE_KEY', 'SUPABASE_URL']
missing = [k for k in required if not os.environ.get(k)]
if missing:
    print(f"ERROR: Missing required environment variables: {', '.join(missing)}")
    print("Set them before running: export SUPABASE_KEY=<key>")
    sys.exit(1)

script = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'mysql_to_supabase.py')
sys.argv = [script]
runpy.run_path(script, run_name='__main__')
