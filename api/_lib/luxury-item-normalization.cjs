'use strict';

const { extractReference, inferBrandFromReference } = require('./normalization-v4.cjs');

const LUXURY_BRANDS = [
  ['Van Cleef & Arpels', /\b(?:van\s+cleef(?:\s*&\s*arpels)?|vca)\b/i],
  ['Louis Vuitton', /\b(?:louis\s+vuitton|lv)\b/i],
  ['Tiffany & Co.', /\btiffany(?:\s*&\s*co\.?)?\b/i],
  ['Bottega Veneta', /\bbottega\s+veneta\b/i],
  ['Harry Winston', /\bharry\s+winston\b/i],
  ['David Yurman', /\bdavid\s+yurman\b/i],
  ['David Webb', /\bdavid\s+webb\b/i],
  ['Oscar Heyman', /\boscar\s+heyman\b/i],
  ['Seaman Schepps', /\bseaman\s+schepps\b/i],
  ['Henry Dunay', /\bhenry\s+dunay\b/i],
  ['Elizabeth Gage', /\belizabeth\s+gage\b/i],
  ['Judith Ripka', /\bjudith\s+ripka\b/i],
  ['Marco Bicego', /\bmarco\s+bicego\b/i],
  ['Roberto Coin', /\broberto\s+coin\b/i],
  ['Pasquale Bruni', /\bpasquale\s+bruni\b/i],
  ['Marina B', /\bmarina\s+b\b/i],
  ['Mikimoto', /\bmikimoto\b/i],
  ['Bucherer', /\bbucherer\b/i],
  ['Pomellato', /\bpomellato\b/i],
  ['Chaumet', /\bchaumet\b/i],
  ['Messika', /\bmessika\b/i],
  ['Damiani', /\bdamiani\b/i],
  ['Kwiat', /\bkwiat\b/i],
  ['Verdura', /\bverdura\b/i],
  ['Piaget', /\bpiaget\b/i],
  ['OMAS', /\bomas\b/i],
  ['Hermes', /\bherm[eèé]s\b/i],
  ['Chanel', /\bchanel\b/i],
  ['Goyard', /\bgoyard\b/i],
  ['Christian Dior', /\b(?:christian\s+)?dior\b/i],
  ['Gucci', /\bgucci\b/i],
  ['Prada', /\bprada\b/i],
  ['Fendi', /\bfendi\b/i],
  ['Bulgari', /\b(?:bulgari|bvlgari)\b/i],
  ['Cartier', /\bcartier\b/i],
  ['Chopard', /\bchopard\b/i],
  ['Graff', /\bgraff\b/i],
  ['Buccellati', /\bbuccellati\b/i],
];

const TYPE_PATTERNS = {
  HANDBAG: [
    ['Birkin', /\bbirkin\b/i], ['Kelly', /\bkelly\b/i], ['Handbag', /\bhand\s*bag\b/i],
    ['Purse', /\bpurse\b/i], ['Tote', /\btote\b/i], ['Clutch', /\bclutch\b/i],
    ['Shoulder bag', /\bshoulder\s+bag\b/i], ['Crossbody bag', /\bcrossbod(?:y|ies)\b/i],
    ['Satchel', /\bsatchel\b/i], ['Travel bag', /\b(?:duffle|travel\s+bag)\b/i],
    ['Pochette', /\bpochette\b/i],
  ],
  JEWELRY: [
    ['Necklace', /\bnecklace\b/i], ['Earrings', /\bearrings?\b/i], ['Pendant', /\bpendant\b/i],
    ['Brooch', /\bbrooch(?:es)?\b/i], ['Anklet', /\banklet\b/i], ['Ring', /\bring\b/i],
    ['Wedding band', /\bwedding\s+band\b/i], ['Bracelet', /\bbracelet\b/i],
    ['Bangle', /\bbangle\b/i], ['Chain', /\b(?:gold\s+)?chain\b/i],
  ],
  ACCESSORY: [
    ['Wallet', /\bwallet\b/i], ['Card holder', /\bcard\s+holder\b/i], ['Belt', /\bbelt\b/i],
    ['Sunglasses', /\bsunglasses\b/i], ['Cufflinks', /\bcufflinks?\b/i],
    ['Fountain pen', /\bfountain\s+pen\b/i], ['Lighter', /\blighter\b/i],
    ['Scarf', /\bscar(?:f|ves)\b/i], ['Silk tie', /\bsilk\s+tie\b/i],
    ['Key holder', /\bkey\s+holder\b/i],
  ],
};

