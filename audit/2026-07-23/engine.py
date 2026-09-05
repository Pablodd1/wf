# WatchFacts Zero-Hallucination Audit Engine (deterministic, evidence-only) v2
# Rules sourced from AGENTS.md, NORMALIZATION_CONTRACT.md, CURRENCY_RULES.md,
# CATALOG_RECONCILIATION.md, ANALYTICS_RULES.md, EXTERNAL_AI_ASSISTANCE_HANDOFF_2026-07-22.md
import re, json

def normref(s):
    return re.sub(r'[^A-Z0-9]', '', str(s).upper())

def load_catalogs(base):
    idx = {}
    cs = json.load(open(f'{base}/public/catalog-source-v1.json'))
    for en in cs['entries']:
        idx.setdefault(normref(en['normalized_reference']), []).append({
            'brand': en['brand'], 'reference': en['reference'], 'model': en.get('model') or '',
            'dial_colors': en.get('dial_colors') or [], 'source': 'catalog-source-v1'})
    mc = json.load(open(f'{base}/api/dictionaries/master_catalog.json'))
    for k, v in mc.items():
        bucket = idx.setdefault(normref(k), [])
        if not any(e['brand'] == v['brand'] and normref(e['reference']) == normref(k) for e in bucket):
            bucket.append({'brand': v['brand'], 'reference': k, 'model': v.get('model') or '',
                           'dial_colors': v.get('dial_colors') or [], 'source': 'master_catalog'})
    cj = json.load(open(f'{base}/public/catalog.json'))
    for en in cj:
        brand = en.get('brand', 'Patek Philippe')
        bucket = idx.setdefault(normref(en['reference']), [])
        if not any(e['brand'] == brand and normref(e['reference']) == normref(en['reference']) for e in bucket):
            dials = [d.strip() for d in (en.get('dial_colors') or '').split(';') if d.strip()]
            bucket.append({'brand': brand, 'reference': en['reference'], 'model': en.get('model') or '',
                           'dial_colors': dials, 'source': 'catalog.json'})
    return idx

CAT = None

HKD_TOK = r'(?:HKD|HDK|HK\$|H\.K\.D\.|港币|港幣|Hong Kong dollars?|HK dollars?)'
USD_TOK = r'(?:USDT|USD|US\$|U\$)'
EUR_TOK = r'(?:EUR|€)'
GBP_TOK = r'(?:GBP|£)'
CHF_TOK = r'(?:CHF)'
CUR_TOK = rf'(?:{HKD_TOK}|{USD_TOK}|{EUR_TOK}|{GBP_TOK}|{CHF_TOK})'
TOK2CUR = {'HKD':'HKD','HDK':'HKD','HK$':'HKD','H.K.D.':'HKD','港币':'HKD','港幣':'HKD','Hong Kong dollar':'HKD','Hong Kong dollars':'HKD','HK dollar':'HKD','HK dollars':'HKD',
           'USD':'USD','US$':'USD','USDT':'USDT','U$':'USD','EUR':'EUR','€':'EUR',
           'GBP':'GBP','£':'GBP','CHF':'CHF'}
MULT = {'K':1e3,'MIL':1e3,'M':1e6,'MN':1e6,'MILL':1e6,'MILLION':1e6,'W':1e4,'万':1e4}

AMOUNT = r'(\d{1,3}(?:[.,]\d{3})+(?:[.,]\d{1,2})?|\d+,\d{1,2}|\d+(?:\.\d+)?)'
MULT_P = r'((?:million|mill|mil|mn|m|k|w|万)(?![A-Za-z/]))?'  # multiplier token; not W/P, not glued to letters
LB = r'(?<![A-Za-z0-9/])'                          # amount must not be glued to letters/dates
PRICE_RE = re.compile(
    rf'(?P<cur1>{CUR_TOK})\s*[:：]?\s*\$?\s*(?P<a1>{AMOUNT})\s*(?P<m1>{MULT_P})\s*(?P<cur2>{CUR_TOK})?'
    rf'|(?P<cur3>\$)\s*(?P<a2>{AMOUNT})\s*(?P<m2>{MULT_P})\s*(?P<cur4>{CUR_TOK})?'
    rf'|{LB}(?P<a3>{AMOUNT})\s*(?P<m3>{MULT_P})\s*(?P<cur5>{CUR_TOK})'
    rf'|{LB}(?P<a4>{AMOUNT})\s*(?P<m4>{MULT_P})\s*(?P<cur6>\$)(?!\w)'
    rf'|{LB}(?P<a5>{AMOUNT})\s*(?P<m5>(?:million|mill|mil|mn|m|k|w|万)(?![A-Za-z/]))'
    rf'|(?P<cur7>\$)\s*(?P<a6>{AMOUNT})',
    re.I)

