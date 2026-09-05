#!/usr/bin/env python3
import os
import sys
import glob
import time
import sys
sys.path.append('/home/jasme/wf/scripts')

from concurrent.futures import ProcessPoolExecutor, as_completed
from pandas_qa_auditor import audit_file_pandas

target_dir = "/mnt/c/Users/jasme/Downloads/WF/ALL watches normalized/3 PP rolex and au"
files = sorted(glob.glob(os.path.join(target_dir, "*.xlsx")))

log_file = "/tmp/audit_3_pp_rolex_au.log"

with open(log_file, "w") as log:
    log.write(f"Starting audit across {len(files)} files in {target_dir}...\n")

t0 = time.time()
results = []

with ProcessPoolExecutor(max_workers=4) as executor:
    futures = {executor.submit(audit_file_pandas, f): f for f in files}
    for idx, future in enumerate(as_completed(futures), 1):
        try:
            res = future.result()
            if res:
                results.append(res)
                with open(log_file, "a") as log:
                    log.write(f"[{idx}/{len(files)}] Audited {res['fname']} ({res['rows']} rows)\n")
        except Exception as e:
            with open(log_file, "a") as log:
                log.write(f"Error in {futures[future]}: {e}\n")

total_rows = sum(r['rows'] for r in results)
summary = f"COMPLETED! Audited {len(results)}/{len(files)} files ({total_rows} total rows) in {time.time()-t0:.2f} seconds.\n"

with open(log_file, "a") as log:
    log.write(summary)

print(summary)
