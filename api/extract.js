/**
 * WatchFacts Extraction API v2.1 — All 5 Fixes Applied
 * FIX #1: No more guessing dial colors
 * FIX #2: Price typo detection + European comma + sanity check
 * FIX #3: Multi-line merge (accumulate up to 5 lines)
 * FIX #4: Catalog fixes (3369→Rolex, 6119→Patek, no ref truncation)
 * FIX #5: Confidence penalty system
 * POST /api/extract
 */

const BRANDS = {
  rolex:'Rolex', patek:'Patek Philippe', pp:'Patek Philippe',
  ap:'Audemars Piguet', audemars:'Audemars Piguet',
  rm:'Richard Mille', cartier:'Cartier', omega:'Omega',
  tudor:'Tudor', vc:'Vacheron Constantin', lange:'A. Lange & Sohne',
  hublot:'Hublot', iwc:'IWC', breitling:'Breitling',
  jaeger:'Jaeger-LeCoultre', panerai:'Panerai', zenith:'Zenith',
  breguet:'Breguet', blancpain:'Blancpain',
  'fp journe':'F.P. Journe', moser:'H. Moser & Cie',
};

const ROLEX_PREFIXES = ['126','116','228','226','278','279','336','277','128','127','124','134','118'];
const PATEK_PREFIXES = ['57','59','51','52','53','58','61','70','71','72','73','49','50','53','61','60'];
const AP_PREFIXES = ['15','16','25','26','67','77'];
const VC_PREFIXES = ['4000','4300','4500','4520','4600','5500','6000','7700','4200','7930'];

const LUXURY_BRANDS = ['Patek Philippe','Rolex','Audemars Piguet','Vacheron Constantin','Richard Mille','A. Lange & Sohne','F.P. Journe'];

const COLOR_SLANG = {
  blk:'Black',black:'Black',blue:'Blue',green:'Green',white:'White',
  grey:'Grey',gray:'Grey',red:'Red',silver:'Silver',
  choco:'Chocolate',chocolate:'Chocolate',champ:'Champagne',champagne:'Champagne',
  salmon:'Salmon',brown:'Brown',yellow:'Yellow',orange:'Orange',
  purple:'Purple',pink:'Pink',tiffany:'Tiffany Blue',meteorite:'Meteorite',
  mete:'Meteorite','ice blue':'Ice Blue',ice:'Ice Blue',pistachio:'Pistachio Green',
  'candy pink':'Candy Pink',lavender:'Lavender',wim:'Wimbledon',
  'salted egg':'Yellow Gold',onyx:'Onyx',mop:'Mother of Pearl',
  rainbow:'Rainbow',rbw:'Rainbow',ombre:'Ombre',eisenkisel:'Eisenkiesel',
};

const NON_DIAL_TERMS = ['diamond','baguette','setting','bezel','indices','markers','hands'];

const COLLAB_TERMS = ['monaco','mancini','kaws','black panther','ferrari','le mans','america','japan','italy','qatar','argentina','1017 alyx','cotton candy'];

const CONDITION_MAP = {
  new:'new','brand new':'new',bnib:'new',used:'pre-owned',
  'pre-owned':'pre-owned','like new':'like-new',unworn:'unworn',
  nos:'new-old-stock',mint:'mint',naked:'pre-owned',
};

function normalizeText(text) {
  return text.replace(/[\u{1F300}-\u{1F9FF}\u{2600}-\u{27BF}]/gu,' ')
    .replace(/\*([^*]+)\*/g,'$1').replace(/\s+/g,' ').trim();
}