DATE_RES = [
    re.compile(r'\bN\s?\d{1,2}\s*/\s*(?:(?:19|20)\d{2}|\d{2})\b', re.I),  # N5/26
    re.compile(r'\b(?:19|20)\d{2}\s*/\s*\d{1,2}\b'),                       # 2026/2
    re.compile(r'\b\d{1,2}\s*[/\-]\s*(?:(?:19|20)\d{2}|\d{2})\b'),         # 6/2026, 05-26
    re.compile(r'\b(?:19|20)\d{2}\s*(?:[yY]|years?)\b'),                   # 2023Y / 2022year
    re.compile(r'\b\d{2}\s*[yY]\b'),                                       # 19y
    re.compile(r'\b(?:19|20)\d{2}\b'),                                     # bare year
]
YEAR4_RE = re.compile(r'\b((?:19|20)\d{2})(?:\s*(?:[yY]|years?))?\b')
MDY_RE = re.compile(r'\b(\d{1,2})\s*[/\-]\s*((?:19|20)\d{2}|\d{2})\b')
YY_RE = re.compile(r'\b(\d{2})\s*[yY]\b')

def mask_spans(text, spans):
    t = list(text)
    for s, e in spans:
        for i in range(s, e): t[i] = ' '
    return ''.join(t)

def date_spans(text):
    spans = []
    for r in DATE_RES:
        spans += [m.span() for m in r.finditer(text)]
    return spans

def extract_years(text):
    years = []
    for m in YEAR4_RE.finditer(text): years.append(int(m.group(1)))
    for m in MDY_RE.finditer(text):
        yy = m.group(2); y = int(yy) if len(yy) == 4 else 2000 + int(yy)
        if 1990 <= y <= 2030: years.append(y)
    for m in YY_RE.finditer(text):
        y = 2000 + int(m.group(1))
        if 1990 <= y <= 2030: years.append(y)
    return sorted(set(years))

def parse_amount(txt):
    t = txt.strip()
    if re.fullmatch(r'\d{1,3}(\.\d{3})+,\d{3}', t): return float(t.replace('.', '').replace(',', ''))
    if re.fullmatch(r'\d{1,3}(,\d{3})+(\.\d{1,2})?', t): return float(t.replace(',', ''))
    if re.fullmatch(r'\d{1,3}(\.\d{3})+', t): return float(t.replace('.', ''))
    if re.fullmatch(r'\d+\.\d+', t): return float(t)
    if re.fullmatch(r'\d+', t): return float(t)
    if re.fullmatch(r'\d{1,3}(,\d{3})*,\d{1,2}', t):
        v = t.replace(',', '.')
        return float(v) if v.count('.') == 1 else None
    return None

def cur_of(tok):
    if not tok: return None
    t = tok.strip()
    if t == '$': return '$'
    if t in ('港币','港幣','€','£'): return TOK2CUR[t]
    if re.fullmatch(r'(?i)hong kong dollars?|hk dollars?', t): return 'HKD'
    return TOK2CUR.get(t.upper())

def parse_price_mentions(text):
    out = []
    for m in PRICE_RE.finditer(text):
        gd = m.groupdict()
        if gd.get('a1'):
            amt_raw, mult_tok = gd['a1'], gd.get('m1') or None
            cur = cur_of(gd.get('cur1')) or cur_of(gd.get('cur2'))
        elif gd.get('a2'):
            amt_raw, mult_tok = gd['a2'], gd.get('m2') or None
            cur = cur_of(gd.get('cur4')) or '$'
        elif gd.get('a3'):
            amt_raw, mult_tok = gd['a3'], gd.get('m3') or None
            cur = cur_of(gd.get('cur5'))
        elif gd.get('a4'):
            amt_raw, mult_tok = gd['a4'], gd.get('m4') or None
            cur = '$'
        elif gd.get('a5'):
            amt_raw, mult_tok = gd['a5'], gd.get('m5') or None
            cur = None
        else:
            amt_raw, mult_tok = gd['a6'], None
            cur = '$'
        amt = parse_amount(amt_raw)
        mf = MULT.get(mult_tok.upper()) if mult_tok else None
        out.append({'amount_raw': amt_raw, 'amount': amt, 'mult_tok': mult_tok, 'mult_factor': mf,
                    'currency': cur, 'raw': m.group(0).strip(), 'start': m.start(), 'end': m.end()})
    return out

