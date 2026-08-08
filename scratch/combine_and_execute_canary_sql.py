import os
import glob

sql_dir = r"C:\Users\Owner\.gemini\antigravity\brain\aaaf9af1-6067-468b-bfc7-1bac307799f6\scratch\mcp_full_canary_chunks"
sql_files = sorted(glob.glob(os.path.join(sql_dir, "q_*.sql")))

print(f"Found {len(sql_files)} SQL files in {sql_dir}.")

combined_dir = r"C:\Users\Owner\.gemini\antigravity\brain\aaaf9af1-6067-468b-bfc7-1bac307799f6\scratch\mcp_combined_canary_sql"
os.makedirs(combined_dir, exist_ok=True)

# Read file 1 (TRUNCATE)
with open(sql_files[0], "r", encoding="utf-8") as f:
    truncate_sql = f.read()

# Files 2..11 (Payloads)
payload_sqls = []
for fpath in sql_files[1:11]:
    with open(fpath, "r", encoding="utf-8") as f:
        payload_sqls.append(f.read())

# Files 11..21 (Jobs)
job_sqls = []
for fpath in sql_files[11:21]:
    with open(fpath, "r", encoding="utf-8") as f:
        job_sqls.append(f.read())

# Files 21..end (Listings)
listing_sqls = []
for fpath in sql_files[21:]:
    with open(fpath, "r", encoding="utf-8") as f:
        listing_sqls.append(f.read())

# Combine into 4 main files
c1 = truncate_sql + "\n" + "\n".join(payload_sqls)
c2 = "\n".join(job_sqls)

# Split listing_sqls into 3 chunks
l_chunk_size = len(listing_sqls) // 3
c3 = "\n".join(listing_sqls[:l_chunk_size])
c4 = "\n".join(listing_sqls[l_chunk_size:l_chunk_size*2])
c5 = "\n".join(listing_sqls[l_chunk_size*2:])

with open(os.path.join(combined_dir, "batch_1_init_payloads.sql"), "w", encoding="utf-8") as f:
    f.write(c1)
with open(os.path.join(combined_dir, "batch_2_jobs.sql"), "w", encoding="utf-8") as f:
    f.write(c2)
with open(os.path.join(combined_dir, "batch_3_listings_1.sql"), "w", encoding="utf-8") as f:
    f.write(c3)
with open(os.path.join(combined_dir, "batch_4_listings_2.sql"), "w", encoding="utf-8") as f:
    f.write(c4)
with open(os.path.join(combined_dir, "batch_5_listings_3.sql"), "w", encoding="utf-8") as f:
    f.write(c5)

print(f"Created 5 combined SQL files in {combined_dir}.")
