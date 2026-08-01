#!/usr/bin/env python3
"""
Fast Vectorized Dial Conflict Pass (Pandas + Multiprocessing)
Target Directory: /mnt/c/Users/jasme/Downloads/WF/ALL watches normalized/

Directives:
1. Identify rows where raw_line explicitly names a dial color.
2. If stored Dial Color is missing/unknown -> fill from raw_line, set dial_resolution_source='RAW_TEXT'.
3. If stored Dial Color contradicts raw_line text -> text evidence wins (update Dial Color = text_dial),
   set qa_disposition='HUMAN_REVIEW_REQUIRED', dial_resolution_source='RAW_TEXT_CONFLICT'.
4. Skip OceanDigital files (already text-derived).
5. Edits files in place atomically.
"""

import os
import sys
import glob
import re
import json
import time
import shutil
from concurrent.futures import ProcessPoolExecutor, as_completed
import pandas as pd

NORM_DIR = "/mnt/c/Users/jasme/Downloads/WF/ALL watches normalized"
REPORT_FILE = "/tmp/dial_conflict_report.json"

DIALS = [
    ('mother of pearl', 'Mother of Pearl'), ('mop', 'Mother of Pearl'),
    ('ice blue', 'Ice Blue'), ('tiffany blue', 'Tiffany Blue'), ('tiffany', 'Tiffany Blue'),
    ('olive green', 'Olive Green'), ('olive', 'Olive Green'),
    ('mint green', 'Mint Green'), ('navy blue', 'Navy Blue'), ('wimbledon', 'Wimbledon'),
    ('rhodium', 'Rhodium'), ('meteorite', 'Meteorite'), ('skeleton', 'Skeleton'),
    ('champagne', 'Champagne'), ('champ', 'Champagne'),
    ('chocolate', 'Chocolate'), ('choc', 'Chocolate'), ('salmon', 'Salmon'),
    ('bronze', 'Bronze'), ('slate', 'Slate'), ('panda', 'Panda'),
    ('black', 'Black'), ('blk', 'Black'), ('white', 'White'), ('wht', 'White'),
    ('blue', 'Blue'), ('blu', 'Blue'), ('green', 'Green'), ('grn', 'Green'),
    ('silver', 'Silver'), ('slv', 'Silver'), ('grey', 'Grey'), ('gray', 'Grey'),
    ('pink', 'Pink'), ('red', 'Red'), ('yellow', 'Yellow'), ('brown', 'Brown'),
    ('purple', 'Purple'), ('cream', 'Cream'), ('beige', 'Beige'), ('orange', 'Orange'),
]

ALIASES = {
    'gray': 'grey', 'mop': 'mother of pearl', 'tiffany': 'tiffany blue', 'tiffany blue': 'tiffany blue',
    'olive': 'olive green', 'navy': 'navy blue', 'champ': 'champagne', 'choc': 'chocolate',
    'blk': 'black', 'wht': 'white', 'blu': 'blue', 'grn': 'green', 'slv': 'silver'
}

def canon(color):
    if not color or pd.isna(color):
        return ''
    c = str(color).strip().lower()
    if c in ('unknown', 'none', 'null', 'n/a', ''):
        return ''
    return ALIASES.get(c, c)

