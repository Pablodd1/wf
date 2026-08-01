#!/usr/bin/env python3
"""
Step 4: Per-user WTS/WTB rollup from the 545,900 parsed OceanDigital rows.
Groups by Phone Number (real poster identity). Output: Excel + JSON.
"""
import csv, json, re
from collections import defaultdict
import openpyxl

IN_CSV = "/tmp/ocean_normalized.csv"
OUT_XLSX = "/mnt/c/Users/jasme/Downloads/WF/OceanDigital_user_rollup.xlsx"
OUT_JSON = "/tmp/ocean_user_rollup.json"

def clean(s):
    if s is None: return ""
    return re.sub(r'[\x00-\x08\x0b\x0c\x0e-\x1f]', '', str(s))

users = defaultdict(lambda: {
    'name': '', 'phone': '', 'posts': 0, 'wts': 0, 'wtb': 0,
    'with_price': 0, 'brands': set(), 'refs': set(),
    'first_seen': None, 'last_seen': None, 'price_sum': 0, 'price_n': 0,
})

for r in csv.DictReader(open(IN_CSV, encoding='utf-8')):
    phone = (r['Phone Number'] or '').strip()
    name = (r['Posted By'] or '').strip()
    key = phone if phone else (name.lower() if name else None)
    if not key:
        continue
    u = users[key]
    if name and not u['name']:
        u['name'] = name
    if phone and not u['phone']:
        u['phone'] = phone
    u['posts'] += 1
    if r['Intent / Type'] == 'WTS':
        u['wts'] += 1
    else:
        u['wtb'] += 1
    price = r['Price ($ USD)']
    try:
        pv = float(price) if price not in ('', None) else 0
    except ValueError:
        pv = 0
    if pv > 0:
        u['with_price'] += 1
        u['price_sum'] += pv
        u['price_n'] += 1
    if r['Brand'] and r['Brand'] != 'Unknown':
        u['brands'].add(r['Brand'])
    if r['Normalized Reference']:
        u['refs'].add(r['Normalized Reference'])
    d = r['Posting Date'] or ''
    if d:
        if not u['first_seen'] or d < u['first_seen']:
            u['first_seen'] = d
        if not u['last_seen'] or d > u['last_seen']:
            u['last_seen'] = d

# Write Excel
wb = openpyxl.Workbook()
ws = wb.active
ws.title = "User Rollup"
ws.append(['Phone', 'Name', 'Total Posts', 'WTS', 'WTB', 'With Price', 'Avg Price (USD)',
           'Brands', 'Unique Refs', 'First Seen', 'Last Seen'])
for key, u in sorted(users.items(), key=lambda x: -x[1]['posts']):
    avg = round(u['price_sum'] / u['price_n']) if u['price_n'] else 0
    ws.append([clean(u['phone']), clean(u['name']), u['posts'], u['wts'], u['wtb'], u['with_price'],
               avg, ', '.join(sorted(u['brands'])[:6]), len(u['refs']),
               u['first_seen'] or '', u['last_seen'] or ''])
wb.save(OUT_XLSX)

summary = {
    'unique_users': len(users),
    'users_with_phone': sum(1 for u in users.values() if u['phone']),
    'users_with_name': sum(1 for u in users.values() if u['name']),
    'total_posts_mapped': sum(u['posts'] for u in users.values()),
    'top_10_posters': [
        {'name': u['name'], 'phone': u['phone'], 'posts': u['posts'], 'wts': u['wts'], 'wtb': u['wtb']}
        for _, u in sorted(users.items(), key=lambda x: -x[1]['posts'])[:10]
    ],
}
with open(OUT_JSON, 'w') as f:
    json.dump(summary, f, indent=2)
print(json.dumps(summary, indent=2), flush=True)