def is_year_amount(amt):
    return amt is not None and 1900 <= amt <= 2030 and amt == int(amt)

def resolve_price(mentions):
    reasons = []
    real = []
    for mn in mentions:
        if mn['mult_factor'] is None and is_year_amount(mn['amount']):
            continue  # year token, not a price
        if mn['currency'] is None and mn['mult_factor'] is None:
            continue
        real.append(mn)
    if not real:
        return None, None, 'PRICE_PARSE_FAILED', ['NO_PRICE_MENTION'], None
    explicit = [mn for mn in real if mn['currency'] not in (None, '$')]
    primary = explicit[0] if explicit else real[0]
    if len(explicit) >= 2:
        currs = {mn['currency'] for mn in explicit}
        if 'HKD' in currs and ('USD' in currs or 'USDT' in currs):
            h = next(mn for mn in explicit if mn['currency'] == 'HKD')
            u = next(mn for mn in explicit if mn['currency'] in ('USD', 'USDT'))
            hv = h['amount'] * (h['mult_factor'] or 1) if h['amount'] else 0
            uv = u['amount'] * (u['mult_factor'] or 1) if u['amount'] else 0
            if uv and abs(hv * 0.128 - uv) / uv > 0.10:
                reasons.append('DUAL_CURRENCY_MISMATCH')
    amt, cur = primary['amount'], primary['currency']
    if amt is None:
        return None, cur, 'PRICE_PARSE_FAILED', ['AMOUNT_UNPARSEABLE', f"raw:{primary['raw']}"], primary['raw']
    if primary['mult_tok'] and primary['mult_factor'] is None:
        return None, cur, 'PRICE_PARSE_FAILED', ['MULTIPLIER_UNPROVEN', f"raw:{primary['raw']}"], primary['raw']
    if cur is None:
        return None, None, 'CURRENCY_UNVERIFIED', ['PRICE_NO_CURRENCY_TOKEN', f"raw:{primary['raw']}"], primary['raw']
    if cur == '$':
        return None, None, 'CURRENCY_AMBIGUOUS', ['BARE_DOLLAR_AMBIGUOUS', f"raw:{primary['raw']}"], primary['raw']
    if primary['mult_factor'] and re.fullmatch(r'\d{1,3}\.\d{3}', primary['amount_raw']):
        amt = float(primary['amount_raw'])  # decimal fraction when multiplier token attached (1.355m = 1.355 x 10^6)
    val = amt * (primary['mult_factor'] or 1)
    if is_year_amount(val):
        return None, cur, 'PRICE_PARSE_FAILED', ['PRICE_EQUALS_YEAR_GUARD', f"raw:{primary['raw']}"], primary['raw']
    if val < 1000: reasons.append('PRICE_IMPLAUSIBLE_LOW')
    if val > 50_000_000: reasons.append('PRICE_IMPLAUSIBLE_HIGH')
    return val, cur, 'VERIFIED', reasons, primary['raw']