def process_single_file(fpath):
    fname = os.path.basename(fpath)
    if fname.startswith('OceanDigital'):
        return None

    try:
        df = pd.read_excel(fpath, engine='openpyxl')
    except Exception as e:
        return {'file': fname, 'error': str(e)}

    # Ensure required columns
    for col in ['Dial Color', 'raw_line', 'qa_disposition', 'dial_resolution_source']:
        if col not in df.columns:
            df[col] = ''
        df[col] = df[col].fillna('').astype(str)

    raw_lines = df['raw_line'].str.lower()
    stored_dials = df['Dial Color']

    # Extract text-derived dial
    extracted_dials = pd.Series('', index=df.index, dtype=object)
    for kw, canonical in DIALS:
        pattern = r'\b' + re.escape(kw) + r'\b'
        unmatched_mask = (extracted_dials == '')
        if not unmatched_mask.any():
            break
        match = raw_lines.str.contains(pattern, regex=True, na=False) & unmatched_mask
        if match.any():
            extracted_dials[match] = canonical

    # Calculate canonical forms for comparison
    canon_stored = stored_dials.apply(canon)
    canon_extracted = extracted_dials.apply(canon)

    has_extracted = canon_extracted != ''
    has_stored = canon_stored != ''

    # Case 1: Fill missing/unknown dial from text
    fill_mask = has_extracted & (~has_stored)

    # Case 2: Conflict where both exist and differ
    conflict_mask = has_extracted & has_stored & (canon_stored != canon_extracted)

    if not (fill_mask.any() or conflict_mask.any()):
        return {'file': fname, 'filled': 0, 'conflicts': 0, 'modified': False}

    # Apply fills
    if fill_mask.any():
        df.loc[fill_mask, 'Dial Color'] = extracted_dials[fill_mask]
        df.loc[fill_mask, 'dial_resolution_source'] = 'RAW_TEXT'

    # Apply conflict resolution (text evidence wins, flag human review)
    if conflict_mask.any():
        df.loc[conflict_mask, 'Dial Color'] = extracted_dials[conflict_mask]
        df.loc[conflict_mask, 'qa_disposition'] = 'HUMAN_REVIEW_REQUIRED'
        df.loc[conflict_mask, 'dial_resolution_source'] = 'RAW_TEXT_CONFLICT'

    # Save modified file atomically
    tmp_path = f"/tmp/{fname}"
    df.to_excel(tmp_path, index=False, engine='openpyxl')
    shutil.copyfile(tmp_path, fpath)
    os.remove(tmp_path)

    return {
        'file': fname,
        'filled': int(fill_mask.sum()),
        'conflicts': int(conflict_mask.sum()),
        'modified': True
    }

def main():
    files = sorted(glob.glob(os.path.join(NORM_DIR, "*.xlsx")))
    files = [f for f in files if not os.path.basename(f).startswith('OceanDigital')]
    print(f"Starting dial conflict pass on {len(files)} files...", flush=True)

    t0 = time.time()
    results = []

    with ProcessPoolExecutor(max_workers=12) as executor:
        futures = {executor.submit(process_single_file, f): f for f in files}
        for idx, future in enumerate(as_completed(futures), 1):
            fpath = futures[future]
            fname = os.path.basename(fpath)
            try:
                res = future.result()
                if res:
                    results.append(res)
            except Exception as e:
                results.append({'file': fname, 'error': str(e)})

            if idx % 50 == 0 or idx == len(files):
                print(f"  Processed {idx}/{len(files)} files ({time.time()-t0:.1f}s)...", flush=True)

    total_filled = sum(r.get('filled', 0) for r in results)
    total_conflicts = sum(r.get('conflicts', 0) for r in results)
    modified_files = sum(1 for r in results if r.get('modified', False))

    summary = {
        'total_files_evaluated': len(files),
        'files_modified': modified_files,
        'dials_filled_from_text': total_filled,
        'conflicts_flagged_human_review': total_conflicts,
        'top_conflict_files': sorted([r for r in results if r.get('conflicts', 0) > 0],
                                     key=lambda x: -x['conflicts'])[:20],
        'elapsed_seconds': round(time.time() - t0, 2)
    }

    with open(REPORT_FILE, 'w') as f:
        json.dump(summary, f, indent=2)

    print("\n==================================================")
    print("           DIAL CONFLICT PASS REPORT              ")
    print("==================================================")
    print(f"Files Evaluated       : {summary['total_files_evaluated']}")
    print(f"Files Modified        : {summary['files_modified']}")
    print(f"Dials Filled (Text)   : {summary['dials_filled_from_text']}")
    print(f"Conflicts (Human Rev) : {summary['conflicts_flagged_human_review']}")
    print(f"Elapsed Time          : {summary['elapsed_seconds']}s")
    print("==================================================\n")

if __name__ == '__main__':
    main()
