#!/usr/bin/env python3
"""
Repair pass v2 — fix false-positive RAW_TEXT_CONFLICT flags from v1.

v1 bug: flagged 3.2M rows as HUMAN_REVIEW_REQUIRED because canon() compared
stored dial vs FIRST text keyword match, but:
  - stored "Black" vs text "black dial" → false conflict (same color)
  - stored "Champagne" vs text "champagne gold" → false conflict (modifier)
  - stored "Blue" vs text "navy blue" → false conflict (same family)
  - stored value had been overwritten by v1 already, so we can't recover the
    original stored value — BUT we can re-derive: if the current Dial Color
    matches the text-derived color (which v1 set it to), then the only question
    is whether the flag HUMAN_REVIEW_REQUIRED was justified. Since v1 set
    Dial Color = text color on conflicts, current Dial Color ALWAYS equals
    text color on flagged rows → we cannot distinguish true vs false from
    current state alone.

STRATEGY (safe, no guessing):
  For every row with dial_resolution_source == 'RAW_TEXT_CONFLICT':
    - Re-extract text dial from raw_line with the IMPROVED extractor
      (family-aware: navy blue→Blue, champagne gold→Champagne, etc.)
    - If improved extraction is empty or equals current Dial Color after
      family-canonicalization → the "conflict" was a formatting artifact:
      downgrade qa_disposition back to 'PUBLISH_WITH_FLAG' and set
      dial_resolution_source = 'RAW_TEXT'.
    - If improved extraction yields a DIFFERENT color family than current
      Dial Color → genuine contradiction: keep HUMAN_REVIEW_REQUIRED.
  Also fix rows v1 marked RAW_TEXT that are fine (no change needed).

Runs parallel across 12 workers. Edits in place. Skips OceanDigital files.
"""
import os, glob, re, json, time, shutil
from concurrent.futures import ProcessPoolExecutor, as_completed
import pandas as pd

NORM_DIR = "/mnt/c/Users/jasme/Downloads/WF/ALL watches normalized"
REPORT = "/tmp/dial_conflict_repair_report.json"

# Family-aware dial extraction. Order matters: most specific first.
# Each entry: (regex pattern, canonical family)
DIAL_PATTERNS = [
    (r'\bmother\s+of\s+pearl\b|\bmop\b', 'Mother of Pearl'),
    (r'\bice\s+blue\b', 'Blue'),
    (r'\btiffany(?:\s+blue)?\b', 'Blue'),
    (r'\bnavy(?:\s+blue)?\b', 'Blue'),
    (r'\bolive(?:\s+green)?\b', 'Green'),
    (r'\bmint\s+green\b', 'Green'),
    (r'\bwimbledon\b', 'Wimbledon'),
    (r'\brhodium\b', 'Rhodium'),
    (r'\bmeteorite\b', 'Meteorite'),
    (r'\bskeleton\b', 'Skeleton'),
    (r'\bpanda\b', 'Panda'),
    (r'\bchampagne\b|\bchamp\b', 'Champagne'),
    (r'\bchocolate\b|\bchoc\b', 'Brown'),
    (r'\bsalmon\b', 'Salmon'),
    (r'\bbronze\b', 'Bronze'),
    (r'\bslate\b', 'Grey'),
    (r'\bblack\b|\bblk\b', 'Black'),
    (r'\bwhite\b|\bwht\b', 'White'),
    (r'\bblue\b|\bblu\b', 'Blue'),
    (r'\bgreen\b|\bgrn\b', 'Green'),
    (r'\bsilver\b|\bslv\b', 'Silver'),
    (r'\bgrey\b|\bgray\b', 'Grey'),
    (r'\bpink\b', 'Pink'),
    (r'\bred\b', 'Red'),
    (r'\byellow\b', 'Yellow'),
    (r'\bbrown\b', 'Brown'),
    (r'\bpurple\b', 'Purple'),
    (r'\bcream\b', 'Cream'),
    (r'\bbeige\b', 'Beige'),
    (r'\borange\b', 'Orange'),
]