REF_PATTERNS = [
    re.compile(r'\bRM\s?-?\d{2,3}\s?-\s?\d{2}[A-Z]{0,3}\b', re.I),
    re.compile(r'\b\d{4}/\d{1,4}[A-Z*]{0,3}(?:\s?-\d{1,3})?\b', re.I),
    re.compile(r'\b\d{4}-[A-Z]{1,2}(?:-\d{1,3})?\b', re.I),
    re.compile(r'\b\d{5,6}[A-Z]{1,4}\b', re.I),
    re.compile(r'\b\d{6}\b'),
    re.compile(r'\b\d{4}[A-Z]{1,2}\b', re.I),
]
BRAND_WORDS = [
    (re.compile(r'\bPatek(?:\s+Philippe)?\b', re.I), 'Patek Philippe'),
    (re.compile(r'\bRolex\b', re.I), 'Rolex'),
    (re.compile(r'\bAudemars\s+Piguet\b', re.I), 'Audemars Piguet'),
    (re.compile(r'\bRichard\s+Mille\b', re.I), 'Richard Mille'),
    (re.compile(r'\bVacheron(?:\s+Constantin)?\b', re.I), 'Vacheron Constantin'),
    (re.compile(r'\bTudor\b', re.I), 'Tudor'),
    (re.compile(r'\bCartier\b', re.I), 'Cartier'),
    (re.compile(r'\bOmega\b', re.I), 'Omega'),
    (re.compile(r'\bBreguet\b', re.I), 'Breguet'),
    (re.compile(r'\bBlancpain\b', re.I), 'Blancpain'),
    (re.compile(r'\bIWC\b', re.I), 'IWC'),
    (re.compile(r'\bPanerai\b', re.I), 'Panerai'),
    (re.compile(r'\bZenith\b', re.I), 'Zenith'),
    (re.compile(r'\bHublot\b', re.I), 'Hublot'),
    (re.compile(r'\bJaeger[- ]LeCoultre\b|\bJLC\b', re.I), 'Jaeger-LeCoultre'),
    (re.compile(r'\bA\.?\s*Lange\b', re.I), 'A. Lange & Söhne'),
    (re.compile(r'\bGrand\s+Seiko\b', re.I), 'Grand Seiko'),
    (re.compile(r'\bPiaget\b', re.I), 'Piaget'),
    (re.compile(r'\bBreitling\b', re.I), 'Breitling'),
    (re.compile(r'\bBvlgari\b|\bBulgari\b', re.I), 'Bvlgari'),
    (re.compile(r'\bF\.?P\.?\s*Journe\b', re.I), 'F.P. Journe'),
    (re.compile(r'\bMB&F\b', re.I), 'MB&F'),
    (re.compile(r'\bTAG\s+Heuer\b', re.I), 'TAG Heuer'),
    (re.compile(r'\bBell\s*(?:&|and)\s*Ross\b', re.I), 'Bell & Ross'),
    (re.compile(r'\bMoser\b', re.I), 'H. Moser & Cie'),
]
DIAL_MAP = {
    'green':'Green','grey':'Grey','gray':'Grey','black':'Black','blk':'Black','white':'White',
    'blue':'Blue','purple':'Purple','brown':'Brown','pink':'Pink','chocolate':'Chocolate','choco':'Chocolate',
    'silver':'Silver','mop':'Mother of Pearl','mother of pearl':'Mother of Pearl',
    'ice blue':'Ice Blue','champagne':'Champagne','red':'Red','yellow':'Yellow','orange':'Orange',
    'sundust':'Sundust','slate':'Slate','rose':'Rose','beige':'Beige',
    'opaline':'Opaline','anthracite':'Anthracite','burgundy':'Burgundy',
}
SPECIAL_TERMS = {'tiffany','salmon','rainbow','ombre','panda','pave','pavé','meteorite','skeleton',
                 'coffee','caramel','olive','turquoise','mint','lilac','lavender','gradient','smoked',
                 'onyx','aventurine','fumé','fume'}
DIAL_RE = re.compile(
    r'\b(mother of pearl|ice blue|mop|green|grey|gray|black|blk|white|blue|purple|brown|pink|chocolate|choco|'
    r'silver|champagne|red|yellow|orange|sundust|slate|rose|beige|opaline|anthracite|burgundy|salmon|tiffany|'
    r'rainbow|ombre|panda|pavé|pave|meteorite|skeleton|coffee|caramel|olive|turquoise|mint|lilac|lavender|'
    r'gradient|smoked|fumé|fume|onyx|aventurine)\b', re.I)
COND_RE = re.compile(r'\b(brand\s?new|like new|pre[- ]?owned|unworn|sealed|new|used|mint)\b', re.I)
SET_RE = re.compile(r'\b(full\s?set|fullest|fullset|naked|watch only|w/p\+?box|w/p|box\s*(?:and|&)\s*papers?|with papers)\b', re.I)
WTB_RE = re.compile(r'\bWTB\b|looking for|want to buy|\bbuying\b|\bLF\b|收購|收购', re.I)
WTS_RE = re.compile(r'\bWTS\b|for sale|\bselling\b|放售|出售', re.I)

