import re
from datetime import datetime, timezone
import hashlib

# Standard FX conversion table
FX_TO_USD = {
    'USD': 1.0,
    'EUR': 1.08,
    'GBP': 1.28,
    'HKD': 0.128,
    'SGD': 0.76,
    'AED': 0.272,
    'JPY': 0.0068,
    'CHF': 1.14,
    'CAD': 0.73,
    'AUD': 0.66
}

# Brand Aliases & Canonical Names
BRAND_PATTERNS = [
    (r'\b(rolex)\b', 'Rolex'),
    (r'\b(audemars\s+piguet|ap)\b', 'Audemars Piguet'),
    (r'\b(patek\s+philippe|patek|pp)\b', 'Patek Philippe'),
    (r'\b(breguet)\b', 'Breguet'),
    (r'\b(tag\s+heuer|tag)\b', 'TAG Heuer'),
    (r'\b(cartier)\b', 'Cartier'),
    (r'\b(omega)\b', 'Omega'),
    (r'\b(tudor)\b', 'Tudor'),
    (r'\b(vacheron\s+constantin|vc)\b', 'Vacheron Constantin'),
    (r'\b(richard\s+mille|rm)\b', 'Richard Mille'),
    (r'\b(iwc|schaffhausen)\b', 'IWC'),
    (r'\b(breitling)\b', 'Breitling'),
    (r'\b(hublot)\b', 'Hublot'),
    (r'\b(panerai|pam)\b', 'Panerai'),
    (r'\b(jaeger[\s\-]lecoultre|jlc)\b', 'Jaeger-LeCoultre'),
    (r'\b(a\.\s*lange\s*(&|and)?\s*s[öo]hne|lange)\b', 'A. Lange & Söhne'),
    (r'\b(franck\s+muller|fm)\b', 'Franck Muller'),
    (r'\b(girard[\s\-]perregaux|gp)\b', 'Girard-Perregaux'),
    (r'\b(chopard)\b', 'Chopard'),
    (r'\b(zenith)\b', 'Zenith'),
    (r'\b(blancpain)\b', 'Blancpain'),
    (r'\b(ulysse\s+nardin|un)\b', 'Ulysse Nardin'),
    (r'\b(grand\s+seiko|gs)\b', 'Grand Seiko'),
    (r'\b(bulgari|bvlgari)\b', 'Bulgari'),
    (r'\b(seiko)\b', 'Seiko'),
    (r'\b(longines)\b', 'Longines'),
    (r'\b(tissot)\b', 'Tissot'),
    (r'\b(bell\s*(&|and)?\s*ross)\b', 'Bell & Ross'),
    (r'\b(f\.?p\.?\s*journe|journe)\b', 'F.P. Journe'),
    (r'\b(h\.?\s*moser\s*(&|and)?\s*cie|moser)\b', 'H. Moser & Cie'),
    (r'\b(glash[üu]tte\s+original)\b', 'Glashütte Original'),
    (r'\b(jacob\s*(&|and)?\s*co)\b', 'Jacob & Co')
]

# Rolex reference detection for hangtag disambiguation
ROLEX_REF_PATTERN = re.compile(
    r'\b(1165\d{2}[a-z]*|1265\d{2}[a-z]*|1166\d{2}[a-z]*|1266\d{2}[a-z]*|1267\d{2}[a-z]*|1167\d{2}[a-z]*|'
    r'1263\d{2}[a-z]*|1163\d{2}[a-z]*|1262\d{2}[a-z]*|1162\d{2}[a-z]*|2282\d{2}[a-z]*|2182\d{2}[a-z]*|'
    r'1282\d{2}[a-z]*|1182\d{2}[a-z]*|124060|126610[a-z]*|116610[a-z]*|116500[a-z]*|126500[a-z]*|'
    r'116506[a-z]*|126506[a-z]*|226570|216570|16570|124270|124300|126000|124200|136660|126660|116660|'
    r'submariner|daytona|day[\s\-]date|datejust|gmt[\s\-]master|sea[\s\-]dweller|sky[\s\-]dweller|explorer|oyster\s+perpetual)\b',
    re.IGNORECASE
)