function extractReference(text) {
  const clean = normalizeText(text);
  let m = clean.match(/\b(?:RM)?(\d{2,3}[-]\d{2,3})\b/i);
  if (!m) m = clean.match(/\bRM(\d{3})\b/i);
  if (!m) m = clean.match(/\b(\d{3})\b(?=.*(?:ntpt|ceramic|naked|full set|ti\b|Rg\b))/i);
  if (m) return { ref: m[1].startsWith('RM') ? m[1] : 'RM'+m[1], conf: m[1].length >= 5 ? 0.85 : 0.70 };
  
  // FIX #4: Preserve full reference with slashes and hyphens (5327G-001, 4200H/222A-B934)
  m = clean.match(/\b(\d{4,6}[A-Za-z]{0,6}(?:\/\d+[A-Za-z]{0,4})?(?:-[A-Za-z0-9]{0,6})?)\b(?!\s*(?:[kKmM]|hkd|HKD|usdt|USDT))\b/i);
  if (m) {
    const ref = m[1];
    const before = clean.substring(Math.max(0, m.index-10), m.index).toUpperCase();
    if (/[$]|HKD|USDT|USD|\.$/.test(before.slice(-4))) return { ref: null, conf: 0 };
    
    if (/^\d{4,6}$/.test(ref)) {
      const n = parseInt(ref);
      if (n >= 10000 && (n % 1000 === 0 || n % 500 === 0)) {
        const ctx = clean.substring(Math.max(0, m.index-15), m.index+ref.length+10);
        if (/[Hh][Kk][Dd]|[Uu][Ss][Dd][Tt]|\$|:/.test(ctx)) return { ref: null, conf: 0 };
      }
    }
    
    const suffixM = ref.match(/^(\d{4,6})([A-Za-z]{2,6})$/);
    if (suffixM && ['HKD','USDT','USD'].includes(suffixM[2].toUpperCase())) return { ref: null, conf: 0 };
    
    const upper = ref.toUpperCase();
    if (new RegExp('^('+ROLEX_PREFIXES.join('|')+')[0-9A-Z-]+$','i').test(ref)) return { ref, conf: 0.85 };
    if (/^\d{5}[A-Za-z]{2,}/.test(ref)) return { ref, conf: 0.85 };
    if (/^\d{4,6}[A-Za-z\/-]+/.test(ref) && ref.length > 4) return { ref, conf: 0.80 };
    if (/^\d{4}$/.test(ref) && parseInt(ref) < 9000) {
      if (parseInt(ref) >= 2020 && parseInt(ref) <= 2030) return { ref: null, conf: 0 };
      return { ref, conf: 0.60 };
    }
  }
  return { ref: null, conf: 0 };
}

// FIX #4: Updated brand detection with correct prefixes
function detectBrand(text, ref) {
  const lower = text.toLowerCase();
  for (const [key,name] of Object.entries(BRANDS)) {
    if (new RegExp('\\b'+key+'\\b','i').test(lower)) return { brand: name, conf: 0.90 };
  }
  if (!ref) return { brand: null, conf: 0 };
  
  const clean = ref.toUpperCase();
  if (clean.startsWith('RM') || /^\d{2}-\d{2}/.test(clean)) return { brand: 'Richard Mille', conf: 0.85 };
  if (/^\d{5}[A-Z]{2}/i.test(clean) && AP_PREFIXES.some(p => clean.startsWith(p))) return { brand: 'Audemars Piguet', conf: 0.80 };
  
  const short = clean.replace(/[^A-Z0-9]/g,'');
  
  // FIX #4: 3369 = Rolex Sky-Dweller (NOT VC)
  if (/^3369/.test(short)) return { brand: 'Rolex', conf: 0.80 };
  if (ROLEX_PREFIXES.some(p => short.startsWith(p))) return { brand: 'Rolex', conf: 0.80 };
  
  // FIX #4: 6119 = Patek Philippe Calatrava
  if (/^6119/.test(short)) return { brand: 'Patek Philippe', conf: 0.80 };
  if (PATEK_PREFIXES.some(p => short.startsWith(p)) && /^\d{4}/.test(short)) return { brand: 'Patek Philippe', conf: 0.75 };
  
  // FIX #4: Additional VC prefixes
  if (VC_PREFIXES.some(p => short.startsWith(p))) return { brand: 'Vacheron Constantin', conf: 0.75 };
  if (/^(WSPN|WSSA|WGTA|WSTA|HPI|WHSA)/i.test(clean)) return { brand: 'Cartier', conf: 0.85 };
  if (clean.startsWith('IW')) return { brand: 'IWC', conf: 0.80 };
  if (/^M\d{2}/.test(clean)) return { brand: 'Tudor', conf: 0.75 };
  
  return { brand: null, conf: 0 };
}

