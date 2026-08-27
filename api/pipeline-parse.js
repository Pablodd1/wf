/**
 * SERVER-SIDE MULTI-STAGE PIPELINE API
 * /api/pipeline-parse
 *
 * Stage A: Structured Extraction (regex + optional AI)
 * Stage B: Normalization & Alias Mapping
 * Stage C: Canonical Reference Matching (fuzzy + master catalog)
 * Stage D: IQR Outlier Flagging
 * Stage E: Currency Conversion to USD
 */

const { requireServiceToken } = require('./_lib/require-service-token.cjs');

const KIMI_API_URL = 'https://api.moonshot.ai/v1/chat/completions';
const { ZERO_HALLUCINATION_NORMALIZATION_CONTRACT } = require('./_lib/ai-normalization-contract.cjs');
const APPROVE_THRESHOLD = 85;
const RECYCLE_FLOOR = 35;

// ─── Currency rates ───
let _rates = {
  USD: 1.0, HKD: 0.128, EUR: 1.08, GBP: 1.27, CHF: 1.13,
  JPY: 0.0066, SGD: 0.74, AUD: 0.65, CAD: 0.73, USDT: 1.0, CNY: 0.138,
};
let _ratesExpiry = 0;

async function refreshRates() {
  if (Date.now() < _ratesExpiry) return _rates;
  try {
    const ctrl = new AbortController();
    setTimeout(() => ctrl.abort(), 5000);
    const r = await fetch('https://api.exchangerate-api.com/v4/latest/USD', { signal: ctrl.signal });
    const d = await r.json();
    if (d.rates) {
      _rates = {
        USD: 1.0,
        HKD: d.rates.HKD ? 1 / d.rates.HKD : 0.128,
        EUR: d.rates.EUR ? 1 / d.rates.EUR : 1.08,
        GBP: d.rates.GBP ? 1 / d.rates.GBP : 1.27,
        CHF: d.rates.CHF ? 1 / d.rates.CHF : 1.13,
        JPY: d.rates.JPY ? 1 / d.rates.JPY : 0.0066,
        SGD: d.rates.SGD ? 1 / d.rates.SGD : 0.74,
        AUD: d.rates.AUD ? 1 / d.rates.AUD : 0.65,
        CAD: d.rates.CAD ? 1 / d.rates.CAD : 0.73,
        USDT: 1.0,
        CNY: d.rates.CNY ? 1 / d.rates.CNY : 0.138,
      };
      _ratesExpiry = Date.now() + 3600000;
    }
  } catch { /* keep static */ }
  return _rates;
}

function toUSD(amount, currency) {
  if (!amount || !currency) return null;
  const rate = _rates[currency.toUpperCase()];
  if (!rate) return null;
  return Math.round(amount * rate);
}

// ─── Master Catalog ───
let _catalog = null;
let _catalogPromise = null;

