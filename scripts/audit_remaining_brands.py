#!/usr/bin/env python3
import os
import sys
import glob
import time
sys.path.append('/home/jasme/wf/scripts')

from concurrent.futures import ProcessPoolExecutor, as_completed
from pandas_qa_auditor import audit_file_pandas

target_dir = "/mnt/c/Users/jasme/Downloads/WF/ALL watches normalized/3 PP rolex and au"
all_files = sorted([f for f in glob.glob(os.path.join(target_dir, "*.xlsx")) if os.path.isfile(f)])

log_file = "/tmp/audit_3_pp_rolex_au.log"

with open(log_file, "w") as log:
    log.write(f"Starting master audit across {len(all_files)} files in {target_dir}...\n")

t0 = time.time()
results = []

with ProcessPoolExecutor(max_workers=14) as executor:
    futures = {executor.submit(audit_file_pandas, f): f for f in all_files}
    for idx, future in enumerate(as_completed(futures), 1):
        fpath = futures[future]
        fname = os.path.basename(fpath)
        try:
            res = future.result()
            if res:
                results.append(res)
                with open(log_file, "a") as log:
                    log.write(f"[{idx}/{len(all_files)}] Audited {fname} ({res['rows']} rows)\n")
        except Exception as e:
            with open(log_file, "a") as log:
                log.write(f"Error in {fname}: {e}\n")

total_rows = sum(r['rows'] for r in results)
summary = f"\n==================================================\nMASTER AUDIT COMPLETED!\nAudited {len(results)}/{len(all_files)} files ({total_rows} total rows) in {time.time()-t0:.2f} seconds.\n==================================================\n"

with open(log_file, "a") as log:
    log.write(summary)

print(summary)
