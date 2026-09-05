import csv, json, collections, statistics, re, sys
sys.path.insert(0,'/tmp')
OUT='/tmp/out'
rows = list(csv.DictReader(open(f'{OUT}/watchfacts_audit_master.csv')))
N=len(rows)

def cnt(key): return collections.Counter(r[key] for r in rows)

# ---------- eligibility sensitivity ----------
def strict_gates(r, waive_intent=False):
    ok = (r['bundle_status']=='SINGLE_LISTING' and r['catalog_status']=='EXACT_MATCH'
          and r['dial_normalized'] and r['currency_status']=='VERIFIED' and r['price_usd']
          and r['duplicate_status'] in ('UNIQUE','CANONICAL')
          and r['recommendation'] in ('KEEP','APPLY_CANDIDATE')
          and not (r['review_reasons'] and 'PRICE_IMPLAUSIBLE' in r['review_reasons']))
    if not ok: return False
    return True if waive_intent else r['intent']=='WTS'
clean = [r for r in rows if strict_gates(r, waive_intent=True)]
strict = [r for r in clean if r['intent']=='WTS']
print('strict WTS-gated eligible:', len(strict), '| intent-waived deterministic-clean:', len(clean))

# ---------- outliers: cohorts brand|ref|condition|set ----------
cohorts = collections.defaultdict(list)
for r in clean:
    key = (r['brand_normalized'], r['reference_normalized'], r['condition_normalized'] or 'UNKNOWN_COND', r['dial_normalized'])
    cohorts[key].append(float(r['price_usd']))
outlier_stats = {}
status_by_row = {}
for key, vals in cohorts.items():
    if len(vals) < 5: continue
    vs = sorted(vals)
    q1 = statistics.quantiles(vs, n=4)[0]; q3 = statistics.quantiles(vs, n=4)[2]
    iqr = q3-q1; lo, hi = q1-1.5*iqr, q3+1.5*iqr
    outlier_stats[key] = (q1,q3,iqr,lo,hi,len(vals))
for r in clean:
    key = (r['brand_normalized'], r['reference_normalized'], r['condition_normalized'] or 'UNKNOWN_COND', r['dial_normalized'])
    if key in outlier_stats:
        q1,q3,iqr,lo,hi,n = outlier_stats[key]
        v = float(r['price_usd'])
        st = 'CLEAN' if lo <= v <= hi else ('OUTLER_HIGH' if v>hi else 'OUTLIER_LOW')
        r['outlier_status'] = 'CLEAN' if lo <= v <= hi else ('OUTLIER_HIGH' if v>hi else 'OUTLIER_LOW')
        r['outlier_reason'] = None if st=='CLEAN' else f'1.5xIQR fence [{lo:.0f},{hi:.0f}] cohort n={n}'
        r['cohort_key'] = '|'.join(key); r['q1']=round(q1,2); r['q3']=round(q3,2); r['iqr']=round(iqr,2)
        r['lower_fence']=round(lo,2); r['upper_fence']=round(hi,2)
    else:
        r['outlier_status']='COHORT_TOO_SMALL'; r['cohort_key']='|'.join(key)
outc = collections.Counter(r.get('outlier_status') for r in clean)
print('outlier status on clean set:', outc)

# rewrite master CSV with outlier cols
import runner
with open(f'{OUT}/watchfacts_audit_master.csv','w',newline='') as f:
    w = csv.DictWriter(f, fieldnames=runner.FIELDS, extrasaction='ignore'); w.writeheader()
    for r in rows: w.writerow(r)

# ---------- report aggregates ----------
agg = {}
agg['total_rows']=N
agg['by_brand'] = cnt('brand_normalized').most_common(30)
agg['by_stored_brand'] = collections.Counter(r['brand_raw'] for r in rows).most_common(15)
agg['by_reference_top'] = collections.Counter(r['reference_normalized'] for r in rows if r['reference_normalized']).most_common(25)
agg['currency_status'] = cnt('currency_status').most_common()
agg['recommendation'] = cnt('recommendation').most_common()
agg['intent'] = cnt('intent').most_common()
agg['bundle'] = cnt('bundle_status').most_common()
agg['duplicate'] = cnt('duplicate_status').most_common()
agg['catalog'] = cnt('catalog_status').most_common()
agg['image'] = cnt('image_status').most_common()
agg['eligible_strict'] = len(strict); agg['eligible_intent_waived'] = len(clean)
agg['outliers'] = outc.most_common()
# seller/date lineage coverage
agg['seller_lineage_present'] = sum(1 for r in rows if r['seller_name'] or r['seller_phone'])
agg['date_lineage_present'] = sum(1 for r in rows if r['original_posted_at'])
# reason tally
rc = collections.Counter()
for r in rows:
    for x in (r['review_reasons'] or '').split('|'):
        if x: rc[x.split(' stored')[0].split(':')[0]] += 1
agg['reasons'] = rc.most_common(40)
# catalog conflicts detail
agg['catalog_conflicts_dial'] = sum(1 for r in rows if r['review_reasons'] and 'DIAL_CATALOG_MISMATCH' in r['review_reasons'])
# examples: 20 accepted (KEEP/APPLY, verified, exact) and 20 blocked (REJECT/HUMAN)
acc = [r for r in rows if r['recommendation'] in ('KEEP','APPLY_CANDIDATE') and r['currency_status']=='VERIFIED' and r['catalog_status']=='EXACT_MATCH' and r['duplicate_status'] in ('UNIQUE','CANONICAL')]
blk = [r for r in rows if r['recommendation'] in ('REJECT_CANDIDATE','HUMAN_REVIEW','SPLIT_REQUIRED')]
def pick(rs, n):
    counts, out = {}, []
    for r in rs:
        k = '|'.join((r['review_reasons'] or '').split('|')[:2])
        if counts.get(k, 0) >= 3: continue
        counts[k] = counts.get(k, 0) + 1
        out.append(r)
        if len(out) >= n: break
    return out
agg['accepted_examples'] = [{k:r[k] for k in ('source_record_id','raw_child_line','brand_normalized','reference_normalized','dial_normalized','condition_normalized','price_normalized','currency_normalized','price_usd','currency_status','catalog_status','recommendation','review_reasons')} for r in pick(acc,20)]
agg['blocked_examples'] = [{k:r[k] for k in ('source_record_id','raw_child_line','brand_raw','reference_raw','brand_normalized','reference_normalized','price_normalized','currency_normalized','currency_status','recommendation','review_reasons')} for r in pick(blk,20)]
json.dump(agg, open(f'{OUT}/aggregates.json','w'), indent=1)
print('aggregates written')