def extract_refs(masked_text):
    spans_found = []
    for pat in REF_PATTERNS:
        for m in pat.finditer(masked_text):
            tok = m.group(0)
            if re.fullmatch(r'\d{6}', tok) and 1900 <= int(tok[:4]) <= 2030:
                continue  # year-like
            if re.fullmatch(r'\d{4}[A-Za-z]{1,2}', tok, ) and 1900 <= int(tok[:4]) <= 2030:
                continue  # 2023Y style
            if '/' in tok and 1900 <= int(tok.split('/')[0]) <= 2030:
                continue  # date 2026/2
            spans_found.append((m.start(), m.end(), tok))
    # drop contained spans
    spans_found.sort()
    kept = []
    for s, e, tok in spans_found:
        if any(s >= ks and e <= ke for ks, ke, _ in kept):
            continue
        kept.append((s, e, tok))
    seen, out = set(), []
    for s, e, tok in kept:
        n = normref(tok)
        if n not in seen:
            seen.add(n); out.append(tok)
    return out

def normalize_reference(tok):
    t = re.sub(r'\s+', '', tok.upper())
    t = re.sub(r'^RM-?', 'RM', t)
    return t

def catalog_lookup(ref_norm):
    n = normref(ref_norm)
    hits = CAT.get(n, [])
    suffix_fallback = False
    if not hits:
        base = re.sub(r'-\d{1,3}$', '', ref_norm)
        if base != ref_norm:
            hits = CAT.get(normref(base), [])
            suffix_fallback = bool(hits)
    if not hits:
        return ('NOT_FOUND', None, '', [], [], suffix_fallback)
    brands = {h['brand'] for h in hits}
    dials = sorted({d for h in hits for d in h['dial_colors']})
    model = next((h['model'] for h in hits if h['model']), '')
    status = 'EXACT_MATCH' if len(brands) == 1 else 'MULTIPLE_CANDIDATES'
    return (status, sorted(brands)[0] if len(brands) == 1 else None, model, dials,
            [h['reference'] for h in hits], suffix_fallback)