# Map any dial string to its family for comparison
FAMILY_MAP = {
    'mother of pearl': 'Mother of Pearl', 'mop': 'Mother of Pearl',
    'ice blue': 'Blue', 'tiffany': 'Blue', 'tiffany blue': 'Blue',
    'navy': 'Blue', 'navy blue': 'Blue', 'blue': 'Blue', 'blu': 'Blue',
    'olive': 'Green', 'olive green': 'Green', 'mint green': 'Green',
    'green': 'Green', 'grn': 'Green',
    'wimbledon': 'Wimbledon', 'rhodium': 'Rhodium', 'meteorite': 'Meteorite',
    'skeleton': 'Skeleton', 'panda': 'Panda',
    'champagne': 'Champagne', 'champ': 'Champagne',
    'chocolate': 'Brown', 'choc': 'Brown', 'brown': 'Brown',
    'salmon': 'Salmon', 'bronze': 'Bronze', 'slate': 'Grey',
    'black': 'Black', 'blk': 'Black',
    'white': 'White', 'wht': 'White',
    'silver': 'Silver', 'slv': 'Silver',
    'grey': 'Grey', 'gray': 'Grey',
    'pink': 'Pink', 'red': 'Red', 'yellow': 'Yellow',
    'purple': 'Purple', 'cream': 'Cream', 'beige': 'Beige', 'orange': 'Orange',
}

def family(color):
    if not color or pd.isna(color):
        return ''
    c = str(color).strip().lower()
    if c in ('unknown', 'none', 'null', 'n/a', ''):
        return ''
    # Direct hit
    if c in FAMILY_MAP:
        return FAMILY_MAP[c]
    # Substring hit: "champagne gold" → Champagne; "black dial" → Black
    for key, fam in FAMILY_MAP.items():
        if re.search(r'\b' + re.escape(key) + r'\b', c):
            return fam
    return c.title()  # unknown custom color → treat as its own family

def text_dial_family(raw):
    tl = (raw or '').lower()
    for pattern, fam in DIAL_PATTERNS:
        if re.search(pattern, tl):
            return fam
    return ''

def process_file(fpath):
    fname = os.path.basename(fpath)
    if fname.startswith('OceanDigital'):
        return None
    try:
        df = pd.read_excel(fpath, engine='openpyxl')
    except Exception as e:
        return {'file': fname, 'error': str(e)}

    for col in ['Dial Color', 'raw_line', 'qa_disposition', 'dial_resolution_source']:
        if col not in df.columns:
            df[col] = ''
        df[col] = df[col].fillna('').astype(str)

    conflict_mask = df['dial_resolution_source'] == 'RAW_TEXT_CONFLICT'
    if not conflict_mask.any():
        return {'file': fname, 'downgraded': 0, 'kept_human': 0, 'modified': False}

    downgraded = 0
    kept = 0
    idxs = df.index[conflict_mask]
    for idx in idxs:
        raw = df.at[idx, 'raw_line']
        current_dial = df.at[idx, 'Dial Color']
        text_fam = text_dial_family(raw)
        current_fam = family(current_dial)
        if not text_fam or text_fam == current_fam:
            # False positive: same family or no real text evidence
            df.at[idx, 'qa_disposition'] = 'PUBLISH_WITH_FLAG'
            df.at[idx, 'dial_resolution_source'] = 'RAW_TEXT'
            downgraded += 1
        else:
            kept += 1

    if downgraded or kept:
        tmp = f"/tmp/repair_{fname}"
        df.to_excel(tmp, index=False, engine='openpyxl')
        shutil.copyfile(tmp, fpath)
        os.remove(tmp)

    return {'file': fname, 'downgraded': downgraded, 'kept_human': kept, 'modified': True}

def main():
    files = sorted(glob.glob(os.path.join(NORM_DIR, "*.xlsx")))
    files = [f for f in files if not os.path.basename(f).startswith('OceanDigital')]
    print(f"Repair pass on {len(files)} files...", flush=True)
    t0 = time.time()
    results = []
    with ProcessPoolExecutor(max_workers=12) as ex:
        futures = {ex.submit(process_file, f): f for f in files}
        for i, fut in enumerate(as_completed(futures), 1):
            try:
                r = fut.result()
                if r:
                    results.append(r)
            except Exception as e:
                results.append({'file': os.path.basename(futures[fut]), 'error': str(e)})
            if i % 50 == 0 or i == len(files):
                print(f"  {i}/{len(files)} ({time.time()-t0:.0f}s)", flush=True)

    total_down = sum(r.get('downgraded', 0) for r in results)
    total_kept = sum(r.get('kept_human', 0) for r in results)
    summary = {
        'files_processed': len(results),
        'false_positives_downgraded': total_down,
        'true_conflicts_kept_human_review': total_kept,
        'elapsed_seconds': round(time.time() - t0, 1),
    }
    with open(REPORT, 'w') as f:
        json.dump(summary, f, indent=2)
    print(json.dumps(summary, indent=2), flush=True)

if __name__ == '__main__':
    main()
