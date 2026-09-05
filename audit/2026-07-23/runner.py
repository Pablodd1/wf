# Audit runner: stored-vs-evidence comparison, recommendation, batching, CSV output
import csv, json, re, hashlib, os, sys, traceback
sys.path.insert(0, os.path.dirname(__file__))
import engine

FIELDS = ["source_record_id","parent_source_id","raw_child_line","brand_raw","brand_normalized",
"reference_raw","reference_normalized","model_normalized","dial_raw","dial_normalized",
"condition_raw","condition_normalized","price_raw","currency_raw","price_normalized","currency_normalized",
"price_usd","intent","seller_name","seller_phone","original_posted_at","catalog_status","bundle_status",
"duplicate_status","currency_status","image_status","price_research_eligible","recommendation",
"review_reasons","confidence","batch_id",
"outlier_status","outlier_reason","cohort_key","q1","q3","iqr","lower_fence","upper_fence"]

CONDITIONS = {'New','Used','Like New','Unknown','UNKNOWN',''}

def norm_raw(x):
    return re.sub(r'\s+', ' ', (x or '').strip()).lower()

def sfloat(v):
    try: return float(v)
    except (TypeError, ValueError): return None

def compare_row(row, parsed, dup_status, image_status):
    """row = parsedWatches 16-field array. Returns (csv_dict, error_or_none)."""
    (sid, sbrand, sref, sdial, sprice, susd, scur, scond,
     raw, sconf, sapproval, sflags, syr1, syr2, simg, sscore) = row
    reasons = list(parsed['reasons'])
    p = parsed
    # ---- stored-vs-evidence checks ----
    scur_s = str(scur or '')
    if scur_s in CONDITIONS and scur_s not in ('Unknown','UNKNOWN',''):
        reasons.append('STORED_COLUMN_CORRUPTION_CONDITION_IN_CURRENCY')
    stored_cur = scur_s.upper() if scur_s.upper() in ('HKD','USD','USDT','EUR','GBP','CHF','$') else None
    cur_conflict = False
    if p['currency_status'] == 'VERIFIED' and stored_cur and stored_cur != p['currency_normalized'] and not (stored_cur=='USD' and p['currency_normalized']=='USDT'):
        cur_conflict = True; reasons.append(f'STORED_CURRENCY_MISMATCH stored:{stored_cur} evidence:{p["currency_normalized"]}')
    price_conflict = False
    if p['price_normalized'] is not None and sprice is not None:
        sp_f = sfloat(sprice)
        if sp_f is None:
            reasons.append('STORED_PRICE_UNREADABLE')
        elif abs(sp_f - p['price_normalized']) > max(1.0, 0.005 * p['price_normalized']):
            price_conflict = True; reasons.append(f'STORED_PRICE_MISMATCH stored:{sprice} evidence:{p["price_normalized"]}')
    if p['price_normalized'] is not None and sprice is None:
        reasons.append('STORED_PRICE_MISSING_BUT_EVIDENCE_PRESENT')
    if p['price_normalized'] is None and sprice is not None:
        reasons.append('STORED_PRICE_NO_LINE_EVIDENCE')
    # priceUSD column sanity
    if susd is not None:
        usd_v = sfloat(susd)
        sp_f = sfloat(sprice)
        if usd_v is None:
            reasons.append('STORED_PRICEUSD_UNREADABLE')
        elif 1900 <= usd_v <= 2030 and sp_f is not None and sp_f > 10000:
            reasons.append(f'STORED_PRICEUSD_IS_YEAR:{susd}')
        elif stored_cur == 'HKD' and sp_f is not None and abs(usd_v - sp_f) < 1:
            reasons.append('STORED_PRICEUSD_EQUALS_HKD_PRICE')
        elif stored_cur in ('USD','USDT') and sp_f is not None and abs(usd_v - sp_f) > max(1.0, 0.01*sp_f):
            reasons.append(f'STORED_PRICEUSD_MISMATCH stored:{susd} price:{sprice}')
    # reference
    ref_conflict = False
    sref_s = str(sref or '')
    if sref_s and re.fullmatch(r'(19|20)\d{2}Y?', sref_s):
        ref_conflict = True; reasons.append(f'STORED_REFERENCE_IS_YEAR:{sref_s}')
    elif p['reference_normalized'] and sref_s:
        if engine.normref(sref_s) != engine.normref(p['reference_normalized']):
            ref_conflict = True
            reasons.append(f'STORED_REFERENCE_MISMATCH stored:{sref_s} evidence:{p["reference_normalized"]}')
    # brand
    brand_conflict = False
    sbrand_s = str(sbrand or '')
    if p['brand_normalized'] and sbrand_s and sbrand_s.lower() not in ('unknown',''):
        if sbrand_s.lower() != p['brand_normalized'].lower():
            brand_conflict = True; reasons.append(f'STORED_BRAND_MISMATCH stored:{sbrand_s} evidence:{p["brand_normalized"]}')
    # dial
    sdial_s = str(sdial or '')
    dial_conflict = False
    if p['dial_normalized'] and sdial_s and sdial_s.upper() not in ('UNKNOWN',''):
        if sdial_s.lower() != p['dial_normalized'].lower():
            dial_conflict = True; reasons.append(f'STORED_DIAL_MISMATCH stored:{sdial_s} evidence:{p["dial_normalized"]}')
    # condition
    scond_s = str(scond or '')
    cond_conflict = False
    if p['condition_normalized'] and scond_s and scond_s.lower() not in ('unknown',''):
        if scond_s.lower() != p['condition_normalized'].lower():
            cond_conflict = True; reasons.append(f'STORED_CONDITION_MISMATCH stored:{scond_s} evidence:{p["condition_normalized"]}')
    # stale stored flags
    sflags = sflags or []
    if 'MISSING_PRICE' in sflags and p['price_normalized'] is not None:
        reasons.append('STALE_FLAG_MISSING_PRICE')
    if 'UNKNOWN_BRAND' in sflags and p['brand_normalized']:
        reasons.append('STALE_FLAG_UNKNOWN_BRAND')
    if 'UNKNOWN_DIAL' in sflags and p['dial_normalized']:
        reasons.append('STALE_FLAG_UNKNOWN_DIAL')
    if 'MISSING_YEAR' in sflags and p['year_evidence']:
        reasons.append('STALE_FLAG_MISSING_YEAR')
    if 'MISSING_REFERENCE' in sflags and p['reference_normalized']:
        reasons.append('STALE_FLAG_MISSING_REFERENCE')
    # year agreement
    try: syr1_i = int(syr1) if syr1 not in (None,'') else None
    except (TypeError, ValueError): syr1_i = None
    if syr1_i and p['year_evidence'] and syr1_i not in p['year_evidence']:
        reasons.append(f'STORED_YEAR_MISMATCH stored:{syr1} evidence:{p["year_evidence"]}')

    # ---- recommendation ----
    col_corrupt = ('STORED_COLUMN_CORRUPTION_CONDITION_IN_CURRENCY' in reasons)
    ref_fixable = (('STORED_REFERENCE_IS_YEAR' in str(reasons)) or
                   (ref_conflict and p['reference_normalized'] and p['catalog_status'] == 'EXACT_MATCH'))
    hard_reject = cur_conflict or price_conflict
    human_triggers = (brand_conflict or dial_conflict or cond_conflict
                      or p['currency_status'] in ('CURRENCY_AMBIGUOUS','CURRENCY_RATE_UNVERIFIED','CURRENCY_UNVERIFIED')
                      or 'DUAL_CURRENCY_MISMATCH' in reasons
                      or p['catalog_status'] == 'MULTIPLE_CANDIDATES'
                      or 'DIAL_CATALOG_MISMATCH' in reasons
                      or 'POSSIBLE_SPECIAL_EDITION' in reasons
                      or 'STORED_PRICE_NO_LINE_EVIDENCE' in reasons
                      or (ref_conflict and not ref_fixable)
                      or 'STORED_PRICE_UNREADABLE' in reasons
                      or 'STORED_PRICEUSD_UNREADABLE' in reasons)
    correctable = (('STORED_PRICE_MISSING_BUT_EVIDENCE_PRESENT' in reasons)
                   or (p['currency_status']=='VERIFIED' and (stored_cur is None or col_corrupt) and sprice is not None)
                   or (p['brand_normalized'] and sbrand_s.lower() in ('unknown',''))
                   or (p['dial_normalized'] and sdial_s.upper() in ('UNKNOWN',''))
                   or (p['condition_normalized'] and scond_s.lower() in ('unknown',''))
                   or (p['reference_normalized'] and not sref_s)
                   or ref_fixable
                   or col_corrupt
                   or reasons_stale(sflags, p))
    if p['is_bundle']:
        rec = 'SPLIT_REQUIRED'
    elif hard_reject:
        rec = 'REJECT_CANDIDATE'
    elif human_triggers:
        rec = 'HUMAN_REVIEW'
    elif dup_status == 'DUPLICATE_EXACT_RAW':
        rec = 'DUPLICATE_REVIEW'
    elif correctable:
        rec = 'APPLY_CANDIDATE'
    elif p['reference_normalized'] is None or p['brand_normalized'] is None:
        rec = 'DEFER_AMBIGUOUS'
    else:
        rec = 'KEEP'

    # ---- price research eligibility (strict, deterministic) ----
    plausible = p['price_normalized'] is not None and not any(
        x.startswith('PRICE_IMPLAUSIBLE') for x in reasons)
    eligible = bool(
        p['intent'] == 'WTS'
        and not p['is_bundle']
        and p['catalog_status'] == 'EXACT_MATCH'
        and p['dial_normalized']
        and p['currency_status'] == 'VERIFIED'
        and p['price_usd'] is not None
        and plausible
        and dup_status in ('UNIQUE','CANONICAL')
        and rec in ('KEEP','APPLY_CANDIDATE')
        and raw)

    # ---- confidence (deterministic rubric) ----
    conf = 0
    if p['reference_normalized'] and p['catalog_status'] == 'EXACT_MATCH': conf += 35
    elif p['reference_normalized']: conf += 15
    if p['currency_status'] == 'VERIFIED': conf += 25
    if p['dial_normalized']: conf += 10
    if p['condition_normalized']: conf += 10
    if p['intent'] != 'UNKNOWN': conf += 10
    if len(p['year_evidence']) == 1: conf += 5
    if p['is_bundle']: conf = min(conf, 40)
    if hard_reject: conf = min(conf, 35)

    rec_dict = {
        'source_record_id': sid,
        'parent_source_id': None,
        'raw_child_line': raw,
        'brand_raw': sbrand or None,
        'brand_normalized': p['brand_normalized'],
        'reference_raw': sref or None,
        'reference_normalized': p['reference_normalized'],
        'model_normalized': p['catalog_model'] or None,
        'dial_raw': p['dial_raw'] or (sdial if sdial_s and sdial_s.upper()!='UNKNOWN' else None),
        'dial_normalized': p['dial_normalized'],
        'condition_raw': p['condition_raw'] or (scond if scond_s.lower() not in ('unknown','') else None),
        'condition_normalized': p['condition_normalized'],
        'price_raw': p['price_raw'],
        'currency_raw': scur or None,
        'price_normalized': p['price_normalized'],
        'currency_normalized': p['currency_normalized'],
        'price_usd': p['price_usd'],
        'intent': p['intent'],
        'seller_name': None, 'seller_phone': None, 'original_posted_at': None,
        'catalog_status': p['catalog_status'],
        'bundle_status': 'SPLIT_REQUIRED' if p['is_bundle'] else ('SINGLE_LISTING' if p['reference_normalized'] else 'UNVERIFIED'),
        'duplicate_status': dup_status,
        'currency_status': p['currency_status'],
        'image_status': image_status,
        'price_research_eligible': eligible,
        'recommendation': rec,
        'review_reasons': '|'.join(dict.fromkeys(reasons)) if reasons else None,
        'confidence': conf,
    }
    # extras for analytics pass (not in CSV contract beyond outlier cols)
    rec_dict['_year'] = p['year_evidence'][0] if p['year_evidence'] else None
    rec_dict['_set'] = p['set_status']
    rec_dict['_refs'] = p['refs_found']
    rec_dict['_mentions'] = len(p['price_mentions'])
    return rec_dict

def reasons_stale(sflags, p):
    sflags = sflags or []
    return (('MISSING_PRICE' in sflags and p['price_normalized'] is not None)
            or ('UNKNOWN_BRAND' in sflags and p['brand_normalized'])
            or ('UNKNOWN_DIAL' in sflags and p['dial_normalized'])
            or ('MISSING_YEAR' in sflags and p['year_evidence'])
            or ('MISSING_REFERENCE' in sflags and p['reference_normalized']))

def sha256(path, chunk=1<<20):
    h = hashlib.sha256()
    with open(path,'rb') as f:
        while True:
            b = f.read(chunk)
            if not b: break
            h.update(b)
    return h.hexdigest()
