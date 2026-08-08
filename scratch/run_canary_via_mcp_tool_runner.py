import os
import glob
import json

sql_dir = r"C:\Users\Owner\.gemini\antigravity\brain\aaaf9af1-6067-468b-bfc7-1bac307799f6\scratch\mcp_full_canary_chunks"
sql_files = sorted(glob.glob(os.path.join(sql_dir, "q_*.sql")))

print(f"Reading {len(sql_files)} SQL files...")

# We will group statements into ~250KB blocks
blocks = []
current_block = []
current_size = 0

for fpath in sql_files:
    with open(fpath, "r", encoding="utf-8") as f:
        content = f.read().strip()
        if content:
            sz = len(content.encode('utf-8'))
            if current_size + sz > 250000 and current_block:
                blocks.append("\n".join(current_block))
                current_block = []
                current_size = 0
            current_block.append(content)
            current_size += sz

if current_block:
    blocks.append("\n".join(current_block))

print(f"Grouped into {len(blocks)} blocks (each ~250KB).")

out_dir = r"C:\Users\Owner\.gemini\antigravity\brain\aaaf9af1-6067-468b-bfc7-1bac307799f6\scratch\mcp_blocks_250k"
os.makedirs(out_dir, exist_ok=True)

for idx, btext in enumerate(blocks):
    with open(os.path.join(out_dir, f"block_{idx+1:02d}.sql"), "w", encoding="utf-8") as f:
        f.write(btext)

print(f"Wrote {len(blocks)} blocks to {out_dir}.")