# Price extraction patterns
PRICE_REGEXES = [
    # $15,500 or $15500 or $15.5k or $15k
    (re.compile(r'\$\s*([0-9]{1,3}(?:,[0-9]{3})+(?:\.[0-9]{1,2})?|[0-9]+(?:\.[0-9]{1,2})?)\s*(k|m)?\b', re.I), 'USD'),
    # 185000HKD or 185,000 HKD or 185k hkd
    (re.compile(r'\b([0-9]{1,3}(?:,[0-9]{3})*|[0-9]+(?:\.[0-9]+)?)\s*(k)?\s*(hkd|hk\$)\b', re.I), 'HKD'),
    # €12,000 or 12000 EUR
    (re.compile(r'(?:€|\beur\b|\beuros?\b)\s*([0-9]{1,3}(?:,[0-9]{3})+(?:\.[0-9]{1,2})?|[0-9]+(?:\.[0-9]+)?)\s*(k)?\b', re.I), 'EUR'),
    (re.compile(r'\b([0-9]{1,3}(?:,[0-9]{3})*|[0-9]+(?:\.[0-9]+)?)\s*(k)?\s*(?:€|\beur\b|\beuros?\b)\b', re.I), 'EUR'),
    # £8,500 or 8500 GBP
    (re.compile(r'(?:£|\bgbp\b)\s*([0-9]{1,3}(?:,[0-9]{3})+(?:\.[0-9]{1,2})?|[0-9]+(?:\.[0-9]+)?)\s*(k)?\b', re.I), 'GBP'),
    (re.compile(r'\b([0-9]{1,3}(?:,[0-9]{3})*|[0-9]+(?:\.[0-9]+)?)\s*(k)?\s*(?:£|\bgbp\b)\b', re.I), 'GBP'),
    # 45000 AED / DHS
    (re.compile(r'\b([0-9]{1,3}(?:,[0-9]{3})*|[0-9]+(?:\.[0-9]+)?)\s*(k)?\s*(aed|dhs|dirhams?)\b', re.I), 'AED'),
    # 22000 SGD / SGD 22000
    (re.compile(r'\b([0-9]{1,3}(?:,[0-9]{3})*|[0-9]+(?:\.[0-9]+)?)\s*(k)?\s*(sgd|sing\s*\$)\b', re.I), 'SGD'),
    # 2500000 JPY / ¥2500000
    (re.compile(r'\b([0-9]{1,3}(?:,[0-9]{3})*|[0-9]+(?:\.[0-9]+)?)\s*(k|m)?\s*(jpy|yen|¥)\b', re.I), 'JPY'),
    # CHF 14,000
    (re.compile(r'\b([0-9]{1,3}(?:,[0-9]{3})*|[0-9]+(?:\.[0-9]+)?)\s*(k)?\s*(chf)\b', re.I), 'CHF'),
    # Plain number trailing price: e.g. "136000" or "52,500" or "36.25k"
    (re.compile(r'(?:price|ask|asking|net|firm|for)?\s*[:=\-]?\s*\b([0-9]{1,3}(?:,[0-9]{3})+|[0-9]{4,7})\b', re.I), 'DEFAULT'),
    (re.compile(r'\b([0-9]{1,3}(?:\.[0-9]{1,2})?)\s*k\b', re.I), 'DEFAULT_K')
]

# Non-backtracking, linear Reference Pattern
REF_PATTERN = re.compile(
    r'\b[0-9A-Za-z]{3,12}(?:[\.\-\/][0-9A-Za-z]{1,8})?\b'
)

# Year pattern
YEAR_PATTERN = re.compile(r'\b(20[0-2][0-9]|19[8-9][0-9]|[0-2][0-9]y|\'[0-2][0-9])\b', re.I)

