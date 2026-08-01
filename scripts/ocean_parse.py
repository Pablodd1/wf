#!/usr/bin/env python3
"""
Step 1: Parse 545,900 missing OceanDigital titles into the 27-column normalized schema.
Pure-Python JASS-style extraction (brand/ref/dial/price/currency/WTS-WTB/condition).
Input: /tmp/ocean_missing_watches.csv
Output: /tmp/ocean_normalized.csv (+ JSON stats)
"""
import csv, re, json
from collections import Counter

IN_CSV = "/tmp/ocean_missing_watches.csv"
OUT_CSV = "/tmp/ocean_normalized.csv"
OUT_STATS = "/tmp/ocean_normalized_stats.json"

# ---------- Brand detection ----------
BRAND_MAP = [
    (r'\bpatek\b|\bpatek\s*philippe\b|\bpp\b', 'Patek Philippe'),
    (r'\baudemars\b|\baudemars\s*piguet\b|\bap\b', 'Audemars Piguet'),
    (r'\brichard\s*mille\b|\brm\s*\d', 'Richard Mille'),
    (r'\ba\.?\s*lange\b|\blange\s*&?\s*s[oö]hne\b|\blange\b', 'A. Lange & Söhne'),
    (r'\bvacheron\b', 'Vacheron Constantin'),
    (r'\bf\.?\s*p\.?\s*journe\b|\bjourne\b', 'F.P. Journe'),
    (r'\bh\.?\s*moser\b|\bmoser\b', 'H. Moser & Cie'),
    (r'\bmb\s*&?\s*f\b', 'MB&F'),
    (r'\bgreubel\b', 'Greubel Forsey'),
    (r'\bjacob\b', 'Jacob & Co'),
    (r'\brolex\b', 'Rolex'),
    (r'\bomega\b', 'Omega'),
    (r'\bcartier\b', 'Cartier'),
    (r'\btudor\b', 'Tudor'),
    (r'\bpanerai\b|\bpam\s*\d', 'Panerai'),
    (r'\bhublot\b', 'Hublot'),
    (r'\biwc\b', 'IWC'),
    (r'\bzenith\b', 'Zenith'),
    (r'\bbreitling\b', 'Breitling'),
    (r'\bbvlgari\b|\bbulgari\b', 'Bvlgari'),
    (r'\bpiaget\b', 'Piaget'),
    (r'\bjaeger\b|\bjlc\b', 'Jaeger-LeCoultre'),
    (r'\bbreguet\b', 'Breguet'),
    (r'\bblancpain\b', 'Blancpain'),
    (r'\bglashutte\b|\bglash[uü]tte\b', 'Glashutte Original'),
    (r'\bgrand\s*seiko\b', 'Grand Seiko'),
    (r'\btag\s*heuer\b|\btag\b', 'TAG Heuer'),
    (r'\bchopard\b', 'Chopard'),
    (r'\bulysse\b', 'Ulysse Nardin'),
    (r'\bgirard\b', 'Girard-Perregaux'),
    (r'\bfranck\s*muller\b', 'Franck Muller'),
    (r'\bbell\s*&?\s*ross\b', 'Bell & Ross'),
    (r'\broger\s*dubuis\b', 'Roger Dubuis'),
]
BRAND_RES = [(re.compile(p, re.I), b) for p, b in BRAND_MAP]

# Reference patterns per brand family (order matters: AP before Rolex)
def extract_ref(title, brand):
    t = title
    # Slash refs (Patek/AP/Lange): 5711/1A, 15500ST.OO, 82172/000R
    m = re.search(r'\b(\d{4,6}[A-Z]{0,3}/[A-Z0-9\-]+)\b', t, re.I)
    if m: return m.group(1).upper()
    # AP dotted: 15500ST.OO.1220ST.01
    m = re.search(r'\b(\d{5}[A-Z]{2}\.[A-Z]{2}\.[A-Z0-9.]+)\b', t, re.I)
    if m: return m.group(1).upper()
    # RM: RM67-02, RM 11-03
    m = re.search(r'\bRM\s*-?\s*(\d{2,3}[-\s]?\d{2})\b', t, re.I)
    if m: return 'RM' + m.group(1).replace(' ', '-')
    # Panerai PAM
    m = re.search(r'\bPAM\s*-?\s*(\d{3,5})\b', t, re.I)
    if m: return 'PAM' + m.group(1)
    # Lange dotted: 181.029
    m = re.search(r'\b(\d{3}\.\d{3})\b', t)
    if m: return m.group(1)
    # Generic 5-7 digit ref with optional letters: 116508, 126333, 5711, 116500LN
    m = re.search(r'\b(\d{5,7}[A-Z]{0,4})\b', t)
    if m: return m.group(1).upper()
    # 4-digit with letters (5711, 5712 style already caught by 4+; older 4-digit refs)
    m = re.search(r'\b(\d{4}[A-Z]{1,3})\b', t)
    if m: return m.group(1).upper()
    return ''