def parse_line(raw):
    text = raw.replace('\xa0', ' ').replace(' ', ' ').replace('\t', ' ')
    r = {'reasons': []}
    if WTB_RE.search(text): r['intent'] = 'WTB'
    elif WTS_RE.search(text): r['intent'] = 'WTS'
    else: r['intent'] = 'UNKNOWN'; r['reasons'].append('INTENT_NOT_IN_EVIDENCE')
    r['year_evidence'] = extract_years(text)
    if len(r['year_evidence']) > 1: r['reasons'].append('MULTIPLE_YEARS')
    # mask dates before price & ref parsing
    dmask = mask_spans(text, date_spans(text))
    mentions = parse_price_mentions(dmask)
    price, cur, cur_status, pr_reasons, price_raw = resolve_price(mentions)
    r['price_mentions'] = mentions
    r['price_normalized'] = price
    r['currency_normalized'] = cur
    r['currency_status'] = cur_status
    r['price_raw'] = price_raw
    r['reasons'] += pr_reasons
    if cur_status == 'VERIFIED' and price is not None:
        if cur in ('USD', 'USDT'):
            r['price_usd'] = round(price, 2)
        elif cur == 'HKD':
            r['price_usd'] = round(price * 0.128, 2); r['reasons'].append('FX_RATE_REPO_HARDCODED_0.128_NO_DATE')
        else:
            r['price_usd'] = None; r['currency_status'] = 'CURRENCY_RATE_UNVERIFIED'
            r['reasons'].append('FX_RATE_NOT_DETERMINISTIC_FOR_' + cur)
    else:
        r['price_usd'] = None
    # mask price spans too before ref extraction
    pmask = mask_spans(dmask, [(mn['start'], mn['end']) for mn in mentions])
    refs = extract_refs(pmask)
    # collapse alias pairs: one ref's normalized form is a prefix of another (e.g. 5235R vs 5235/50R)
    if len(refs) >= 2:
        norms = sorted({normref(x) for x in refs}, key=len)
        non_alias = [norms[0]]
        for n in norms[1:]:
            if not any(n.startswith(k) or k.startswith(n) for k in non_alias):
                non_alias.append(n)
        # same 4-digit base + single price mention => alias pair of one watch, not a bundle
        if len(non_alias) >= 2 and len({n[:4] for n in non_alias}) == 1 and len(r['price_mentions']) <= 1:
            non_alias = non_alias[:1]
            r['reasons'].append('ALIAS_REF_PAIR_COLLAPSED')
        elif len(non_alias) < len(norms):
            r['reasons'].append('ALIAS_REF_PAIR_COLLAPSED')
        r['is_bundle'] = len(non_alias) >= 2
    else:
        r['is_bundle'] = False
    r['refs_found'] = refs
    ref_tok = refs[0] if refs else None
    r['reference_normalized'] = normalize_reference(ref_tok) if ref_tok else None
    if not ref_tok: r['reasons'].append('NO_REFERENCE_FOUND')
    if ref_tok:
        st, cbrand, model, cdials, cands, sfx = catalog_lookup(r['reference_normalized'])
        r['catalog_status'] = st; r['catalog_brand'] = cbrand; r['catalog_model'] = model
        r['catalog_dials'] = cdials; r['catalog_candidates'] = cands
        if sfx: r['reasons'].append('REF_SUFFIX_VARIANT_FALLBACK')
        if st == 'NOT_FOUND': r['reasons'].append('REFERENCE_NOT_FOUND')
        if st == 'MULTIPLE_CANDIDATES': r['reasons'].append('REFERENCE_AMBIGUOUS')
    else:
        r['catalog_status'] = 'UNVERIFIED'; r['catalog_brand'] = None; r['catalog_model'] = ''
        r['catalog_dials'] = []; r['catalog_candidates'] = []
    b = None
    for pat, name in BRAND_WORDS:
        if pat.search(text): b = name; break
    if b is None and r['catalog_brand']: b = r['catalog_brand']
    r['brand_normalized'] = b
    if b is None: r['reasons'].append('BRAND_NOT_DETERMINED')
    dm = DIAL_RE.search(text)
    if dm:
        after = text[dm.end():dm.end()+12].lower()
        if dm.group(0).lower() in ('rose','white','yellow','red','black','pink') and re.match(r'\s*(gold|platinum|steel|titanium)', after):
            dm2 = DIAL_RE.search(text, dm.end())
            dm = dm2
    r['dial_raw'] = dm.group(0) if dm else None
    if r['dial_raw']:
        low = r['dial_raw'].lower()
        if low in SPECIAL_TERMS:
            if any(low == d.lower() for d in r['catalog_dials']):
                r['dial_normalized'] = next(d for d in r['catalog_dials'] if d.lower() == low)
            else:
                r['dial_normalized'] = None; r['reasons'].append('POSSIBLE_SPECIAL_EDITION')
        else:
            r['dial_normalized'] = DIAL_MAP.get(low, r['dial_raw'].strip().title())
            if r['catalog_dials'] and not any(r['dial_normalized'].lower() == d.lower() for d in r['catalog_dials']):
                r['reasons'].append('DIAL_CATALOG_MISMATCH')
    else:
        r['dial_normalized'] = None; r['reasons'].append('DIAL_NOT_IN_EVIDENCE')
    cm = COND_RE.search(text)
    if cm:
        c = re.sub(r'\s+', ' ', cm.group(0).lower())
        r['condition_normalized'] = {'brand new':'New','brandnew':'New','new':'New','unworn':'New','sealed':'New',
                                     'like new':'Like New','mint':'Like New','used':'Used',
                                     'pre-owned':'Used','preowned':'Used','pre owned':'Used'}.get(c, c.title())
        r['condition_raw'] = cm.group(0)
    else:
        r['condition_normalized'] = None; r['condition_raw'] = None; r['reasons'].append('CONDITION_NOT_IN_EVIDENCE')
    if r['catalog_status'] == 'MULTIPLE_CANDIDATES':
        explicit_brand = None
        for pat, name in BRAND_WORDS:
            if pat.search(text): explicit_brand = name; break
        if explicit_brand:
            hits = CAT.get(normref(r['reference_normalized']), [])
            match = [h for h in hits if h['brand'] == explicit_brand]
            if match:
                r['catalog_status'] = 'EXACT_MATCH'; r['catalog_brand'] = explicit_brand
                r['brand_normalized'] = explicit_brand
                r['catalog_model'] = next((h['model'] for h in match if h['model']), r['catalog_model'])
                r['catalog_dials'] = sorted({d for h in match for d in h['dial_colors']})
                r['reasons'] = [x for x in r['reasons'] if x != 'REFERENCE_AMBIGUOUS']
                r['reasons'].append('REF_BRAND_DISAMBIGUATED')
    sm = SET_RE.search(text)
    if sm:
        s = sm.group(0).lower().replace(' ', '')
        r['set_status'] = ('WATCH_ONLY' if s in ('naked','watchonly') else
                           'FULL_SET' if ('full' in s or 'papers' in s or s.startswith('w/p')) else 'CLAIMED')
        r['reasons'].append('SET_STATUS_' + r['set_status'])
    else:
        r['set_status'] = None
    return r
