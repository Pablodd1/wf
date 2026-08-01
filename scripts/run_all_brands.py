#!/usr/bin/env python3
"""
Master Parallel QA Audit & Enrichment Runner (Pandas Edition)
Executes pandas_qa_auditor.py across all 354 Excel files concurrently.
"""

import os
import sys
import glob
import time
import json
from concurrent.futures import ProcessPoolExecutor, as_completed

from pandas_qa_auditor import audit_file_pandas

PROGRESS_FILE = "/tmp/qa_audit_progress.json"

def load_progress():
    if os.path.exists(PROGRESS_FILE):
        try:
            with open(PROGRESS_FILE, 'r') as f:
                return json.load(f)
        except Exception:
            return {}
    return {}

def save_progress(completed_files):
    try:
        with open(PROGRESS_FILE, 'w') as f:
            json.dump(completed_files, f)
    except Exception:
        pass

def main():
    folder = "/mnt/c/Users/jasme/Downloads/WF/ALL watches normalized"
    pattern = sys.argv[1] if len(sys.argv) > 1 else "*.xlsx"
    files = sorted(glob.glob(os.path.join(folder, pattern)))
    
    completed = load_progress()
    files_to_process = [f for f in files if os.path.basename(f) not in completed]
    
    print(f"Total files matched: {len(files)}")
    print(f"Already completed: {len(completed)}")
    print(f"Remaining to process: {len(files_to_process)}")

    if not files_to_process:
        print("All files in this batch already processed!")
        return

    # Process in parallel using 4 worker processes
    t0 = time.time()
    results = []

    with ProcessPoolExecutor(max_workers=4) as executor:
        future_to_file = {executor.submit(audit_file_pandas, f): f for f in files_to_process}
        
        for idx, future in enumerate(as_completed(future_to_file), 1):
            fpath = future_to_file[future]
            fname = os.path.basename(fpath)
            try:
                res = future.result()
                if res:
                    results.append(res)
                    completed[fname] = res
                    save_progress(completed)
                    print(f"[{idx}/{len(files_to_process)}] Finished {fname} ({res['rows']} rows)")
            except Exception as e:
                print(f"Error processing {fname}: {e}")

    print(f"\nBatch completed in {time.time()-t0:.2f} seconds.")

if __name__ == '__main__':
    main()