# Dial colors
DIALS = [
    ('mother of pearl', 'Mother of Pearl'), ('mop', 'Mother of Pearl'),
    ('ice blue', 'Ice Blue'), ('tiffany', 'Tiffany Blue'), ('olive', 'Olive Green'),
    ('mint green', 'Mint Green'), ('navy', 'Navy Blue'), ('wimbledon', 'Wimbledon'),
    ('rhodium', 'Rhodium'), ('meteorite', 'Meteorite'), ('skeleton', 'Skeleton'),
    ('champagne', 'Champagne'), ('chocolate', 'Chocolate'), ('salmon', 'Salmon'),
    ('bronze', 'Bronze'), ('slate', 'Slate'), ('panda', 'Panda'),
    ('black', 'Black'), ('white', 'White'), ('blue', 'Blue'), ('green', 'Green'),
    ('silver', 'Silver'), ('grey', 'Grey'), ('gray', 'Grey'), ('pink', 'Pink'),
    ('red', 'Red'), ('yellow', 'Yellow'), ('brown', 'Brown'), ('purple', 'Purple'),
    ('cream', 'Cream'), ('beige', 'Beige'), ('orange', 'Orange'),
]

# Currency patterns -> (regex, currency, usd_rate_or_None)
CUR_PATTERNS = [
    (re.compile(r'(?:HK\$|HKD)\s*\.?\s*([\d,]+(?:\.\d+)?)\s*([kKmM])?', re.I), 'HKD', 0.128),
    (re.compile(r'([\d,]+(?:\.\d+)?)\s*([kKmM])?\s*(?:HKD|HK\$)', re.I), 'HKD', 0.128),
    (re.compile(r'(?:US\$|USD|USDT)\s*\.?\s*([\d,]+(?:\.\d+)?)\s*([kKmM])?', re.I), 'USD', 1.0),
    (re.compile(r'([\d,]+(?:\.\d+)?)\s*([kKmM])?\s*(?:USD|USDT|US\$)', re.I), 'USD', 1.0),
    (re.compile(r'\$\s*([\d,]+(?:\.\d+)?)\s*([kKmM])?'), 'USD', 1.0),  # bare $ assumed USD (flagged)
    (re.compile(r'(?:EUR|€)\s*\.?\s*([\d,]+(?:\.\d+)?)\s*([kKmM])?', re.I), 'EUR', 1.08),
    (re.compile(r'(?:GBP|£)\s*\.?\s*([\d,]+(?:\.\d+)?)\s*([kKmM])?', re.I), 'GBP', 1.27),
    (re.compile(r'(?:CHF)\s*\.?\s*([\d,]+(?:\.\d+)?)\s*([kKmM])?', re.I), 'CHF', 1.12),
    (re.compile(r'(?:AED)\s*\.?\s*([\d,]+(?:\.\d+)?)\s*([kKmM])?', re.I), 'AED', 0.272),
    (re.compile(r'(?:SGD)\s*\.?\s*([\d,]+(?:\.\d+)?)\s*([kKmM])?', re.I), 'SGD', 0.74),
    (re.compile(r'(?:RMB|CNY)\s*\.?\s*([\d,]+(?:\.\d+)?)\s*([kKmM])?', re.I), 'CNY', 0.138),
]

WTB_RE = re.compile(r'^\s*(?:WTB|LTB|ISO)\b|\bwtb\b|\blooking\s*for\b|\bwant\s*to\s*buy\b|\bin\s*search\s*of\b', re.I)

