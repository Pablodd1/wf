#!/usr/bin/env python3
"""Cross-reference competitor Top 25 dealers against Supabase watch_records and update dealer/region fields."""
import csv
import requests
import json
import os
import re

# Load Supabase key
with open('/home/jasme/wf/.env') as f:
    for line in f:
        line = line.strip()
        if line.startswith('SUPABASE_SERVICE_ROLE_KEY='):
            SB_KEY = line.split('=', 1)[1].strip().strip('"').strip("'")
            break

HEADERS = {'apikey': SB_KEY, 'Authorization': f'Bearer {SB_KEY}', 'Content-Type': 'application/json'}
SB_URL = 'https://bptrvfncppbjnchsaxtb.supabase.co/rest/v1/watch_records'

def load_dealers(csv_path):
    dealers = []
    with open(csv_path) as f:
        reader = csv.DictReader(f)
        for row in reader:
            # Extract last 4 digits from masked phone like +130****8263
            phone = row.get('whatsapp_phone', '')
            phone_last4 = ''
            digits = re.findall(r'\d', phone)
            if len(digits) >= 4:
                phone_last4 = ''.join(digits[-4:])
            
            dealers.append({
                'name': row['name'].strip(),
                'name_lower': row['name'].strip().lower(),
                'region': row.get('region', '').strip(),
                'rating': int(row.get('review_count', 0)),
                'wts': int(row.get('wts_listings', 0)),
                'wtb': int(row.get('wtb_listings', 0)),
                'profile_id': row.get('profile_id', '').strip(),
                'phone_last4': phone_last4,
                'profile_url': row.get('profile_url', '').strip(),
            })
    return dealers

def find_matches(dealers):
    """Find Supabase records matching each dealer by name or phone."""
    matches = {}
    
    for d in dealers:
        name = d['name']
        matched_ids = []
        
        # Try exact seller_name match
        r = requests.get(SB_URL, headers=HEADERS, params={
            'select': 'id,brand,reference,seller_name,seller_phone,price_usd,source',
            'seller_name': f'ilike.*{name}*',
            'limit': '100'
        }, timeout=30)
        
        if r.status_code == 200:
            data = r.json()
            for row in data:
                sname = (row.get('seller_name') or '').lower()
                if name.lower() in sname:
                    matched_ids.append(row['id'])
        
        # Also try phone last-4 match if we have phone
        if d['phone_last4'] and not matched_ids:
            r2 = requests.get(SB_URL, headers=HEADERS, params={
                'select': 'id,brand,reference,seller_name,seller_phone,source',
                'seller_phone': f'ilike.*{d["phone_last4"]}',
                'limit': '100'
            }, timeout=30)
            if r2.status_code == 200:
                for row in r2.json():
                    matched_ids.append(row['id'])
                    print(f"  Phone match: {row.get('seller_name')} -> {name}")
        
        matches[name] = {
            'dealer': d,
            'matched_count': len(matched_ids),
            'sample_ids': matched_ids[:3]
        }
        
        if len(matched_ids) > 0:
            print(f"  {name}: {len(matched_ids)} matches")
    
    return matches

def update_dealer_data(matches, dry_run=True):
    """Update watch_records with dealer_id, region, rating for matched rows."""
    updated = 0
    
    for name, info in matches.items():
        d = info['dealer']
        matched = info['matched_count']
        if matched == 0:
            continue
        
        # Get all matching IDs
        all_ids = []
        name_lower = d['name_lower']
        
        r = requests.get(SB_URL, headers=HEADERS, params={
            'select': 'id',
            'seller_name': f'ilike.*{name_lower}*',
            'limit': '1000'
        }, timeout=30)
        
        if r.status_code == 200:
            all_ids = [row['id'] for row in r.json() if name_lower in (row.get('seller_name') or '').lower()]
        
        if not all_ids:
            continue
        
        print(f"\n  Updating {len(all_ids)} records for {name} (rating={d['rating']}, region={d['region']})")
        
        if dry_run:
            print(f"    [DRY RUN] Would set dealer_id={d['profile_id']}, region={d['region']}")
            updated += len(all_ids)
            continue
        
        # PATCH in batches of 200
        for i in range(0, len(all_ids), 200):
            batch = all_ids[i:i+200]
            # Build filter
            ids_str = ','.join(batch)
            
            patch_data = {
                'dealer_id': d['profile_id'],
                'region': d['region'],
            }
            
            r = requests.patch(
                f'{SB_URL}?id=in.({ids_str})',
                headers=HEADERS,
                json=patch_data,
                timeout=60
            )
            if r.status_code in (200, 204):
                updated += len(batch)
            else:
                print(f"    PATCH error: {r.status_code} {r.text[:200]}")
    
    return updated

def main():
    csv_path = '/home/jasme/wf/docs/competitor_top25_rated_dealers.csv'
    dealers = load_dealers(csv_path)
    print(f"Loaded {len(dealers)} dealers")
    
    print("\n=== Finding matches in Supabase ===")
    matches = find_matches(dealers)
    
    total_matched = sum(1 for m in matches.values() if m['matched_count'] > 0)
    total_records = sum(m['matched_count'] for m in matches.values())
    print(f"\n{total_matched}/{len(dealers)} dealers matched, {total_records} total records")
    
    # Show matched dealers
    for name, info in sorted(matches.items(), key=lambda x: -x[1]['matched_count']):
        if info['matched_count'] > 0:
            d = info['dealer']
            print(f"  {name}: {info['matched_count']} records | ★{d['rating']} | {d['region']} | {d['wts']}WTS/{d['wtb']}WTB")
    
    # Show unmatched
    unmatched = [name for name, info in matches.items() if info['matched_count'] == 0]
    if unmatched:
        print(f"\n  UNMATCHED ({len(unmatched)}):")
        for name in unmatched:
            d = next(x['dealer'] for x in matches.values() if x['dealer']['name'] == name)
            print(f"    {name} (phone ...{d['phone_last4']})")
    
    # Update
    print("\n=== Updating Supabase ===")
    updated = update_dealer_data(matches, dry_run=False)
    print(f"\nTotal records updated: {updated}")

if __name__ == '__main__':
    main()