const CANONICAL_BRAND_ALIASES = new Map([
  ['HERMES', 'Hermès'],
  ['HERMÈS', 'Hermès'],
  ['HERMÉ̀S', 'Hermès'],
  ['BVLGARI', 'Bvlgari'],
  ['BULGARI', 'Bvlgari'],
  ['TIFFANY', 'Tiffany & Co.'],
  ['TIFFANY & CO', 'Tiffany & Co.'],
  ['TIFFANY & CO.', 'Tiffany & Co.'],
  ['VAN CLEEF', 'Van Cleef & Arpels'],
  ['VCA', 'Van Cleef & Arpels'],
  ['DIOR', 'Christian Dior'],
]);

function clean(value) {
  const result = value == null ? '' : String(value).replace(/\s+/g, ' ').trim();
  return result || null;
}

function sourceText(source = {}) {
  const raw = source.raw_data || {};
  return [raw.brand, raw.maker, raw.title, raw.model, raw.description, raw.comments, source.raw_message]
    .map(clean).filter(Boolean).join('\n');
}

function canonicalizeLuxuryBrand(value) {
  const supplied = clean(value);
  if (!supplied) return null;
  return CANONICAL_BRAND_ALIASES.get(supplied.toUpperCase()) || supplied;
}

function inferSignatureMaison(source = {}, category) {
  if (String(category || '').toUpperCase() !== 'HANDBAG') return null;
  const text = sourceText(source);
  if (/\bbirkin\b|\bconstance\b/i.test(text)) return 'Hermès';
  if (/\bkelly\b/i.test(text)
    && /\b(?:bag|mini|togo|epsom|chevre|mysore|hardware|stamp|hwd)\b/i.test(text)) return 'Hermès';
  return null;
}

function inferLuxuryBrand(source = {}) {
  const raw = source.raw_data || {};
  const supplied = canonicalizeLuxuryBrand(raw.brand || raw.maker);
  if (supplied) return supplied;
  const text = sourceText(source);
  return canonicalizeLuxuryBrand(LUXURY_BRANDS.find(([, pattern]) => pattern.test(text))?.[0])
    || inferSignatureMaison(source, raw.category || source.category)
    || null;
}

function inferLuxuryItemType(source = {}, category) {
  const text = sourceText(source);
  return (TYPE_PATTERNS[String(category || '').toUpperCase()] || [])
    .find(([, pattern]) => pattern.test(text))?.[0] || null;
}

function inferLuxuryCondition(source = {}) {
  const text = sourceText(source);
  if (/\b(?:brand\s+new|new\s+in\s+box|bnib|unworn)\b/i.test(text)) return 'New';
  if (/\b(?:like\s+new|lnib|mint)\b/i.test(text)) return 'Used - Like New';
  if (/\b(?:excellent|very\s+good)\b/i.test(text)) return 'Used - Good';
  if (/\b(?:fair|worn|visible\s+wear)\b/i.test(text)) return 'Used - Fair';
  if (/\b(?:pre[- ]?owned|used)\b/i.test(text)) return 'Used';
  return null;
}

function matchedLuxuryCategories(source = {}) {
  const text = sourceText(source);
  return Object.entries(TYPE_PATTERNS)
    .filter(([, patterns]) => patterns.some(([, pattern]) => pattern.test(text)))
    .map(([category]) => category);
}