# Brand inference from reference pattern (JASS ordering: AP before Rolex)
def infer_brand_from_ref(ref):
    if not ref:
        return ''
    r = ref.upper()
    if r.startswith('RM') and re.match(r'RM\d{2}', r):
        return 'Richard Mille'
    if r.startswith('PAM'):
        return 'Panerai'
    if '/' in r:
        # Slash refs: Patek (5711/1A, 5712/1A, 5980/60G, 7118/1200R) vs Lange (82172/000R)
        head = r.split('/')[0]
        if re.match(r'^[2-9]\d{3,4}[A-Z]?$', head):
            return 'Patek Philippe'
        return 'Patek Philippe'  # slash refs overwhelmingly Patek in dealer data
    # AP patterns FIRST (155xx, 154xx, 262xx, 26xxx, 41xxx, 77xxx, 74xx)
    if re.match(r'^1[56]\d{3}', r) or re.match(r'^2[56]\d{3}', r) or re.match(r'^41\d{3}', r) or re.match(r'^77\d{3}', r) or re.match(r'^74\d{2}', r):
        return 'Audemars Piguet'
    # Rolex 5-6 digit (10xxx-19xxxx)
    if re.match(r'^1[0-8]\d{4}', r):
        return 'Rolex'
    # Rolex 4-digit + letters (1675, 6263 style) — only with letters to avoid years
    if re.match(r'^\d{4}[A-Z]{1,3}$', r):
        return 'Rolex'
    # Lange dotted (181.029)
    if re.match(r'^\d{3}\.\d{3}$', r):
        return 'A. Lange & Söhne'
    return ''

def parse_price(title):
    """Returns (price_usd, currency, price_raw, provenance). provenance: EXPLICIT/BARE_DOLLAR/NONE"""
    for rx, cur, rate in CUR_PATTERNS:
        m = rx.search(title)
        if m:
            num_str = m.group(1).replace(',', '')
            try:
                num = float(num_str)
            except ValueError:
                continue
            suffix = (m.group(2) or '').lower()
            if suffix == 'k':
                num *= 1000
            elif suffix == 'm':
                num *= 1_000_000
            # sanity gate
            if num < 100 or num > 50_000_000:
                continue
            usd = round(num * rate)
            prov = 'EXPLICIT'
            if rx.pattern.startswith('\\$'):
                prov = 'BARE_DOLLAR'
            return (usd, cur, f"{num:,.0f} {cur}", prov)
    return (0, '', '', 'NONE')

