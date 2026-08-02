'use strict';

const UNKNOWN_DIALS = new Set([
  '', '-', '--', 'N/A', 'N A', 'NA', 'NONE', 'NULL', 'UNKNOWN', 'UNK', 'UNSPECIFIED',
  'NOT SPECIFIED', 'NOT AVAILABLE', 'NOT KNOWN', 'NO COLOR', 'UNKNOWN COLOR', 'UNKNOW',
  'UNKNOWS', 'UNKNOWS COLOR', 'OTHER', 'COLOR DIAL', 'DIAL COLOR',
  'MULTIPLE', 'MULTI', 'MIXED',
]);

// Only spelling and dealer-shorthand aliases belong here. Market-significant
// variants (Tiffany Blue, Champagne, Salmon, Panda, Meteorite, etc.) stay distinct.
const DIAL_ALIASES = new Map([
  ['GRAY', 'Grey'],
  ['GREY', 'Grey'],
  ['MOP', 'Mother of Pearl'],
  ['M.O.P', 'Mother of Pearl'],
  ['M O P', 'Mother of Pearl'],
  ['MOTHER OF PEARL', 'Mother of Pearl'],
  ['MOTHER-OF-PEARL', 'Mother of Pearl'],
  ['MOTHER OF PEARL DIAL', 'Mother of Pearl'],
  ['CHOCO', 'Chocolate'],
  ['CHOC', 'Chocolate'],
  ['CHOCOLATE', 'Chocolate'],
  ['TIFFANY', 'Tiffany Blue'],
  ['TIFFANY BLUE', 'Tiffany Blue'],
  ['ICEBLUE', 'Ice Blue'],
  ['ICE BLUE', 'Ice Blue'],
  ['REVERSE PANDA', 'Reverse Panda'],
  ['PANDA', 'Panda'],
  ['MOP WHITE', 'White Mother of Pearl'],
  ['WHITE MOP', 'White Mother of Pearl'],
  ['BLK', 'Black'],
  ['BK', 'Black'],
  ['WHT', 'White'],
  ['BLU', 'Blue'],
  ['GRN', 'Green'],
  ['GRENN', 'Green'],
  ['GREEEN', 'Green'],
  ['GERY', 'Grey'],
  ['SLIVER', 'Silver'],
  ['CHAMP', 'Champagne'],
  ['METE', 'Meteorite'],
  ['TIFF', 'Tiffany Blue'],
  ['TIFFANI', 'Tiffany Blue'],
  ['TIFFINI', 'Tiffany Blue'],
  ['TB', 'Tiffany Blue'],
  ['WIM', 'Wimbledon'],
  ['WIMB', 'Wimbledon'],
  ['WIN', 'Wimbledon'],
  ['WIMBELDON', 'Wimbledon'],
  ['CANDY', 'Candy Pink'],
  ['PISTA', 'Pistachio'],
  ['PISTACHO', 'Pistachio'],
  ['PISTSCHIO', 'Pistachio'],
  ['PIS', 'Pistachio'],
  ['CELE', 'Celebration'],
  ['CELEB', 'Celebration'],
  ['OMBR', 'Ombre'],
  ['OMBER', 'Ombre'],
  ['YML', 'Yellow Mother of Pearl'],
  ['PAVED', 'Pave'],
  ['RALNBOW', 'Rainbow'],
  ['AVENTUINE', 'Aventurine'],
  ['EISENKISSEL', 'Eisenkiesel'],
  ['EISIKINSELL', 'Eisenkiesel'],
]);

const KNOWN_DIAL_TERMS = [
  'White Mother of Pearl', 'Black Mother of Pearl', 'Mother of Pearl',
  'Reverse Panda', 'Tiffany Blue', 'Ombre Green', 'Ice Blue', 'Olive Green',
  'Sunburst Blue', 'Sunburst Black', 'Champagne', 'Meteorite', 'Skeleton',
  'Candy Pink', 'Pistachio', 'Wimbledon', 'Sundust', 'Celebration', 'Pave',
  'Rainbow', 'Aventurine', 'Eisenkiesel', 'Carnelian', 'Onyx', 'Rhodium',
  'Ivory', 'Opal', 'Puzzle', 'Coffee', 'Smoke', 'Zebra', 'Multicolour',
  'Yellow Mother of Pearl', 'Salmon', 'Chocolate', 'Anthracite', 'Burgundy', 'Lavender', 'Turquoise',
  'Panda', 'Copper', 'Bronze', 'Silver', 'Black', 'Blue', 'White', 'Grey',
  'Green', 'Brown', 'Pink', 'Purple', 'Yellow', 'Orange', 'Red', 'Gold',
  'Beige', 'Slate', 'Diamond',
];