function extractYear(text) {
  const lower = text.toLowerCase();
  let m = lower.match(/\bn(\d{1,2})\s*\/\s*(\d{2,4})\b/);
  if (m) { const yr = parseInt(m[2]); return { year: yr < 100 ? 2000+yr : yr, month: parseInt(m[1]), conf: 0.90 }; }
  m = lower.match(/\b(\d{1,2})\s*\/\s*(\d{4})\b/);
  if (m && parseInt(m[1]) <= 12) return { year: parseInt(m[2]), month: parseInt(m[1]), conf: 0.85 };
  m = lower.match(/\b((?:20)?(\d{2}))y\b/);
  if (m) { const yr = 2000+parseInt(m[2]); if (yr <= 2030) return { year: yr, month: null, conf: m[1].startsWith('20') ? 0.85 : 0.75 }; }
  m = lower.match(/\b(20[2-3]\d)\b(?!\s*[km])/);
  if (m) return { year: parseInt(m[1]), month: null, conf: 0.60 };
  return { year: null, month: null, conf: 0 };
}

// FIX #2: Price extraction with typo detection
function extractPrice(text) {
  const lower = text.toLowerCase();
  let result = { price: null, currency: null, conf: 0, flags: [] };
  
  // HKD:585000
  let m = lower.match(/\b(hkd|usdt|usd)\s*[:=]\s*([\d,]+)\s*[km]?\b/i);
  if (m) { result = { price: parseFloat(m[2].replace(/,/g,'')), currency: m[1].toUpperCase(), conf: 0.90, flags: [] }; }
  
  // HKD930K (no space)
  if (!result.price) {
    m = lower.match(/\b(hkd|usdt|usd)\s*([\d,.]+)\s*[kK]\b/i);
    if (m) result = { price: parseFloat(m[2].replace(/,/g,'')) * 1000, currency: m[1].toUpperCase(), conf: 0.90, flags: [] };
  }
  // FIX #2B: European comma format "1,48m" → 1.48 million (MUST come before standard k/m pattern)
  if (!result.price) {
    m = lower.match(/\b(\d+),(\d+)\s*([mM])\s*(hkd|usdt|usd)?\b/i);
    if (m) {
      const euroAmount = parseFloat(m[1] + '.' + m[2]);
      const mult = m[3].toLowerCase() === 'm' ? 1000000 : 1000;
      result = { price: euroAmount * mult, currency: (m[4] || '').toUpperCase() || null, conf: 0.65, flags: ['european_comma_format'] };
    }
  }
  
  // 240k hkd (standard — AFTER European comma check)
  if (!result.price) {
    m = lower.match(/\b([\d,.]+)\s*([km])\s*(hkd|usdt|usd|uadt)\b/i);
    if (m) {
      // Skip if this looks like European comma (digit,digit pattern)
      if (/,/.test(m[1]) && !/,\d{3}/.test(m[1])) continue_price = false;
      let amt = parseFloat(m[1].replace(/,/g,''));
      if (m[2].toLowerCase() === 'k') amt *= 1000; else amt *= 1000000;
      result = { price: amt, currency: m[3].toUpperCase().replace('UADT','USDT'), conf: 0.90, flags: [] };
    }
  }
  
  // $12,500
  if (!result.price) {
    m = lower.match(/\$([\d,.]+)\s*[km]?\b/);
    if (m) {
      let amt = parseFloat(m[1].replace(/,/g,''));
      if (/k/i.test(m[0])) amt *= 1000;
      result = { price: amt, currency: /usd/i.test(lower) ? 'USD' : 'HKD', conf: 0.60, flags: [] };
    }
  }
  
  // 240k alone
  if (!result.price) {
    m = lower.match(/\b([\d,.]+)\s*[kK]\b(?!\s*(hkd|usdt|usd))/);
    if (m) result = { price: parseFloat(m[1].replace(/,/g,'')) * 1000, currency: 'HKD', conf: 0.65, flags: [] };
  }
  
  // 1.45M
  if (!result.price) {
    m = lower.match(/\b(\d[\d,.]*)\s*[mM]\b/);
    if (m) {
      const s = m[1].replace(/,/g,'');
      if (s && s !== '.') result = { price: parseFloat(s) * 1000000, currency: null, conf: 0.60, flags: [] };
    }
  }
  
  // Plain number: "178 hkd", "395 hkd", "HKD 583,000"
  if (!result.price) {
    // Currency first: HKD 583,000
    m = lower.match(/\b(hkd|usdt|usd)\s+([\d,.]+)\b(?!\s*[km])/i);
    if (m) result = { price: parseFloat(m[2].replace(/,/g,'')), currency: m[1].toUpperCase(), conf: 0.70, flags: ['plain_number'] };
  }
  if (!result.price) {
    // Number then currency: 178 hkd, 395 hkd
    m = lower.match(/\b([\d,.]+)\s+(hkd|usdt|usd)\b(?!\s*[km])/i);
    if (m) result = { price: parseFloat(m[1].replace(/,/g,'')), currency: m[2].toUpperCase(), conf: 0.70, flags: ['plain_number'] };
  }
  
  // Bare number >= 10000 that looks like a price (no ref pattern)
  if (!result.price) {
    m = lower.match(/\b(\d{5,7})\b(?!\s*(?:[kKmM]|hkd|HKD|usdt|USDT|[A-Za-z]{2}))/);
    if (m) {
      const n = parseInt(m[1]);
      if (n >= 10000 && n % 500 === 0) {
        result = { price: n, currency: null, conf: 0.35, flags: ['currency_ambiguous'] };
      }
    }
  }
  
  // FIX #2A: Missing K suffix — if price < 1000 and luxury watch, multiply by 1000
  // Never add a missing K/M multiplier. Ambiguous amounts require review.
  
  // FIX #2C: Sanity check — price < 5000 on luxury watch = human review
  if (result.price && result.price < 5000 && result.price > 0) {
    result.flags.push('price_below_luxury_minimum');
    result.conf = Math.min(result.conf, 0.40);
  }
  
  return result;
}