function hasWholeWatchEvidence(source = {}) {
  const text = sourceText(source);
  const namedWatch = /\b(?:rolex|rlx|patek|aquanaut|nautilus|vacheron|audemars|royal\s+oak|richard\s+mille|panerai|hublot|omega|iwc|zenith|datejust|daytona|submariner|(?:pam|rm|vc|ap)\s*[-:]?\s*\d{2,})\b/i;
  const reference = /\b(?:\d{5,6}[A-Z]{0,3}|(?:VC|AP)\s*[-:]?\s*\d{4,}[A-Z]*|\d{4}[A-Z]\/\d[A-Z])\b/i;
  const watchContext = /\b(?:watch|full\s+set|box\s*(?:and|&)\s*papers|dial|bezel|movement|quartz|crystal|steel\s+links?|deployment\s+clasp|strap|papers?\s+(?:and|&)\s+wallet|card\s+(?:and|&)\s+wallet)\b/i;
  const extractedReference = extractReference(text);
  return Boolean(inferBrandFromReference(extractedReference))
    || namedWatch.test(text)
    || (reference.test(text) && watchContext.test(text));
}

function luxuryIdentityEligibility(source = {}, category) {
  const normalizedCategory = String(category || '').toUpperCase();
  const itemType = inferLuxuryItemType(source, normalizedCategory);
  const categoryMatches = matchedLuxuryCategories(source);
  const reasons = [];
  if (!itemType) reasons.push('MISSING_EXPLICIT_ITEM_TYPE');
  if (categoryMatches.some(match => match !== normalizedCategory)) reasons.push('CROSS_CATEGORY_ITEM_TERMS');
  if (hasWholeWatchEvidence(source)) reasons.push('WHOLE_WATCH_EVIDENCE');
  return { eligible: reasons.length === 0, item_type: itemType, reasons };
}

function normalizeLuxuryIdentity(source = {}, category) {
  const raw = source.raw_data || {};
  const itemType = inferLuxuryItemType(source, category);
  const suppliedTitle = clean(raw.model || raw.title);
  const brand = inferLuxuryBrand({ ...source, category, raw_data: { ...raw, category } });
  const sourceDescription = suppliedTitle || clean(source.raw_message);
  const titleLooksLikeRawMessage = Boolean(sourceDescription)
    && (sourceDescription.length > 120
      || (sourceDescription.length > 80
        && /\b(?:wts|wtb|want\s+to\s+buy|looking\s+for|for\s+sale|available)\b/i.test(sourceDescription))
      || /[\r\n]|(?:^|\s)(?:price|delivery|shipping)\s*[:\-]|[$€£¥₩₹]/i.test(sourceDescription));
  const normalizedName = [brand, itemType].filter(Boolean).join(' ') || itemType || null;
  return {
    brand,
    model: titleLooksLikeRawMessage ? normalizedName : (suppliedTitle || normalizedName),
    reference: clean(raw.reference || raw.normalized_reference || raw.sku || raw.style_number),
    condition: inferLuxuryCondition(source),
    luxury_item_name: titleLooksLikeRawMessage ? normalizedName : (suppliedTitle || normalizedName),
    luxury_item_type: itemType,
    source_item_description: sourceDescription,
    maker_evidence_status: brand ? 'SOURCE_OR_SIGNATURE_EVIDENCE' : 'MISSING_REVIEW_REQUIRED',
  };
}

module.exports = {
  LUXURY_BRANDS,
  TYPE_PATTERNS,
  canonicalizeLuxuryBrand,
  inferLuxuryBrand,
  inferLuxuryCondition,
  inferLuxuryItemType,
  hasWholeWatchEvidence,
  luxuryIdentityEligibility,
  matchedLuxuryCategories,
  normalizeLuxuryIdentity,
  sourceText,
};