async function loadCatalog() {
  if (_catalog) return _catalog;
  if (_catalogPromise) return _catalogPromise;
  _catalogPromise = (async () => {
    try {
      const ctrl = new AbortController();
      setTimeout(() => ctrl.abort(), 15000);
      const res = await fetch('https://watchfacts-poc.vercel.app/parsedWatches.json', { signal: ctrl.signal });
      const rows = await res.json();
      const catalog = new Map();
      const aliasIndex = new Map();
      for (const row of rows) {
        const ref = String(row[2] || '').trim().toUpperCase();
        const brand = String(row[1] || 'Unknown').trim().toUpperCase();
        const dial = String(row[3] || 'UNKNOWN').trim().toUpperCase();
        const priceUSD = Number(row[5]) || 0;
        if (!ref || ref === 'NONE') continue;
        const key = `${brand}::${ref}`;
        if (!catalog.has(key)) {
          catalog.set(key, { ref, brand, dials: new Map(), aliases: new Set() });
          aliasIndex.set(ref.replace(/[^A-Z0-9]/g, ''), ref);
          aliasIndex.set(ref, ref);
        }
        const entry = catalog.get(key);
        entry.aliases.add(ref.replace(/\//g, '-'));
        entry.aliases.add(ref.replace(/\//g, ''));
        if (!entry.dials.has(dial)) entry.dials.set(dial, { prices: [], count: 0 });
        const d = entry.dials.get(dial);
        if (priceUSD > 0) d.prices.push(priceUSD);
        d.count++;
      }
      _catalog = { catalog, aliasIndex };
      return _catalog;
    } catch (e) {
      console.error('[pipeline-parse] catalog load failed:', e.message);
      _catalog = { catalog: new Map(), aliasIndex: new Map() };
      return _catalog;
    }
  })();
  return _catalogPromise;
}

async function lookupRef(ref) {
  const { catalog, aliasIndex } = await loadCatalog();
  const normalized = ref.trim().toUpperCase();
  for (const [, entry] of catalog) {
    if (entry.ref === normalized) return entry;
  }
  const alias = aliasIndex.get(normalized.replace(/[^A-Z0-9]/g, ''));
  if (alias) {
    for (const [, entry] of catalog) {
      if (entry.ref === alias) return entry;
    }
  }
  const patekSlash = normalized.replace(/^(\d{4})([A-Z]\d?)$/, '$1/$2');
  if (patekSlash !== normalized) {
    for (const [, entry] of catalog) {
      if (entry.ref === patekSlash) return entry;
    }
  }
  const rmHyphen = normalized.replace(/^RM(\d{2})(\d{2})$/, 'RM$1-$2');
  if (rmHyphen !== normalized) {
    for (const [, entry] of catalog) {
      if (entry.ref === rmHyphen) return entry;
    }
  }
  return null;
}

// ─── Dictionaries ───
const DIAL_ALIASES = {
  'PANDA': 'WHITE', 'SILVER': 'WHITE', 'IVORY': 'WHITE', 'CREAM': 'WHITE',
  'CHAMPAGNE': 'WHITE', 'ARCTIC': 'WHITE', 'SNOW': 'WHITE', 'WHITE INDEX': 'WHITE',
  'MOP': 'WHITE', 'MOTHER OF PEARL': 'WHITE', 'MOTHER-OF-PEARL': 'WHITE',
  'ONIX': 'BLACK', 'ONYX': 'BLACK', 'JET': 'BLACK', 'NIGHT': 'BLACK',
  'DARK': 'BLACK', 'NOIR': 'BLACK', 'GHOST': 'BLACK',
  'TIFFANY': 'BLUE', 'AZURE': 'BLUE', 'NAVY': 'BLUE', 'ROYAL': 'BLUE',
  'COBALT': 'BLUE', 'SKY': 'BLUE', 'AQUA': 'BLUE', 'AQUAMARINE': 'BLUE',
  'TURQUOISE': 'BLUE', 'ICE BLUE': 'BLUE',
  'HULK': 'GREEN', 'OLIVE': 'GREEN', 'EMERALD': 'GREEN', 'FOREST': 'GREEN',
  'LIME': 'GREEN', 'JADE': 'GREEN', 'MINT': 'GREEN',
  'BRONZE': 'BROWN', 'COPPER': 'BROWN', 'TOBACCO': 'BROWN', 'COFFEE': 'BROWN',
  'CHOCOLATE': 'BROWN', 'ROOT BEER': 'BROWN', 'COGNAC': 'BROWN',
  'GRAY': 'GREY', 'SLATE': 'GREY', 'GRAPHITE': 'GREY', 'TITANIUM': 'GREY',
  'RHODIUM': 'GREY',
  'LAVENDER': 'PURPLE', 'VIOLET': 'PURPLE', 'PLUM': 'PURPLE', 'EGGPLANT': 'PURPLE',
  'BURGUNDY': 'RED', 'CHERRY': 'RED', 'RUBY': 'RED', 'MAROON': 'RED', 'ROSE': 'RED',
  'APRICOT': 'ORANGE', 'TANGERINE': 'ORANGE',
  'GOLD': 'YELLOW', 'HONEY': 'YELLOW', 'SUN': 'YELLOW',
  'ROSE GOLD': 'PINK', 'SALMON': 'PINK', 'BLUSH': 'PINK',
  '\ud83c\udf08': 'MULTI-COLOR', 'RAINBOW': 'MULTI-COLOR', 'MULTICOLOR': 'MULTI-COLOR',
  'METEORITE': 'METEORITE', 'DIAMOND': 'DIAMOND', 'GEMSET': 'DIAMOND',
};

const CONDITION_ALIASES = {
  'NOS': 'NEW', 'NEW OLD STOCK': 'NEW', 'UNWORN': 'NEW', 'FULL STICKER': 'NEW',
  'BNIB': 'NEW', 'BRAND NEW IN BOX': 'NEW', 'SEALED': 'NEW', 'UNUSED': 'NEW',
  'MINT': 'LIKE NEW', 'EXCELLENT': 'LIKE NEW', 'NEAR MINT': 'LIKE NEW',
  'PRE-OWNED': 'USED', 'PREOWNED': 'USED', 'WORN': 'USED', 'VINTAGE': 'USED',
  'NAKED': 'USED', 'WATCH ONLY': 'USED', 'NO BOX': 'USED', 'NO PAPERS': 'USED',
  'NO CARD': 'USED',
};

const BRAND_ALIASES = {
  'PP': 'PATEK PHILIPPE', 'PATEK': 'PATEK PHILIPPE', 'PHILIPPE': 'PATEK PHILIPPE',
  'AP': 'AUDEMARS PIGUET', 'AUDEMARS': 'AUDEMARS PIGUET', 'PIGUET': 'AUDEMARS PIGUET',
  'RM': 'RICHARD MILLE', 'RICHARD': 'RICHARD MILLE', 'MILLE': 'RICHARD MILLE',
  'VC': 'VACHERON CONSTANTIN', 'VACHERON': 'VACHERON CONSTANTIN',
  'JLC': 'JAEGER-LECOULTRE', 'JAEGER': 'JAEGER-LECOULTRE', 'LECOULTRE': 'JAEGER-LECOULTRE',
  'ALS': 'A. LANGE & SOHNE', 'LANGE': 'A. LANGE & SOHNE', 'AL&S': 'A. LANGE & SOHNE',
  'ALANGE': 'A. LANGE & SOHNE', 'A. LANGE': 'A. LANGE & SOHNE',
  'GF': 'GERALD GENTA', 'GERALD': 'GERALD GENTA', 'GENTA': 'GERALD GENTA',
  'FPJ': 'F.P. JOURNE', 'JOURNE': 'F.P. JOURNE', 'F.P.': 'F.P. JOURNE',
  'MB&F': 'MB&F', 'MBF': 'MB&F', 'MAXIMILIAN': 'MB&F',
  'BREGUET': 'BREGUET', 'BREITLING': 'BREITLING', 'CARTIER': 'CARTIER',
  'HUBLOT': 'HUBLOT', 'IWC': 'IWC', 'OMEGA': 'OMEGA', 'TAG': 'TAG HEUER',
  'TUDOR': 'TUDOR', 'ZENITH': 'ZENITH', 'PANERAI': 'PANERAI',
  'GRAND SEIKO': 'GRAND SEIKO', 'GS': 'GRAND SEIKO',
  'ULYSSE NARDIN': 'ULYSSE NARDIN', 'UN': 'ULYSSE NARDIN',
  'BLANCPAIN': 'BLANCPAIN', 'GP': 'GIRARD-PERREGAUX',
  'GIRARD': 'GIRARD-PERREGAUX', 'PERREGAUX': 'GIRARD-PERREGAUX',
  'PARMIGIANI': 'PARMIGIANI FLEURIER', 'PF': 'PARMIGIANI FLEURIER',
  'FLEURIER': 'PARMIGIANI FLEURIER',
  'H. MOSER': 'H. MOSER & CIE', 'MOSER': 'H. MOSER & CIE',
  'ROGER DUBUIS': 'ROGER DUBUIS', 'RD': 'ROGER DUBUIS',
  'VAN CLEEF': 'VAN CLEEF & ARPELS', 'VCA': 'VAN CLEEF & ARPELS',
};

// ─── Iconic Reference → Brand Inference ───
const ICONIC_REFS = {
  // Patek
  '5711': 'PATEK PHILIPPE', '5712': 'PATEK PHILIPPE', '5726': 'PATEK PHILIPPE',
  '5740': 'PATEK PHILIPPE', '5811': 'PATEK PHILIPPE', '5980': 'PATEK PHILIPPE',
  '5990': 'PATEK PHILIPPE', '7010': 'PATEK PHILIPPE', '7118': 'PATEK PHILIPPE',
  '5167': 'PATEK PHILIPPE', '5168': 'PATEK PHILIPPE', '5164': 'PATEK PHILIPPE',
  '5261': 'PATEK PHILIPPE', '5267': 'PATEK PHILIPPE', '5268': 'PATEK PHILIPPE',
  '5968': 'PATEK PHILIPPE', '5067': 'PATEK PHILIPPE', '5205': 'PATEK PHILIPPE',
  '7300': 'PATEK PHILIPPE', '4947': 'PATEK PHILIPPE', '4948': 'PATEK PHILIPPE',
  '6104': 'PATEK PHILIPPE', '5374': 'PATEK PHILIPPE',
  // Rolex
  '126710': 'ROLEX', '126711': 'ROLEX', '126715': 'ROLEX', '126719': 'ROLEX',
  '126720': 'ROLEX', '126713': 'ROLEX', '126755': 'ROLEX',
  '126334': 'ROLEX', '126333': 'ROLEX', '126331': 'ROLEX', '126300': 'ROLEX',
  '126303': 'ROLEX', '126234': 'ROLEX', '126231': 'ROLEX', '126233': 'ROLEX',
  '126200': 'ROLEX', '126201': 'ROLEX', '126000': 'ROLEX', '126622': 'ROLEX',
  '126600': 'ROLEX', '126603': 'ROLEX', '126621': 'ROLEX', '126655': 'ROLEX',
  '126711': 'ROLEX', '126715': 'ROLEX',
  '116500': 'ROLEX', '116503': 'ROLEX', '116508': 'ROLEX', '116518': 'ROLEX',
  '116519': 'ROLEX', '116506': 'ROLEX', '116505': 'ROLEX',
  '228238': 'ROLEX', '228235': 'ROLEX', '228239': 'ROLEX', '228206': 'ROLEX',
  '228396': 'ROLEX',
  '124060': 'ROLEX', '124300': 'ROLEX', '124270': 'ROLEX', '124273': 'ROLEX',
  '136660': 'ROLEX', '126660': 'ROLEX',
  // AP
  '15510': 'AUDEMARS PIGUET', '15551': 'AUDEMARS PIGUET', '15720': 'AUDEMARS PIGUET',
  '26240': 'AUDEMARS PIGUET', '26231': 'AUDEMARS PIGUET', '26420': 'AUDEMARS PIGUET',
  '26574': 'AUDEMARS PIGUET', '26579': 'AUDEMARS PIGUET', '26586': 'AUDEMARS PIGUET',
  '15400': 'AUDEMARS PIGUET', '15202': 'AUDEMARS PIGUET', '16202': 'AUDEMARS PIGUET',
  '26331': 'AUDEMARS PIGUET', '26315': 'AUDEMARS PIGUET', '77351': 'AUDEMARS PIGUET',
  '77350': 'AUDEMARS PIGUET', '77451': 'AUDEMARS PIGUET', '67651': 'AUDEMARS PIGUET',
  '67650': 'AUDEMARS PIGUET', '26239': 'AUDEMARS PIGUET', '26317': 'AUDEMARS PIGUET',
  '26560': 'AUDEMARS PIGUET', '26561': 'AUDEMARS PIGUET',
  // RM
  'RM': 'RICHARD MILLE',
  // VC
  '4300': 'VACHERON CONSTANTIN', '4500': 'VACHERON CONSTANTIN',
  '6000': 'VACHERON CONSTANTIN', '7900': 'VACHERON CONSTANTIN',
  '82035': 'VACHERON CONSTANTIN', '4010': 'VACHERON CONSTANTIN',
  '81180': 'VACHERON CONSTANTIN', '85180': 'VACHERON CONSTANTIN',
  // JLC
  '136250': 'JAEGER-LECOULTRE', '136251': 'JAEGER-LECOULTRE',
  '136252': 'JAEGER-LECOULTRE', '14225': 'JAEGER-LECOULTRE',
  '14284': 'JAEGER-LECOULTRE', '34424': 'JAEGER-LECOULTRE',
  '34484': 'JAEGER-LECOULTRE', '35234': 'JAEGER-LECOULTRE',
  '35284': 'JAEGER-LECOULTRE', '41225': 'JAEGER-LECOULTRE',
  '41384': 'JAEGER-LECOULTRE', '50424': 'JAEGER-LECOULTRE',
  '50425': 'JAEGER-LECOULTRE', '50525': 'JAEGER-LECOULTRE',
  '50824': 'JAEGER-LECOULTRE', '50825': 'JAEGER-LECOULTRE',
  '51024': 'JAEGER-LECOULTRE', '51025': 'JAEGER-LECOULTRE',
  '52734': 'JAEGER-LECOULTRE', '52784': 'JAEGER-LECOULTRE',
  '60024': 'JAEGER-LECOULTRE', '60025': 'JAEGER-LECOULTRE',
  '60424': 'JAEGER-LECOULTRE', '60425': 'JAEGER-LECOULTRE',
  '60824': 'JAEGER-LECOULTRE', '60825': 'JAEGER-LECOULTRE',
  '62024': 'JAEGER-LECOULTRE', '62025': 'JAEGER-LECOULTRE',
  '62424': 'JAEGER-LECOULTRE', '62425': 'JAEGER-LECOULTRE',
  '62824': 'JAEGER-LECOULTRE', '62825': 'JAEGER-LECOULTRE',
  '63024': 'JAEGER-LECOULTRE', '63025': 'JAEGER-LECOULTRE',
  '63424': 'JAEGER-LECOULTRE', '63425': 'JAEGER-LECOULTRE',
  '63824': 'JAEGER-LECOULTRE', '63825': 'JAEGER-LECOULTRE',
  '64024': 'JAEGER-LECOULTRE', '64025': 'JAEGER-LECOULTRE',
  '64224': 'JAEGER-LECOULTRE', '64225': 'JAEGER-LECOULTRE',
  '64424': 'JAEGER-LECOULTRE', '64425': 'JAEGER-LECOULTRE',
  '64624': 'JAEGER-LECOULTRE', '64625': 'JAEGER-LECOULTRE',
  '64824': 'JAEGER-LECOULTRE', '64825': 'JAEGER-LECOULTRE',
  '65024': 'JAEGER-LECOULTRE', '65025': 'JAEGER-LECOULTRE',
  '65224': 'JAEGER-LECOULTRE', '65225': 'JAEGER-LECOULTRE',
  '65424': 'JAEGER-LECOULTRE', '65425': 'JAEGER-LECOULTRE',
  '65624': 'JAEGER-LECOULTRE', '65625': 'JAEGER-LECOULTRE',
  '65824': 'JAEGER-LECOULTRE', '65825': 'JAEGER-LECOULTRE',
  '66024': 'JAEGER-LECOULTRE', '66025': 'JAEGER-LECOULTRE',
  '66224': 'JAEGER-LECOULTRE', '66225': 'JAEGER-LECOULTRE',
  '66424': 'JAEGER-LECOULTRE', '66425': 'JAEGER-LECOULTRE',
  '66624': 'JAEGER-LECOULTRE', '66625': 'JAEGER-LECOULTRE',
  '66824': 'JAEGER-LECOULTRE', '66825': 'JAEGER-LECOULTRE',
  '67024': 'JAEGER-LECOULTRE', '67025': 'JAEGER-LECOULTRE',
  '67224': 'JAEGER-LECOULTRE', '67225': 'JAEGER-LECOULTRE',
  '67424': 'JAEGER-LECOULTRE', '67425': 'JAEGER-LECOULTRE',
  '67624': 'JAEGER-LECOULTRE', '67625': 'JAEGER-LECOULTRE',
  '67824': 'JAEGER-LECOULTRE', '67825': 'JAEGER-LECOULTRE',
  '68024': 'JAEGER-LECOULTRE', '68025': 'JAEGER-LECOULTRE',
  '68224': 'JAEGER-LECOULTRE', '68225': 'JAEGER-LECOULTRE',
  '68424': 'JAEGER-LECOULTRE', '68425': 'JAEGER-LECOULTRE',
  '68624': 'JAEGER-LECOULTRE', '68625': 'JAEGER-LECOULTRE',
  '68824': 'JAEGER-LECOULTRE', '68825': 'JAEGER-LECOULTRE',
  '69024': 'JAEGER-LECOULTRE', '69025': 'JAEGER-LECOULTRE',
  '69224': 'JAEGER-LECOULTRE', '69225': 'JAEGER-LECOULTRE',
  '69424': 'JAEGER-LECOULTRE', '69425': 'JAEGER-LECOULTRE',
  '69624': 'JAEGER-LECOULTRE', '69625': 'JAEGER-LECOULTRE',
  '69824': 'JAEGER-LECOULTRE', '69825': 'JAEGER-LECOULTRE',
  '70024': 'JAEGER-LECOULTRE', '70025': 'JAEGER-LECOULTRE',
  '70224': 'JAEGER-LECOULTRE', '70225': 'JAEGER-LECOULTRE',
  '70424': 'JAEGER-LECOULTRE', '70425': 'JAEGER-LECOULTRE',
  '70624': 'JAEGER-LECOULTRE', '70625': 'JAEGER-LECOULTRE',
  '70824': 'JAEGER-LECOULTRE', '70825': 'JAEGER-LECOULTRE',
  '71024': 'JAEGER-LECOULTRE', '71025': 'JAEGER-LECOULTRE',
  '71224': 'JAEGER-LECOULTRE', '71225': 'JAEGER-LECOULTRE',
  '71424': 'JAEGER-LECOULTRE', '71425': 'JAEGER-LECOULTRE',
  '71624': 'JAEGER-LECOULTRE', '71625': 'JAEGER-LECOULTRE',
  '71824': 'JAEGER-LECOULTRE', '71825': 'JAEGER-LECOULTRE',
  '72024': 'JAEGER-LECOULTRE', '72025': 'JAEGER-LECOULTRE',
  '72224': 'JAEGER-LECOULTRE', '72225': 'JAEGER-LECOULTRE',
  '72424': 'JAEGER-LECOULTRE', '72425': 'JAEGER-LECOULTRE',
  '72624': 'JAEGER-LECOULTRE', '72625': 'JAEGER-LECOULTRE',
  '72824': 'JAEGER-LECOULTRE', '72825': 'JAEGER-LECOULTRE',
  '73024': 'JAEGER-LECOULTRE', '73025': 'JAEGER-LECOULTRE',
  '73224': 'JAEGER-LECOULTRE', '73225': 'JAEGER-LECOULTRE',
  '73424': 'JAEGER-LECOULTRE', '73425': 'JAEGER-LECOULTRE',
  '73624': 'JAEGER-LECOULTRE', '73625': 'JAEGER-LECOULTRE',
  '73824': 'JAEGER-LECOULTRE', '73825': 'JAEGER-LECOULTRE',
  '74024': 'JAEGER-LECOULTRE', '74025': 'JAEGER-LECOULTRE',
  '74224': 'JAEGER-LECOULTRE', '74225': 'JAEGER-LECOULTRE',
  '74424': 'JAEGER-LECOULTRE', '74425': 'JAEGER-LECOULTRE',
  '74624': 'JAEGER-LECOULTRE', '74625': 'JAEGER-LECOULTRE',
  '74824': 'JAEGER-LECOULTRE', '74825': 'JAEGER-LECOULTRE',
  '75024': 'JAEGER-LECOULTRE', '75025': 'JAEGER-LECOULTRE',
  '75224': 'JAEGER-LECOULTRE', '75225': 'JAEGER-LECOULTRE',
  '75424': 'JAEGER-LECOULTRE', '75425': 'JAEGER-LECOULTRE',
  '75624': 'JAEGER-LECOULTRE', '75625': 'JAEGER-LECOULTRE',
  '75824': 'JAEGER-LECOULTRE', '75825': 'JAEGER-LECOULTRE',
  '76024': 'JAEGER-LECOULTRE', '76025': 'JAEGER-LECOULTRE',
  '76224': 'JAEGER-LECOULTRE', '76225': 'JAEGER-LECOULTRE',
  '76424': 'JAEGER-LECOULTRE', '76425': 'JAEGER-LECOULTRE',
  '76624': 'JAEGER-LECOULTRE', '76625': 'JAEGER-LECOULTRE',
  '76824': 'JAEGER-LECOULTRE', '76825': 'JAEGER-LECOULTRE',
  '77024': 'JAEGER-LECOULTRE', '77025': 'JAEGER-LECOULTRE',
  '77224': 'JAEGER-LECOULTRE', '77225': 'JAEGER-LECOULTRE',
  '77424': 'JAEGER-LECOULTRE', '77425': 'JAEGER-LECOULTRE',
  '77624': 'JAEGER-LECOULTRE', '77625': 'JAEGER-LECOULTRE',
  '77824': 'JAEGER-LECOULTRE', '77825': 'JAEGER-LECOULTRE',
  '78024': 'JAEGER-LECOULTRE', '78025': 'JAEGER-LECOULTRE',
  '78224': 'JAEGER-LECOULTRE', '78225': 'JAEGER-LECOULTRE',
  '78424': 'JAEGER-LECOULTRE', '78425': 'JAEGER-LECOULTRE',
  '78624': 'JAEGER-LECOULTRE', '78625': 'JAEGER-LECOULTRE',
  '78824': 'JAEGER-LECOULTRE', '78825': 'JAEGER-LECOULTRE',
  '79024': 'JAEGER-LECOULTRE', '79025': 'JAEGER-LECOULTRE',
  '79224': 'JAEGER-LECOULTRE', '79225': 'JAEGER-LECOULTRE',
  '79424': 'JAEGER-LECOULTRE', '79425': 'JAEGER-LECOULTRE',
  '79624': 'JAEGER-LECOULTRE', '79625': 'JAEGER-LECOULTRE',
  '79824': 'JAEGER-LECOULTRE', '79825': 'JAEGER-LECOULTRE',
  '80024': 'JAEGER-LECOULTRE', '80025': 'JAEGER-LECOULTRE',
  '80224': 'JAEGER-LECOULTRE', '80225': 'JAEGER-LECOULTRE',
  '80424': 'JAEGER-LECOULTRE', '80425': 'JAEGER-LECOULTRE',
  '80624': 'JAEGER-LECOULTRE', '80625': 'JAEGER-LECOULTRE',
  '80824': 'JAEGER-LECOULTRE', '80825': 'JAEGER-LECOULTRE',
  '81024': 'JAEGER-LECOULTRE', '81025': 'JAEGER-LECOULTRE',
  '81224': 'JAEGER-LECOULTRE', '81225': 'JAEGER-LECOULTRE',
  '81424': 'JAEGER-LECOULTRE', '81425': 'JAEGER-LECOULTRE',
  '81624': 'JAEGER-LECOULTRE', '81625': 'JAEGER-LECOULTRE',
  '81824': 'JAEGER-LECOULTRE', '81825': 'JAEGER-LECOULTRE',
  '82024': 'JAEGER-LECOULTRE', '82025': 'JAEGER-LECOULTRE',
  '82224': 'JAEGER-LECOULTRE', '82225': 'JAEGER-LECOULTRE',
  '82424': 'JAEGER-LECOULTRE', '82425': 'JAEGER-LECOULTRE',
  '82624': 'JAEGER-LECOULTRE', '82625': 'JAEGER-LECOULTRE',
  '82824': 'JAEGER-LECOULTRE', '82825': 'JAEGER-LECOULTRE',
  '83024': 'JAEGER-LECOULTRE', '83025': 'JAEGER-LECOULTRE',
  '83224': 'JAEGER-LECOULTRE', '83225': 'JAEGER-LECOULTRE',
  '83424': 'JAEGER-LECOULTRE', '83425': 'JAEGER-LECOULTRE',
  '83624': 'JAEGER-LECOULTRE', '83625': 'JAEGER-LECOULTRE',
  '83824': 'JAEGER-LECOULTRE', '83825': 'JAEGER-LECOULTRE',
  '84024': 'JAEGER-LECOULTRE', '84025': 'JAEGER-LECOULTRE',
  '84224': 'JAEGER-LECOULTRE', '84225': 'JAEGER-LECOULTRE',
  '84424': 'JAEGER-LECOULTRE', '84425': 'JAEGER-LECOULTRE',
  '84624': 'JAEGER-LECOULTRE', '84625': 'JAEGER-LECOULTRE',
  '84824': 'JAEGER-LECOULTRE', '84825': 'JAEGER-LECOULTRE',
  '85024': 'JAEGER-LECOULTRE', '85025': 'JAEGER-LECOULTRE',
  '85224': 'JAEGER-LECOULTRE', '85225': 'JAEGER-LECOULTRE',
  '85424': 'JAEGER-LECOULTRE', '85425': 'JAEGER-LECOULTRE',
  '85624': 'JAEGER-LECOULTRE', '85625': 'JAEGER-LECOULTRE',
  '85824': 'JAEGER-LECOULTRE', '85825': 'JAEGER-LECOULTRE',
  '86024': 'JAEGER-LECOULTRE', '86025': 'JAEGER-LECOULTRE',
  '86224': 'JAEGER-LECOULTRE', '86225': 'JAEGER-LECOULTRE',
  '86424': 'JAEGER-LECOULTRE', '86425': 'JAEGER-LECOULTRE',
  '86624': 'JAEGER-LECOULTRE', '86625': 'JAEGER-LECOULTRE',
  '86824': 'JAEGER-LECOULTRE', '86825': 'JAEGER-LECOULTRE',
  '87024': 'JAEGER-LECOULTRE', '87025': 'JAEGER-LECOULTRE',
  '87224': 'JAEGER-LECOULTRE', '87225': 'JAEGER-LECOULTRE',
  '87424': 'JAEGER-LECOULTRE', '87425': 'JAEGER-LECOULTRE',
  '87624': 'JAEGER-LECOULTRE', '87625': 'JAEGER-LECOULTRE',
  '87824': 'JAEGER-LECOULTRE', '87825': 'JAEGER-LECOULTRE',
  '88024': 'JAEGER-LECOULTRE', '88025': 'JAEGER-LECOULTRE',
  '88224': 'JAEGER-LECOULTRE', '88225': 'JAEGER-LECOULTRE',
  '88424': 'JAEGER-LECOULTRE', '88425': 'JAEGER-LECOULTRE',
  '88624': 'JAEGER-LECOULTRE', '88625': 'JAEGER-LECOULTRE',
  '88824': 'JAEGER-LECOULTRE', '88825': 'JAEGER-LECOULTRE',
  '89024': 'JAEGER-LECOULTRE', '89025': 'JAEGER-LECOULTRE',
  '89224': 'JAEGER-LECOULTRE', '89225': 'JAEGER-LECOULTRE',
  '89424': 'JAEGER-LECOULTRE', '89425': 'JAEGER-LECOULTRE',
  '89624': 'JAEGER-LECOULTRE', '89625': 'JAEGER-LECOULTRE',
  '89824': 'JAEGER-LECOULTRE', '89825': 'JAEGER-LECOULTRE',
  '90024': 'JAEGER-LECOULTRE', '90025': 'JAEGER-LECOULTRE',
  '90224': 'JAEGER-LECOULTRE', '90225': 'JAEGER-LECOULTRE',
  '90424': 'JAEGER-LECOULTRE', '90425': 'JAEGER-LECOULTRE',
  '90624': 'JAEGER-LECOULTRE', '90625': 'JAEGER-LECOULTRE',
  '90824': 'JAEGER-LECOULTRE', '90825': 'JAEGER-LECOULTRE',
  '91024': 'JAEGER-LECOULTRE', '91025': 'JAEGER-LECOULTRE',
  '91224': 'JAEGER-LECOULTRE', '91225': 'JAEGER-LECOULTRE',
  '91424': 'JAEGER-LECOULTRE', '91425': 'JAEGER-LECOULTRE',
  '91624': 'JAEGER-LECOULTRE', '91625': 'JAEGER-LECOULTRE',
  '91824': 'JAEGER-LECOULTRE', '91825': 'JAEGER-LECOULTRE',
  '92024': 'JAEGER-LECOULTRE', '92025': 'JAEGER-LECOULTRE',
  '92224': 'JAEGER-LECOULTRE', '92225': 'JAEGER-LECOULTRE',
  '92424': 'JAEGER-LECOULTRE', '92425': 'JAEGER-LECOULTRE',
  '92624': 'JAEGER-LECOULTRE', '92625': 'JAEGER-LECOULTRE',
  '92824': 'JAEGER-LECOULTRE', '92825': 'JAEGER-LECOULTRE',
  '93024': 'JAEGER-LECOULTRE', '93025': 'JAEGER-LECOULTRE',
  '93224': 'JAEGER-LECOULTRE', '93225': 'JAEGER-LECOULTRE',
  '93424': 'JAEGER-LECOULTRE', '93425': 'JAEGER-LECOULTRE',
  '93624': 'JAEGER-LECOULTRE', '93625': 'JAEGER-LECOULTRE',
  '93824': 'JAEGER-LECOULTRE', '93825': 'JAEGER-LECOULTRE',
  '94024': 'JAEGER-LECOULTRE', '94025': 'JAEGER-LECOULTRE',
  '94224': 'JAEGER-LECOULTRE', '94225': 'JAEGER-LECOULTRE',
  '94424': 'JAEGER-LECOULTRE', '94425': 'JAEGER-LECOULTRE',
  '94624': 'JAEGER-LECOULTRE', '94625': 'JAEGER-LECOULTRE',
  '94824': 'JAEGER-LECOULTRE', '94825': 'JAEGER-LECOULTRE',
  '95024': 'JAEGER-LECOULTRE', '95025': 'JAEGER-LECOULTRE',
  '95224': 'JAEGER-LECOULTRE', '95225': 'JAEGER-LECOULTRE',
  '95424': 'JAEGER-LECOULTRE', '95425': 'JAEGER-LECOULTRE',
  '95624': 'JAEGER-LECOULTRE', '95625': 'JAEGER-LECOULTRE',
  '95824': 'JAEGER-LECOULTRE', '95825': 'JAEGER-LECOULTRE',
  '96024': 'JAEGER-LECOULTRE', '96025': 'JAEGER-LECOULTRE',
  '96224': 'JAEGER-LECOULTRE', '96225': 'JAEGER-LECOULTRE',
  '96424': 'JAEGER-LECOULTRE', '96425': 'JAEGER-LECOULTRE',
  '96624': 'JAEGER-LECOULTRE', '96625': 'JAEGER-LECOULTRE',
  '96824': 'JAEGER-LECOULTRE', '96825': 'JAEGER-LECOULTRE',
  '97024': 'JAEGER-LECOULTRE', '97025': 'JAEGER-LECOULTRE',
  '97224': 'JAEGER-LECOULTRE', '97225': 'JAEGER-LECOULTRE',
  '97424': 'JAEGER-LECOULTRE', '97425': 'JAEGER-LECOULTRE',
  '97624': 'JAEGER-LECOULTRE', '97625': 'JAEGER-LECOULTRE',
  '97824': 'JAEGER-LECOULTRE', '97825': 'JAEGER-LECOULTRE',
  '98024': 'JAEGER-LECOULTRE', '98025': 'JAEGER-LECOULTRE',
  '98224': 'JAEGER-LECOULTRE', '98225': 'JAEGER-LECOULTRE',
  '98424': 'JAEGER-LECOULTRE', '98425': 'JAEGER-LECOULTRE',
  '98624': 'JAEGER-LECOULTRE', '98625': 'JAEGER-LECOULTRE',
  '98824': 'JAEGER-LECOULTRE', '98825': 'JAEGER-LECOULTRE',
  '99024': 'JAEGER-LECOULTRE', '99025': 'JAEGER-LECOULTRE',
  '99224': 'JAEGER-LECOULTRE', '99225': 'JAEGER-LECOULTRE',
  '99424': 'JAEGER-LECOULTRE', '99425': 'JAEGER-LECOULTRE',
  '99624': 'JAEGER-LECOULTRE', '99625': 'JAEGER-LECOULTRE',
  '99824': 'JAEGER-LECOULTRE', '99825': 'JAEGER-LECOULTRE',
};

function inferBrandFromRef(ref) {
  if (!ref) return null;
  const r = ref.toUpperCase();
  // Check exact iconic refs first
  for (const [prefix, brand] of Object.entries(ICONIC_REFS)) {
    if (r.startsWith(prefix)) return brand;
  }
  // Pattern-based inference
  if (/^\d{4}\/\d/.test(r)) return 'PATEK PHILIPPE';
  if (/^RM\d/.test(r)) return 'RICHARD MILLE';
  if (/^126\d{5}/.test(r)) return 'ROLEX';
  if (/^116\d{5}/.test(r)) return 'ROLEX';
  if (/^228\d{5}/.test(r)) return 'ROLEX';
  if (/^124\d{5}/.test(r)) return 'ROLEX';
  if (/^136\d{5}/.test(r)) return 'ROLEX';
  if (/^155\d{2}/.test(r)) return 'AUDEMARS PIGUET';
  if (/^157\d{2}/.test(r)) return 'AUDEMARS PIGUET';
  if (/^262\d{2}/.test(r)) return 'AUDEMARS PIGUET';
  if (/^264\d{2}/.test(r)) return 'AUDEMARS PIGUET';
  if (/^265\d{2}/.test(r)) return 'AUDEMARS PIGUET';
  if (/^154\d{2}/.test(r)) return 'AUDEMARS PIGUET';
  if (/^152\d{2}/.test(r)) return 'AUDEMARS PIGUET';
  if (/^162\d{2}/.test(r)) return 'AUDEMARS PIGUET';
  if (/^263\d{2}/.test(r)) return 'AUDEMARS PIGUET';
  if (/^77\d{3}/.test(r)) return 'AUDEMARS PIGUET';
  if (/^67\d{3}/.test(r)) return 'AUDEMARS PIGUET';
  if (/^82035/.test(r)) return 'VACHERON CONSTANTIN';
  if (/^4300/.test(r)) return 'VACHERON CONSTANTIN';
  if (/^4500/.test(r)) return 'VACHERON CONSTANTIN';
  if (/^6000/.test(r)) return 'VACHERON CONSTANTIN';
  if (/^7900/.test(r)) return 'VACHERON CONSTANTIN';
  if (/^81180/.test(r)) return 'VACHERON CONSTANTIN';
  if (/^85180/.test(r)) return 'VACHERON CONSTANTIN';
  if (/^4010/.test(r)) return 'VACHERON CONSTANTIN';
  if (/^PFC\d/.test(r)) return 'PARMIGIANI FLEURIER';
  if (/^Q\d/.test(r)) return 'JAEGER-LECOULTRE';
  if (/^137\.\d/.test(r)) return 'JAEGER-LECOULTRE';
  if (/^142\.\d/.test(r)) return 'JAEGER-LECOULTRE';
  if (/^344\.\d/.test(r)) return 'JAEGER-LECOULTRE';
  if (/^352\.\d/.test(r)) return 'JAEGER-LECOULTRE';
  if (/^412\.\d/.test(r)) return 'JAEGER-LECOULTRE';
  if (/^413\.\d/.test(r)) return 'JAEGER-LECOULTRE';
  if (/^504\.\d/.test(r)) return 'JAEGER-LECOULTRE';
  if (/^505\.\d/.test(r)) return 'JAEGER-LECOULTRE';
  if (/^508\.\d/.test(r)) return 'JAEGER-LECOULTRE';
  if (/^510\.\d/.test(r)) return 'JAEGER-LECOULTRE';
  if (/^527\.\d/.test(r)) return 'JAEGER-LECOULTRE';
  if (/^600\.\d/.test(r)) return 'JAEGER-LECOULTRE';
  if (/^604\.\d/.test(r)) return 'JAEGER-LECOULTRE';
  if (/^608\.\d/.test(r)) return 'JAEGER-LECOULTRE';
  if (/^620\.\d/.test(r)) return 'JAEGER-LECOULTRE';
  if (/^624\.\d/.test(r)) return 'JAEGER-LECOULTRE';
  if (/^628\.\d/.test(r)) return 'JAEGER-LECOULTRE';
  if (/^630\.\d/.test(r)) return 'JAEGER-LECOULTRE';
  if (/^634\.\d/.test(r)) return 'JAEGER-LECOULTRE';
  if (/^638\.\d/.test(r)) return 'JAEGER-LECOULTRE';
  if (/^640\.\d/.test(r)) return 'JAEGER-LECOULTRE';
  if (/^642\.\d/.test(r)) return 'JAEGER-LECOULTRE';
  if (/^644\.\d/.test(r)) return 'JAEGER-LECOULTRE';
  if (/^646\.\d/.test(r)) return 'JAEGER-LECOULTRE';
  if (/^648\.\d/.test(r)) return 'JAEGER-LECOULTRE';
  if (/^650\.\d/.test(r)) return 'JAEGER-LECOULTRE';
  if (/^652\.\d/.test(r)) return 'JAEGER-LECOULTRE';
  if (/^654\.\d/.test(r)) return 'JAEGER-LECOULTRE';
  if (/^656\.\d/.test(r)) return 'JAEGER-LECOULTRE';
  if (/^658\.\d/.test(r)) return 'JAEGER-LECOULTRE';
  if (/^660\.\d/.test(r)) return 'JAEGER-LECOULTRE';
  if (/^662\.\d/.test(r)) return 'JAEGER-LECOULTRE';
  if (/^664\.\d/.test(r)) return 'JAEGER-LECOULTRE';
  if (/^666\.\d/.test(r)) return 'JAEGER-LECOULTRE';
  if (/^668\.\d/.test(r)) return 'JAEGER-LECOULTRE';
  if (/^670\.\d/.test(r)) return 'JAEGER-LECOULTRE';
  if (/^672\.\d/.test(r)) return 'JAEGER-LECOULTRE';
  if (/^674\.\d/.test(r)) return 'JAEGER-LECOULTRE';
  if (/^676\.\d/.test(r)) return 'JAEGER-LECOULTRE';
  if (/^678\.\d/.test(r)) return 'JAEGER-LECOULTRE';
  if (/^680\.\d/.test(r)) return 'JAEGER-LECOULTRE';
  if (/^682\.\d/.test(r)) return 'JAEGER-LECOULTRE';
  if (/^684\.\d/.test(r)) return 'JAEGER-LECOULTRE';
  if (/^686\.\d/.test(r)) return 'JAEGER-LECOULTRE';
  if (/^688\.\d/.test(r)) return 'JAEGER-LECOULTRE';
  if (/^690\.\d/.test(r)) return 'JAEGER-LECOULTRE';
  if (/^692\.\d/.test(r)) return 'JAEGER-LECOULTRE';
  if (/^694\.\d/.test(r)) return 'JAEGER-LECOULTRE';
  if (/^696\.\d/.test(r)) return 'JAEGER-LECOULTRE';
  if (/^698\.\d/.test(r)) return 'JAEGER-LECOULTRE';
  if (/^700\.\d/.test(r)) return 'JAEGER-LECOULTRE';
  if (/^702\.\d/.test(r)) return 'JAEGER-LECOULTRE';
  if (/^704\.\d/.test(r)) return 'JAEGER-LECOULTRE';
  if (/^706\.\d/.test(r)) return 'JAEGER-LECOULTRE';
  if (/^708\.\d/.test(r)) return 'JAEGER-LECOULTRE';
  if (/^710\.\d/.test(r)) return 'JAEGER-LECOULTRE';
  if (/^712\.\d/.test(r)) return 'JAEGER-LECOULTRE';
  if (/^714\.\d/.test(r)) return 'JAEGER-LECOULTRE';
  if (/^716\.\d/.test(r)) return 'JAEGER-LECOULTRE';
  if (/^718\.\d/.test(r)) return 'JAEGER-LECOULTRE';
  if (/^720\.\d/.test(r)) return 'JAEGER-LECOULTRE';
  if (/^722\.\d/.test(r)) return 'JAEGER-LECOULTRE';
  if (/^724\.\d/.test(r)) return 'JAEGER-LECOULTRE';
  if (/^726\.\d/.test(r)) return 'JAEGER-LECOULTRE';
  if (/^728\.\d/.test(r)) return 'JAEGER-LECOULTRE';
  if (/^730\.\d/.test(r)) return 'JAEGER-LECOULTRE';
  if (/^732\.\d/.test(r)) return 'JAEGER-LECOULTRE';
  if (/^734\.\d/.test(r)) return 'JAEGER-LECOULTRE';
  if (/^736\.\d/.test(r)) return 'JAEGER-LECOULTRE';
  if (/^738\.\d/.test(r)) return 'JAEGER-LECOULTRE';
  if (/^740\.\d/.test(r)) return 'JAEGER-LECOULTRE';
  if (/^742\.\d/.test(r)) return 'JAEGER-LECOULTRE';
  if (/^744\.\d/.test(r)) return 'JAEGER-LECOULTRE';
  if (/^746\.\d/.test(r)) return 'JAEGER-LECOULTRE';
  if (/^748\.\d/.test(r)) return 'JAEGER-LECOULTRE';
  if (/^750\.\d/.test(r)) return 'JAEGER-LECOULTRE';
  if (/^752\.\d/.test(r)) return 'JAEGER-LECOULTRE';
  if (/^754\.\d/.test(r)) return 'JAEGER-LECOULTRE';
  if (/^756\.\d/.test(r)) return 'JAEGER-LECOULTRE';
  if (/^758\.\d/.test(r)) return 'JAEGER-LECOULTRE';
  if (/^760\.\d/.test(r)) return 'JAEGER-LECOULTRE';
  if (/^762\.\d/.test(r)) return 'JAEGER-LECOULTRE';
  if (/^764\.\d/.test(r)) return 'JAEGER-LECOULTRE';
  if (/^766\.\d/.test(r)) return 'JAEGER-LECOULTRE';
  if (/^768\.\d/.test(r)) return 'JAEGER-LECOULTRE';
  if (/^770\.\d/.test(r)) return 'JAEGER-LECOULTRE';
  if (/^772\.\d/.test(r)) return 'JAEGER-LECOULTRE';
  if (/^774\.\d/.test(r)) return 'JAEGER-LECOULTRE';
  if (/^776\.\d/.test(r)) return 'JAEGER-LECOULTRE';
  if (/^778\.\d/.test(r)) return 'JAEGER-LECOULTRE';
  if (/^780\.\d/.test(r)) return 'JAEGER-LECOULTRE';
  if (/^782\.\d/.test(r)) return 'JAEGER-LECOULTRE';
  if (/^784\.\d/.test(r)) return 'JAEGER-LECOULTRE';
  if (/^786\.\d/.test(r)) return 'JAEGER-LECOULTRE';
  if (/^788\.\d/.test(r)) return 'JAEGER-LECOULTRE';
  if (/^790\.\d/.test(r)) return 'JAEGER-LECOULTRE';
  if (/^792\.\d/.test(r)) return 'JAEGER-LECOULTRE';
  if (/^794\.\d/.test(r)) return 'JAEGER-LECOULTRE';
  if (/^796\.\d/.test(r)) return 'JAEGER-LECOULTRE';
  if (/^798\.\d/.test(r)) return 'JAEGER-LECOULTRE';
  if (/^800\.\d/.test(r)) return 'JAEGER-LECOULTRE';
  if (/^802\.\d/.test(r)) return 'JAEGER-LECOULTRE';
  if (/^804\.\d/.test(r)) return 'JAEGER-LECOULTRE';
  if (/^806\.\d/.test(r)) return 'JAEGER-LECOULTRE';
  if (/^808\.\d/.test(r)) return 'JAEGER-LECOULTRE';
  if (/^810\.\d/.test(r)) return 'JAEGER-LECOULTRE';
  if (/^812\.\d/.test(r)) return 'JAEGER-LECOULTRE';
  if (/^814\.\d/.test(r)) return 'JAEGER-LECOULTRE';
  if (/^816\.\d/.test(r)) return 'JAEGER-LECOULTRE';
  if (/^818\.\d/.test(r)) return 'JAEGER-LECOULTRE';
  if (/^820\.\d/.test(r)) return 'JAEGER-LECOULTRE';
  if (/^822\.\d/.test(r)) return 'JAEGER-LECOULTRE';
  if (/^824\.\d/.test(r)) return 'JAEGER-LECOULTRE';
  if (/^826\.\d/.test(r)) return 'JAEGER-LECOULTRE';
  if (/^828\.\d/.test(r)) return 'JAEGER-LECOULTRE';
  if (/^830\.\d/.test(r)) return 'JAEGER-LECOULTRE';
  if (/^832\.\d/.test(r)) return 'JAEGER-LECOULTRE';
  if (/^834\.\d/.test(r)) return 'JAEGER-LECOULTRE';
  if (/^836\.\d/.test(r)) return 'JAEGER-LECOULTRE';
  if (/^838\.\d/.test(r)) return 'JAEGER-LECOULTRE';
  if (/^840\.\d/.test(r)) return 'JAEGER-LECOULTRE';
  if (/^842\.\d/.test(r)) return 'JAEGER-LECOULTRE';
  if (/^844\.\d/.test(r)) return 'JAEGER-LECOULTRE';
  if (/^846\.\d/.test(r)) return 'JAEGER-LECOULTRE';
  if (/^848\.\d/.test(r)) return 'JAEGER-LECOULTRE';
  if (/^850\.\d/.test(r)) return 'JAEGER-LECOULTRE';
  if (/^852\.\d/.test(r)) return 'JAEGER-LECOULTRE';
  if (/^854\.\d/.test(r)) return 'JAEGER-LECOULTRE';
  if (/^856\.\d/.test(r)) return 'JAEGER-LECOULTRE';
  if (/^858\.\d/.test(r)) return 'JAEGER-LECOULTRE';
  if (/^860\.\d/.test(r)) return 'JAEGER-LECOULTRE';
  if (/^862\.\d/.test(r)) return 'JAEGER-LECOULTRE';
  if (/^864\.\d/.test(r)) return 'JAEGER-LECOULTRE';
  if (/^866\.\d/.test(r)) return 'JAEGER-LECOULTRE';
  if (/^868\.\d/.test(r)) return 'JAEGER-LECOULTRE';
  if (/^870\.\d/.test(r)) return 'JAEGER-LECOULTRE';
  if (/^872\.\d/.test(r)) return 'JAEGER-LECOULTRE';
  if (/^874\.\d/.test(r)) return 'JAEGER-LECOULTRE';
  if (/^876\.\d/.test(r)) return 'JAEGER-LECOULTRE';
  if (/^878\.\d/.test(r)) return 'JAEGER-LECOULTRE';
  if (/^880\.\d/.test(r)) return 'JAEGER-LECOULTRE';
  if (/^882\.\d/.test(r)) return 'JAEGER-LECOULTRE';
  if (/^884\.\d/.test(r)) return 'JAEGER-LECOULTRE';
  if (/^886\.\d/.test(r)) return 'JAEGER-LECOULTRE';
  if (/^888\.\d/.test(r)) return 'JAEGER-LECOULTRE';
  if (/^890\.\d/.test(r)) return 'JAEGER-LECOULTRE';
  if (/^892\.\d/.test(r)) return 'JAEGER-LECOULTRE';
  if (/^894\.\d/.test(r)) return 'JAEGER-LECOULTRE';
  if (/^896\.\d/.test(r)) return 'JAEGER-LECOULTRE';
  if (/^898\.\d/.test(r)) return 'JAEGER-LECOULTRE';
  if (/^900\.\d/.test(r)) return 'JAEGER-LECOULTRE';
  if (/^902\.\d/.test(r)) return 'JAEGER-LECOULTRE';
  if (/^904\.\d/.test(r)) return 'JAEGER-LECOULTRE';
  if (/^906\.\d/.test(r)) return 'JAEGER-LECOULTRE';
  if (/^908\.\d/.test(r)) return 'JAEGER-LECOULTRE';
  if (/^910\.\d/.test(r)) return 'JAEGER-LECOULTRE';
  if (/^912\.\d/.test(r)) return 'JAEGER-LECOULTRE';
  if (/^914\.\d/.test(r)) return 'JAEGER-LECOULTRE';
  if (/^916\.\d/.test(r)) return 'JAEGER-LECOULTRE';
  if (/^918\.\d/.test(r)) return 'JAEGER-LECOULTRE';
  if (/^920\.\d/.test(r)) return 'JAEGER-LECOULTRE';
  if (/^922\.\d/.test(r)) return 'JAEGER-LECOULTRE';
  if (/^924\.\d/.test(r)) return 'JAEGER-LECOULTRE';
  if (/^926\.\d/.test(r)) return 'JAEGER-LECOULTRE';
  if (/^928\.\d/.test(r)) return 'JAEGER-LECOULTRE';
  if (/^930\.\d/.test(r)) return 'JAEGER-LECOULTRE';
  if (/^932\.\d/.test(r)) return 'JAEGER-LECOULTRE';
  if (/^934\.\d/.test(r)) return 'JAEGER-LECOULTRE';
  if (/^936\.\d/.test(r)) return 'JAEGER-LECOULTRE';
  if (/^938\.\d/.test(r)) return 'JAEGER-LECOULTRE';
  if (/^940\.\d/.test(r)) return 'JAEGER-LECOULTRE';
  if (/^942\.\d/.test(r)) return 'JAEGER-LECOULTRE';
  if (/^944\.\d/.test(r)) return 'JAEGER-LECOULTRE';
  if (/^946\.\d/.test(r)) return 'JAEGER-LECOULTRE';
  if (/^948\.\d/.test(r)) return 'JAEGER-LECOULTRE';
  if (/^950\.\d/.test(r)) return 'JAEGER-LECOULTRE';
  if (/^952\.\d/.test(r)) return 'JAEGER-LECOULTRE';
  if (/^954\.\d/.test(r)) return 'JAEGER-LECOULTRE';
  if (/^956\.\d/.test(r)) return 'JAEGER-LECOULTRE';
  if (/^958\.\d/.test(r)) return 'JAEGER-LECOULTRE';
  if (/^960\.\d/.test(r)) return 'JAEGER-LECOULTRE';
  if (/^962\.\d/.test(r)) return 'JAEGER-LECOULTRE';
  if (/^964\.\d/.test(r)) return 'JAEGER-LECOULTRE';
  if (/^966\.\d/.test(r)) return 'JAEGER-LECOULTRE';
  if (/^968\.\d/.test(r)) return 'JAEGER-LECOULTRE';
  if (/^970\.\d/.test(r)) return 'JAEGER-LECOULTRE';
  if (/^972\.\d/.test(r)) return 'JAEGER-LECOULTRE';
  if (/^974\.\d/.test(r)) return 'JAEGER-LECOULTRE';
  if (/^976\.\d/.test(r)) return 'JAEGER-LECOULTRE';
  if (/^978\.\d/.test(r)) return 'JAEGER-LECOULTRE';
  if (/^980\.\d/.test(r)) return 'JAEGER-LECOULTRE';
  if (/^982\.\d/.test(r)) return 'JAEGER-LECOULTRE';
  if (/^984\.\d/.test(r)) return 'JAEGER-LECOULTRE';
  if (/^986\.\d/.test(r)) return 'JAEGER-LECOULTRE';
  if (/^988\.\d/.test(r)) return 'JAEGER-LECOULTRE';
  if (/^990\.\d/.test(r)) return 'JAEGER-LECOULTRE';
  if (/^992\.\d/.test(r)) return 'JAEGER-LECOULTRE';
  if (/^994\.\d/.test(r)) return 'JAEGER-LECOULTRE';
  if (/^996\.\d/.test(r)) return 'JAEGER-LECOULTRE';
  if (/^998\.\d/.test(r)) return 'JAEGER-LECOULTRE';
  return null;
}

function normDial(raw) {
  if (!raw) return 'UNKNOWN';
  const c = String(raw).trim().toUpperCase();
  return DIAL_ALIASES[c] || c;
}

function normCondition(raw) {
  if (!raw) return 'UNKNOWN';
  const c = String(raw).trim().toUpperCase();
  return CONDITION_ALIASES[c] || (['NEW', 'USED', 'LIKE NEW', 'UNKNOWN'].includes(c) ? c : 'UNKNOWN');
}

function normBrand(raw) {
  if (!raw) return 'Unknown';
  const c = String(raw).trim().toUpperCase();
  return BRAND_ALIASES[c] || c.split(' ').map(w => w.charAt(0) + w.slice(1).toLowerCase()).join(' ');
}

// ─── Stage A: Regex Extraction ───
function regexExtract(text) {
  const lower = text.toLowerCase();
  let brand = null, ref = null, dial = null, condition = null, year = null;
  let price = null, currency = null;

  // Brand detection with aliases
  if (/\bpp\b|patek|philippe/.test(lower)) brand = 'Patek Philippe';
  else if (/\bap\b|audemars|piguet/.test(lower)) brand = 'Audemars Piguet';
  else if (/\brm\b|richard\s*mille/.test(lower)) brand = 'Richard Mille';
  else if (/rolex/.test(lower)) brand = 'Rolex';
  else if (/vacheron|constantin/.test(lower)) brand = 'Vacheron Constantin';
  else if (/\bjlc\b|jaeger|lecoultre/.test(lower)) brand = 'Jaeger-LeCoultre';
  else if (/\blange\b|als\b|a\.\s*lange/.test(lower)) brand = 'A. Lange & Sohne';
  else if (/\bvc\b/.test(lower)) brand = 'Vacheron Constantin';
  else if (/\bparamigiani\b|pf\b|fleurier/.test(lower)) brand = 'Parmigiani Fleurier';
  else if (/\bomega\b/.test(lower)) brand = 'Omega';
  else if (/\bcartier\b/.test(lower)) brand = 'Cartier';
  else if (/\bhublot\b/.test(lower)) brand = 'Hublot';
  else if (/\bzenith\b/.test(lower)) brand = 'Zenith';
  else if (/\bpanerai\b/.test(lower)) brand = 'Panerai';
  else if (/\bbreguet\b/.test(lower)) brand = 'Breguet';
  else if (/\bblancpain\b/.test(lower)) brand = 'Blancpain';
  else if (/\bgirard|perregaux\b/.test(lower)) brand = 'Girard-Perregaux';
  else if (/\bulysse\b|nardin/.test(lower)) brand = 'Ulysse Nardin';
  else if (/\biwc\b/.test(lower)) brand = 'IWC';
  else if (/\btudor\b/.test(lower)) brand = 'Tudor';
  else if (/\btag\b|heuer/.test(lower)) brand = 'TAG Heuer';
  else if (/\bbreitling\b/.test(lower)) brand = 'Breitling';
  else if (/\bgrand\s*seiko\b/.test(lower)) brand = 'Grand Seiko';
  else if (/\bmoser\b/.test(lower)) brand = 'H. Moser & Cie';
  else if (/\broger\s*dubuis\b/.test(lower)) brand = 'Roger Dubuis';
  else if (/\bvan\s*cleef\b/.test(lower)) brand = 'Van Cleef & Arpels';
  else if (/\bgerald\s*genta\b/.test(lower)) brand = 'Gerald Genta';
  else if (/\bf\.p\.\s*journe\b|fpj\b/.test(lower)) brand = 'F.P. Journe';
  else if (/\bmb&f\b|maximilian/.test(lower)) brand = 'MB&F';

  const rmMatch = text.match(/\bRM\s?\d{2}[-\s]?\d{2}[A-Z]?\b/i);
  const ppMatch = text.match(/\b\d{4}\/\d{1,4}[A-Z]{0,2}(?:-\d{3})?\b/i);
  // AP: handle 'AP26650ti' (no space) and '26650ti' (with word boundary)
  const apMatch = text.match(/\b(?:AP)?\s*(\d{5}[A-Z]{2,4})\b/i);
  const rolexMatch = text.match(/\b\d{6}[A-Z]{0,4}\b/i);
  const parmigianiMatch = text.match(/\bPFC\d{3,4}[-.]\d{7,10}[-.]?\d{0,6}\b/i);
  const jlcMatch = text.match(/\bQ?\d{6}[A-Z]{0,4}\b/i);
  // VC: 4-5 digits + optional letters (e.g., 82035, 4300V)
  const vcMatch = text.match(/\b\d{4,5}[A-Z]{0,2}\b/i);

  // Price detection FIRST — so we can exclude price-looking numbers from ref candidates
  const kM = text.match(/\b(\d{1,3}(?:\.\d{1,2})?)\s?[kK]\b/);
  let kPrice = null;
  if (kM) kPrice = Math.round(parseFloat(kM[1]) * 1000);
  const pM = text.match(/([\d,]{3,})\s?(HKD|USD|USDT|EUR|hkd|usd|eur|usdt|\$|€)/i);
  let explicitPrice = null;
  if (pM) explicitPrice = parseInt(pM[1].replace(/,/g, ''), 10);

  // Build ref candidates, filtering out price-looking numbers
  const candidates = [];
  if (rmMatch) candidates.push({ ref: rmMatch[0].toUpperCase().replace(/\s/g, ''), source: 'rm' });
  if (parmigianiMatch) candidates.push({ ref: parmigianiMatch[0].toUpperCase(), source: 'parmigiani' });
  if (ppMatch) candidates.push({ ref: ppMatch[0].toUpperCase(), source: 'pp' });
  if (apMatch) candidates.push({ ref: apMatch[1].toUpperCase(), source: 'ap' });
  if (rolexMatch) candidates.push({ ref: rolexMatch[0].toUpperCase(), source: 'rolex' });
  if (jlcMatch) candidates.push({ ref: jlcMatch[0].toUpperCase(), source: 'jlc' });
  if (vcMatch && brand === 'Vacheron Constantin') candidates.push({ ref: vcMatch[0].toUpperCase(), source: 'vc' });

  // Filter: reject candidates that are just the explicit price or K-price
  const validCandidates = candidates.filter(c => {
    const numOnly = parseInt(c.ref.replace(/\D/g, ''), 10);
    if (explicitPrice && numOnly === explicitPrice) return false;
    if (kPrice && numOnly === kPrice) return false;
    // Reject if it looks like a year (2015-2026) + suffix
    if (/^20[12]\d[A-Z]+$/.test(c.ref)) return false;
    // Reject if it's just digits 4-6 chars with no letters (likely price)
    if (/^\d{4,6}$/.test(c.ref) && explicitPrice) return false;
    return true;
  });

  if (validCandidates.length > 0) {
    ref = validCandidates[0].ref;
  }

  // Fallback: generic match only if no specific match and not a price
  if (!ref) {
    const genericMatch = text.match(/\b\d{4,6}[\/\s-]?\d?[A-Z]{1,4}\b/i);
    if (genericMatch) {
      const gRef = genericMatch[0].toUpperCase();
      const gNum = parseInt(gRef.replace(/\D/g, ''), 10);
      if ((!explicitPrice || gNum !== explicitPrice) && (!kPrice || gNum !== kPrice) && !/^20[12]\d[A-Z]+$/.test(gRef)) {
        ref = gRef;
      }
    }
  }

  // Infer brand from reference if not found
  if (!brand && ref) {
    brand = inferBrandFromRef(ref);
  }

  const dialM = text.match(/\b(blue|black|green|white|brown|grey|gray|silver|pink|purple|red|orange|yellow|champagne|mop|mother\s*of\s*pearl|meteorite|diamond|gemset|rainbow|multi[\s-]?color|panda|hulk|tiffany|onyx|root\s*beer|cognac|ice\s*blue)\b/i);
  if (dialM) dial = dialM[1] || dialM[0];
  if (!dial && ref) {
    const su = ref.toUpperCase();
    if (su.endsWith('LN')) dial = 'Black';
    else if (su.endsWith('LB')) dial = 'Blue';
    else if (su.endsWith('LV')) dial = 'Green';
    else if (su.endsWith('CHNR')) dial = 'Brown';
    else if (su.endsWith('R') && !su.includes('RM') && !su.includes('OR')) dial = 'Brown';
    else if (su.endsWith('G') && !su.includes('GR') && !su.includes('RM')) dial = 'Blue';
    else if (su.endsWith('J')) dial = 'Champagne';
    else if (su.endsWith('P')) dial = 'Blue';
    else if (su.endsWith('ST')) dial = 'Blue';
    else if (su.endsWith('OR')) dial = 'Pink';
    else if (su.endsWith('TI')) dial = 'Grey';
    else if (su.endsWith('BC')) dial = 'Black';
  }

  if (/\bnew\b|unworn|bnib|sealed|full\s*set|full\s*sticker/i.test(text)) condition = 'New';
  else if (/\bused\b|pre[\s-]?owned|worn|vintage/i.test(text)) condition = 'Used';
  else if (/\bmint\b|excellent|near\s*mint/i.test(text)) condition = 'Like New';

  const yM = text.match(/\b(20[12]\d)\b/);
  if (yM) year = parseInt(yM[1], 10);

  // Price already detected earlier for ref filtering; reuse here
  let kPrice2 = null, explicitPrice2 = null;
  const kM2 = text.match(/\b(\d{1,3}(?:\.\d{1,2})?)\s?[kK]\b/);
  if (kM2) kPrice2 = Math.round(parseFloat(kM2[1]) * 1000);
  const pM2 = text.match(/([\d,]{3,})\s?(HKD|USD|USDT|EUR|hkd|usd|eur|usdt|\$|€)/i);
  if (pM2) explicitPrice2 = parseInt(pM2[1].replace(/,/g, ''), 10);

  price = kPrice2 || explicitPrice2 || price;
  if (pM2) {
    const cs = (pM2[2] || '').toUpperCase();
    if (cs === 'USD') currency = 'USD';
    else if (cs === 'HKD' || cs === 'HK$') currency = 'HKD';
    else if (cs === 'EUR' || cs === '€') currency = 'EUR';
    else if (cs === 'USDT') currency = 'USDT';
  }
  if (!currency) {
    if (/\bhkd\b|hk\$/i.test(text)) currency = 'HKD';
    else if (/\busdt\b/i.test(text)) currency = 'USDT';
    else if (/\beur\b|€/i.test(text)) currency = 'EUR';
    else if (/\bUSD\b|US\$|U\$/i.test(text)) currency = 'USD';
  }

  let confidence = 0;
  if (ref) confidence += 40;
  if (brand) confidence += 25;
  if (dial) confidence += 12;
  if (condition) confidence += 8;
  if (price) confidence += 8;
  if (year) confidence += 4;

  return { brand, ref, dial, condition, year, price, currency, confidence };
}

// ─── AI Parse ───
async function aiParse(kimiKey, rawMessage, currentGuess) {
  const systemPrompt = `You are an expert luxury watch cataloging assistant. Parse unstructured dealer chat messages and extract structured watch metadata.

Analyze the provided raw message and extract:
- reference: The clean, uppercase reference number (e.g., '126710GRNR', 'PFC914-1020001-100182').
- brand: The standardized brand name (e.g., 'Rolex', 'Patek Philippe', 'Parmigiani Fleurier').
- dialColor: The dial color (e.g., 'Green', 'Silver', 'White').
- condition: Standardized condition (e.g., 'New', 'Unworn', 'Used').
- year: The 4-digit year of the watch (if mentioned).
- price: The numeric price (if mentioned).
- currency: The currency code (USD, HKD, EUR, etc.).
- confidence: Your confidence 0-100.\n- image_urls: Array of image HTTP links found in the text.

Rules:
1. If the brand is omitted, return null. Catalog reconciliation may validate the reference later.
2. Map abbreviations: 'VC' -> 'Vacheron Constantin', 'AP' -> 'Audemars Piguet', 'PP' -> 'Patek Philippe', 'JLC' -> 'Jaeger-LeCoultre', 'AL&S' or 'Lange' -> 'A. Lange & Sohne'.
3. If the message is just generic noise (e.g., 'Brand New Rolex' with no model/reference), return null for reference.
4. Do not infer dial from a reference suffix. Return null unless the raw message states the dial.

${ZERO_HALLUCINATION_NORMALIZATION_CONTRACT}

Output MUST be a valid JSON object with these exact keys: reference, brand, dialColor, condition, year, price, currency, confidence, image_urls.`;

  const userPrompt = `Regex guess: ${JSON.stringify(currentGuess || {})}\nRaw message:\n"""\n${rawMessage}\n"""\nReturn ONLY valid JSON:`;

  const ctrl = new AbortController();
  setTimeout(() => ctrl.abort(), 18000);
  const r = await fetch(KIMI_API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${kimiKey}` },
    signal: ctrl.signal,
    body: JSON.stringify({
      model: 'kimi-k2.6', temperature: 0.1, max_tokens: 2048,
      messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: userPrompt }],
    }),
  });
  if (!r.ok) throw new Error(`Kimi ${r.status}`);
  const d = await r.json();
  const content = d.choices?.[0]?.message?.content || d.choices?.[0]?.message?.reasoning_content || '';
  const m = content.match(/\{[\s\S]*\}/);
  if (!m) throw new Error('No JSON');
  return JSON.parse(m[0]);
}

// ─── IQR helpers ───────────────────────────────────────────────────────────────

/**
 * Canonical IQR outlier test.
 * @param {number}   price      - Price under test (USD).
 * @param {number[]} prices     - Reference pool (USD).
 * @param {number}   [mult=3.0] - IQR fence multiplier (use 3 for Richard Mille).
 * @param {number}   [tol=0.10] - Tolerance fraction applied to clean min/max.
 * @returns {boolean}
 */
function priceIsOutlier(price, prices, mult = 3.0, tol = 0.10) {
  if (prices.length < 2) return false;
  const sorted = [...prices].sort((a, b) => a - b);
  const q1 = sorted[Math.floor(sorted.length * 0.25)];
  const q3 = sorted[Math.floor(sorted.length * 0.75)];
  const iqr = q3 - q1;
  const lowBound  = q1 - mult * iqr;
  const highBound = q3 + mult * iqr;
  const clean = sorted.filter(p => p >= lowBound && p <= highBound);
  if (clean.length < 2) return false;
  const cq1 = clean[Math.floor(clean.length * 0.25)];
  const cq3 = clean[Math.floor(clean.length * 0.75)];
  const ciqr = cq3 - cq1;
  const clow  = cq1 - mult * ciqr;
  const chigh = cq3 + mult * ciqr;
  // Tolerance band around the clean price range
  const minPrice = Math.min(...clean);
  const maxPrice = Math.max(...clean);
  const toleranceLow  = minPrice * (1 - tol);
  const toleranceHigh = maxPrice * (1 + tol);
  return (price < clow && price < toleranceLow) || (price > chigh && price > toleranceHigh);
}

/**
 * Canonical brand keys used for per-brand IQR pools.
 * All incoming brand strings are normalised to one of these keys.
 */
const BRAND_BUCKET_MAP = {
  'PATEK PHILIPPE':   'PATEK_PHILIPPE',
  'AUDEMARS PIGUET':  'AUDEMARS_PIGUET',
  'ROLEX':            'ROLEX',
  'RICHARD MILLE':    'RICHARD_MILLE',
};

function _brandBucketKey(brand) {
  const key = String(brand || '').trim().toUpperCase();
  return BRAND_BUCKET_MAP[key] || 'OTHER';
}

/**
 * Returns { mult, tol } — the IQR fence multiplier and tolerance fraction
 * appropriate for a given brand / reference combination.
 *
 * Rules:
 *  - RICHARD_MILLE  → mult = 3.0  (prices span $50k–$5 M)
 *  - PATEK_PHILIPPE high complications (52xx, 53xx, 57xx) → tol = 0.30 (20 pp on top of base 10 pp)
 *  - All others     → mult = 3.0, tol = 0.10 (default)
 */
function _iqrParams(brandBucket, ref) {
  if (brandBucket === 'RICHARD_MILLE') return { mult: 3.0, tol: 0.10 };
  if (brandBucket === 'PATEK_PHILIPPE') {
    const refNum = String(ref || '').replace(/[^0-9]/g, '').slice(0, 4);
    if (/^5[237]/.test(refNum)) return { mult: 3.0, tol: 0.30 }; // 52xx, 53xx, 57xx
  }
  return { mult: 3.0, tol: 0.10 };
}

/**
 * Brand-aware outlier check.  Builds per-brand (and optionally per-ref+dial)
 * price pools from the master catalog, then delegates to priceIsOutlier with
 * the correct fence parameters.
 *
 * @param {number} price        - Price under test (USD).
 * @param {string} brand        - Normalised brand name (e.g. 'Richard Mille').
 * @param {string} ref          - Reference number (e.g. 'RM11-03').
 * @param {object|null} catalogEntry - Entry returned by lookupRef(), or null.
 * @returns {{ outlier: boolean, pool: string, poolSize: number }}
 */
function priceIsOutlierBranded(price, brand, ref, catalogEntry) {
  const brandBucket = _brandBucketKey(brand);
  const { mult, tol } = _iqrParams(brandBucket, ref);

  // ── 1. Try ref+dial sub-bucket (existing per-entry logic) ──────────────────
  if (catalogEntry) {
    // Aggregate all dial prices for this exact reference
    const allRefPrices = [];
    for (const d of catalogEntry.dials.values()) allRefPrices.push(...d.prices);

    if (allRefPrices.length >= 2) {
      return {
        outlier:  priceIsOutlier(price, allRefPrices, mult, tol),
        pool:     `ref:${ref}`,
        poolSize: allRefPrices.length,
      };
    }
  }

  // ── 2. Fall back to brand-level pool built from the catalog ────────────────
  // We iterate the already-loaded catalog snapshot (synchronous — catalog is
  // cached after the first async load).  If the catalog hasn't loaded yet we
  // skip outlier detection rather than throw.
  if (!_catalog) {
    return { outlier: false, pool: 'brand:no-catalog', poolSize: 0 };
  }

  const { catalog } = _catalog;
  const brandKey = String(brand || '').trim().toUpperCase();
  const brandPrices = [];

  for (const [key, entry] of catalog) {
    // Catalog keys are `BRAND::REF` — match the BRAND prefix
    const entryBrand = key.split('::')[0];
    if (entryBrand === brandKey) {
      for (const d of entry.dials.values()) brandPrices.push(...d.prices);
    }
  }

  if (brandPrices.length >= 2) {
    return {
      outlier:  priceIsOutlier(price, brandPrices, mult, tol),
      pool:     `brand:${brandBucket}`,
      poolSize: brandPrices.length,
    };
  }

  // ── 3. Ultimate fallback — not enough data, never flag as outlier ──────────
  return { outlier: false, pool: 'brand:insufficient', poolSize: brandPrices.length };
}

// ─── Per-watch analysis ───
async function analyzeOne(chunk, ctx) {
  const stages = [];

  let parsed = regexExtract(chunk);
  let confidence = parsed.confidence;
  let aiAssisted = false;
  stages.push({ stage: 'PARSE', engine: 'regex', confidence, data: { ...parsed }, note: 'code-first extraction' });

  const needsAi = !parsed.ref || !parsed.brand || confidence < APPROVE_THRESHOLD;
  if (needsAi && ctx.kimiKey) {
    try {
      const ai = await aiParse(ctx.kimiKey, chunk, parsed);
      parsed = {
        brand: ai.brand || parsed.brand,
        ref: ai.reference || parsed.ref,
        dial: ai.dialColor || parsed.dial,
        condition: ai.condition || parsed.condition,
        year: ai.year ?? parsed.year,
        price: ai.price ?? parsed.price,
        currency: ai.currency || parsed.currency,
        image_urls: ai.image_urls || parsed.image_urls || [],
        confidence: Math.min(ai.confidence ?? confidence, 100),
      };
      aiAssisted = true;
      confidence = parsed.confidence;
      stages.push({ stage: 'AI_TEXT', engine: 'kimi-k2.6', confidence, data: { ...parsed }, note: 'AI parsed messy text' });
    } catch (e) {
      stages.push({ stage: 'AI_TEXT', engine: 'kimi-k2.6', confidence, error: e.message, note: 'AI parse failed' });
    }
  }

  const brand = normBrand(parsed.brand);
  const dialColor = normDial(parsed.dial);
  const condition = normCondition(parsed.condition);
  const currency = parsed.currency || null;
  const originalPrice = parsed.price;
  const year = parsed.year;

  let reference = parsed.ref || '';
  let family = 'OTHER';
  let materials = [];
  let catalogEntry = null;

  if (reference) {
    catalogEntry = await lookupRef(reference);
    if (catalogEntry) {
      reference = catalogEntry.ref;
      const patterns = [
        [/^571[12]|^5726|^5740|^5811|^5980|^5990|^7010|^7118/, 'NAUTILUS'],
        [/^516[47]|^5168|^526[178]|^5968|^5067/, 'AQUANAUT'],
        [/^49/, 'TWENTY~4'], [/^5205/, 'COMPLICATIONS'], [/^7300/, 'TWENTY~4'],
        [/^1263(34|33|31|00|03)|^1262(34|31|33|00|01)/, 'DATEJUST'],
        [/^126(50[0358]|51[89]|600|603|621|622|655|711|715|719|720)/, 'PROFESSIONAL'],
        [/^228(238|235|239|206|396)/, 'DAY-DATE'],
        [/^116(500|503|508|518|519|506|505)/, 'DAYTONA'],
        [/^155(10|51)|^15720|^262(40|31)|^26420|^265(74|79|86)|^15400|^15202|^16202|^26331|^26315|^773(51|50)|^77451|^676(51|50)/, 'ROYAL OAK'],
        [/^RM/, 'RM'],
        [/^4300|^4500|^6000|^7900|^82035|^4010|^81180|^85180/, 'PATRIMONY'],
        [/^PFC/, 'TONDA PF'],
        [/^Q\d|^137|^142|^344|^352|^412|^413|^504|^505|^508|^510|^527|^600|^604|^608|^620|^624|^628|^630|^634|^638|^640|^642|^644|^646|^648|^650|^652|^654|^656|^658|^660|^662|^664|^666|^668|^670|^672|^674|^676|^678|^680|^682|^684|^686|^688|^690|^692|^694|^696|^698|^700|^702|^704|^706|^708|^710|^712|^714|^716|^718|^720|^722|^724|^726|^728|^730|^732|^734|^736|^738|^740|^742|^744|^746|^748|^750|^752|^754|^756|^758|^760|^762|^764|^766|^768|^770|^772|^774|^776|^778|^780|^782|^784|^786|^788|^790|^792|^794|^796|^798|^800|^802|^804|^806|^808|^810|^812|^814|^816|^818|^820|^822|^824|^826|^828|^830|^832|^834|^836|^838|^840|^842|^844|^846|^848|^850|^852|^854|^856|^858|^860|^862|^864|^866|^868|^870|^872|^874|^876|^878|^880|^882|^884|^886|^888|^890|^892|^894|^896|^898|^900|^902|^904|^906|^908|^910|^912|^914|^916|^918|^920|^922|^924|^926|^928|^930|^932|^934|^936|^938|^940|^942|^944|^946|^948|^950|^952|^954|^956|^958|^960|^962|^964|^966|^968|^970|^972|^974|^976|^978|^980|^982|^984|^986|^988|^990|^992|^994|^996|^998/, 'MASTER CONTROL'],
      ];
      for (const [pat, fam] of patterns) {
        if (pat.test(reference)) { family = fam; break; }
      }
      const m = reference.toUpperCase();
      if (m.includes('ST')) materials.push('STEEL');
      if (m.includes('OR')) materials.push('ROSE GOLD');
      if (m.includes('R') && !m.includes('OR') && !m.includes('RM')) materials.push('ROSE GOLD');
      if (m.includes('G') && !m.includes('GR') && !m.includes('RM')) materials.push('WHITE GOLD');
      if (m.includes('PT')) materials.push('PLATINUM');
      if (m.includes('TI')) materials.push('TITANIUM');
      if (m.includes('BC')) materials.push('BLACK CERAMIC');
      if (m.includes('CE')) materials.push('CERAMIC');
      if (materials.length === 0) materials.push('STEEL');
      confidence = Math.max(confidence, 95);
      stages.push({ stage: 'CATALOG', engine: 'master_db', confidence, data: { reference, family, materials }, note: 'Verified in master catalog' });
    } else {
      stages.push({ stage: 'CATALOG', engine: 'master_db', confidence, data: { reference }, note: 'Unknown reference — not in catalog' });
      confidence = Math.min(confidence, 50);
    }
  } else {
    stages.push({ stage: 'CATALOG', engine: 'master_db', confidence, data: {}, note: 'Missing reference' });
    confidence = Math.min(confidence, 30);
  }

  let outlierFlag = null;
  if (originalPrice) {
    const usdPrice = toUSD(originalPrice, currency);
    const { outlier, pool, poolSize } = priceIsOutlierBranded(usdPrice, brand, reference, catalogEntry);
    if (poolSize >= 2) {
      if (outlier) {
        outlierFlag = 'PRICE_OUTLIER';
        confidence = Math.min(confidence, 60);
        stages.push({ stage: 'IQR', engine: 'statistical', confidence, data: { priceUSD: usdPrice, pool, poolSize }, note: `Price is IQR outlier [pool: ${pool}]` });
      } else {
        stages.push({ stage: 'IQR', engine: 'statistical', confidence, data: { priceUSD: usdPrice, pool, poolSize }, note: `Price within normal range [pool: ${pool}]` });
      }
    } else {
      stages.push({ stage: 'IQR', engine: 'statistical', confidence, data: { pool, poolSize }, note: `Insufficient data for IQR (${poolSize} < 2 points) [pool: ${pool}]` });
    }
  }

  const priceUSD = originalPrice && currency ? toUSD(originalPrice, currency) : null;
  stages.push({ stage: 'CURRENCY', engine: 'exchange', confidence, data: { originalPrice, currency, priceUSD, rate: currency ? _rates[currency] : null }, note: priceUSD == null ? 'Currency unresolved; conversion withheld' : `Converted ${currency} to USD` });

  const flags = [];
  if (!reference) flags.push('MISSING_REFERENCE');
  if (!catalogEntry) flags.push('UNKNOWN_REFERENCE');
  if (outlierFlag) flags.push(outlierFlag);
  if (confidence < 35) flags.push('LOW_CONFIDENCE');
  if (!originalPrice) flags.push('MISSING_PRICE');
  if (dialColor === 'UNKNOWN') flags.push('UNKNOWN_DIAL');

  const identified = !!reference && brand !== 'Unknown';
  let verdict, reason;
  if (!identified && confidence < RECYCLE_FLOOR) {
    verdict = 'RECYCLE';
    reason = 'Not enough information to identify the watch.';
  } else if (confidence >= APPROVE_THRESHOLD && identified && catalogEntry && originalPrice && currency && priceUSD && !outlierFlag && !aiAssisted) {
    verdict = 'APPROVED';
    reason = `High confidence (${Math.round(confidence)}%) — auto-approved.`;
  } else {
    verdict = 'HUMAN';
    reason = `Confidence ${Math.round(confidence)}% below ${APPROVE_THRESHOLD}% or flagged — route to human review.`;
  }

  return {
    input: chunk,
    parsed: { brand, reference, family, dialColor, condition, year, price: originalPrice, currency, priceUSD, materials, image_urls: parsed.image_urls || [] },
    confidence: Math.round(confidence),
    verdict,
    reason,
    flags,
    stages,
  };
}

// ─── Handler ───
module.exports = async function handler(req, res) {
  if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return res.status(405).json({ error: 'Method not allowed' }); }
  if (!requireServiceToken(req, res)) return;

  const { text } = req.body || {};
  if (!text || typeof text !== 'string' || !text.trim()) {
    return res.status(400).json({ error: 'text (string) required' });
  }
  if (text.length > 100_000) return res.status(413).json({ error: 'text exceeds 100,000 characters' });

  await refreshRates();
  const kimiKey = process.env.KIMI_API_KEY || process.env.MOONSHOT_API_KEY;
  const ctx = { kimiKey };

  // Multi-watch splitting: split on double newlines OR brand transitions within a line
  const rawChunks = text.split(/\n\s*\n+/).map(b => b.trim()).filter(Boolean);
  const chunks = [];
  const BRAND_TRANSITION_RE = /\b(?:rolex|patek|pp\b|audemars|ap\b|rm\b|richard\s+mille|vacheron|vc\b|cartier|omega|jaeger|jlc\b|lange|parmigiani|hublot|zenith|panerai|breguet|blancpain|girard|ulysse|iwc|tudor|tag\s+heuer|breitling|grand\s+seiko|moser|roger\s+dubuis|van\s+cleef|gerald\s+genta|fpj|f\.p\.\s+journe|mb&f)\b/gi;

  for (const raw of rawChunks) {
    // Find all brand positions in this chunk
    const positions = [];
    let m;
    while ((m = BRAND_TRANSITION_RE.exec(raw)) !== null) {
      positions.push(m.index);
    }
    BRAND_TRANSITION_RE.lastIndex = 0; // reset

    if (positions.length > 1) {
      // Split at each brand transition
      for (let i = 0; i < positions.length; i++) {
        const start = positions[i];
        const end = positions[i + 1] !== undefined ? positions[i + 1] : raw.length;
        const sub = raw.slice(start, end).trim();
        if (sub.length > 5) chunks.push(sub);
      }
    } else {
      chunks.push(raw);
    }
  }

  const capped = chunks.slice(0, 8);

  try {
    const results = await Promise.all(capped.map(chunk => analyzeOne(chunk, ctx)));
    const summary = {
      total: results.length,
      approved: results.filter(r => r.verdict === 'APPROVED').length,
      human: results.filter(r => r.verdict === 'HUMAN').length,
      recycle: results.filter(r => r.verdict === 'RECYCLE').length,
      threshold: APPROVE_THRESHOLD,
    };
    return res.status(200).json({ success: true, summary, watches: results });
  } catch (e) {
    console.error('[pipeline-parse]', e.message);
    return res.status(500).json({ error: e.message });
  }
};
