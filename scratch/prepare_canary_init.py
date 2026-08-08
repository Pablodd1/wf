import json
import os
import sys
import urllib.request
import urllib.parse

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(__file__)), "scripts"))
from pipeline_processor import WatchFactsPipelineProcessor

SUPABASE_PROJECT_ID = "qnsafosakvonzgfcsphh"
MCP_CONFIG_PATH = r"C:\Users\Owner\.gemini\antigravity\mcp\supabase-mcp-server\execute_sql.json"

# We use the Supabase MCP API / REST / Management endpoint to execute SQL statements safely
def sql_q(val, is_uuid=False):
    if val is None:
        return "NULL"
    if isinstance(val, bool):
        return "TRUE" if val else "FALSE"
    if isinstance(val, (int, float)):
        return str(val)
    s = str(val).replace("'", "''").replace("\r", " ").replace("\n", " ")
    if is_uuid:
        return f"'{s}'::uuid"
    return f"'{s}'"

json_path = r"C:\Users\Owner\.gemini\antigravity\brain\aaaf9af1-6067-468b-bfc7-1bac307799f6\scratch\canary_json\raw_payloads.json"
with open(json_path, "r", encoding="utf-8") as f:
    raw_payloads = json.load(f)

print(f"1. Preparing 500 raw payloads & jobs...")
processor = WatchFactsPipelineProcessor()

# Generate SQL statements
sql_statements = []
sql_statements.append("TRUNCATE staging.listings, jobs.processing_jobs, raw.payloads RESTART IDENTITY CASCADE;")

# Chunk payloads insertion
for i in range(0, len(raw_payloads), 100):
    chunk = raw_payloads[i:i+100]
    p_rows = []
    j_rows = []
    for p in chunk:
        p_rows.append(f"({sql_q(p['id'], True)}, {sql_q(p['source_platform'])}, {sql_q(p['source_group_id'])}, {sql_q(p['source_group_name'])}, {sql_q(p['source_message_id'])}, {sql_q(p['source_sender_id'])}, {sql_q(p['source_sender_name'])}, {sql_q(p['original_message_text'])}, NOW(), {sql_q(p['payload_checksum'])})")
        j_rows.append(f"({sql_q(p['id'], True)}, {sql_q(p['id'], True)}, 'queued'::jobs.processing_status, NOW(), NOW())")
    
    p_sql = "INSERT INTO raw.payloads (id, source_platform, source_group_id, source_group_name, source_message_id, source_sender_id, source_sender_name, original_message_text, original_timestamp, payload_checksum) VALUES " + ",\n".join(p_rows) + " ON CONFLICT (id) DO NOTHING;"
    j_sql = "INSERT INTO jobs.processing_jobs (id, raw_payload_id, status, created_at, updated_at) VALUES " + ",\n".join(j_rows) + " ON CONFLICT (id) DO NOTHING;"
    sql_statements.append(p_sql)
    sql_statements.append(j_sql)

print(f"Generated {len(sql_statements)} initialization SQL statements.")
