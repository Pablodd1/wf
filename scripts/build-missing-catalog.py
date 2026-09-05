#!/usr/bin/env python3
"""
Build a supplemental reference catalog by searching online for references missing
from the existing catalog/enriched_refs.json.

Finds references with:
- brand = "Unknown" or low confidence
- No catalog match (not in catalog.json or enriched_refs.json)

Then calls the /api/online-search endpoint for each unique missing reference
and builds public/missing_refs.json that the parser can consult during review.

Usage: python3 scripts/build-missing-catalog.py [--limit N] [--dry-run]
"""

import json, sys, os, time, urllib.request, urllib.error

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PUBLIC_DIR = os.path.join(BASE_DIR, 'public')
PARSED_FILE = os.path.join(PUBLIC_DIR, 'parsedWatches.json')
CATALOG_FILE = os.path.join(PUBLIC_DIR, 'catalog.json')
ENRICHED_FILE = os.path.join(PUBLIC_DIR, 'enriched_refs.json')
OUTPUT_FILE = os.path.join(PUBLIC_DIR, 'missing_refs.json')

API_BASE = os.environ.get('WF_API_BASE', 'https://watchfacts-poc.vercel.app')
API_URL = f'{API_BASE}/api/online-search'

LIMIT = 50  # max references to search (each costs ~$0.0002 API call)
DRY_RUN = False
DELAY = 0.5  # seconds between API calls

for i, arg in enumerate(sys.argv[1:], 1):
    if arg == '--dry-run':
        DRY_RUN = True
    elif arg == '--limit' and i < len(sys.argv) - 1:
        LIMIT = int(sys.argv[i+1])

# -- Normalize reference for comparison --
def norm_ref(ref):
    return ''.join(c.upper() for c in str(ref) if c.isalnum())

# -- Load existing catalog references (set of normalized refs) --
def load_known_refs():
    known = set()
    for fpath in [CATALOG_FILE, ENRICHED_FILE]:
        if not os.path.exists(fpath):
            continue
        with open(fpath) as f:
            data = json.load(f)
        for entry in data:
            ref = norm_ref(entry.get('reference', ''))
            if ref:
                known.add(ref)
    return known

# -- Scan parsedWatches.json for unique missing references --
def find_missing_refs(known_refs):
    if not os.path.exists(PARSED_FILE):
        print(f"ERROR: {PARSED_FILE} not found")
        return []
    
    with open(PARSED_FILE) as f:
        data = json.load(f)
    
    # Data is an array of arrays: [id, brand, reference, dial, price, priceUSD, currency, condition, rawMessage, ...]
    # Or array of objects
    missing = {}  # norm_ref -> { reference, brand, sample_message, count }
    
    for row in data:
        if isinstance(row, list):
            brand = row[1] if len(row) > 1 else 'Unknown'
            ref = row[2] if len(row) > 2 else ''
            raw = row[8] if len(row) > 8 else ''
        else:
            brand = row.get('brand', 'Unknown')
            ref = row.get('reference', '')
            raw = row.get('rawMessage', row.get('sourceLine', ''))
        
        nref = norm_ref(ref)
        if not nref or nref in known_refs:
            continue
        
        if nref not in missing:
            missing[nref] = {
                'reference': ref,
                'brand': brand if brand != 'Unknown' else None,
                'sample_message': raw[:200] if raw else '',
                'count': 0,
            }
        missing[nref]['count'] += 1
    
    # Sort by count descending (most frequent missing refs first)
    return sorted(missing.values(), key=lambda x: -x['count'])

# -- Call online-search API --
def search_ref(entry, dry_run=False):
    if dry_run:
        print(f"  [DRY RUN] Would search: {entry['reference']} ({entry['brand'] or 'Unknown'}) x{entry['count']}")
        return {'reference': entry['reference'], 'brand': entry['brand'] or 'Unknown', 'confidence': 0, 'source': 'dry-run'}
    
    payload = json.dumps({
        'reference': entry['reference'],
        'brand': entry['brand'],
        'rawMessage': entry['sample_message'],
    }).encode('utf-8')
    
    req = urllib.request.Request(API_URL, data=payload, headers={
        'Content-Type': 'application/json',
    })
    
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            result = json.loads(resp.read())
            if result.get('success'):
                return {
                    'reference': result.get('reference', entry['reference']),
                    'brand': result.get('brand', entry['brand'] or 'Unknown'),
                    'model': result.get('model'),
                    'collection': result.get('collection'),
                    'year': result.get('year'),
                    'case_material': result.get('caseMaterial'),
                    'dial_colors': result.get('dialColors'),
                    'price_range': result.get('priceRange'),
                    'confidence': result.get('confidence', 0),
                    'source': result.get('source', 'online-search'),
                    'notes': result.get('notes'),
                    'occurrences': entry['count'],
                }
            else:
                print(f"  API returned error: {result.get('error', 'unknown')}")
                return None
    except urllib.error.HTTPError as e:
        print(f"  HTTP {e.code}: {e.reason}")
        return None
    except Exception as e:
        print(f"  Failed: {e}")
        return None

# -- Main --
def main():
    known = load_known_refs()
    print(f"Loaded {len(known):,} known references from catalog + enriched_refs")
    
    missing = find_missing_refs(known)
    print(f"Found {len(missing):,} unique missing references in parsedWatches.json")
    
    if not missing:
        print("Nothing to do!")
        return
    
    # Show top missing by count
    print(f"\nTop missing references (limit={LIMIT}):")
    for i, entry in enumerate(missing[:20]):
        print(f"  {i+1}. {entry['reference']:20s} {entry['brand'] or 'Unknown':20s} x{entry['count']:,}")
    
    if LIMIT < len(missing):
        print(f"  ... and {len(missing) - LIMIT} more (will search top {LIMIT})")
    
    # Search each missing ref
    results = []
    for i, entry in enumerate(missing[:LIMIT]):
        print(f"\n[{i+1}/{min(LIMIT, len(missing))}] Searching: {entry['reference']} ({entry['brand'] or 'Unknown'})...")
        result = search_ref(entry, dry_run=DRY_RUN)
        if result:
            results.append(result)
            print(f"  → {result.get('brand', '?')} {result.get('model', '')} (confidence: {result.get('confidence', 0)}%)")
        else:
            print(f"  → No result")
        if not DRY_RUN and i < LIMIT - 1:
            time.sleep(DELAY)
    
    # Save results
    if results and not DRY_RUN:
        # Load existing missing_refs if any
        existing = []
        if os.path.exists(OUTPUT_FILE):
            with open(OUTPUT_FILE) as f:
                existing = json.load(f)
        
        # Merge: new results override existing entries with same reference
        existing_map = {norm_ref(r['reference']): r for r in existing}
        for r in results:
            existing_map[norm_ref(r['reference'])] = r
        
        merged = list(existing_map.values())
        merged.sort(key=lambda x: -x.get('confidence', 0))
        
        with open(OUTPUT_FILE, 'w') as f:
            json.dump(merged, f, indent=2, ensure_ascii=False)
        
        print(f"\n✓ Saved {len(merged)} entries to {OUTPUT_FILE}")
        print(f"  New this run: {len(results)}")
        print(f"  Total catalog now: {len(merged)} missing refs with AI enrichment")
    elif DRY_RUN:
        print(f"\n[Dry run complete — {len(results)} references would be added]")

if __name__ == '__main__':
    main()