function cleanDialText(value) {
  return String(value ?? '')
    .replace(/[\u2010-\u2015]/g, '-')
    .replace(/[_/]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function comparisonKey(value) {
  return cleanDialText(value).toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim();
}

function titleCase(value) {
  return cleanDialText(value).toLowerCase().replace(/\b\w/g, char => char.toUpperCase());
}

function normalizeDialValue(raw) {
  const cleaned = cleanDialText(raw).replace(/\s+DIAL$/i, '').trim();
  const key = comparisonKey(cleaned);
  if (!key || UNKNOWN_DIALS.has(key)) {
    return { value: null, known: false, changed: Boolean(cleaned), reason: 'placeholder' };
  }
  const canonical = DIAL_ALIASES.get(key) || titleCase(cleaned);
  return {
    value: canonical,
    known: true,
    changed: comparisonKey(canonical) !== comparisonKey(raw),
    reason: DIAL_ALIASES.has(key) ? 'alias' : 'canonical',
  };
}

function uniqueCatalogDials(values) {
  const unique = new Map();
  const sourceValues = Array.isArray(values) ? values : (values == null ? [] : [values]);
  for (const raw of sourceValues) {
    // Catalog imports occasionally store comma-delimited values in one cell.
    for (const part of String(raw || '').split(/[,;|]/)) {
      const normalized = normalizeDialValue(part);
      if (normalized.known) unique.set(comparisonKey(normalized.value), normalized.value);
    }
  }
  return [...unique.values()];
}

function containsTerm(text, term) {
  const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+');
  return new RegExp(`(?:^|[^a-z0-9])${escaped}(?:\\s+dial)?(?:$|[^a-z0-9])`, 'i').test(text);
}

function containsExplicitDialTerm(text, term) {
  const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+');
  return new RegExp(
    `(?:\\bdial\\s*[:=-]?\\s*${escaped}\\b|\\b${escaped}\\s+dial\\b)`,
    'i',
  ).test(text);
}

function extractDialFromText(rawText, catalogDials = []) {
  const text = cleanDialText(rawText);
  if (!text) return null;
  const catalogCandidates = uniqueCatalogDials(catalogDials).sort((a, b) => b.length - a.length);
  const genericCandidates = KNOWN_DIAL_TERMS.sort((a, b) => b.length - a.length);
  const seen = new Set();
  for (const candidate of catalogCandidates) {
    const normalized = normalizeDialValue(candidate);
    const key = comparisonKey(normalized.value);
    if (!normalized.known || seen.has(key)) continue;
    seen.add(key);
    if (containsTerm(text, candidate)) return normalized.value;
  }
  // Without catalog support, require an explicit "blue dial" or "dial: blue"
  // phrase. This prevents case, bezel, bracelet and strap colors from being
  // promoted into dial_color.
  for (const candidate of genericCandidates) {
    const normalized = normalizeDialValue(candidate);
    const key = comparisonKey(normalized.value);
    if (!normalized.known || seen.has(key)) continue;
    seen.add(key);
    if (containsExplicitDialTerm(text, candidate)) return normalized.value;
  }
  return null;
}

function alignDealerDialAliasToCatalog(value, catalogDials = []) {
  const key = comparisonKey(value);
  const catalog = uniqueCatalogDials(catalogDials);
  const catalogKeys = new Set(catalog.map(comparisonKey));
  if (key === 'PANDA' && (catalogKeys.has('WHITE') || catalogKeys.has('SILVER')) && !catalogKeys.has('PANDA')) {
    return { value: 'White', reason: 'raw_alias_panda_to_white' };
  }
  return { value, reason: null };
}

function resolveDial({ sourceDial, rawText, catalogDials = [] }) {
  const source = normalizeDialValue(sourceDial);
  const catalog = uniqueCatalogDials(catalogDials);
  const fromText = extractDialFromText(rawText, catalog);

  if (fromText) {
    const aligned = alignDealerDialAliasToCatalog(fromText, catalog);
    const conflictsWithSource = source.known && comparisonKey(source.value) !== comparisonKey(aligned.value);
    return {
      value: aligned.value,
      evidence: 'explicit_raw_text',
      confidence: 95,
      ambiguous: conflictsWithSource,
      reason: conflictsWithSource ? 'source_text_conflict' : aligned.reason,
    };
  }
  if (source.known) {
    return { value: source.value, evidence: 'source_record', confidence: 80, ambiguous: false, reason: null };
  }
  if (catalog.length === 1) {
    return { value: catalog[0], evidence: 'exact_catalog_single_dial', confidence: 90, ambiguous: false, reason: null };
  }
  if (catalog.length > 1) {
    return { value: null, evidence: 'exact_catalog_multiple_dials', confidence: 0, ambiguous: true, reason: 'multiple_catalog_dials' };
  }
  return { value: null, evidence: null, confidence: 0, ambiguous: false, reason: 'no_dial_evidence' };
}

module.exports = {
  comparisonKey,
  extractDialFromText,
  alignDealerDialAliasToCatalog,
  normalizeDialValue,
  resolveDial,
  uniqueCatalogDials,
};
