#!/usr/bin/env python3
"""
Bulk normalize REVIEW → APPROVED using the real Node parser.
Runs a Node subprocess that uses the actual lookupCatalog function.
Processes 1000 at a time (limited by individual UPDATE speed).
"""
import json, time, sys, subprocess, urllib.request, urllib.parse, os

SUPABASE_URL = 'https://bptrvfncppbjnchsaxtb.supabase.co'
SERVICE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJwdHJ2Zm5jcHBiam5jaHNheHRiIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4MTU2MjYzMSwiZXhwIjoyMDk3MTM4NjMxfQ.x1KpnBCtgcn02hiBJfuNkm3FYq6elHv3Gnys62nu8SU'

HEADERS = {
    'apikey': SERVICE_KEY,
    'Authorization': f'Bearer {SERVICE_KEY}',
    'Content-Type': 'application/json',
    'Accept': 'application/json',
}

def fetch_batch(last_id=None, limit=1000):
    cols = 'id,brand,reference,raw_message'
    params = f'select={urllib.parse.quote(cols)}&verdict=eq.REVIEW&order=id.asc&limit={limit}'
    if last_id:
        params += f'&id=gt.{urllib.parse.quote(str(last_id))}'
    url = f'{SUPABASE_URL}/rest/v1/watch_records?{params}'
    for attempt in range(5):
        try:
            req = urllib.request.Request(url, headers=HEADERS)
            with urllib.request.urlopen(req, timeout=120) as resp:
                return json.loads(resp.read().decode())
        except Exception:
            time.sleep(3)
    return None

def update_fast(ids, update_brand=None):
    """Update ALL matching records in one Supabase PATCH"""
    if not ids:
        return True
    # Supabase can't do PATCH with IN clause, so batch per ID
    success = 0
    for i in range(0, len(ids), 100):
        chunk = ids[i:i+100]
        for rec_id in chunk:
            try:
                url = f'{SUPABASE_URL}/rest/v1/watch_records?id=eq.{urllib.parse.quote(str(rec_id))}'
                body = json.dumps({'confidence': 100, 'verdict': 'APPROVED'}).encode()
                req = urllib.request.Request(url, data=body, headers=HEADERS, method='PATCH')
                with urllib.request.urlopen(req, timeout=30):
                    success += 1
            except Exception:
                pass
    return success

# Switch to a Node script for exact catalog matching
NODE_SCRIPT = '''
const { lookupCatalog } = require('./api/_lib/catalog-matcher');
let input = '';
process.stdin.on('data', chunk => input += chunk);
process.stdin.on('end', () => {
  const records = JSON.parse(input);
  const matched = [];
  for (const r of records) {
    const rawMsg = r.raw_message || '';
    if (!r.brand || !r.reference) continue;
    const ref = r.reference.replace(/\..+/, '').replace(/^M/, '').replace(/-\\w+$/, '').trim();
    const cat = lookupCatalog(r.brand, r.reference) || lookupCatalog(r.brand, ref);
    if (cat) matched.push(r.id);
  }
  process.stdout.write(JSON.stringify(matched));
});
'''

node_process = None

print('Starting Node catalog matcher...')
os.chdir('/home/jasme/wf')

start = time.time()
total = 0
matched_total = 0
updated = 0
last_id = None
errs = 0

while True:
    rows = fetch_batch(last_id)
    if rows is None:
        errs += 1
        if errs >= 10:
            print('\nStopping (too many errors)')
            break
        time.sleep(5)
        continue
    errs = 0
    
    if not rows:
        print('\nNo more REVIEW records')
        break
    
    last_id = rows[-1]['id']
    records_json = json.dumps(rows)
    
    # Run Node matcher
    proc = subprocess.run(
        ['node', '-e', NODE_SCRIPT],
        input=records_json,
        capture_output=True,
        text=True,
        timeout=30,
        cwd='/home/jasme/wf'
    )
    
    if proc.returncode != 0:
        print(f'\n  ⚠ Node error: {proc.stderr[:100]}')
        continue
    
    try:
        matched_ids = json.loads(proc.stdout.strip())
    except:
        continue
    
    total += len(rows)
    matched_total += len(matched_ids)
    
    if matched_ids:
        updated += update_fast(matched_ids)
    
    rate = total / (time.time() - start)
    remaining = 769921 - total
    eta = max(0, remaining / rate / 60) if rate > 0 else 0
    
    sys.stdout.write(
        f'\r  scanned {total:>7,} | matched {matched_total:>6,} | '
        f'updated {updated:>6,} | {rate:.0f}/s | ETA {eta:.0f} min'
    )
    sys.stdout.flush()

elapsed = time.time() - start
print(f'\n\n{"="*60}')
print(f'REVIEW → APPROVED')
print(f'Scanned: {total:,}')
print(f'Catalog-matched: {matched_total:,}')
print(f'Updated: {updated:,}')
print(f'Time: {elapsed/60:.1f} min')
print(f'Rate: {total/elapsed:.0f}/s')