// FIX #1: Dial color — ONLY if color descriptor is in input. NEVER guess.
function detectDialColor(text) {
  const lower = text.toLowerCase();
  
  // First: check if this is a collaboration term, not a color
  for (const term of COLLAB_TERMS) {
    if (lower.includes(term)) {
      // Check if there's ALSO a real color
      const withoutCollab = lower.replace(new RegExp(term,'gi'),'');
      for (const [slang, normalized] of Object.entries(COLOR_SLANG).sort((a,b) => b[0].length-a[0].length)) {
        const escaped = slang.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
        if (new RegExp('\\b'+escaped+'\\b','i').test(withoutCollab))
          return { dial: normalized, conf: 0.80, source: 'text' };
      }
      // Collab term only — no dial color
      return { dial: null, conf: 0, source: null };
    }
  }
  
  // Check for non-dial terms (diamond, baguette, etc.) — these are settings, not colors
  for (const term of NON_DIAL_TERMS) {
    if (lower.includes(term)) {
      // Only if there's ALSO a color word
      const withoutSetting = lower.replace(new RegExp(term,'gi'),'');
      for (const [slang, normalized] of Object.entries(COLOR_SLANG).sort((a,b) => b[0].length-a[0].length)) {
        const escaped = slang.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
        if (new RegExp('\\b'+escaped+'\\b','i').test(withoutSetting))
          return { dial: normalized, conf: 0.75, source: 'text-with-setting' };
      }
      // Setting only, no color → null
      return { dial: null, conf: 0, source: null };
    }
  }
  
  // Look for explicit color descriptors
  for (const [slang, normalized] of Object.entries(COLOR_SLANG).sort((a,b) => b[0].length-a[0].length)) {
    const escaped = slang.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
    if (new RegExp('\\b'+escaped+'\\b','i').test(lower))
      return { dial: normalized, conf: 0.80, source: 'text' };
  }
  
  // FIX #1: NO color descriptor found → null. Do NOT guess.
  return { dial: null, conf: 0, source: null };
}

