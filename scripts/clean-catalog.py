#!/usr/bin/env python3
"""
CLEAN CATALOG REFERENCE: Removes non-reference strings from reference-catalog.json.
- Pocket watch strings ("144350" in Waltham) → flag as POSSIBLE_ROLEX_REF
- Non-watch strings (bags, straps, accessories) → remove from catalog
- Duplicate entries → deduplicate by reference+brand

Output: reference-catalog-clean.json
"""

import json
import re
import os

CATALOG_PATH = '/home/jasme/wf/api/dictionaries/reference-catalog.json'
OUTPUT_PATH = '/home/jasme/wf/api/dictionaries/reference-catalog-clean.json'
AUDIT_PATH = '/home/jasme/wf/CATALOG_AUDIT_v2.json'

with open(CATALOG_PATH, 'r') as f:
    catalog = json.load(f)

if isinstance(catalog, dict):
    entries = []
    for brand, refs in catalog.items():
        if isinstance(refs, list):
            for ref in refs:
                entries.append({'brand': brand, 'reference': str(ref)})
        elif isinstance(refs, dict):
            for ref, data in refs.items():
                entries.append({'brand': brand, 'reference': str(ref), 'data': data})
else:
    entries = catalog

print(f"Loaded {len(entries)} catalog entries")

# Contamination patterns to flag
NON_REF_PATTERNS = [
    r'^\d{4,7}$',  # Could be a price, not a reference
    r'bag|strap|bracelet|buckle|deployant|crown|dial|bezel|case back',  # Watch parts
    r'pocket watch',  # Pocket watch descriptions
    r'$|¥|£|€|USD|HKD|CNY',  # Price-like strings
]

cleaned = []
flagged = []
duplicates = set()

for entry in entries:
    brand = entry.get('brand', 'Unknown')
    ref = entry.get('reference', '')
    ref_str = str(ref).strip()
    
    # Skip empty references
    if not ref_str or ref_str == 'None' or ref_str == '':
        flagged.append({
            'brand': brand,
            'reference': ref_str,
            'reason': 'EMPTY_OR_NONE',
            'action': 'REMOVED'
        })
        continue
    
    # Skip price-like references (4-7 digit numbers that could be prices)
    if re.match(r'^\d{4,7}$', ref_str):
        flagged.append({
            'brand': brand,
            'reference': ref_str,
            'reason': 'POSSIBLE_PRICE_REF',
            'action': 'FLAGGED'
        })
        # Keep but flag
        cleaned.append(entry)
        continue
    
    # Skip non-watch references (bags, straps, etc.)
    skip = False
    for pattern in NON_REF_PATTERNS[1:]:
        if re.search(pattern, ref_str, re.IGNORECASE):
            flagged.append({
                'brand': brand,
                'reference': ref_str,
                'reason': 'NON_WATCH_STRING',
                'action': 'REMOVED'
            })
            skip = True
            break
    if skip:
        continue
    
    # Deduplicate by (brand, reference)
    key = (brand, ref_str)
    if key in duplicates:
        flagged.append({
            'brand': brand,
            'reference': ref_str,
            'reason': 'DUPLICATE',
            'action': 'REMOVED'
        })
        continue
    duplicates.add(key)
    
    cleaned.append(entry)

print(f"Cleaned: {len(cleaned)} entries")
print(f"Flagged/removed: {len(flagged)} entries")

# Save cleaned catalog
with open(OUTPUT_PATH, 'w') as f:
    json.dump(cleaned, f, indent=2)
print(f"✓ Cleaned catalog: {OUTPUT_PATH}")

# Save audit
with open(AUDIT_PATH, 'w') as f:
    json.dump({'cleaned': len(cleaned), 'flagged': len(flagged), 'details': flagged}, f, indent=2)
print(f"✓ Audit: {AUDIT_PATH}")
