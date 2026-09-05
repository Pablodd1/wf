import csv, json, os, sys, time
sys.path.insert(0, '/tmp')
import engine, runner

BASE = '/tmp/wf'
OUT = '/tmp/out'
os.makedirs(OUT, exist_ok=True)
os.makedirs(f'{OUT}/batches', exist_ok=True)

engine.CAT = engine.load_catalogs(BASE)
t0 = time.time()

# ---------- input inventory ----------
inputs = ['public/parsedWatches.json','public/sample_listings.json','public/patek_listings.json',
          'public/WatchFacts_Normalized_Dataset.xlsx','public/parsedWatches.schema.json']
inv = []
for f in inputs:
    p = f'{BASE}/{f}'
    inv.append({'file': f, 'bytes': os.path.getsize(p), 'sha256': runner.sha256(p)})
json.dump(inv, open(f'{OUT}/input_inventory.json','w'), indent=1)
print('inventory done', time.time()-t0)

pw = json.load(open(f'{BASE}/public/parsedWatches.json'))
N = len(pw)

# ---------- duplicate pre-pass (exact raw, whitespace-normalized) ----------
from collections import defaultdict
groups = defaultdict(list)
for r in pw:
    groups[runner.norm_raw(r[8])].append(r[0])
dup_status = {}
dup_groups = 0
for g, ids in groups.items():
    if len(ids) > 1:
        dup_groups += 1
        for i, sid in enumerate(ids):
            dup_status[sid] = 'CANONICAL' if i == 0 else 'DUPLICATE_EXACT_RAW'
    else:
        dup_status[ids[0]] = 'UNIQUE'
print('dup groups:', dup_groups, time.time()-t0)

# ---------- image map (exact raw-message lineage from supplied listing files) ----------
sl = json.load(open(f'{BASE}/public/sample_listings.json'))
raw2img = {}
for x in sl:
    rm = runner.norm_raw(x.get('rawMessage',''))
    if x.get('imageUrl'):
        raw2img.setdefault(rm, x['imageUrl'])

# ---------- batches ----------
BATCH = 25000
batch_ids = []
master_rows = []
err_rows = []
summaries = []
for bi, start in enumerate(range(0, N, BATCH), 1):
    bid = f'B{bi:03d}'
    batch_ids.append(bid)
    chunk = pw[start:start+BATCH]
    rows, errs = [], []
    cnt = {}
    for r in chunk:
        sid = r[0]
        try:
            parsed = engine.parse_line(r[8] or '')
            img = 'IMAGE_CANDIDATE_EXISTS' if runner.norm_raw(r[8]) in raw2img else 'NO_IMAGE_EVIDENCE'
            d = runner.compare_row(r, parsed, dup_status[sid], img)
            d['batch_id'] = bid
            rows.append(d)
            for k in ['recommendation','currency_status','catalog_status','bundle_status','duplicate_status','intent']:
                cnt[k+':'+str(d[k])] = cnt.get(k+':'+str(d[k]),0)+1
            cnt['eligible:'+str(d['price_research_eligible'])] = cnt.get('eligible:'+str(d['price_research_eligible']),0)+1
        except Exception as e:
            errs.append({'source_record_id': sid,'batch_id': bid,'error_stage':'parse_compare',
                         'error_type': type(e).__name__,'error_message': str(e)[:400],
                         'raw_value': (r[8] or '')[:400],'retryable': False})
    # reconciliation: input rows must equal outputs + errors
    recon_ok = len(rows) + len(errs) == len(chunk)
    with open(f'{OUT}/batches/audit_{bid}.csv','w',newline='') as f:
        w = csv.DictWriter(f, fieldnames=runner.FIELDS, extrasaction='ignore')
        w.writeheader()
        for d in rows: w.writerow(d)
    last_sid = chunk[-1][0]
    summ = {'batch_id': bid,'input_rows': len(chunk),'audited': len(rows),'errors': len(errs),
            'last_source_id': last_sid,'reconciliation': 'OK' if recon_ok else 'FAIL', **cnt}
    summaries.append(summ)
    master_rows.extend(rows); err_rows.extend(errs)
    print(bid, len(rows), 'errs', len(errs), 'recon', recon_ok, f'{time.time()-t0:.0f}s')

# ---------- master CSV ----------
with open(f'{OUT}/watchfacts_audit_master.csv','w',newline='') as f:
    w = csv.DictWriter(f, fieldnames=runner.FIELDS, extrasaction='ignore')
    w.writeheader()
    for d in master_rows: w.writerow(d)

# ---------- errors CSV ----------
with open(f'{OUT}/watchfacts_audit_errors.csv','w',newline='') as f:
    w = csv.DictWriter(f, fieldnames=['source_record_id','batch_id','error_stage','error_type','error_message','raw_value','retryable'])
    w.writeheader()
    for e in err_rows: w.writerow(e)

# ---------- state ----------
json.dump({'batches': batch_ids,'last_processed_source_id': summaries[-1]['last_source_id'],
           'total_rows': N,'processed': len(master_rows),'errors': len(err_rows)},
          open(f'{OUT}/checkpoint.json','w'), indent=1)
json.dump(summaries, open(f'{OUT}/batch_summaries.json','w'), indent=1)
json.dump(master_rows, open(f'{OUT}/master_rows.json','w'))  # for outlier pass
print('DONE', len(master_rows), 'rows,', len(err_rows), 'errors', f'{time.time()-t0:.0f}s')