function detectCaseMaterial(text, ref, brand) {
  const lower = text.toLowerCase();
  if (/white gold|wg\b/i.test(lower)) return { material:'White Gold', conf:0.90 };
  if (/rose gold|rg\b/i.test(lower)) return { material:'Rose Gold', conf:0.90 };
  if (/yellow gold|yg\b/i.test(lower)) return { material:'Yellow Gold', conf:0.90 };
  if (/platinum|pt\b/i.test(lower)) return { material:'Platinum', conf:0.90 };
  if (/titanium|ti\b/i.test(lower)) return { material:'Titanium', conf:0.85 };
  if (/ceramic/i.test(lower)) return { material:'Ceramic', conf:0.85 };
  if (/carbon|ntpt|forged carbon/i.test(lower)) return { material:'Carbon/NTPT', conf:0.80 };
  if (/stainless steel|steel/i.test(lower)) return { material:'Stainless Steel', conf:0.85 };
  
  const MATERIAL_SUFFIX = {
    or:'Rose Gold',st:'Stainless Steel',ti:'Titanium',ba:'Yellow Gold',
    bc:'White Gold',wg:'White Gold',rg:'Rose Gold',ce:'Ceramic',
    cd:'Ceramic',cb:'Ceramic',io:'Titanium/Ceramic',sg:'Sedna Gold',
    sr:'Steel + Rose Gold',ic:'Titanium/Ceramic',nt:'NTPT Carbon',xt:'Carbon/TPT',
  };
  
  if (ref && brand) {
    const up = ref.toUpperCase();
    for (const [suffix,mat] of Object.entries(MATERIAL_SUFFIX).sort((a,b) => b[0].length-a[0].length)) {
      if (up.includes(suffix.toUpperCase()) && suffix.length >= 2)
        return { material:mat, conf:0.70 };
    }
  }
  return { material:null, conf:0 };
}

