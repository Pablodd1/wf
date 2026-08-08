import json
import os

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
    payloads = json.load(f)

print(f"Loaded {len(payloads)} payloads.")

payload_rows = []
job_rows = []

for p in payloads:
    p_row = f"({sql_q(p['id'], True)}, {sql_q(p['source_platform'])}, {sql_q(p['source_group_id'])}, {sql_q(p['source_group_name'])}, {sql_q(p['source_message_id'])}, {sql_q(p['source_sender_id'])}, {sql_q(p['source_sender_name'])}, {sql_q(p['original_message_text'])}, NOW(), {sql_q(p['payload_checksum'])})"
    payload_rows.append(p_row)
    
    j_row = f"({sql_q(p['id'], True)}, {sql_q(p['id'], True)}, 'queued'::jobs.processing_status, NOW(), NOW())"
    job_rows.append(j_row)

out_dir = r"C:\Users\Owner\.gemini\antigravity\brain\aaaf9af1-6067-468b-bfc7-1bac307799f6\scratch\queued_canary_sql"
os.makedirs(out_dir, exist_ok=True)

# Write 5 chunks of 100
for i in range(5):
    p_chunk = payload_rows[i*100:(i+1)*100]
    j_chunk = job_rows[i*100:(i+1)*100]
    
    p_sql = "INSERT INTO raw.payloads (id, source_platform, source_group_id, source_group_name, source_message_id, source_sender_id, source_sender_name, original_message_text, original_timestamp, payload_checksum) VALUES " + ",\n".join(p_chunk) + " ON CONFLICT (id) DO NOTHING;"
    j_sql = "INSERT INTO jobs.processing_jobs (id, raw_payload_id, status, created_at, updated_at) VALUES " + ",\n".join(j_chunk) + " ON CONFLICT (id) DO NOTHING;"
    
    with open(os.path.join(out_dir, f"payloads_{i+1}.sql"), "w", encoding="utf-8") as f:
        f.write(p_sql)
    with open(os.path.join(out_dir, f"jobs_{i+1}.sql"), "w", encoding="utf-8") as f:
        f.write(j_sql)

print(f"Successfully generated payload and job SQL chunk files in {out_dir}.")
