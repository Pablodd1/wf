import os
import glob
import json
import urllib.request
import urllib.parse

# We use the Supabase MCP or REST endpoint with service role key if available, or execute SQL queries in python
sql_dir = r"C:\Users\Owner\.gemini\antigravity\brain\aaaf9af1-6067-468b-bfc7-1bac307799f6\scratch\mcp_combined_canary_sql"
files = [
    "batch_1_init_payloads.sql",
    "batch_2_jobs.sql",
    "batch_3_listings_1.sql",
    "batch_4_listings_2.sql",
    "batch_5_listings_3.sql"
]

print(f"Reading {len(files)} batch files...")
for fname in files:
    fpath = os.path.join(sql_dir, fname)
    with open(fpath, "r", encoding="utf-8") as f:
        content = f.read()
    print(f"File {fname}: {len(content)} bytes, {content.count(';') if content else 0} SQL statements")

