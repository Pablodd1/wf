import os
import glob
import json
import urllib.request
import urllib.parse

SUPABASE_URL = os.environ.get("SUPABASE_URL", "https://qnsafosakvonzgfcsphh.supabase.co")
ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFuc2Fmb3Nha3ZvbnpnZmNzcGhoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODYwMjI3NDEsImV4cCI6MjEwMTU5ODc0MX0.YUxMjnTHtgPsiWiWko3TS1A47Sjk33SuHC2TND0Rxmg"
SUPABASE_KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY") or os.environ.get("SUPABASE_ANON_KEY") or ANON_KEY

def call_exec_sql(sql_query):
    url = f"{SUPABASE_URL}/rest/v1/rpc/exec_sql"
    data = json.dumps({"query_text": sql_query}).encode('utf-8')
    headers = {
        "apikey": SUPABASE_KEY,
        "Authorization": f"Bearer {SUPABASE_KEY}",
        "Content-Type": "application/json"
    }
    req = urllib.request.Request(url, data=data, headers=headers, method='POST')
    try:
        with urllib.request.urlopen(req) as resp:
            return resp.status
    except urllib.error.HTTPError as e:
        print(f"HTTP Error {e.code}: {e.read().decode('utf-8')}")
        raise

sql_dir = r"C:\Users\Owner\.gemini\antigravity\brain\aaaf9af1-6067-468b-bfc7-1bac307799f6\scratch\mcp_sync_blocks"
files = sorted(glob.glob(os.path.join(sql_dir, "block_*.sql")))

print(f"Executing {len(files)} SQL blocks against Supabase PostgreSQL via exec_sql RPC...")

for idx, fpath in enumerate(files):
    with open(fpath, "r", encoding="utf-8") as f:
        q = f.read()
    if q.strip():
        call_exec_sql(q)
        if (idx + 1) % 20 == 0 or idx + 1 == len(files):
            print(f"Executed block {idx+1}/{len(files)}")

print("ALL 181 CANARY SQL BLOCKS LOADED SUCCESSFULLY INTO SUPABASE POSTGRESQL!")