// FIX #3: Multi-line aware extraction — merged lines
function extractWatch(text) {
  const clean = normalizeText(text);
  const { ref, conf: refConf } = extractReference(clean);
  
  // Fallback: no reference but has price → create partial listing
  if (!ref) {
    const priceData = extractPrice(clean);
    if (priceData.price && priceData.price > 0) {
      const { brand, conf: bConf } = detectBrand(clean, null);
      return {
        brand, reference: null, model_name: null, year: null, manufacture_month: null,
        price_original: priceData.price, currency_original: priceData.currency || null,
        condition: null, dial_color: null, case_material: null,
        bracelet_material: null, papers: null, box: null, full_set: null,
        movement_type: null, case_size_mm: null,
        seller_notes: null, collaboration: null,
        message_type: 'FS',
        extraction_confidence: { brand: bConf, reference: 0, price: priceData.conf, year: 0, overall: Math.round(Math.max(0.10, priceData.conf - 0.20) * 100) / 100 },
        price_flags: priceData.flags,
        dial_source: null,
        what_i_needed_but_didnt_have: ['reference_number'],
        errors_or_ambiguities: ['price_only_no_reference'].concat(priceData.flags.length ? [] : []),
        normalization_notes: priceData.flags.length ? priceData.flags.join('; ') : null,
        raw_text: text,
      };
    }
    return null;
  }
  
  const { brand, conf: brandConf } = detectBrand(clean, ref);
  const { year, month, conf: yearConf } = extractYear(clean);
  const priceData = extractPrice(clean);
  const { dial, conf: dialConf, source: dialSource } = detectDialColor(clean);
  const { material: caseMat, conf: caseConf } = detectCaseMaterial(clean, ref, brand);
  
  let condition = null;
  const l = clean.toLowerCase();
  for (const [key,val] of Object.entries(CONDITION_MAP).sort((a,b) => b[0].length-a[0].length)) {
    if (new RegExp('\\b'+key+'\\b','i').test(l)) { condition = val; break; }
  }
  if (!condition && /n\d{1,2}\s*\/\s*\d/i.test(l)) condition = 'new';
  if (!condition && /used|pre.owned/i.test(l)) condition = 'pre-owned';
  
  let papers = null, box = null, fullSet = null;
  if (/naked|only watch|only wacth/i.test(l)) { papers=false; box=false; fullSet=false; }
  if (/full set\b(?!.*no box)/i.test(l)) { papers=true; box=true; fullSet=true; }
  if (/full set.*no box/i.test(l)) { papers=true; box=false; fullSet=false; }
  if (/no papers|without papers/i.test(l)) papers = false;
  if (/papers|card|stamped/i.test(l) && papers === null) papers = true;
  if (/no box|without box/i.test(l)) box = false;
  if (/\bbox\b/i.test(l) && box === null) box = true;
  if (/bnib/i.test(l)) { condition='new'; papers=true; box=true; fullSet=true; }
  
  // FIX #5: Confidence penalty system
  let overall = [brandConf, refConf, yearConf, priceData.conf].filter(c => c > 0).reduce((a,b) => a+b, 0) / Math.max(1, [brandConf, refConf, yearConf, priceData.conf].filter(c => c > 0).length);
  
  const errors = [];
  
  // FIX #5: brand == null → -30
  if (!brand) { overall -= 0.30; errors.push('unknown_brand'); }
  
  // FIX #5: truncated reference
  if (ref && !/[\/\-]/.test(ref) && ref.length >= 6 && /^\d+[A-Z]/.test(ref)) {
    // May be truncated — check if raw text has longer version
    if (clean.includes(ref + '-') || clean.includes(ref + '/')) {
      overall -= 0.25;
      errors.push('reference_truncated');
    }
  }
  
  // FIX #5: guessed dial color → -15
  if (dial && dialSource !== 'text') {
    overall -= 0.15;
    errors.push('dial_color_guessed');
  }
  
  // FIX #5: currency guessed → -10
  if (priceData.price && !priceData.currency) {
    overall -= 0.10;
    errors.push('currency_guessed');
  }
  
  // FIX #2: price flags → penalize
  // Missing multipliers are not silently repaired.
  if (priceData.flags.includes('european_comma_format')) {
    overall -= 0.10;
    errors.push('price_european_comma');
  }
  if (priceData.flags.includes('price_below_luxury_minimum')) {
    overall -= 0.40;
    errors.push('price_below_minimum');
  }
  
  if (!year) overall *= 0.85;
  if (!priceData.price) overall *= 0.80;
  if (!brand) overall *= 0.75;
  
  overall = Math.round(Math.max(0, Math.min(overall, 1.0)) * 100) / 100;
  
  return {
    brand, reference: ref, model_name: null, year, manufacture_month: month,
    price_original: priceData.price, currency_original: priceData.currency,
    condition, dial_color: dial, case_material: caseMat,
    bracelet_material: null, papers, box, full_set: fullSet,
    movement_type: null, case_size_mm: null,
    seller_notes: null, collaboration: null,
    message_type: /wtb|looking for|need\b|wanted/i.test(l) ? 'WTB' : 'FS',
    extraction_confidence: {
      brand: Math.round(brandConf*100)/100,
      reference: Math.round(refConf*100)/100,
      price: Math.round(priceData.conf*100)/100,
      year: Math.round(yearConf*100)/100,
      overall
    },
    price_flags: priceData.flags,
    dial_source: dialSource,
    what_i_needed_but_didnt_have: [],
    errors_or_ambiguities: errors,
    normalization_notes: priceData.flags.length ? priceData.flags.join('; ') : null,
    raw_text: text,
  };
}

// ─── Vercel Handler with FIX #3 multi-line merge ───

const REF_SUFFIX_DIAL = {
  LN:'Black', LB:'Blue', LV:'Green', CHNR:'Brown/Black',
  BLNR:'Blue/Black', BLRO:'Blue/Red', VTNR:'Black/Green',
  GRNR:'Black/Grey', SARU:'Orange',
};

const REF_DIAL_OVERRIDES = {
  '116500LN':'White','126500LN':'White','116518':'Champagne','116519':'Meteorite',
  '5711/1A':'Blue','5712/1A':'Blue','5167A':'Black',
  '5164A':'Black','5968A':'Black','5968G':'Green',
  '126334':'Grey','126234':'Grey',
};