def parse_row(row):
    mysql_id, from_name, from_number, region, price_col, status, origin, deadline, title = row
    title = title or ''
    # Brand
    brand = ''
    for rx, b in BRAND_RES:
        if rx.search(title):
            brand = b
            break
    # Ref
    ref = extract_ref(title, brand)
    # Brand inference from ref when text gave no brand
    if not brand and ref:
        brand = infer_brand_from_ref(ref)
    # Model = ref for now (catalog mapping happens later)
    model = ref
    # Dial
    dial = 'Unknown'
    tl = title.lower()
    for kw, canon in DIALS:
        if re.search(r'\b' + re.escape(kw) + r'\b', tl):
            dial = canon
            break
    # Intent
    intent = 'WTB' if WTB_RE.search(title) else 'WTS'
    # Price: prefer title extraction; fall back to MySQL price column (USD, provenance MYSQL_COL)
    price_usd, currency, price_raw, prov = parse_price(title)
    if price_usd == 0 and price_col:
        try:
            mp = float(price_col)
            if 100 <= mp <= 50_000_000:
                price_usd = round(mp)
                currency = 'USD'
                price_raw = f"{mp:,.0f} USD"
                prov = 'MYSQL_COL'
        except ValueError:
            pass
    # Condition
    cond = 'Used'
    if re.search(r'\b(?:brand\s*new|bnib|new\b|unworn|sealed|n\d{1,2}/2\d)\b', tl):
        cond = 'New'
    elif re.search(r'\b(?:used|pre[- ]?owned|preowned)\b', tl):
        cond = 'Used'
    # QA disposition
    if prov == 'EXPLICIT':
        qa = 'PASS'
    elif prov == 'MYSQL_COL':
        qa = 'PUBLISH_WITH_FLAG'
    elif prov == 'BARE_DOLLAR':
        qa = 'PUBLISH_WITH_FLAG'
    else:
        qa = 'PUBLISH_WITH_FLAG'  # no price — display only
    price_eligible = 'YES' if (intent == 'WTS' and price_usd > 0 and prov in ('EXPLICIT', 'MYSQL_COL')) or intent == 'WTB' else 'NO'
    return {
        'Auction ID': f'ocean_{mysql_id}',
        'Posting Date': deadline or '',
        'Posted By': from_name or '',
        'raw_line': title,
        'Phone Number': from_number or '',
        'Intent / Type': intent,
        'Brand': brand or 'Unknown',
        'Model': model,
        'Raw Reference': ref,
        'Normalized Reference': ref,
        'Catalog Reference': '',
        'Catalog Model': '',
        'Dial Color': dial,
        'Catalog Dial': '',
        'Condition': cond,
        'Price ($ USD)': price_usd,
        'Verification Tier': 'Tier 3 - Auto',
        'Confidence %': '70' if prov == 'EXPLICIT' else '55',
        'Verification Status': 'Auto Parsed',
        'User Image URL': '',
        'Catalog Image URL': '',
        'Final Image URL': '',
        'qa_disposition': qa,
        'catalog_status': 'CATALOG_NOT_AVAILABLE',
        'trading_floor_eligible': 'YES',
        'price_research_eligible': price_eligible,
        'dial_resolution_source': 'RAW_TEXT' if dial != 'Unknown' else 'UNKNOWN',
        'price_provenance': prov,
        'currency': currency,
        'region': region or '',
    }

def main():
    rows = list(csv.reader(open(IN_CSV, encoding='utf-8')))
    header, data = rows[0], rows[1:]
    print(f"Parsing {len(data):,} missing titles...", flush=True)
    out_rows = []
    stats = Counter()
    for i, r in enumerate(data, 1):
        try:
            parsed = parse_row(r)
            out_rows.append(parsed)
            stats[f"brand:{parsed['Brand']}"] += 1
            stats[f"prov:{parsed['price_provenance']}"] += 1
            stats[f"intent:{parsed['Intent / Type']}"] += 1
            if parsed['Dial Color'] != 'Unknown':
                stats['dial_found'] += 1
            if parsed['Price ($ USD)'] > 0:
                stats['price_found'] += 1
        except Exception as e:
            stats['errors'] += 1
        if i % 100000 == 0:
            print(f"  ... {i:,}", flush=True)

    cols = ['Auction ID','Posting Date','Posted By','raw_line','Phone Number','Intent / Type','Brand','Model',
            'Raw Reference','Normalized Reference','Catalog Reference','Catalog Model','Dial Color','Catalog Dial',
            'Condition','Price ($ USD)','Verification Tier','Confidence %','Verification Status','User Image URL',
            'Catalog Image URL','Final Image URL','qa_disposition','catalog_status','trading_floor_eligible',
            'price_research_eligible','dial_resolution_source','price_provenance','currency','region']
    with open(OUT_CSV, 'w', newline='', encoding='utf-8') as f:
        w = csv.DictWriter(f, fieldnames=cols)
        w.writeheader()
        for r in out_rows:
            w.writerow(r)

    summary = {
        'total_parsed': len(out_rows),
        'price_found': stats['price_found'],
        'dial_found': stats['dial_found'],
        'errors': stats['errors'],
        'intent': {k.split(':',1)[1]: v for k, v in stats.items() if k.startswith('intent:')},
        'price_provenance': {k.split(':',1)[1]: v for k, v in stats.items() if k.startswith('prov:')},
        'top_brands': sorted([(k.split(':',1)[1], v) for k, v in stats.items() if k.startswith('brand:')],
                             key=lambda x: -x[1])[:30],
    }
    with open(OUT_STATS, 'w') as f:
        json.dump(summary, f, indent=2)
    print(json.dumps(summary, indent=2), flush=True)

if __name__ == '__main__':
    main()