class UnbundlingEngine:
    def __init__(self):
        pass

    def unbundle_message(self, raw_message, parent_record=None):
        """
        Segments a raw multi-watch message into discrete watch item lines,
        extracts metadata for each line, and resolves brand attribution.
        Returns a list of extracted child listing dictionaries.
        """
        if not raw_message or not isinstance(raw_message, str):
            return []

        # 1. Clean message and split into raw segment lines
        lines = self._segment_lines(raw_message)
        if not lines:
            return []

        extracted_items = []
        current_brand_context = None

        for idx, line in enumerate(lines, 1):
            line_clean = line.strip()
            if len(line_clean) < 5:
                continue

            # Check if this line is just a brand header (e.g. "⌚Used AP⌚" or "ROLEX:")
            header_brand = self._detect_brand_header(line_clean)
            if header_brand:
                current_brand_context = header_brand
                # If there's more text on this header line, continue parsing it
                remaining_text = self._strip_brand_header(line_clean, header_brand)
                if len(remaining_text) < 5:
                    continue
                else:
                    line_clean = remaining_text

            # Parse item details from this specific line
            item_data = self._parse_single_line(line_clean, default_brand=current_brand_context)
            if item_data:
                item_data['item_index'] = len(extracted_items) + 1
                item_data['raw_line'] = line_clean
                extracted_items.append(item_data)

        return extracted_items

    def _segment_lines(self, text):
        """Splits multi-item dealer messages across common delimiters."""
        if not text:
            return []
        # Replace emoji bullets and separators with newlines
        formatted = re.sub(r'[⌚🔥⚡💎👑🔴🔵🟢•▪*\t\r]+', '\n', text)
        # Split by numbered lines e.g. "1. ", "2) "
        formatted = re.sub(r'(?:^|\n)\s*(\d+[\.\)])\s+', r'\n\1 ', formatted)
        
        raw_lines = []
        for l in formatted.split('\n'):
            l_clean = l.strip()
            if not l_clean:
                continue
            if ' / ' in l_clean or ' | ' in l_clean:
                parts = re.split(r'\s+[\|\/]\s+', l_clean)
                for p in parts:
                    p_str = p.strip()
                    if len(p_str) > 3:
                        raw_lines.append(p_str)
            else:
                raw_lines.append(l_clean)
        return raw_lines

    def _detect_brand_header(self, line):
        """Detects if a line is a section header for a specific brand."""
        line_lower = line.lower()
        for pat, brand in BRAND_PATTERNS:
            if re.search(pat, line_lower):
                # If it's a short header line like "Used Breguet" or "Rolex:"
                if len(line.split()) <= 4:
                    return brand
        return None

    def _strip_brand_header(self, line, brand):
        return re.sub(brand, '', line, flags=re.IGNORECASE).strip(' :-\t')

    def _parse_single_line(self, line, default_brand=None):
        line_lower = line.lower()

        # 1. Brand Detection & Rolex Disambiguation
        detected_brand = None
        
        # Check for Rolex references (e.g. 228238, 116506, white tag)
        rolex_match = ROLEX_REF_PATTERN.search(line_lower)
        if rolex_match and ('white tag' in line_lower or 'green tag' in line_lower or 'hang tag' in line_lower or 'tag' in line_lower):
            detected_brand = 'Rolex'
        else:
            for pat, brand in BRAND_PATTERNS:
                if re.search(pat, line_lower):
                    detected_brand = brand
                    break

        if not detected_brand:
            detected_brand = default_brand or "UNRESOLVED"

        # 2. Price Extraction
        price_val, currency, usd_price = self._extract_price(line)

        # 3. Reference Extraction
        ref_norm = self._extract_reference(line, detected_brand)

        # 4. Year Extraction
        year_val = self._extract_year(line)

        # 5. Condition / Box / Papers
        box, papers, full_set, condition = self._extract_box_papers_condition(line)

        # 6. Model Guess
        model_name = self._resolve_model(line, detected_brand, ref_norm)

        # Check if line has enough watch substance
        if detected_brand == "UNRESOLVED" and ref_norm == "UNRESOLVED" and price_val is None:
            return None

        return {
            'brand': detected_brand,
            'model': model_name,
            'reference': ref_norm,
            'year': year_val,
            'price_raw': str(price_val) if price_val is not None else "",
            'currency': currency,
            'price_usd': usd_price,
            'box': box,
            'papers': papers,
            'full_set': full_set,
            'condition': condition,
            'is_watch': True
        }

    def _extract_price(self, line):
        for pattern, curr in PRICE_REGEXES:
            m = pattern.search(line)
            if m:
                val_str = m.group(1).replace(',', '')
                try:
                    num = float(val_str)
                except ValueError:
                    continue

                # Multiplier
                if len(m.groups()) >= 2 and m.group(2):
                    mult = m.group(2).lower()
                    if mult == 'k': num *= 1000
                    elif mult == 'm': num *= 1000000
                elif curr == 'DEFAULT_K':
                    num *= 1000
                    curr = 'USD'

                actual_curr = curr
                if curr in ('DEFAULT', 'DEFAULT_K'):
                    # Guess currency based on magnitude
                    if num > 40000 and ('hk' in line.lower() or 'hkd' in line.lower()):
                        actual_curr = 'HKD'
                    elif num > 40000 and ('aed' in line.lower() or 'dhs' in line.lower()):
                        actual_curr = 'AED'
                    elif num > 100000:
                        actual_curr = 'HKD' if 'hk' in line.lower() else 'JPY'
                    else:
                        actual_curr = 'USD'

                fx_rate = FX_TO_USD.get(actual_curr, 1.0)
                usd_price = round(num * fx_rate, 2)
                return num, actual_curr, usd_price

        return None, "", None

    def _extract_reference(self, line, brand):
        # Look for references
        matches = REF_PATTERN.findall(line)
        cleaned_matches = []
        for m in matches:
            m_clean = m.upper().strip('.-/')
            # Exclude words that look like years or phone codes
            if re.match(r'^(20[0-2][0-9]|19[8-9][0-9]|USD|HKD|EUR|GBP|AED|SGD|CHF|JPY|FULLSET|BNIB|USED|MINT|BOX|PAPERS|NEW)$', m_clean):
                continue
            if len(m_clean) >= 4:
                cleaned_matches.append(m_clean)

        if cleaned_matches:
            return cleaned_matches[0]
        return "UNRESOLVED"

    def _extract_year(self, line):
        m = YEAR_PATTERN.search(line)
        if m:
            yr = m.group(1).lower().replace('y', '').replace("'", '')
            if len(yr) == 2:
                num = int(yr)
                return f"20{num:02d}" if num <= 30 else f"19{num:02d}"
            return yr
        return ""

    def _extract_box_papers_condition(self, line):
        line_lower = line.lower()
        full_set = "UNKNOWN"
        box = "UNKNOWN"
        papers = "UNKNOWN"
        condition = "Pre-Owned"

        if 'bnib' in line_lower or 'brand new' in line_lower or 'unworn' in line_lower:
            condition = "Unworn / New"
        elif 'mint' in line_lower:
            condition = "Mint"
        elif 'used' in line_lower or 'pre-owned' in line_lower:
            condition = "Pre-Owned"

        if 'fullset' in line_lower or 'full set' in line_lower or 'complete set' in line_lower or 'box and paper' in line_lower or 'b&p' in line_lower:
            full_set = "YES"
            box = "YES"
            papers = "YES"
        elif 'naked' in line_lower or 'watch only' in line_lower or 'no box' in line_lower:
            full_set = "NO"
            box = "NO" if 'no box' in line_lower else "UNKNOWN"
            papers = "NO" if 'no paper' in line_lower else "UNKNOWN"

        return box, papers, full_set, condition

    def _resolve_model(self, line, brand, ref):
        line_lower = line.lower()
        if brand == "Rolex":
            if 'daytona' in line_lower or ref.startswith('1165') or ref.startswith('1265'): return "Daytona"
            elif 'submariner' in line_lower or ref.startswith('12661') or ref.startswith('11661') or ref.startswith('12406'): return "Submariner"
            elif 'gmt' in line_lower or ref.startswith('1267') or ref.startswith('1167'): return "GMT-Master II"
            elif 'day date' in line_lower or 'day-date' in line_lower or ref.startswith('2282') or ref.startswith('2182'): return "Day-Date"
            elif 'datejust' in line_lower or ref.startswith('1263') or ref.startswith('1262') or ref.startswith('1162'): return "Datejust"
            elif 'sky dweller' in line_lower or 'sky-dweller' in line_lower or ref.startswith('3269') or ref.startswith('3369'): return "Sky-Dweller"
            elif 'explorer' in line_lower or ref.startswith('12427') or ref.startswith('22657'): return "Explorer"
            elif 'oyster perpetual' in line_lower or ref.startswith('12430') or ref.startswith('12600'): return "Oyster Perpetual"
            else: return "Rolex Collection"
        elif brand == "Audemars Piguet":
            if 'royal oak offshore' in line_lower or 'offshore' in line_lower or ref.startswith('264'): return "Royal Oak Offshore"
            elif 'royal oak' in line_lower or ref.startswith('154') or ref.startswith('155') or ref.startswith('152') or ref.startswith('263') or ref.startswith('262'): return "Royal Oak"
            elif 'code 11.59' in line_lower or 'code' in line_lower: return "Code 11.59"
            else: return "Audemars Piguet Collection"
        elif brand == "Patek Philippe":
            if 'nautilus' in line_lower or ref.startswith('571') or ref.startswith('572') or ref.startswith('598') or ref.startswith('599') or ref.startswith('711'): return "Nautilus"
            elif 'aquanaut' in line_lower or ref.startswith('516') or ref.startswith('596') or ref.startswith('526') or ref.startswith('506'): return "Aquanaut"
            elif 'calatrava' in line_lower or ref.startswith('519') or ref.startswith('522') or ref.startswith('611') or ref.startswith('529'): return "Calatrava"
            elif 'complications' in line_lower or ref.startswith('539') or ref.startswith('520') or ref.startswith('590'): return "Complications"
            elif 'twenty~4' in line_lower or 'twenty 4' in line_lower or ref.startswith('491'): return "Twenty~4"
            else: return "Patek Philippe Collection"
        elif brand == "TAG Heuer":
            if 'carrera' in line_lower: return "Carrera"
            elif 'monaco' in line_lower: return "Monaco"
            elif 'aquaracer' in line_lower: return "Aquaracer"
            elif 'formula 1' in line_lower or 'f1' in line_lower: return "Formula 1"
            elif 'autavia' in line_lower: return "Autavia"
            elif 'link' in line_lower: return "Link"
            else: return "TAG Heuer Collection"
        elif brand == "Breguet":
            if 'marine' in line_lower: return "Marine"
            elif 'classique' in line_lower: return "Classique"
            elif 'type xx' in line_lower or 'type xxi' in line_lower or 'type 20' in line_lower: return "Type XX / XXI / XXII"
            elif 'reine de naples' in line_lower or ref.startswith('891'): return "Reine de Naples"
            elif 'tradition' in line_lower: return "Tradition"
            elif 'heritage' in line_lower or 'héritage' in line_lower: return "Héritage"
            else: return "Breguet Collection"
        elif brand == "Cartier":
            if 'santos' in line_lower: return "Santos"
            elif 'tank' in line_lower: return "Tank"
            elif 'ballon bleu' in line_lower: return "Ballon Bleu"
            elif 'panthere' in line_lower or 'panthère' in line_lower: return "Panthère"
            elif 'pasha' in line_lower: return "Pasha"
            else: return "Cartier Collection"
        elif brand == "Omega":
            if 'speedmaster' in line_lower: return "Speedmaster"
            elif 'seamaster' in line_lower: return "Seamaster"
            elif 'constellation' in line_lower: return "Constellation"
            elif 'de ville' in line_lower: return "De Ville"
            else: return "Omega Collection"
        elif brand == "Zenith":
            if 'chronomaster' in line_lower: return "Chronomaster Sport"
            elif 'defy' in line_lower: return "Defy"
            elif 'el primero' in line_lower: return "El Primero"
            elif 'pilot' in line_lower: return "Pilot"
            else: return "Zenith Collection"
        elif brand in ("Bulgari", "Bvlgari"):
            if 'octo finissimo' in line_lower: return "Octo Finissimo"
            elif 'octo' in line_lower: return "Octo"
            elif 'serpenti' in line_lower: return "Serpenti"
            elif 'aluminium' in line_lower or 'aluminum' in line_lower: return "Aluminium"
            elif 'bvlgari' in line_lower or 'bulgari' in line_lower: return "Bvlgari Bvlgari"
            else: return "Bulgari Collection"
        elif brand == "Chopard":
            if 'alpine eagle' in line_lower: return "Alpine Eagle"
            elif 'mille miglia' in line_lower: return "Mille Miglia"
            elif 'happy sport' in line_lower: return "Happy Sport"
            elif 'l.u.c' in line_lower or 'luc' in line_lower: return "L.U.C"
            else: return "Chopard Collection"
        elif brand == "Jacob & Co":
            if 'astronomia' in line_lower: return "Astronomia"
            elif 'epic x' in line_lower: return "Epic X"
            elif 'bugatti' in line_lower or 'chiron' in line_lower: return "Bugatti Chiron"
            elif 'five time zone' in line_lower or '5 time zone' in line_lower: return "Five Time Zone"
            else: return "Jacob & Co. Collection"
        elif brand == "Blancpain":
            if 'fifty fathoms' in line_lower: return "Fifty Fathoms"
            elif 'bathyscaphe' in line_lower: return "Bathyscaphe"
            elif 'villeret' in line_lower: return "Villeret"
            else: return "Blancpain Collection"
        elif brand == "Ulysse Nardin":
            if 'freak' in line_lower: return "Freak"
            elif 'marine' in line_lower: return "Marine Chronometer"
            elif 'diver' in line_lower: return "Diver"
            else: return "Ulysse Nardin Collection"
        elif brand == "Girard-Perregaux":
            if 'laureato' in line_lower: return "Laureato"
            elif 'bridges' in line_lower or 'three bridges' in line_lower: return "Bridges"
            elif '1966' in line_lower: return "1966"
            elif 'vintage 1945' in line_lower: return "Vintage 1945"
            else: return "Girard-Perregaux Collection"
        elif brand == "H. Moser & Cie":
            if 'streamliner' in line_lower: return "Streamliner"
            elif 'pioneer' in line_lower: return "Pioneer"
            elif 'endeavour' in line_lower: return "Endeavour"
            elif 'heritage' in line_lower: return "Heritage"
            else: return "H. Moser & Cie. Collection"
        elif brand == "Glashütte Original":
            if 'seaq' in line_lower: return "SeaQ"
            elif 'panomatic' in line_lower or 'panomaticlunar' in line_lower: return "PanoMaticLunar"
            elif 'senator' in line_lower: return "Senator"
            elif 'seventies' in line_lower: return "Seventies"
            else: return "Glashütte Original Collection"
        elif brand == "Grand Seiko":
            if 'evolution 9' in line_lower or 'evo 9' in line_lower: return "Evolution 9"
            elif 'snowflake' in line_lower: return "Heritage Snowflake"
            elif 'shunbun' in line_lower: return "Heritage Shunbun"
            elif 'heritage' in line_lower: return "Heritage Collection"
            elif 'sport' in line_lower: return "Sport Collection"
            elif 'elegance' in line_lower: return "Elegance Collection"
            else: return "Grand Seiko Collection"
        elif brand == "Tudor":
            if 'black bay' in line_lower or 'bb58' in line_lower or 'bb36' in line_lower or 'bb41' in line_lower: return "Black Bay"
            elif 'pelagos' in line_lower: return "Pelagos"
            elif 'royal' in line_lower: return "Royal"
            elif 'ranger' in line_lower: return "Ranger"
            elif 'glamour' in line_lower: return "Glamour"
            elif 'heritage' in line_lower or 'chrono' in line_lower: return "Heritage Chrono"
            else: return "Tudor Collection"
        elif brand == "Vacheron Constantin":
            if 'overseas' in line_lower or ref.startswith('4500') or ref.startswith('5500') or ref.startswith('7900'): return "Overseas"
            elif 'patrimony' in line_lower or ref.startswith('8518'): return "Patrimony"
            elif 'traditionnelle' in line_lower or ref.startswith('8217'): return "Traditionnelle"
            elif 'historiques' in line_lower or '222' in line_lower: return "Historiques"
            elif 'fiftysix' in line_lower or '56' in line_lower: return "Fiftysix"
            else: return "Vacheron Constantin Collection"
        elif brand == "Richard Mille":
            if 'rm 011' in line_lower or 'rm11' in line_lower or 'rm 11' in line_lower: return "RM 011 / RM 11-03"
            elif 'rm 035' in line_lower or 'rm35' in line_lower or 'rm 35' in line_lower or 'rafa' in line_lower: return "RM 035 Baby Nadal"
            elif 'rm 055' in line_lower or 'rm55' in line_lower or 'rm 55' in line_lower or 'bubba' in line_lower: return "RM 055 Bubba Watson"
            elif 'rm 067' in line_lower or 'rm67' in line_lower or 'rm 67' in line_lower: return "RM 067 / RM 67-02"
            elif 'rm 007' in line_lower or 'rm07' in line_lower or 'rm 07' in line_lower: return "RM 07 Ladies"
            elif 'rm 72' in line_lower or 'rm72' in line_lower: return "RM 72-01 Lifestyle"
            elif 'rm 65' in line_lower or 'rm65' in line_lower: return "RM 65-01 Split Sec"
            elif 'rm 010' in line_lower or 'rm10' in line_lower or 'rm 10' in line_lower: return "RM 010 Automatic"
            elif 'rm 027' in line_lower or 'rm27' in line_lower or 'rm 27' in line_lower: return "RM 027 Tourbillon"
            else: return "Richard Mille Collection"
        elif brand == "Hublot":
            if 'big bang' in line_lower: return "Big Bang"
            elif 'classic fusion' in line_lower: return "Classic Fusion"
            elif 'spirit of big bang' in line_lower or 'spirit' in line_lower: return "Spirit of Big Bang"
            elif 'king power' in line_lower: return "King Power"
            elif 'square bang' in line_lower: return "Square Bang"
            elif 'mp' in line_lower or 'masterpiece' in line_lower: return "MP Collection"
            else: return "Hublot Collection"
        elif brand == "IWC":
            if 'big pilot' in line_lower: return "Big Pilot"
            elif 'pilot' in line_lower or ref.startswith('IW377') or ref.startswith('IW388'): return "Pilot's Watch"
            elif 'portugieser' in line_lower or 'portuguese' in line_lower or ref.startswith('IW371') or ref.startswith('IW500'): return "Portugieser"
            elif 'portofino' in line_lower or ref.startswith('IW356'): return "Portofino"
            elif 'aquatimer' in line_lower: return "Aquatimer"
            elif 'ingenieur' in line_lower: return "Ingenieur"
            elif 'da vinci' in line_lower: return "Da Vinci"
            else: return "IWC Collection"
        elif brand == "Panerai":
            if 'luminor due' in line_lower: return "Luminor Due"
            elif 'luminor' in line_lower or 'pam00' in line_lower or 'pam01' in line_lower: return "Luminor"
            elif 'submersible' in line_lower or 'pam01313' in line_lower: return "Submersible"
            elif 'radiomir' in line_lower: return "Radiomir"
            else: return "Panerai Collection"
        elif brand == "Jaeger-LeCoultre":
            if 'reverso' in line_lower: return "Reverso"
            elif 'master ultra thin' in line_lower or 'mut' in line_lower: return "Master Ultra Thin"
            elif 'master control' in line_lower or 'master' in line_lower: return "Master Control"
            elif 'polaris' in line_lower: return "Polaris"
            elif 'rendez-vous' in line_lower or 'rendezvous' in line_lower: return "Rendez-Vous"
            elif 'atmos' in line_lower: return "Atmos Clock"
            else: return "Jaeger-LeCoultre Collection"
        elif brand == "Breitling":
            if 'navitimer' in line_lower: return "Navitimer"
            elif 'chronomat' in line_lower: return "Chronomat"
            elif 'superocean' in line_lower: return "Superocean"
            elif 'avenger' in line_lower: return "Avenger"
            elif 'premier' in line_lower: return "Premier"
            elif 'transocean' in line_lower: return "Transocean"
            elif 'professional' in line_lower or 'emergency' in line_lower: return "Professional / Emergency"
            else: return "Breitling Collection"
        elif brand == "Franck Muller":
            if 'vanguard' in line_lower: return "Vanguard"
            elif 'crazy hours' in line_lower: return "Crazy Hours"
            elif 'master banker' in line_lower: return "Master Banker"
            elif 'long island' in line_lower: return "Long Island"
            elif 'curvex' in line_lower or 'cintree' in line_lower: return "Cintrée Curvex"
            else: return "Franck Muller Collection"
        elif brand in ("F.P. Journe", "F.P.Journe", "Journe"):
            if 'elegante' in line_lower or 'élégante' in line_lower: return "Élégante"
            elif 'souverain' in line_lower or 'chronometre' in line_lower: return "Chronomètre Souverain"
            elif 'octa' in line_lower: return "Octa Reserve / Automatique"
            elif 'centigraphe' in line_lower: return "Centigraphe Souverain"
            elif 'tourbillon' in line_lower: return "Tourbillon Souverain"
            else: return "F.P. Journe Collection"
        elif brand in ("A. Lange & Söhne", "A. Lange & Sohne", "Lange & Söhne", "Lange"):
            if 'lange 1' in line_lower or 'lange1' in line_lower: return "Lange 1"
            elif 'saxonia' in line_lower: return "Saxonia"
            elif 'datograph' in line_lower: return "Datograph"
            elif 'zeitwerk' in line_lower: return "Zeitwerk"
            elif '1815' in line_lower: return "1815 Collection"
            elif 'richard lange' in line_lower: return "Richard Lange"
            else: return "A. Lange & Söhne Collection"
        else:
            return f"{brand} Collection" if brand != "UNRESOLVED" else "Unresolved Collection"
