import os
import glob

sql_dir = r"C:\Users\Owner\.gemini\antigravity\brain\aaaf9af1-6067-468b-bfc7-1bac307799f6\scratch\mcp_full_canary_chunks"
sql_files = sorted(glob.glob(os.path.join(sql_dir, "q_*.sql")))

print(f"Reading {len(sql_files)} query chunk files...")

out_dir = r"C:\Users\Owner\.gemini\antigravity\brain\aaaf9af1-6067-468b-bfc7-1bac307799f6\scratch\mcp_clean_10_chunks"
os.makedirs(out_dir, exist_ok=True)

# 1. Truncate + Payloads
p_sqls = []
for fpath in sql_files[:11]:
    with open(fpath, "r", encoding="utf-8") as f:
        p_sqls.append(f.read())

with open(os.path.join(out_dir, "step_1_payloads.sql"), "w", encoding="utf-8") as f:
    f.write("\n".join(p_sqls))

# 2. Jobs
j_sqls = []
for fpath in sql_files[11:21]:
    with open(fpath, "r", encoding="utf-8") as f:
        j_sqls.append(f.read())

with open(os.path.join(out_dir, "step_2_jobs.sql"), "w", encoding="utf-8") as f:
    f.write("\n".join(j_sqls))

# 3. Listings (files 21..181 = 160 files) -> split into 8 files of 20 query blocks each
listing_files = sql_files[21:]
num_chunks = 8
chunk_len = len(listing_files) // num_chunks

for idx in range(num_chunks):
    sub = listing_files[idx*chunk_len : (idx+1)*chunk_len] if idx < num_chunks - 1 else listing_files[idx*chunk_len:]
    l_sqls = []
    for fpath in sub:
        with open(fpath, "r", encoding="utf-8") as f:
            l_sqls.append(f.read())
    with open(os.path.join(out_dir, f"step_{idx+3}_listings.sql"), "w", encoding="utf-8") as f:
        f.write("\n".join(l_sqls))

print(f"Generated 10 clean SQL steps in {out_dir}.")
