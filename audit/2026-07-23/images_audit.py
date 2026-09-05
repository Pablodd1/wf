import json, csv, collections, concurrent.futures, urllib.request, ssl, re, sys
sys.path.insert(0,'/tmp')
import runner
OUT='/tmp/out'
sl = json.load(open('/tmp/wf/public/sample_listings.json'))
pk = json.load(open('/tmp/wf/public/patek_listings.json'))

# cross-file consistency: same listing id set?
pk_by_raw = collections.defaultdict(list)
for x in pk:
    pk_by_raw[re.sub(r'\s+',' ',(x.get('description') or '').strip()).lower()].append(x.get('image_url'))

# master raw set for lineage linking
master = list(csv.DictReader(open(f'{OUT}/watchfacts_audit_master.csv')))
raw2ids = collections.defaultdict(list)
for r in master:
    raw2ids[re.sub(r'\s+',' ',(r['raw_child_line'] or '').strip()).lower()].append(r['source_record_id'])

url2listings = collections.defaultdict(list)
for x in sl:
    if x.get('imageUrl'):
        url2listings[x['imageUrl']].append(x['id'])

unique_urls = sorted(url2listings)
print('listings:', len(sl), 'unique image urls:', len(unique_urls))

ctx = ssl.create_default_context()
def check(url):
    try:
        req = urllib.request.Request(url, method='HEAD', headers={'User-Agent':'Mozilla/5.0 audit'})
        with urllib.request.urlopen(req, timeout=12, context=ctx) as r:
            return url, r.status, r.headers.get('Content-Length')
    except Exception as e:
        try:
            req = urllib.request.Request(url, headers={'User-Agent':'Mozilla/5.0 audit','Range':'bytes=0-0'})
            with urllib.request.urlopen(req, timeout=12, context=ctx) as r:
                return url, r.status, 'range-ok'
        except Exception as e2:
            return url, None, str(e2)[:120]

results = {}
with concurrent.futures.ThreadPoolExecutor(max_workers=24) as ex:
    for url, status, info in ex.map(check, unique_urls):
        results[url] = (status, info)
reach = collections.Counter(1 if s and int(s)<400 else 0 for s,_ in results.values())
print('reachable:', reach)

rows_out = []
for x in sl:
    url = x.get('imageUrl') or ''
    raw_n = re.sub(r'\s+',' ',(x.get('rawMessage') or '').strip()).lower()
    linked_master = raw2ids.get(raw_n, [])
    s, info = results.get(url, (None,'not-checked'))
    reachable = bool(s and int(s) < 400)
    shared = len(url2listings.get(url, []))
    pk_match = url in (pk_by_raw.get(raw_n) or [])
    if not url:
        rec, reason = 'REJECT', 'NO_IMAGE_URL_ON_RECORD'
    elif shared > 1:
        rec, reason = 'DEFER', f'IMAGE_URL_SHARED_BY_{shared}_LISTING_RECORDS'
    elif not reachable:
        rec, reason = 'DEFER', f'URL_UNREACHABLE:{info}'
    elif linked_master:
        rec, reason = 'SAFE_CANDIDATE', f'EXACT_RAW_LINEAGE master:{linked_master[0]} patek_file_match:{pk_match}'
    else:
        rec, reason = 'DEFER', 'RAW_MESSAGE_NOT_IN_MASTER_DATASET'
    rows_out.append({
        'source_record_id': linked_master[0] if linked_master else x['id'],
        'source_message_id': x['id'],
        'image_key': url.rsplit('/',1)[-1] if url else '',
        'public_url': url, 'match_basis': 'EXACT_LISTING_RECORD_FIELD+EXACT_RAW_MESSAGE' if linked_master else 'LISTING_RECORD_FIELD_ONLY',
        'url_reachable': reachable, 'recommendation': rec, 'reason': reason, 'batch_id': f"IMG-{(len(rows_out)//1000)+1:03d}"})

with open(f'{OUT}/watchfacts_audit_images.csv','w',newline='') as f:
    w = csv.DictWriter(f, fieldnames=['source_record_id','source_message_id','image_key','public_url','match_basis','url_reachable','recommendation','reason','batch_id'])
    w.writeheader(); [w.writerow(r) for r in rows_out]
print(collections.Counter(r['recommendation'] for r in rows_out))
print('sample unreachable reasons:', collections.Counter(r['reason'].split(':')[0] for r in rows_out if r['recommendation']!='SAFE_CANDIDATE').most_common(8))