function inferDialFromRef(ref) {
  if (!ref) return null;
  const clean = ref.toUpperCase();
  for (const [key,color] of Object.entries(REF_DIAL_OVERRIDES)) {
    if (clean.includes(key.toUpperCase())) return color;
  }
  for (const [suffix,color] of Object.entries(REF_SUFFIX_DIAL)) {
    if (clean.endsWith(suffix.toUpperCase()) || clean.includes('/'+suffix.toUpperCase())) return color;
  }
  return null;
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin','*');
  res.setHeader('Access-Control-Allow-Methods','POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers','Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error:'POST required' });
  
  try {
    const { messages = [], enrichVision = false } = req.body || {};
    if (!messages.length) return res.status(400).json({ error:'messages array required' });
    
    const listings = [];
    const stats = { total_messages: messages.length, extracted: 0, high: 0, medium: 0, low: 0, visionEnriched: 0, merged_listings: 0 };
    
    // FIX #3: Multi-line accumulator
    let pending = null;
    let pendingLines = 0;
    
    for (let i = 0; i < messages.length; i++) {
      const msg = (messages[i] || '').trim();
      if (!msg) continue;
      
      const hasRef = /\b(\d{4,6}[A-Za-z]{0,6}|RM\d|\d{2,3}[-]\d{2,3})\b/i.test(msg);
      const hasPrice = /(?:HKD|USDT|USD|hkd|usdt|usd)\s*[:=]?\s*[\d,.]+[km]?\b|\$[\d,.]+|[\d,.]+[km]?\s+(?:hkd|usdt|usd)|[\d,.]+[km]\b/i.test(msg);
      
      // FIX #3: If pending has ref but no price, accumulate lines
      if (pending && !hasRef && pendingLines < 5) {
        pending = pending + ' ' + msg;
        pendingLines++;
        if (hasPrice) {
          // Got price — flush now
          const result = extractWatch(pending);
          if (result) {
            listings.push(result);
            stats.extracted++;
            stats.merged_listings++;
            const c = result.extraction_confidence.overall;
            if (c >= 0.85) stats.high++;
            else if (c >= 0.50) stats.medium++;
            else stats.low++;
          }
          pending = null;
          pendingLines = 0;
        }
        continue;
      }
      
      // Flush previous pending
      if (pending) {
        const result = extractWatch(pending);
        if (result) {
          listings.push(result);
          stats.extracted++;
          const c = result.extraction_confidence.overall;
          if (c >= 0.85) stats.high++;
          else if (c >= 0.50) stats.medium++;
          else stats.low++;
        }
      }
      
      if (hasRef) {
        pending = msg;
        pendingLines = 1;
        // If this line ALSO has a price, extract immediately
        if (hasPrice) {
          const result = extractWatch(msg);
          if (result) {
            listings.push(result);
            stats.extracted++;
            const c = result.extraction_confidence.overall;
            if (c >= 0.85) stats.high++;
            else if (c >= 0.50) stats.medium++;
            else stats.low++;
          }
          pending = null;
          pendingLines = 0;
        }
      } else {
        // No reference — try price-only extraction
        if (hasPrice && !pending) {
          const result = extractWatch(msg);
          if (result) {
            listings.push(result);
            stats.extracted++;
            const c = result.extraction_confidence.overall;
            if (c >= 0.85) stats.high++;
            else if (c >= 0.50) stats.medium++;
            else stats.low++;
          }
        }
        pending = null;
        pendingLines = 0;
      }
    }
    
    // Flush last pending
    if (pending) {
      const result = extractWatch(pending);
      if (result) {
        listings.push(result);
        stats.extracted++;
        const c = result.extraction_confidence.overall;
        if (c >= 0.85) stats.high++;
        else if (c >= 0.50) stats.medium++;
        else stats.low++;
      }
    }
    
    // Vision enrichment
    // Image/catalog validation is downstream and never overwrites raw claims here.
    
    listings.sort((a,b) => b.extraction_confidence.overall - a.extraction_confidence.overall);
    
    res.json({ listings, stats, engine_version: '2.1-fixes-applied' });
  } catch (e) {
    res.status(500).json({ error: e.message, listings:[], stats:{} });
  }
};
