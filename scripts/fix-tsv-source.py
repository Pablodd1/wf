#!/usr/bin/env python3
"""
FIX TSV FILES (source of truth):
1. Clear price/HKD from reference column
2. Extract real reference from rawMessage
3. Mark multi-watch as HUMAN verdict
4. Cross-reference dial color from reference catalog
"""

import re, os, json

DESKTOP = '/mnt/c/Users/jasme/Desktop'
CATALOG_PATH = '/home/jasme/wf/api/_lib/reference-catalog.json'

# Load catalog for dial cross-reference
try:
    with open(CATALOG_PATH) as f:
        cat_data = json.load(f)
    catalog = cat_data.get('catalog', cat_data)
except:
    catalog = {}

# Brand ref patterns
BRAND_PATTERNS = {
    'Rolex': re.compile(r'\b(\d{4,6}[A-Za-z]{0,4})\b'),
    'Patek Philippe': re.compile(r'\b(\d{4,5}/\d{1,2}[A-Za-z]?)\b'),
    'Audemars Piguet': re.compile(r'\b(\d{5,6}[A-Z]{2,})\b'),
    'Richard Mille': re.compile(r'.?(RM\d{2,3})\b', re.I),
    'Cartier': re.compile(r'\b([Ww]\d{4,}[A-Za-z]*)\b'),
    'Omega': re.compile(r'\b(\d{3}\.\d{2}\.\d{2}\.\d{2}\.\d{3})\b'),
    'IWC': re.compile(r'.?(IW\d{5,6})\b', re.I),
    'Panerai': re.compile(r'.?(PAM\d{5,6})\b', re.I),
    'Hublot': re.compile(r'\b(\d{3}\.[A-Z]{2}\.\d{4}\.[A-Z]{2})\b'),
    'Jaeger-LeCoultre': re.compile(r'.?(Q\d{6,7})\b'),
    'Breitling': re.compile(r'\b([A-Z]\d{5,7}[A-Z]\d[A-Z]\d)\b'),
    'Tudor': re.compile(r'.?(M\d{5}-\d{4})\b'),
    'Zenith': re.compile(r'\b(\d{2}\.\d{4}\.\d{4})\b'),
}

HKD_REF = re.compile(r'HKD|hkd|USD|EUR|CHF|CNY|[$¥£€]|^\d+K$|^\d+m$')

def get_dial_from_catalog(brand, ref):
    """Try to find dial color from reference catalog"""
    if brand not in catalog:
        return None
    brand_cat = catalog[brand]
    for model, refs in brand_cat.items():
        if ref in refs:
            # Check if model name contains color clues
            color_clues = {
                'green': ['green', 'verde'],
                'blue': ['blue', 'bleu', 'blu'],
                'black': ['black', 'noir', 'nero', 'blk'],
                'white': ['white', 'blanc', 'bianco'],
                'silver': ['silver', 'argent'],
                'red': ['red', 'rouge', 'rosso'],
                'gold': ['gold', 'or'],
            }
            model_l = model.lower()
            for color, clues in color_clues.items():
                for clue in clues:
                    if clue in model_l:
                        return color.title()
    return None

files = [f for f in os.listdir(DESKTOP) if f.startswith('WF_') and f.endswith('_corrected.tsv')]

total_fixed = 0
total_human = 0
total_dial = 0

for path in sorted(files):
    full_path = os.path.join(DESKTOP, path)
    with open(full_path) as f:
        lines = f.readlines()
    
    header = lines[0].strip().split('\t')
    ref_idx = header.index('reference') if 'reference' in header else -1
    raw_idx = header.index('rawMessage') if 'rawMessage' in header else (header.index('raw_message') if 'raw_message' in header else -1)
    dial_idx = header.index('dialColor') if 'dialColor' in header else -1
    verdict_idx = header.index('verdict') if 'verdict' in header else -1
    brand_idx = header.index('brand') if 'brand' in header else -1
    multi_idx = header.index('multiWatch') if 'multiWatch' in header else -1
    
    brand_name = path.replace('WF_WTS_', '').replace('WF_WTB_', '').replace('_corrected.tsv', '').replace('_', ' ')
    ref_pattern = BRAND_PATTERNS.get(brand_name)
    
    fixed_lines = [lines[0]]
    file_fixed = 0
    file_human = 0
    file_dial = 0
    
    for line in lines[1:]:
        if not line.strip():
            fixed_lines.append(line)
            continue
        
        cols = line.strip().split('\t')
        ref = cols[ref_idx] if ref_idx >= 0 and ref_idx < len(cols) else ''
        raw = cols[raw_idx] if raw_idx >= 0 and raw_idx < len(cols) else ''
        dial = cols[dial_idx] if dial_idx >= 0 and dial_idx < len(cols) else ''
        verdict = cols[verdict_idx] if verdict_idx >= 0 and verdict_idx < len(cols) else ''
        
        ref_needs_fix = False
        
        # Check if ref looks like HKD/price
        if not ref or ref in ('None', '', '0'):
            ref_needs_fix = True
        elif HKD_REF.search(ref):
            ref_needs_fix = True
        elif re.match(r'^\d{5,7}$', ref) and len(ref) >= 5:
            if not re.match(r'^\d{5,6}[A-Za-z]', ref):
                ref_needs_fix = True
        
        # Count HKD lines = multi-watch indicator
        hkd_lines = len([l for l in raw.split('\n') if re.search(r'HKD|hkd|HK\$', l)])
        is_multi = hkd_lines >= 2
        
        if ref_needs_fix and ref_idx >= 0:
            new_ref = ''
            if ref_pattern:
                for raw_line in raw.split('\n')[:20]:
                    if re.search(r'HKD|hkd|price|stock|confirm|[??\?]', raw_line):
                        continue
                    match = ref_pattern.search(raw_line)
                    if match:
                        candidate = match.group(1)
                        if not re.match(r'^(19|20)\d{2}$', candidate):
                            new_ref = candidate
                            break
            cols[ref_idx] = new_ref
            file_fixed += 1
        
        # Set multi-watch to HUMAN
        if is_multi and verdict_idx >= 0 and verdict.upper() != 'HUMAN':
            cols[verdict_idx] = 'HUMAN'
            file_human += 1
        if is_multi and multi_idx >= 0:
            cols[multi_idx] = 'YES'
        
        # Cross-reference dial from catalog
        if dial_idx >= 0 and (not dial or dial in ('None', '', '0', 'null', 'undefined')):
            catalog_dial = get_dial_from_catalog(brand_name, cols[ref_idx] if ref_idx >= 0 and cols[ref_idx] else ref)
            if catalog_dial:
                cols[dial_idx] = catalog_dial
                file_dial += 1
        
        fixed_lines.append('\t'.join(cols) + '\n')
    
    # Write back
    with open(full_path, 'w') as f:
        f.writelines(fixed_lines)
    
    if file_fixed or file_human or file_dial:
        print(f'  ✓ {path}: {file_fixed} refs, {file_human} HUMAN, {file_dial} dial')
    total_fixed += file_fixed
    total_human += file_human
    total_dial += file_dial

print(f'\n✓ TOTAL: {total_fixed} refs fixed, {total_human} HUMAN, {total_dial} dial from catalog')
print(f'✓ TSV files updated on Desktop')
