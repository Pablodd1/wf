/**
 * WatchFacts — Semantic Watch Parser v4.0
 * ===============================================
 * Extracts structured watch data from free-text dealer messages
 * received via WhatsApp / Telegram. Handles luxury brands, multi-format
 * prices, conditions, references, emoji/flags, and multi-watch listings.
 *
 * v3: WhatsApp format support — emoji stripping, section header detection,
 *     HKD/K/M price formats, N5-N1 condition grading, MM/YYYY year parsing.
 * v3.1-patch1: NORM_001-004 + 5 listing overrides
 * v4.0: Intent-first parsing (WTB/WTT before price), $5M hard cap,
 *       section header rejection, expanded price-ref collision detection,
 *       dial color TitleCase normalization, verdict re-evaluation.
 *
 * CommonJS — runs in Vercel serverless and local Node scripts.
 */

'use strict';

// ═══════════════════════════════════════════════════════════════
// CATALOG MATCHER — wired in at module load time
// ═══════════════════════════════════════════════════════════════
const { lookupCatalog } = require('./catalog-matcher');

// ═══════════════════════════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════════════════════════

// Dynamic thresholds — can be overridden via env vars
function getApproveThreshold() {
  const env = process.env.APPROVE_THRESHOLD;
  return env ? parseInt(env, 10) : 85;
}

function getHumanThreshold() {
  const env = process.env.HUMAN_THRESHOLD;
  return env ? parseInt(env, 10) : 70;
}

/** Threshold above which a parse is auto-approved. */
const APPROVE_THRESHOLD = getApproveThreshold();

/** Threshold above which a parse passes; below lands in human review. */
const HUMAN_THRESHOLD = getHumanThreshold();

/** Currency conversion rates → USD. */
const RATES = {
  USD:  1.0,
  USDT: 1.0,
  HKD:  0.128,
  EUR:  1.08,
  GBP:  1.27,
  CHF:  1.13,
  SGD:  0.74,
  AUD:  0.65,
  CAD:  0.73,
  JPY:  0.0066,
  CNY:  0.138,
  RMB:  0.138,
};

/** Brands we know how to detect, with aliases and extraction rules. */
const { validateReference } = require('./reference-catalog.js');

const BRAND_MAP = [
  { names: ['patek philippe', 'patek', 'pp', '百达翡丽', '百達翡麗'], canon: 'Patek Philippe' },
  { names: ['rolex', '劳力士', '勞力士'],                  canon: 'Rolex' },
  { names: ['audemars piguet', 'audemars', 'ap', '爱彼', '愛彼'], canon: 'Audemars Piguet' },
  { names: ['richard mille', 'rm', 'richardmille', '理查德米勒', '理查德米爾'], canon: 'Richard Mille' },
  { names: ['vacheron constantin', 'vacheron', 'vc', '江诗丹顿', '江詩丹頓'], canon: 'Vacheron Constantin' },
  { names: ['breitling', '百年灵', '百年靈'],              canon: 'Breitling' },
  { names: ['a. lange & sohne', 'a.lange', 'lange', 'alange', '朗格'], canon: 'A. Lange & Sohne' },
  { names: ['mb&f', 'mbf', 'max busser'],              canon: 'MB&F' },
  { names: ['omega', '欧米茄', '歐米茄'],                  canon: 'Omega' },
  { names: ['cartier', '卡地亚', '卡地亞', 'santos', 'tank', 'ballon bleu', 'ballonbleu', 'pasha', 'ronde', 'calibre de cartier', 'crb', 'wsr'], canon: 'Cartier' },
  { names: ['iwc', '万国', '萬國'],                        canon: 'IWC' },
  { names: ['jaeger-lecoultre', 'jaeger', 'jlc', 'jl', '积家', '積家'], canon: 'Jaeger-LeCoultre' },
  { names: ['hublot', '宇舶'],                           canon: 'Hublot' },
  { names: ['tag heuer', 'tagheuer', '泰格豪雅'],         canon: 'TAG Heuer' },
  { names: ['zenith', '真力时', '真力時'],                  canon: 'Zenith' },
  { names: ['blancpain', '宝珀', '寶珀'],                  canon: 'Blancpain' },
  { names: ['breguet', '宝玑', '寶璣'],                    canon: 'Breguet' },
  { names: ['tudor', '帝舵'],                             canon: 'Tudor' },
  { names: ['grand seiko', 'grandseiko', 'gs', '冠蓝狮', '冠藍獅'], canon: 'Grand Seiko' },
  { names: ['seiko', '精工'],                            canon: 'Seiko' },
  { names: ['glashutte original', 'glashutte', 'glas hutte', 'glasshutte', '格拉苏蒂'], canon: 'Glashutte Original' },
  { names: ['panerai', '沛纳海', '沛納海'],                 canon: 'Panerai' },
  { names: ['ulysse nardin', 'ulysse', '雅典'],           canon: 'Ulysse Nardin' },
  { names: ['girard-perregaux', 'girard perregaux', '芝柏'], canon: 'Girard-Perregaux' },
  { names: ['fp journe', 'f.p.journe', 'journe', 'fpj'], canon: 'F.P. Journe' },
  { names: ['de bethune', 'debethune'],                canon: 'De Bethune' },
  { names: ['greubel forsey', 'greubelforsey'],        canon: 'Greubel Forsey' },
  { names: ['ferrari'],                                canon: 'Ferrari' },
  { names: ['bulgari', 'bvlgari'],                     canon: 'Bulgari' },
  { names: ['franck muller', 'franckmuller', 'fm '],   canon: 'Franck Muller' },
  { names: ['chopard'],                                canon: 'Chopard' },
  { names: ['hermes', 'hermès', 'hermés'],              canon: 'Hermes' },
  { names: ['roger dubuis', 'rogerdubuis', 'rddbex'],  canon: 'Roger Dubuis' },
  { names: ['bell & ross', 'bell and ross', 'bellross', 'b&r'], canon: 'Bell & Ross' },
  { names: ['longines'],                               canon: 'Longines' },
  { names: ['montblanc', 'mont blanc'],                canon: 'Montblanc' },
];

/** Individual listing overrides — known correction cases */
const LISTING_OVERRIDES = {
  // Bvlgari Serpenti incorrectly classified as Rolex
  '101910': { brand: 'Bulgari', model: 'Serpenti Tubogas', price_usd: 12500.00, category: 'WATCH' },
  // Richard Mille RM30-01 in Patek Philippe bulk dump
  'RM30-01': { brand: 'Richard Mille', model: 'RM30-01 Le Mans', price_usd: 268000.00, category: 'WATCH' },
  // Reference vs price conflict: 126301 mapped to $126,301
  '126301': { price_validation: true, note: 'Reference number mapped to price' },
  // Gucci bag incorrectly listed as Rolex
  '774209': { brand: 'Gucci', model: 'Horsebit 1955', category: 'OTHER', nonWatch: true },
};

/** Reference patterns per brand family. */
const REF_PATTERNS = [
  // Patek Philippe — e.g. 5712/1A-001, 5236P, 6300A, 7118, 7300, bare 5711
  { regex: /\b([34567]\d{3}[A-Z]?[\/\-]?[0-9A-Z]{0,4}[\-–]?[0-9A-Z]{0,5})\b/i, brandHint: 'Patek Philippe' },
  // Rolex — e.g. 126529, 116500LN, 228238, 124060
  // v4.1: Also match "116500 L.N", "116500 L N" (dealer variations with separators)
  // Use [ \t] instead of \s to avoid matching across newlines
  { regex: /\b(\d{5,6}[ \t]?[A-Z][ \t._]?[A-Z]?)\b/i, brandHint: 'Rolex' },
  { regex: /\b(\d{5,6}[A-Z]{0,4})\b/i, brandHint: 'Rolex' },
  // AP Royal Oak / Offshore — e.g. 15210ST, 26420SO, 26240OR
  { regex: /\b(\d{5}[A-Z]{2,4}\.?\d{0,2})\b/i, brandHint: 'Audemars Piguet' },
  // Richard Mille — e.g. RM07-01, RM11-03, RM35-02, RM030-01
  { regex: /\b(RM\s?\d{2,3}[-–]?\d{2,3})(?:\s|$|[A-Z]?\b)/i, brandHint: 'Richard Mille' },
  // Vacheron — e.g. 4300V/220R, 6000V, 85180
  // Must contain V or / to avoid matching years like 2019Y
  { regex: /\b(\d{4,5}[Vv]\/?\d{0,3}[A-Za-z]{0,3})\b/i, brandHint: 'Vacheron Constantin' },
  // F.P. Journe — CS (Chronometre Souveau), RS, CE, LB, etc.
  { regex: /\b(CS|RS|CE|LB|LC)\b/i, brandHint: 'F.P. Journe' },
  // Omega — e.g. 145.022-69, 311.30.42, 210.30.42
  // Also multi-segment: 123.10.35.20.01.001, 2221.80.00
  { regex: /\b(\d{3}\.\d{3}[\-–]?\d{0,2})\b/, brandHint: 'Omega' },
  { regex: /\b(\d{3}(?:\.\d{2,3})+)\b/, brandHint: 'Omega' },
  { regex: /\b(\d{4}\.\d{2,3}\.\d{2,3})\b/, brandHint: 'Omega' },
  // JLC — e.g. Q397846J, Q4102520
  { regex: /\b(Q\d{6,7}[A-Z]?)\b/i, brandHint: 'Jaeger-LeCoultre' },
  // IWC — e.g. IW371615, IW324005
  { regex: /\b(IW\d{5,7}[A-Z]?)\b/i, brandHint: 'IWC' },
  // Cartier — e.g. W51007Q4, WSR, CRB, W2
  { regex: /\b(W\d{5,7}[A-Z]{0,3})\b/i, brandHint: 'Cartier' },
  { regex: /\b((?:WSR|CRB|CRO|WTB|WEA|W2)\d{4,6}[A-Z]?)\b/i, brandHint: 'Cartier' },
  // Hublot — e.g. 301.SX.130.RX, MP-05
  { regex: /\b(MP[-]?\d{2,5})\b/i, brandHint: 'Hublot' },
  { regex: /\b(\d{3}\.[A-Z]{2}\.\d{3}\.[A-Z]{2})\b/i, brandHint: 'Hublot' },
  // Glashutte Original — e.g. 1-58-01, 1-39-52-02
  { regex: /\b(1-\d{2}-\d{2}(?:-\d{2})?)\b/i, brandHint: 'Glashutte Original' },
  // TAG Heuer — e.g. CAL5113, WW2111, CBL2113, WAR201
  { regex: /\b(CAL\d{3,5})\b/i, brandHint: 'TAG Heuer' },
  { regex: /\b((?:WW|CBL|WAR|WBD|CAZ|CAY|CAR|CAF)\d{3,6}[A-Z]{0,3})\b/i, brandHint: 'TAG Heuer' },
  // Grand Seiko — e.g. SBGC221, SBGA211, SBGR253
  { regex: /\b(SBG[A-Z]\d{3})\b/i, brandHint: 'Grand Seiko' },
  // Bell & Ross — e.g. BR03-92, BR 03-92, BR0392-BLU-ST/SCA, BR05A-BLM-SKCE/SCE
  { regex: /\b(BR\s?0?\d{2}[A-Z]?[-–]?\d{0,2}(?:[-–][A-Z]{2,4}[-–][A-Z0-9]{2,4}(?:\/[A-Z0-9]{2,4})?)?)\b/i, brandHint: 'Bell & Ross' },
  // Blancpain — e.g. AC02-12B53-63A, 5054-0130-B52A, 6669-1127-55B
  { regex: /\b([A-Z]{0,2}\d{2,4}[-–]\d{2,4}[A-Z]?\d{0,2}[-–][A-Z0-9]{2,4})\b/i, brandHint: 'Blancpain' },
  // Roger Dubuis — e.g. RDDBEX0364
  { regex: /\b(RDDBEX\d{3,5})\b/i, brandHint: 'Roger Dubuis' },
  // Longines — e.g. L3.830.4.92.9, L2.919.4.78.6, l2.175.0
  { regex: /\b(L\d\.\d{3}\.\d\.\d{2}\.\d)\b/i, brandHint: 'Longines' },
  { regex: /\b(L\d\.\d{3}\.\d)\b/i, brandHint: 'Longines' },
  // Girard-Perregaux — e.g. 81060-21-2010-FH7A (long hyphenated, must not be mistaken for a year)
  { regex: /\b(\d{5}[-–]\d{2}[-–]\d{3,4}[-–][A-Z0-9]{3,5})\b/i, brandHint: 'Girard-Perregaux' },
  // Ulysse Nardin — e.g. UN 246-00/43, 246 00/43
  { regex: /\b(UN\s?\d{3}[-–]?\d{2}\/\d{2})\b/i, brandHint: 'Ulysse Nardin' },
  { regex: /\b(\d{3}[-–]\d{2}\/\d{2})\b/, brandHint: 'Ulysse Nardin' },
  // Montblanc — e.g. U0111012 (7-digit U-prefixed)
  { regex: /\b(U\d{7})\b/i, brandHint: 'Montblanc' },
  // Panerai — explicit PAM##### (before generic fallback so zero-pad normalizer sees it cleanly)
  { regex: /\b(PAM\s?\d{2,5})\b/i, brandHint: 'Panerai' },
  // Chopard — e.g. 298600-3001, 168566-3011, 4087
  { regex: /\b(\d{6}[-–]\d{3,4})\b/, brandHint: 'Chopard' },
  // Roger Dubuis alt / Hermes Cape Cod — e.g. CC1.810
  { regex: /\b(CC\d\.\d{3})\b/i, brandHint: 'Hermes' },
  // Generic fallback — NNNNN or NNNN/XX format
  { regex: /\b([A-Z]*\d{4,6}[\/\-]?[A-Z0-9]{0,4})\b/i, brandHint: null },
];

/**
 * v4.3: PROTECTED reference patterns — matched BEFORE price/year stripping runs.
 * These are structurally unambiguous multi-segment references that must never
 * be touched by the generic price/year/currency stripping regexes, because
 * their embedded digit groups can look like years or prices (e.g. Girard-
 * Perregaux "81060-21-2010-FH7A" contains "2010" which looks like a year;
 * Glashutte "1-58-01" starts with a lone digit; Piaget vintage "9133 A 6"
 * has internal spaces that must be preserved, not glued or stripped).
 *
 * If a protected pattern matches, its extracted ref is returned immediately —
 * generic cleanup (price-strip, suffix-strip, space-glue) is skipped entirely.
 */
const PROTECTED_REF_PATTERNS = [
  // Girard-Perregaux — long hyphenated ref; embedded "2010" etc. must survive
  { regex: /\b(\d{5}[-–]\d{2}[-–]\d{3,4}[-–][A-Z0-9]{3,5})\b/i, brandHint: 'Girard-Perregaux', preserveAsIs: true },
  // Glashutte Original — dashed format starting with a lone digit
  { regex: /\b(\d-\d{2}-\d{2}(?:-\d{2})?)\b/, brandHint: 'Glashutte Original', preserveAsIs: true },
  // Roger Dubuis
  { regex: /\b(RDDBEX\d{3,5})\b/i, brandHint: 'Roger Dubuis', preserveAsIs: true },
  // Bell & Ross full format with slash suffix
  { regex: /\b(BR\s?0?\d{2}[A-Z]?[-–]\d{0,2}[-–][A-Z]{2,4}[-–][A-Z0-9]{2,4}(?:\/[A-Z0-9]{2,4})?)\b/i, brandHint: 'Bell & Ross', preserveAsIs: true },
  // Blancpain dash-caliber style
  { regex: /\b([A-Z]{0,2}\d{2,4}[-–]\d{2,4}[A-Z]?\d{0,2}[-–][A-Z0-9]{2,4})\b/i, brandHint: 'Blancpain', preserveAsIs: true },
  // Longines dotted style — do not let the ".9" tail be mistaken for a price decimal
  { regex: /\b(L\d\.\d{3}\.\d\.\d{2}\.\d)\b/i, brandHint: 'Longines', preserveAsIs: true },
  // Montblanc 7-digit U-prefix
  { regex: /\b(U\d{7})\b/i, brandHint: 'Montblanc', preserveAsIs: true },
  // Piaget vintage spaced format — e.g. "9133 A 6", "9775 A 6" — preserve internal spacing
  { regex: /\b(\d{4}\s[A-Z]\s\d)\b/i, brandHint: 'Piaget', preserveAsIs: true, keepSpaces: true },
  // Franck Muller — refs may legitimately contain internal spaces (e.g. "902 QZ REL")
  { regex: /\b(\d{3,4}\s(?:QZ|SC|DT|REL)(?:\s[A-Z]{2,4})*)\b/i, brandHint: 'Franck Muller', preserveAsIs: true, keepSpaces: true },
];

/** Dial colour keywords mapped to canonical names. */
const DIAL_KEYWORDS = {
  black:    ['black', 'noir', 'nero'],
  blue:     ['blue', 'bleu', 'navy', 'ocean'],
  white:    ['white', 'blanc', 'bianco', 'silver'],
  green:    ['green', 'vert', 'verde'],
  brown:    ['brown', 'bronze', 'marron', 'chocolate', 'coffee'],
  grey:     ['grey', 'gray', 'gris', 'grigio', 'slate', 'anthracite'],
  champagne:['champagne', 'champ', 'gold dial'],
  salmon:   ['salmon', 'copper', 'rose gold dial'],
  purple:   ['purple', 'violet', 'lilac'],
  red:      ['red', 'rouge', 'rosso'],
  burgundy: ['burgundy', 'wine', 'bordeaux'],
  orange:   ['orange'],
  yellow:   ['yellow', 'jaune', 'giallo'],
  silver:   ['silver', 'argent'],
  'mother of pearl': ['mother of pearl', 'mop', 'nacre', 'pearl'],
};

/** Dial colour hints from reference suffixes. */
const REF_DIAL_MAP = {
  BL: 'blue', B: 'blue', BU: 'blue',
  BK: 'black', K: 'black', BLK: 'black',
  W: 'white', WH: 'white', WT: 'white',
  G: 'green', GN: 'green', GRN: 'green',
  S: 'silver', SL: 'silver', SI: 'silver',
  CH: 'champagne', C: 'champagne',
  R: 'red', RD: 'red',
  O: 'orange', OR: 'orange',
  P: 'purple', PU: 'purple',
  SA: 'salmon', SAL: 'salmon',
  BR: 'brown', BN: 'brown',
  GY: 'grey', GRY: 'grey', GR: 'grey',
  MOP: 'mother of pearl',
};

/** Condition keywords and their canonical forms. */
const CONDITION_MAP = [
  { keywords: ['brand new'],                              canon: 'New',    score: 1.0 },
  { keywords: ['new', 'bnib'],                            canon: 'New',    score: 1.0 },
  { keywords: ['n5'],                                     canon: 'New',    score: 0.95 },
  { keywords: ['like new', 'mint', '99%', '99 new', '98%', '97%', '96%', '95%'], canon: 'Like New', score: 0.95 },
  { keywords: ['n4'],                                     canon: 'Like New', score: 0.90 },
  { keywords: ['nos', 'new old stock'],                   canon: 'NOS',    score: 0.98 },
  { keywords: ['unused', 'unworn'],                       canon: 'Unused', score: 0.99 },
  { keywords: ['excellent', 'exc', 'great condition', 'very good', 'vgc'], canon: 'Excellent', score: 0.85 },
  { keywords: ['n3'],                                     canon: 'Excellent', score: 0.85 },
  { keywords: ['good', 'good condition', 'gwc'],          canon: 'Good',   score: 0.7 },
  { keywords: ['n2'],                                     canon: 'Good',   score: 0.70 },
  { keywords: ['fair', 'used', 'pre-owned', 'preowned', 'pre owned'], canon: 'Used', score: 0.5 },
  { keywords: ['n1'],                                     canon: 'Fair',   score: 0.50 },
  { keywords: ['poor', 'bad', 'damaged', 'scratches'],    canon: 'Poor',   score: 0.2 },
  { keywords: ['full set', 'fullset', 'complete set', 'completeset'], canon: 'Full Set', score: 1.0 },
];

/** Box & papers accessory keywords. */
const ACCESSORY_PATTERNS = {
  fullSet:     /\bfull\s*set\b|\bcomplete\s*set\b|\bfullset\b|\bfull\s*kit\b|\bwith\s*everything\b/i,
  box:         /\bwith\s*box\b|\bw[\/\s]?box\b|\bbox\s*(?:and|&)\s*papers\b|\bhas\s*box\b|\boriginal\s*box\b/i,
  papers:      /\bwith\s*papers\b|\bw[\/\s]?papers\b|\bpapers?\b|\bcard\b|\bcertificate\b|\bwarranty\s*card\b|\bkeep\s*card\b|\bkeepcard\b/i,
  noBox:       /\bno\s*box\b|\bwithout\s*box\b|\bbox\s*only\b(?!.*papers)/i,
  noPapers:    /\bno\s*papers\b|\bwithout\s*papers\b|\bpapers\s*only\b(?!.*box)/i,
  noBoxPapers: /\bno\s*box\s*(and|&)\s*no\s*papers\b|\bno\s*bp\b|\bnobp\b|\bnaked\b(?!.*strap)/i,
};

/** Multipliers used in price parsing. */
const PRICE_MULTIPLIERS = { k: 1e3, m: 1e6, b: 1e9 };

// Non-watch product keywords for NORM_004
const NON_WATCH_KEYWORDS = ['bag', 'shoulder bag', 'leather', 'hardware', 'crossbody', 'tote', 'clutch', 'purse', 'wallet'];

// v4.3: Hermes bag model names — these are NEVER watches, force NON_WATCH_OR_WRONG_CATEGORY
const HERMES_BAG_MODELS = ['birkin', 'kelly', 'constance', 'hac', 'picotin', 'evelyne', 'garden party', 'lindy', 'bolide'];

// v4.3: Watch-accessory keywords (strap/bracelet/box/link ONLY, not the watch itself)
// Distinct from NON_WATCH_KEYWORDS (which is for bags/apparel) — these describe
// watch-adjacent accessories being sold separately from the watch head.
const ACCESSORY_KEYWORDS = [
  'strap only', 'strap for', 'bracelet only', 'bracelet for',
  'wooden box', 'box only', 'box available', 'watch box',
  'link only', 'links only', 'extra link', 'spare link',
];
// Looser single-word signals — only treated as accessory when NO valid
// brand-specific reference pattern was found alongside them (checked in caller).
const ACCESSORY_WEAK_SIGNALS = ['strap', 'bracelet', 'link', 'links', 'box', 'boxes'];

// ═══════════════════════════════════════════════════════════════
// HELPER: createCryptoHash (Node >=19 compatible)
// ═══════════════════════════════════════════════════════════════

function _createHash(input) {
  try {
    const crypto = require('crypto');
    return crypto.createHash('md5').update(input, 'utf8').digest('hex');
  } catch (_e) {
    let h = 0;
    for (let i = 0; i < input.length; i++) {
      h = ((h << 5) - h + input.charCodeAt(i)) | 0;
    }
    return String(Math.abs(h));
  }
}

// ═══════════════════════════════════════════════════════════════
// WHATSAPP FORMAT HELPERS
// ═══════════════════════════════════════════════════════════════

/**
 * Strip emoji, flags, and decorative characters from WhatsApp messages.
 */
function stripWhatsAppDecorations(text) {
  if (!text) return '';
  return text
    .replace(/[\u{1F1E6}-\u{1F1FF}]{2}/gu, ' ')  // Country flags 🇭🇰 🇺🇸
    .replace(/[\u{1F300}-\u{1F9FF}]/gu, ' ')      // Emoji range 1
    .replace(/[\u{2600}-\u{26FF}]/gu, ' ')         // Emoji range 2 (symbols)
    .replace(/[\u{2700}-\u{27BF}]/gu, ' ')         // Emoji range 3 (dingbats)
    .replace(/[\u{FE00}-\u{FE0F}]/gu, '')          // Variation selectors
    .replace(/\[\d{1,2}:\d{2}\s*(?:AM|PM)\s*,\s*\d{1,2}\/\d{1,2}\/\d{4}\]\s*\+?[\d\s:]+/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Detect if a line is a section header (not a listing).
 */
function isSectionHeader(text) {
  if (!text) return false;
  const t = text.trim();
  // v4.0: WTB/ISO/LF lines are NEVER section headers — they're buy requests
  if (/\b(wtb|iso|lf|looking\s+for|want\s+to\s+buy|seeking|in\s+search\s+of)\b/i.test(t)) return false;
  // Lines starting with clock emoji are always headers
  if (/^[\u231A\u231B]/u.test(t)) return true;
  // 🚩🚩ROLEX🚩🚩 or 🏆Patek Philippe New in HK or ⌚🇭🇰PP Ready in HK
  // Only match if the line CONTAINS emoji characters (not just optional)
  const hasEmoji = /[\u231A\u231B\u{1F300}-\u{1F9FF}\u{2600}-\u{26FF}]/u.test(t);
  if (hasEmoji && /^[\u231A\u231B\u{1F300}-\u{1F9FF}\u{2600}-\u{26FF}\s]*\w+.*[\u231A\u231B\u{1F300}-\u{1F9FF}\u{2600}-\u{26FF}\s]*$/u.test(t)) {
    // If it contains brand names but no reference or price → header
    const hasRef = /\b\d{4,6}/.test(t);
    const hasPrice = /\d+[KkMm]|\d{4,7}|hkd|usd|usdt/i.test(t);
    if (!hasRef && !hasPrice) return true;
  }
  // Pure emoji lines or bare phone numbers
  if (/^\+?\d[\d\s]*$/.test(t)) return true;
  // v4.3: Bare brand-name-only text (e.g. "BVLGARI", "ZENITH", "DEFY") must NOT
  // be discarded as a section header — it needs to flow through to brand
  // detection so parseFull can flag it NEEDS_MANUAL_REVIEW (brand with no ref)
  // instead of silently dropping it as GARBAGE. Check against known brand
  // names before applying the generic short-text-no-digits header heuristic.
  const isKnownBrandOnly = BRAND_MAP.some(entry =>
    entry.names.some(name => t.toLowerCase() === name.toLowerCase())
  );
  if (isKnownBrandOnly) return false;
  if (t.length < 10 && !/\d/.test(t)) return true;
  // Separator lines
  if (/^-{3,}|={3,}|\*{3,}$/.test(t)) return true;
  return false;
}

// ═══════════════════════════════════════════════════════════════
// EXPORTED FUNCTIONS
// ═══════════════════════════════════════════════════════════════

/**
 * Split a message that may contain multiple watches.
 *
 * Handles three formats:
 * 1. Delimiter-separated: "watch1 // watch2 | watch3"
 * 2. WhatsApp multi-watch: refs chained with prices — "126509 Blue N9 Hk$410K 126505 Cho N10 Hk$420K"
 * 3. Newline-separated: "watch1\nwatch2\nwatch3"
 *
 * For format 2, we detect boundaries where a new watch reference appears
 * after a price/currency token from the previous watch.
 */
function splitMultiWatch(text) {
  if (!text) return [''];

  // ── Phase 1: Split on newlines first (most reliable separator) ──
  let lines = text.split(/\n+/).map(l => l.trim()).filter(l => l.length > 0);

  // If newlines produced multiple lines, check if each has a ref → already split
  if (lines.length > 1) {
    const linesWithRefs = lines.filter(l => /\b\d{4,6}[A-Z]{0,4}\b/i.test(l) || /\bRM\d/i.test(l));
    if (linesWithRefs.length >= 2) {
      // Further split each line for delimiter format
      const result = [];
      for (const line of lines) {
        result.push(...splitByDelimiters(line));
      }
      return result.filter(p => p.length > 0);
    }
  }

  // ── Phase 2: Delimiter-based splitting (//, |, \) ──
  const single = lines.join(' ');
  const delimited = splitByDelimiters(single);
  if (delimited.length > 1) return delimited;

  // ── Phase 3: WhatsApp multi-watch detection ──
  // Pattern: ref + [optional details] + price → next ref + price
  // Split BEFORE a reference number that follows a price/currency token
  const multiSplit = splitWhatsAppMultiWatch(single);
  if (multiSplit.length > 1) return multiSplit;

  return [single.trim()];
}

/**
 * Split on common delimiters: //, |, \, and/&/+ before a digit
 */
function splitByDelimiters(text) {
  if (!text) return [];
  return text
    .split(/(?:\s*\/\/\s*|\s*\|\s*|\s*\\\s*|\s+(?:and|&|\+)\s+(?=\d|[A-Z]{2,}|\$))/i)
    .map(p => p.trim())
    .filter(p => p.length > 0);
}

/**
 * Split WhatsApp-style multi-watch listings.
 *
 * Dealer format example:
 *   "126509 Blue N9 Hk$410K 126505 Cho N10 Hk$420K 126515 Cho f.s D.F N8 Hk$342k"
 *
 * Each watch segment contains: reference → [dial/condition details] → price
 * We split BEFORE each reference that follows a price token.
 *
 * Price tokens: Hk$XXX[Kk], $XXX[Kk], XXX[Kk] HKD, USDT XXX, etc.
 * Reference tokens: 5-6 digit number optionally followed by letters, or RM##-##
 */
function splitWhatsAppMultiWatch(text) {
  if (!text) return [text];

  // Price-currency pattern: detects end of a watch's price info
  // Matches: Hk$410K, HK$420k, $342k, 410K HKD, HKD 410K, USDT 50K, etc.
  const priceTokenRe = /(?:(?:HK|hk|Hk|hK)\s*\$\s*\d{1,6}(?:[.,]\d{1,3})?\s*[KkMm]?)|(?:\$\s*\d{1,6}(?:[.,]\d{1,3})?\s*[KkMm]?)|(?:(?:HKD|USD|USDT|EUR|GBP|CHF)\s*\d{1,6}(?:[.,]\d{1,3})?\s*[KkMm]?)|(?:\d{1,6}\s*[KkMm]\s*(?:HKD|USD|USDT))|(?:\d{3,7}\s*(?:HKD|USD|USDT|EUR|GBP|CHF))/gi;

  // Reference pattern: 5-6 digit number (optionally with letters) or RM##-##
  const refTokenRe = /\b(?:\d{5,6}[A-Z]{0,4}|RM\d{2,3}[-–]?\d{2}|Q\d{6,7})\b/gi;

  // Collect ALL ref and price positions using regex.exec
  const refs = [];
  const prices = [];
  let m;

  // Reset regex
  const refRe = new RegExp(refTokenRe.source, 'gi');
  while ((m = refRe.exec(text)) !== null) {
    refs.push({ start: m.index, end: m.index + m[0].length, text: m[0] });
  }

  const priceRe = new RegExp(priceTokenRe.source, 'gi');
  while ((m = priceRe.exec(text)) !== null) {
    // Avoid matching a ref as a price (overlap detection)
    const overlapsRef = refs.some(r => r.start <= m.index && m.index < r.end);
    if (!overlapsRef && m[0].length > 2) {
      prices.push({ start: m.index, end: m.index + m[0].length, text: m[0] });
    }
  }

  // Merge into a sorted event timeline
  const events = [
    ...refs.map(e => ({ ...e, type: 'ref' })),
    ...prices.map(e => ({ ...e, type: 'price' })),
  ].sort((a, b) => a.start - b.start);

  if (refs.length < 2) return [text.trim()];

  // Walk the timeline: split before a REF that comes after a PRICE
  const segments = [];
  let lastSplit = 0;
  let foundPrice = false;

  for (const evt of events) {
    if (evt.type === 'price') {
      foundPrice = true;
    } else if (evt.type === 'ref') {
      if (foundPrice && evt.start > lastSplit) {
        // This ref follows a price → new watch
        segments.push(text.slice(lastSplit, evt.start).trim());
        lastSplit = evt.start;
        foundPrice = false;
      }
    }
  }

  // Push remaining text
  if (lastSplit < text.length) {
    segments.push(text.slice(lastSplit).trim());
  }

  // Only return splits if we found 2+ segments with refs
  if (segments.length > 1) {
    const refSegments = segments.filter(s => refTokenRe.test(s));
    if (refSegments.length >= 2) {
      return segments.filter(s => s.length > 0);
    }
  }

  return [text.trim()];
}

/**
 * Detect the watch brand from a dealer message.
 * v4.1: RM references are checked FIRST to prevent Richard Mille being
 *       swallowed under Rolex when a multi-watch message contains both.
 */
function parseBrand(text) {
  if (!text) return null;
  const lower = text.toLowerCase();

  // v4.2: Richard Mille checked FIRST (before Rolex) to prevent misclassification
  if (/\b(richard\s*mille|rm\s?\d{2,3})\b/i.test(text)) {
    return 'Richard Mille';
  }

  // Find ALL brand matches, return the FIRST one (leftmost in text)
  // This handles "Tudor Black Bay 58 Rolex" → Tudor (first), not Rolex
  let firstMatch = null;
  let firstIndex = Infinity;

  for (const entry of BRAND_MAP) {
    // Skip Richard Mille — already handled above
    if (entry.canon === 'Richard Mille') continue;
    for (const alias of entry.names) {
      const pattern = new RegExp('(?:^|[^a-z])' + alias.replace(/[.*+?^${}()|[\]\\\\]/g, '\\\\$&') + '(?:$|[^a-z])', 'i');
      const match = lower.match(pattern);
      if (match && match.index < firstIndex) {
        firstIndex = match.index;
        firstMatch = entry.canon;
      }
      if (alias.length >= 4 && lower.includes(alias)) {
        const idx = lower.indexOf(alias);
        if (idx < firstIndex) {
          firstIndex = idx;
          firstMatch = entry.canon;
        }
      }
    }
  }

  if (firstMatch) return firstMatch;

  // NORM_001: If text explicitly contains a different luxury brand, use it
  const EXPLICIT_BRANDS = [
    { names: ['bvlgari', 'bulgari'], canon: 'Bulgari' },
    { names: ['richard mille', 'rm '], canon: 'Richard Mille' },
    { names: ['audemars piguet', 'ap '], canon: 'Audemars Piguet' },
    { names: ['vacheron constantin', 'vacheron'], canon: 'Vacheron Constantin' },
  ];
  for (const entry of EXPLICIT_BRANDS) {
    for (const alias of entry.names) {
      if (lower.includes(alias)) return entry.canon;
    }
  }

  return null;
}

/**
 * Extract a watch reference number from the message.
 * v3.1: Stronger guards against years (2023) and prices (95000HKD, 718.000)
 */
function parseReference(text, brandHint) {
  if (!text) return null;
  // Keep newlines as separators — they prevent word concatenation across lines
  const clean = text
    .replace(/[\u200B\u200C\u200D\uFEFF]/g, '');

  // v4.3: PROTECTED PATTERNS — check BEFORE any price/year stripping.
  // These multi-segment refs (GP, Glashutte, Bell & Ross, Blancpain, Longines,
  // Montblanc, Piaget vintage, Franck Muller spaced) must never be run through
  // the generic price/year/currency stripping below, because their embedded
  // digit groups can resemble years or prices and get wrongly stripped.
  const protectedOrdered = [...PROTECTED_REF_PATTERNS].sort((a, b) => {
    if (a.brandHint && a.brandHint === brandHint) return -1;
    if (b.brandHint && b.brandHint === brandHint) return 1;
    return 0;
  });
  for (const pat of protectedOrdered) {
    const m = clean.match(pat.regex);
    if (m) {
      let ref = m[1].trim();
      if (!pat.keepSpaces) ref = ref.replace(/\s+/g, '');
      ref = ref.toUpperCase();
      return normalizeRefFormat(ref, pat.brandHint);
    }
  }

  // Remove price-context and years BEFORE searching for references
  // Use [ \t]+ (NOT \s) to avoid matching across newlines
  const priceStripped = clean
    // v4.3: Dealer item/stock IDs — "Item # 2405682", "SKU 1234", "Stock #5678"
    // These are internal dealer tracking numbers, NEVER a brand reference.
    // NOTE: deliberately excludes "ref" — "Ref: 126610LN" usually precedes the
    // ACTUAL valid reference and must not be stripped (would destroy real refs).
    .replace(/\b(?:item|sku|stock)\s*#?\s*\.?\s*(?:no\.?|id)?\s*[:#]?\s*\d{4,10}\b/gi, ' ')
    // Currency+number combos: "410K HKD", "HK$410K", "USDT 50000", "$342k"
    .replace(/\b\d{1,3}(?:,\d{3})*[ \t]*(?:USD|USDT|HKD|EUR|GBP|CHF|HKG)\b/gi, ' ')
    .replace(/\b\d{1,3}\.\d{3}[ \t]*(?:USD|USDT|HKD|EUR|GBP|CHF|HKG)\b/gi, ' ')
    .replace(/\b\d{3,7}[ \t]*(?:USD|USDT|HKD|EUR|GBP|CHF|HKG)\b/gi, ' ')
    .replace(/(?:USD|USDT|HKD|EUR|GBP|CHF|HKG)\s*\d+/gi, ' ')
    .replace(/\d+(?:USD|USDT|HKD|EUR|GBP|CHF|HKG)/gi, ' ')
    // HK$ / Hk$ prefix (common WhatsApp dealer format): "Hk$410K", "HK$420k"
    .replace(/[Hh][Kk]\$\s*\d{1,6}(?:[.,]\d{1,3})?\s*[KkMm]?\b/g, ' ')
    // $-prefixed prices: "$5100", "$34,500", "$17.9K", "$4200" (must strip before ref extraction)
    .replace(/\$\s*\d{1,3}(?:,\d{3})*(?:\.\d+)?\s*[KkMm]?\b/g, ' ')
    .replace(/\$\s*\d{4,7}\s*[KkMm]?\b/g, ' ')
    .replace(/\$\s*\d{1,6}\s*[KkMm]\b/g, ' ')
    // Standalone USDT (not attached to a number — garbage in reference field)
    .replace(/\bUSDT\b/gi, ' ')
    // Price with K/M suffix and no currency: "410K", "420k" (only when preceded by non-digit)
    .replace(/(?<!\d)\d{1,6}\s*[KkMm]\b(?!\w)/g, ' ')
    // Years: 2020-2030, also "Jun-2006" style date prefixes
    .replace(/\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*[-\.]?\s*(19|20)\d{2}\b/gi, ' ')
    .replace(/\b(19|20)\d{2}\b/g, ' ')
    // Full sentences/descriptions in parentheses (not refs)
    .replace(/\([^)]*(?:without|with|full|sticker|card|box|paper)[^)]*\)/gi, ' ')
    // Status abbreviations: f.s, s.s, k.c, D.F (dealer shorthand not refs)
    .replace(/\b[fdsk][.]\s?[sck]\b/gi, ' ');

  const ordered = [...REF_PATTERNS].sort((a, b) => {
    if (a.brandHint && a.brandHint === brandHint) return -1;
    if (b.brandHint && b.brandHint === brandHint) return 1;
    return 0;
  });

  for (const pat of ordered) {
    const m = priceStripped.match(pat.regex);
    if (m) {
      // v4.3: Preserve internal dots for brands whose reference format IS
      // dot-separated (Omega 310.32.42.50.02.001, Hublot 301.SX.130.RX,
      // Hermes Cape Cod CC1.810, Longines L2.175.0). Only strip dots for
      // brands where they're dealer typos (Rolex "116500 L.N" → "116500LN").
      const preserveDots = ['Omega', 'Hublot', 'Hermes', 'Longines'].includes(pat.brandHint);
      let ref = m[1].replace(/\s+/g, '').toUpperCase();
      if (!preserveDots) {
        ref = ref
          // Normalize dealer variations: "116500 L.N" → "116500LN", "116500 l n" → "116500LN"
          .replace(/[._]/g, '');
      }
      ref = ref
        .replace(/^(\d{5,6})(DAY|DATE|NEW|FULL|SET|USED|LIKE|MINT|GREEN|BLUE|BLACK|WHITE|GOLD|LAND|CHOC|CHOCO|WIM|OLIVE|SUNDUST|TIFFANY|LAVENDER|PISTACHIO|TURQUOISE|PANDA|PAVE|BLK|SILVER|GREY|GRAY|PN|RBOW|SUB|GMT|YM|OP|DJ|DD|DD2|DJ2|EXP|II|I)$/i, '$1')
        .replace(/^(\d{5,6})(DAY|DATE|NEW|FULL|SET|USED|LIKE|MINT|GREEN|BLUE|BLACK|WHITE|GOLD|LAND|CHOC|CHOCO|WIM|OLIVE|SUNDUST|TIFFANY|LAVENDER|PISTACHIO|TURQUOISE|PANDA|PAVE|BLK|SILVER|GREY|GRAY|PN|RBOW|SUB|GMT|YM|OP|DJ|DD|DD2|DJ2|EXP|II|I)(?=\d)/i, '$1')
        .replace(/[\-\/]$/, '');  // Strip trailing dash/slash

      // Strip common dealer/status suffixes that get concatenated
      // NOTE: OR = rose gold, AS = steel — do NOT strip valid material codes
      // Strip BEFORE length validation
      ref = ref.replace(/(NEED|SOLD|TYIA|WHO|PLZ|DM|NIB|PM|PRE|CARD|NO|THKS|THANK|ROSE|HK|REF|BNIB|TIA)$/i, '');
      // v4.3: Strip leading "Ref-"/"Ref:"/"Ref " prefix glued onto the extracted match
      // e.g. "Ref-WSSA0030" → "WSSA0030" (the raw regex sometimes captures the label too)
      ref = ref.replace(/^REF[-:.]?/i, '');
      // v4.2: Strip brand abbreviations from reference prefix (per Alex's request)
      // VC = Vacheron Constantin, PP = Patek Philippe, AP = Audemars Piguet
      // These are dealer shorthand, not part of the actual reference number
      // IMPORTANT: Only strip when followed by space or digit separator,
      // NOT when the abbreviation IS part of the ref (e.g., RM030-01 is a valid RM ref)
      ref = ref.replace(/^(VC|PP|AP|JLC|IWC|HUB|CART|OMG|ZEN)\s+/i, '');
      ref = ref.replace(/^(VC|PP|AP|JLC|IWC|HUB|CART|OMG|ZEN)(?=\d{4,})/i, '');
      // Re-validate after stripping
      if (!ref || ref.length < 4) continue;

      // STRICT validation — reject obvious non-references
      if (/^\d{4}$/.test(ref) && (ref.startsWith('19') || ref.startsWith('20'))) continue;  // Year
      if (/^0[\d.]/.test(ref)) continue;  // Starts with 0
      if (/^\d+\.\d{3}$/.test(ref)) continue;  // European price
      if (/^\d{1,3}$/.test(ref)) continue;  // Too short
      if (/\d{4,7}\s*(?:USD|USDT|HKD|EUR|GBP|CHF)/i.test(ref)) continue;  // Price with currency
      if (/^\d{4,7}[KM]$/i.test(ref)) continue;  // Price with K/M suffix

      // Must contain letters OR be 4-6 digit numeric (Patek 5711, Rolex 116500)
      // OR be a dotted reference like Omega 145.022-69 or 123.10.35.20.01.001 or 2221.80.00
      const hasLetters = /[A-Z]/.test(ref);
      const isNumericRef = /^\d{4,6}$/.test(ref);
      const isDottedRef = /^\d{3,4}\.\d{2,3}/.test(ref);
      const isDashedRef = /^\d-\d{2}-\d{2}/.test(ref);  // Glashutte Original: 1-58-01
      if (!hasLetters && !isNumericRef && !isDottedRef && !isDashedRef) continue;

      // For numeric-only refs, verify not followed by currency
      if (isNumericRef) {
        const after = priceStripped.slice(m.index + m[0].length, m.index + m[0].length + 10).toLowerCase();
        if (/\b(usd|hkd|eur|gbp|k\b|m\b)/.test(after)) continue;
      }

      return normalizeRefFormat(ref, pat.brandHint || brandHint);
    }
  }
  return null;
}

/**
 * v4.3: Per-brand suffix/format normalizers — applied as the FINAL step
 * after a reference has been extracted and validated. Fixes brand-specific
 * casing/format conventions flagged by Alex's review (missing "M" prefix on
 * Tudor, zero-padding on Panerai PAM refs, canonical RM##-## spacing, glued
 * Piaget G0A codes, uppercase Longines "L" prefix).
 */
function normalizeRefFormat(ref, brand) {
  if (!ref) return ref;

  switch (brand) {
    case 'Tudor':
      // Restore missing "M" prefix: "7939A1A0RU-0001" → "M7939A1A0RU-0001"
      if (/^\d{4,5}[A-Z]/.test(ref) && !ref.startsWith('M')) {
        return 'M' + ref;
      }
      return ref;

    case 'Panerai':
      // Zero-pad to PAM##### — "PAM372" → "PAM00372" (ref already space-stripped by this point)
      { const m = ref.match(/^PAM0*(\d{1,5})$/i);
        if (m) return 'PAM' + m[1].padStart(5, '0'); }
      return ref;

    case 'Richard Mille':
      // Canonical RM##-## no-space format: "RM 11-03" → "RM11-03"
      return ref.replace(/^RM\s+/i, 'RM').toUpperCase();

    case 'Piaget':
      // Glue "G0A 34077" → "G0A34077" (but the protected spaced-vintage pattern
      // like "9133 A 6" is handled separately with keepSpaces and never reaches here)
      { const m = ref.match(/^G0A\s?(\d{4,5})$/i);
        if (m) return 'G0A' + m[1]; }
      return ref;

    case 'Longines':
      // Force uppercase leading L: "l2.175.0" → "L2.175.0"
      return ref.replace(/^l/, 'L');

    case 'IWC':
      return ref.toUpperCase();

    case 'Bell & Ross':
      // "03-92" alone (brand already implied "BR") → glue to "BR03-92"
      if (/^\d{2}-\d{2}$/.test(ref)) return 'BR' + ref;
      return ref.replace(/^B&R\s*/i, 'BR').toUpperCase();

    case 'Hublot':
      // Dotted format: uppercase segments — "917nj6909rx" style w/o dots is
      // ambiguous; only reformat if dots are already present
      if (/^\d{3}\.[A-Z]{2}\.\d{3,4}\.[A-Z]{2}$/i.test(ref)) return ref.toUpperCase();
      return ref;

    case 'Grand Seiko':
      return ref.toUpperCase();

    default:
      return ref;
  }
}

/**
 * Extract the dial colour from the message text.
 * v4.1: Only returns canonical color names. Rejects multi-word text that
 *       contains commas, "and", "&", or material descriptions (gold, steel, etc.)
 *       that dealers put alongside dial info.
 */
function parseDial(text, ref) {
  if (!text) return null;
  const lower = text.toLowerCase();

  // Find ALL matching colors, then pick the best one
  const foundColors = [];
  for (const [colour, aliases] of Object.entries(DIAL_KEYWORDS)) {
    for (const alias of aliases) {
      const rx = new RegExp('(?:^|[^a-z])' + alias.replace(/[.*+?^${}()|[\]\\\\]/g, '\\\\$&') + '(?:$|[^a-z])', 'i');
      if (rx.test(lower)) {
        foundColors.push(colour);
        break; // Don't add same color twice from different aliases
      }
    }
  }

  // If exactly one color found, return it
  if (foundColors.length === 1) {
    return normalizeDialColor(foundColors[0]);
  }

  // If multiple colors found, prefer the one that appears closest to "dial" keyword
  // or closest to the reference number in the text
  if (foundColors.length > 1) {
    // Check if "dial" keyword exists and a color is near it
    const dialIdx = lower.indexOf('dial');
    if (dialIdx >= 0) {
      // Find which color appears closest after "dial"
      let bestColor = null;
      let bestDist = Infinity;
      for (const c of foundColors) {
        const aliases = DIAL_KEYWORDS[c] || [c];
        for (const alias of aliases) {
          const idx = lower.indexOf(alias, dialIdx);
          if (idx >= 0 && idx - dialIdx < bestDist) {
            bestDist = idx - dialIdx;
            bestColor = c;
          }
        }
      }
      if (bestColor) return normalizeDialColor(bestColor);
    }

    // Fallback: if catalog has a dial color for this ref, use it
    if (ref) {
      const catalogEntry = lookupCatalog(null, ref);
      if (catalogEntry && catalogEntry.dialColor) {
        return normalizeDialColor(catalogEntry.dialColor.toLowerCase());
      }
    }

    // Final fallback: return the first found color (most common use case)
    return normalizeDialColor(foundColors[0]);
  }

  // No color keyword found — try inferring from reference suffix
  if (ref) {
    const dialCode = inferDialFromRef(ref);
    if (dialCode) return normalizeDialColor(dialCode);
  }

  return null;
}

/**
 * v4.0: Normalize dial color to TitleCase canonical form.
 */
function normalizeDialColor(colour) {
  if (!colour) return colour;
  const map = {
    'black': 'Black',
    'blue': 'Blue',
    'white': 'White',
    'green': 'Green',
    'brown': 'Brown',
    'grey': 'Grey',
    'champagne': 'Champagne',
    'salmon': 'Salmon',
    'purple': 'Purple',
    'red': 'Red',
    'burgundy': 'Burgundy',
    'orange': 'Orange',
    'yellow': 'Yellow',
    'silver': 'Silver',
    'mother of pearl': 'Mother Of Pearl',
  };
  return map[colour.toLowerCase()] || colour;
}

/**
 * Infer dial colour from the alphabetic suffix of a reference number.
 */
function inferDialFromRef(ref) {
  if (!ref) return null;
  // Only infer dial from short suffixes (2-3 letters like BL, BK, GN)
  // Skip long suffixes (4+ chars like SACO, RBOW, BLNR — these are Rolex model codes)
  const suffixMatch = ref.match(/[A-Za-z]{2,3}(?=\d*$|[\-\/]?\d*$)/g);
  if (suffixMatch) {
    for (const sfx of suffixMatch) {
      const upper = sfx.toUpperCase();
      if (REF_DIAL_MAP[upper]) return REF_DIAL_MAP[upper];
    }
  }
  return null;
}

/**
 * Infer brand from a known reference number pattern.
 * v4.2: Reference prefix overrides text brand detection.
 *       If a Hublot listing has PAM00372 → brand becomes Panerai.
 *       If an Omega listing has W51007Q4 → brand becomes Cartier.
 *       If a Hublot listing has IW371615 → brand becomes IWC.
 */
function inferBrandFromRef(ref) {
  if (!ref) return null;
  const r = ref.toUpperCase();
  
  // ── Brand-specific prefixes (very reliable) ──
  // RM prefix → Richard Mille
  if (r.startsWith('RM')) return 'Richard Mille';
  
  // PAM prefix → Panerai (NOT Hublot)
  if (r.startsWith('PAM')) return 'Panerai';
  
  // Q prefix → Jaeger-LeCoultre
  if (/^Q\d{6,7}/.test(r)) return 'Jaeger-LeCoultre';
  
  // IW prefix → IWC (NOT Hublot)
  if (/^IW\d{5,7}/.test(r)) return 'IWC';
  
  // W + 5+ digits → Cartier (NOT Omega)
  if (/^W\d{5,}[A-Z]?/.test(r)) return 'Cartier';
  
  // Cartier format: CRB, CRO, WSR, W2, etc.
  if (/^(WSR|W2|CBB|CRB|CRO|WTB|WEA)\d/i.test(r)) return 'Cartier';
  
  // ── Vacheron Constantin: 4-5 digits ending in V, or with / separator ──
  if (/^\d{4,5}V$/i.test(r)) return 'Vacheron Constantin';
  if (/^\d{4,5}V\/\d{0,3}[A-Z]{0,3}$/i.test(r)) return 'Vacheron Constantin';
  // v4.3: Vacheron Historiques format — "4200H/222A-B934", "4200H/222J-B935"
  // (####H/###[letter]-[letter]###). Checked BEFORE the Patek pattern below,
  // because it would otherwise also match the generic "[3-7]\d{3}[A-Z]" shape.
  if (/^\d{4}H\/\d{3}[A-Z][-–][A-Z]\d{3,4}$/i.test(r)) return 'Vacheron Constantin';

  // ── Patek Philippe: 4-digit refs starting with 3,4,5,6,7 ──
  // AND only if followed by a slash or letter suffix (e.g., 5711/1A, 5236P)
  // Do NOT infer Patek for bare 4-5 digit numbers — too ambiguous with Rolex
  // v4.3 FIX: previous regex /^[3-7]\d{3}[A-Z]|[\\/]/ had broken operator
  // precedence — the unanchored `|[\\/]` alternative matched ANY string
  // containing a slash anywhere (e.g. Vacheron "4200H/222A-B934" was wrongly
  // inferred as Patek). Corrected to properly anchor both alternatives.
  if (/^[3-7]\d{3}([A-Z]|\/)/.test(r)) return 'Patek Philippe';
  
  // ── Rolex: 6-digit refs starting with 11-27 ──
  if (/^\d{6}/.test(r)) {
    const first2 = parseInt(r.slice(0, 2), 10);
    if (first2 >= 11 && first2 <= 27) return 'Rolex';
  }
  
  // ── AP: 5-digit + 2+ uppercase letters (15210ST, 26240OR) ──
  if (/^\d{5}[A-Z]{2,4}/.test(r)) return 'Audemars Piguet';
  
  // ── Hublot: typically has dots (301.SX.130.RX) or MP prefix ──
  if (/^MP\d{5}/.test(r)) return 'Hublot';
  if (/^\d{3}\.[A-Z]{2}\.\d{3}\.[A-Z]{2}/.test(r)) return 'Hublot';
  
  // ── Omega: dotted format (123.10.35.20.01.001) ──
  if (/^\d{3}\.\d{2,3}/.test(r)) return 'Omega';
  
  // ── Glashutte Original: 1-XX-XX format ──
  if (/^1-\d{2}-\d{2}/.test(r)) return 'Glashutte Original';

  // ── v4.3: additional brand-specific prefixes (flag-only, see AUTO_OVERRIDE_BRANDS) ──
  if (/^RDDBEX\d/.test(r)) return 'Roger Dubuis';
  if (/^SBG[A-Z]\d{3}/.test(r)) return 'Grand Seiko';
  if (/^L\d\.\d{3}\.\d/.test(r)) return 'Longines';
  if (/^U\d{7}$/.test(r)) return 'Montblanc';
  if (/^CAL\d{3,5}/.test(r)) return 'TAG Heuer';
  if (/^BR\s?0?\d{2}/.test(r)) return 'Bell & Ross';

  return null;
}

/**
 * v4.3: Brands for which reference-prefix inference is trusted enough to
 * AUTO-OVERRIDE the text-detected brand (as approved in v4.2 for the
 * Hublot/Omega/Rolex cross-contamination cases). Any OTHER inferred brand
 * mismatch is flagged as WRONG_BRAND_SUSPECT instead of silently changed,
 * per the new verdict taxonomy — safer default until a human confirms
 * these newer prefixes (Roger Dubuis, Grand Seiko, Longines, Montblanc,
 * TAG Heuer, Bell & Ross, Vacheron Historiques) are equally unambiguous.
 * v4.3: Vacheron Constantin removed from auto-override — Alex flagged a
 * case (Grand Seiko row containing a VC Historiques ref) that needs human
 * confirmation rather than a silent brand swap.
 */
const AUTO_OVERRIDE_BRANDS = new Set([
  'Richard Mille', 'Panerai', 'Jaeger-LeCoultre', 'IWC', 'Cartier',
  'Patek Philippe', 'Rolex', 'Audemars Piguet',
  'Hublot', 'Omega', 'Glashutte Original',
]);

/**
 * Extract condition from the message.
 */
function parseCondition(text) {
  if (!text) return { condition: null, score: 0 };
  const lower = text.toLowerCase();
  for (const entry of CONDITION_MAP) {
    for (const kw of entry.keywords) {
      const rx = new RegExp('(?:^|[^a-z])' + kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?:$|[^a-z])', 'i');
      if (rx.test(lower)) {
        return { condition: entry.canon, score: entry.score };
      }
    }
  }
  return { condition: null, score: 0 };
}

/**
 * Extract the manufacturing year from the message.
 */
function parseYear(text) {
  if (!text) return null;
  const lower = text.toLowerCase();

  // MM/YYYY format: "5/2026", "6/2026", "04/2025"
  const slashYear = text.match(/\b(\d{1,2})\/(\d{4})\b/);
  if (slashYear) {
    const y = parseInt(slashYear[2], 10);
    if (y >= 2020 && y <= 2030) return y;
  }

  // Explicit year mentions: "2021", "year 2022"
  const explicit = lower.match(/\b(19[5-9]\d|20[0-3]\d)\b/);
  if (explicit) {
    const y = parseInt(explicit[1], 10);
    if (y >= 1950 && y <= 2030) return y;
  }

  // "N5/N6 2026" → condition grading
  const nearCondition = lower.match(/(?:new\s+\d{2}|n\d{1,2}[/\\]n?\d{0,2})\s*(20\d{2})/);
  if (nearCondition) return parseInt(nearCondition[1], 10);

  return null;
}

/**
 * Extract price from the message text.
 * Handles: 208.000Usdt, 2.2M HKD, 138K HKD, 1.85m, 1,58m, 99000, etc.
 * v3.1: Added explicit HKD-with-m-suffix pattern (NORM_002).
 */
function parsePrice(text, ref) {
  if (!text) return null;
  const clean = text.replace(/[\u200B\u200C\u200D\uFEFF]/g, ' ');

  let searchText = clean;
  if (ref) {
    searchText = searchText.replace(new RegExp(ref.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'), ' ');
  }

  // Skip year numbers that could be mistaken for prices
  searchText = searchText.replace(/\b(20[0-3]\d)\b/g, ' ');

  const patterns = [
    // European comma-decimal: 1,58m → 1.58 → 1,580,000
    { regex: /\b(\d{1,3},\d{2})\s*[mM]\b/g, handler: (m) => parseFloat(m[1].replace(',', '.')) * 1e6 },
    // 1.85m, 1.4M, 1.265m, 2.35m (dot + m/M)
    { regex: /\b(\d{1,3}(?:\.\d{1,3})?)\s*[mM]\b(?![a-zA-Z])/g, multiplier: 1e6 },
    // 865K, 118K, 120k (uppercase or lowercase K)
    { regex: /\b(\d{1,6}(?:[.,]\d{1,3})?)\s*[kK]\b(?![a-zA-Z])/g, multiplier: 1e3 },
    // 1,68M (European comma thousands)
    { regex: /\b(\d{1,3},\d{3})\s*[mM]\b/g, multiplier: 1e6 },
    // 1.080.000 (European dot-thousands chain)
    { regex: /\b(\d{1,3}(?:\.\d{3})+)\b/g, multiplier: 1, european: true },
    // Currency stuck to number: HKD930K, HKD583K, USD185000, hkd435k (case-insensitive)
    { regex: /(?:HKD|USD|USDT|EUR|GBP)\s*(\d{1,6}(?:[.,]\d{1,3})?)\s*([KkMm])?\b/gi, handler: (m) => {
      const num = parseFloat(m[1].replace(/,/g, ''));
      const mult = { k: 1e3, K: 1e3, m: 1e6, M: 1e6 }[m[2]] || 1;
      return num * mult;
    }},
    // NORM_002: hkd998m, hkd 1.5m — explicit HKD with m suffix
    // Also matches typo "hkf" (common in WhatsApp from non-native typists)
    { regex: /hk[df]?\s*(\d{1,3}(?:\.\d{1,3})?)\s*[mM]\b/gi, handler: (m) => {
      const num = parseFloat(m[1]);
      return num * 1e6 * 0.128; // HKD to USD conversion
    }},
    // 268000 with currency
    { regex: /\b(\d{4,7})\s*(?:USD|USDT|HKD|EUR|GBP|CHF|SGD|AUD|CAD|CNY|RMB)\b/gi, multiplier: 1 },
    // v3.4: comma-thousands with currency: "205,000 hkd", "111,500hkd", "3,056,055 HKD"
    { regex: /\b(\d{1,3}(?:,\d{3})+)\s*(?:USD|USDT|HKD|EUR|GBP|CHF|SGD|AUD|CAD|AED)\b/gi, handler: (m) => parseFloat(m[1].replace(/,/g, '')) },
    // v3.4: $-prefixed comma-thousands: "$34,500", "$16,250+ship"
    { regex: /[$](\d{1,3}(?:,\d{3})+)(?:\.\d+)?\b/g, handler: (m) => parseFloat(m[1].replace(/,/g, '')) },
    // v3.4: dealer k-shorthand with comma decimal: "$17,9 + 🏷" → 17,900
    { regex: /[$](\d{1,3}),(\d)\b(?!\d)/g, handler: (m) => (parseFloat(m[1]) + parseFloat(m[2]) / 10) * 1000 },
    // Price context words
    { regex: /(?:price|asking|ask|sell|offer|offered|at|for)\s*[:]?(\d{1,3}(?:[,]?\d{3})*(?:\.\d+)?)/gi, multiplier: 1 },
    // General fallback
    { regex: /\b(\d{4,7})\b/g, multiplier: 1 },
  ];

  for (const pat of patterns) {
    const matches = [...searchText.matchAll(pat.regex)];
    for (const m of matches) {
      // Custom handler for complex patterns (e.g., European comma-decimal, currency-attached)
      if (pat.handler) {
        const value = pat.handler(m);
        if (!isNaN(value) && value > 0) {
          const final = Math.round(value);
          if (final >= 500 && final <= 5_000_000) {
            return final;
          }
        }
        continue;
      }
      let raw = m[1].replace(/,/g, '');
      let value;
      if (pat.european && /\d\.\d{3}$/.test(raw)) {
        value = parseInt(raw.replace(/\./g, ''), 10);
      } else {
        value = parseFloat(raw.replace(/,/g, ''));
      }
      if (!isNaN(value) && value > 0) {
        const final = Math.round(value * (pat.multiplier || 1));
        if (final >= 500 && final <= 5_000_000) {
          return final;
        }
      }
    }
  }
  return null;
}

/**
 * Extract the currency code from the message.
 */
function parseCurrency(text) {
  if (!text) return null;
  const lower = text.toLowerCase();
  const currencies = [
    ['usdt', 'USDT'], ['usd', 'USD'], ['hkd', 'HKD'], ['eur', 'EUR'],
    ['gbp', 'GBP'], ['chf', 'CHF'], ['sgd', 'SGD'], ['aud', 'AUD'],
    ['cad', 'CAD'], ['jpy', 'JPY'], ['cny', 'CNY'], ['rmb', 'RMB'],
  ];
  for (const [code, canonical] of currencies) {
    const rx = new RegExp('(?:^|[^a-z])' + code + '(?:[^a-z]|$)', 'i');
    if (rx.test(lower)) return canonical;
  }
  return null;
}

/**
 * Convert an amount from any supported currency to USD.
 */
function toUSD(amount, currency) {
  if (!amount || amount <= 0) return 0;
  const rate = RATES[(currency || 'USD').toUpperCase()] || 1.0;
  return Math.round(amount * rate);
}

/**
 * Detect box & papers status from the message.
 */
function parseAccessories(text) {
  if (!text) return { hasBox: false, hasPapers: false, note: null };
  const lower = text.toLowerCase();

  if (ACCESSORY_PATTERNS.fullSet.test(lower)) {
    return { hasBox: true, hasPapers: true, note: 'Full Set' };
  }

  if (ACCESSORY_PATTERNS.noBoxPapers.test(lower)) {
    return { hasBox: false, hasPapers: false, note: 'No Box/Papers' };
  }

  const hasBox = ACCESSORY_PATTERNS.box.test(lower);
  const hasPapers = ACCESSORY_PATTERNS.papers.test(lower);
  const noBox = ACCESSORY_PATTERNS.noBox.test(lower);
  const noPapers = ACCESSORY_PATTERNS.noPapers.test(lower);

  const finalBox = hasBox && !noBox;
  const finalPapers = hasPapers && !noPapers;

  let note = null;
  if (finalBox && finalPapers) note = 'Box & Papers';
  else if (finalBox && !finalPapers) note = 'Box Only';
  else if (!finalBox && finalPapers) note = 'Papers Only';

  return { hasBox: finalBox, hasPapers: finalPapers, note };
}

// ═══════════════════════════════════════════════════════════════
// v3.4 EXTRACTORS — inclusions, notes, details, date_month
// ═══════════════════════════════════════════════════════════════

/**
 * v3.4: Normalize inclusions to a strict enum.
 * FULL_SET | W_AND_C | BOX_ONLY | PAPERS_ONLY | NAKED | null
 */
function parseInclusions(text) {
  if (!text) return null;
  const lower = text.toLowerCase();
  if (/\b(full\s?set|fullset|complete\s?set|b&p|box\s*(?:and|&|\+)\s*papers?)\b/i.test(lower)) return 'FULL_SET';
  if (/\b(naked|only\s?watch|watch\s?only|no\s?box\s?no\s?papers?)\b/i.test(lower)) return 'NAKED';
  if (/\b(w&c|w\/c|watch\s*(?:and|&|\+)\s*card|watch\s?card)\b/i.test(lower)) return 'W_AND_C';
  const noBox = /\b(no|without)\s?box\b/i.test(lower);
  const noPapers = /\b(no|without)\s?papers?\b/i.test(lower);
  const hasBox = /\bbox\b/i.test(lower) && !noBox;
  const hasPapers = /\b(papers?|card)\b/i.test(lower) && !noPapers;
  if (noBox && (hasPapers || /\bcard\b/i.test(lower))) return 'PAPERS_ONLY';
  if (hasBox && noPapers) return 'BOX_ONLY';
  if (hasBox && hasPapers) return 'FULL_SET';
  return null;
}

/**
 * v3.4: Extract dealer notes — shipping, location, quirks.
 * Returns compact "; "-joined string or null. Never invents data.
 */
function parseNotes(text) {
  if (!text) return null;
  const lower = text.toLowerCase();
  const notes = [];
  if (/\+\s?(label|🏷|lbl|ship)\b|\+\s?🏷️?|plus\s?label/i.test(text)) notes.push('+label');
  if (/\bready\s?(in\s?|stock\s?)?(hk|hong\s?kong)\b|\bhk\s?(spot|stock|ready)\b/i.test(lower)) notes.push('Ready in HK');
  if (/\b(nyc|new york)\s?📍?\b/i.test(lower) && /📍|ready|stock|location/i.test(text)) notes.push('NYC');
  if (/\bdubai\s?(ready|stock)?\b/i.test(lower) && /ready|stock/i.test(lower)) notes.push('Dubai');
  if (/\b(usa?|us|la|miami)\s?(ready|stock)\b/i.test(lower)) notes.push('US stock');
  if (/\busdt\s?(ok|✅|accepted)?\b/i.test(lower) && /ok|✅|accept|welcome/i.test(lower)) notes.push('USDT OK');
  if (/\bwire\b/i.test(lower) && /welcome|only|🔌/i.test(lower)) notes.push('Wire');
  if (/\bcross-?posted\b/i.test(lower)) notes.push('Cross-posted');
  if (/\b(hold|on hold)\b/i.test(lower)) notes.push('HOLD');
  if (/\bugly\s?handwriting\b/i.test(lower)) notes.push('Ugly handwriting');
  if (/-\s?\d\s?link|minus\s?(one|\d)\s?link|full\s?links?\b/i.test(lower)) {
    const linkMatch = text.match(/-\s?(\d)\s?link|minus\s?(one|\d)\s?link/i);
    if (linkMatch) notes.push(`-${linkMatch[1] || linkMatch[2]} link`);
    else if (/full\s?links?\b/i.test(lower)) notes.push('Full links');
  }
  return notes.length ? notes.join('; ') : null;
}

/**
 * v3.4: Extract dial/model details beyond plain colour —
 * Wimbledon, Pave, Olive Arabic, 50th anniversary, Celebration, etc.
 */
const DETAIL_KEYWORDS = [
  'wimbledon', 'pave', 'pavé', 'olive arabic', 'olive', 'celebration',
  'tiffany', 'sundust', 'lavender', 'pistachio', 'turquoise', 'aubergine',
  'chocolate', 'choc', 'panda', 'rainbow', 'ice blue', 'mother of pearl',
  'mop', 'arabic', 'roman', 'diamond', 'smoked', '50th anniversary', '50th',
  '150th', 'anniversary', 'jubilee', 'oyster', 'oysterflex', 'batman',
  'pepsi', 'hulk', 'starbucks', 'kermit', 'land dweller', 'ghost',
  'carnelian', 'onyx', 'meteorite',
];
const DETAIL_CANON = {
  'choc': 'Chocolate', 'pavé': 'Pave', 'mop': 'Mother of Pearl',
  '50th': '50th Anniversary', '150th': '150th Anniversary',
};
function parseDetails(text) {
  if (!text) return null;
  const lower = text.toLowerCase();
  const found = [];
  for (const kw of DETAIL_KEYWORDS) {
    const rx = new RegExp('(?:^|[^a-z])' + kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?:$|[^a-z])', 'i');
    if (rx.test(lower)) {
      const canon = DETAIL_CANON[kw] || kw.split(' ').map(w => w[0].toUpperCase() + w.slice(1)).join(' ');
      if (!found.includes(canon)) found.push(canon);
    }
  }
  return found.length ? found.slice(0, 4).join(', ') : null;
}

/**
 * v3.4: Preserve the original month/year notation — "05/2022", "N7/2025",
 * "Nov 2024", "12/24". Returns raw string or null.
 */
function parseDateMonth(text) {
  if (!text) return null;
  // N-code: N7/2025, N3/26
  const nCode = text.match(/\bN(\d{1,2})\s?\/\s?(20\d{2}|\d{2})\b/i);
  if (nCode) {
    const yr = nCode[2].length === 2 ? '20' + nCode[2] : nCode[2];
    return `${nCode[1].padStart(2, '0')}/${yr}`;
  }
  // MM/YYYY: 05/2022, 12/2025
  const mmYyyy = text.match(/\b(0?[1-9]|1[0-2])\/(20\d{2})\b/);
  if (mmYyyy) return `${mmYyyy[1].padStart(2, '0')}/${mmYyyy[2]}`;
  // Month name: Nov 2024, June 2026
  const monthName = text.match(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+(20\d{2})\b/i);
  if (monthName) {
    const months = { jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06', jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12' };
    return `${months[monthName[1].toLowerCase().slice(0, 3)]}/${monthName[2]}`;
  }
  // MM/YY: 12/24 (only when preceded by month-ish context to avoid ref collisions)
  const mmYy = text.match(/\b(0?[1-9]|1[0-2])\/(2[0-9])\b/);
  if (mmYy) return `${mmYy[1].padStart(2, '0')}/20${mmYy[2]}`;
  return null;
}

/**
 * v3.4: Normalize condition to exactly 3 buckets.
 * BRAND_NEW | MINT | USED | null
 */
function normalizeConditionBucket(condition, text) {
  const lower = (text || '').toLowerCase();
  if (/\b(bnib|brand\s?new|unworn|full\s?stickers?|true\s?new|nos)\b/i.test(lower)) return 'BRAND_NEW';
  if (/\b(like\s?new|99(\.9)?%|mint|slider|excellent)\b/i.test(lower)) return 'MINT';
  if (/\b(used|pre-?owned|worn)\b/i.test(lower)) return 'USED';
  if (!condition) return null;
  const c = condition.toLowerCase();
  if (/new|unworn|bnib/.test(c)) return 'BRAND_NEW';
  if (/mint|like|excellent/.test(c)) return 'MINT';
  if (/used|good|fair|pre/.test(c)) return 'USED';
  return null;
}


/**
 * NORM_003: Detect if parsed price is actually the reference number.
 * E.g., reference "126301" should NOT be parsed as price $126,301.
 */
function validatePriceNotReference(price, ref) {
  if (!price || !ref) return price;
  const refNum = parseInt(ref.replace(/\D/g, ''), 10);
  if (isNaN(refNum)) return price;
  // If price is within 1% of the reference number, reject it
  if (Math.abs(price - refNum) / refNum < 0.01) {
    return null; // Price is actually the reference — reject
  }
  // v4.0: Check if price digits match first 5-6 chars of reference (prefix collision)
  const priceStr = String(price);
  const refPrefix = ref.substring(0, Math.min(6, ref.length)).replace(/\D/g, '');
  if (refPrefix.length >= 5 && priceStr.startsWith(refPrefix)) {
    return null; // Price matches reference prefix — likely collision
  }
  return price;
}

/**
 * NORM_004: Detect if the text describes a non-watch product.
 */
function detectNonWatch(text) {
  if (!text) return false;
  const lower = text.toLowerCase();
  return NON_WATCH_KEYWORDS.some(kw => lower.includes(kw));
}

/**
 * v4.3: Detect if a Hermes-brand row is actually a bag listing, not a watch.
 * Bag model names (Birkin, Kelly, Constance, Hac, etc.) are never watches.
 */
function detectHermesBagModel(text) {
  if (!text) return false;
  const lower = text.toLowerCase();
  return HERMES_BAG_MODELS.some(model => {
    const rx = new RegExp('(?:^|[^a-z])' + model.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?:$|[^a-z])', 'i');
    return rx.test(lower);
  });
}

/**
 * v4.3: Detect if the row describes a watch ACCESSORY (strap/bracelet/box/link)
 * rather than the watch itself. Returns true only when an accessory keyword
 * is present AND no clear brand-specific reference number was extracted —
 * a genuine watch listing that merely mentions "full set with box" should
 * NOT be flagged (that's normal watch listing language, not an accessory sale).
 */
function detectAccessoryListing(text, ref) {
  if (!text) return false;
  const lower = text.toLowerCase();

  // Strong signals: explicit "X only" / "X for" phrasing — always an accessory sale
  if (ACCESSORY_KEYWORDS.some(kw => lower.includes(kw))) return true;

  // v4.3: "links only" / "extra links" / "22links Only" with "watch" and a price
  // is a WATCH listing describing condition (how many links included), NOT an
  // accessory-only sale. Only flag "link" when the text does NOT mention a
  // complete watch or has no extracted reference.
  const isWatchListing = (
    /(?:^|[^a-z])watch(?:$|[^a-z])/.test(lower) ||
    /(?:^|[^a-z])w&c(?:$|[^a-z])/.test(lower) ||
    ref !== null
  );

  // v4.3: Accessory keyword as the LEADING word (e.g. "BRACELET 15500/26331OR")
  // is a strong signal regardless of whether reference-looking numbers follow —
  // dealers commonly list an accessory alongside the reference numbers of the
  // watch models it fits, which should not be mistaken for a watch listing.
  const leadingWord = lower.trim().split(/\s+/)[0];
  if (ACCESSORY_WEAK_SIGNALS.includes(leadingWord)) return true;

  // Weak signals: bare "strap"/"bracelet"/"box" word present but NO valid
  // reference extracted AND not a watch listing → likely an accessory-only sale
  if (!isWatchListing && ACCESSORY_WEAK_SIGNALS.some(kw => {
    const rx = new RegExp('(?:^|[^a-z])' + kw + '(?:$|[^a-z])', 'i');
    return rx.test(lower);
  })) {
    return true;
  }

  return false;
}

/**
 * v4.3: Detect whether the row is a MULTI_WATCH_STOCK_LIST that couldn't be
 * cleanly split by splitMultiWatch — i.e. 2+ distinct valid brand-specific
 * reference patterns are present in one raw message with no clear single-row
 * boundary. In that case we refuse to guess and flag for manual resolution.
 */
function detectMultiWatchStockList(text) {
  if (!text) return false;
  const matches = [];
  for (const pat of REF_PATTERNS) {
    if (!pat.brandHint) continue; // skip generic fallback — too noisy for this check
    const re = new RegExp(pat.regex.source, pat.regex.flags.includes('g') ? pat.regex.flags : pat.regex.flags + 'g');
    let m;
    while ((m = re.exec(text)) !== null) {
      matches.push({ ref: m[1], brand: pat.brandHint, index: m.index });
      if (matches.length > 6) break; // cap — clearly a stock list by now
    }
    if (matches.length > 6) break;
  }
  // Dedupe by normalized ref value
  const uniqueRefs = new Set(matches.map(m => m.ref.replace(/[\s._-]/g, '').toUpperCase()));
  return uniqueRefs.size >= 2;
}

/**
 * Classify the listing type (WTS / WTB / WTT / GARBAGE).
 */
function classifyListingType(text) {
  if (!text || text.trim().length === 0) return 'GARBAGE';
  const lower = text.toLowerCase();

  const garbageSignals = [
    /\b(scam|spam|fake|replica|rep\b|superclone|1:1 clone)/i,
    /\b(crypto airdrop|join my group|click here|free money)/i,
    /\b(viagra|cialis|casino|betting|lottery)\b/i,
  ];
  for (const rx of garbageSignals) {
    if (rx.test(lower)) return 'GARBAGE';
  }

  const wtbSignals = [
    /\b(wtb|want to buy|looking for|seeking|buying|wanted|in search of|iso)\b/i,
    /\blf\b/i,
    /\bneed\s+(?!gone|sold|out|help|to\s+sell|quick)/i,
    /\bwant\s+this\s+watch\b/i,
    /\bbuy\s+(?:any|the|a)\b.*\bwatch\b/i,
  ];
  for (const rx of wtbSignals) {
    if (rx.test(lower)) return 'WTB';
  }

  const wttSignals = [
    /\b(wtt|want to trade|trade for|trading|swap for|swap with|exchange for|px\s+welcome|part\s*exchange)\b/i,
  ];
  for (const rx of wttSignals) {
    if (rx.test(lower)) return 'WTT';
  }

  const wtsSignals = [
    /\b(wts|want to sell|selling|for sale|fs\b|available|asking|price is|offer|offered)\b/i,
    /\$\d/i, /\d+\s*(?:usd|usdt|hkd|eur|gbp)/i,
    /\d+[KkMm]\s*(?:usd|usdt|hkd|eur|gbp)/i,
  ];
  for (const rx of wtsSignals) {
    if (rx.test(lower)) return 'WTS';
  }

  if (parseBrand(text) && parseReference(text)) {
    return 'WTS';
  }

  return 'GARBAGE';
}

/**
 * Compute a deterministic hash for a message (used for dedup).
 */
function hashMessage(text) {
  if (!text) return '';
  const normalised = text.toLowerCase().replace(/\s+/g, ' ').trim();
  return _createHash(normalised);
}

/**
 * Confidence Protocol — 4-Tier Matrix (from Jasmel's protocol image)
 *
 * | Catalog Match          | AI Intervention    | Confidence | Action              |
 * |------------------------|---------------------|------------|---------------------|
 * | Everything in catalog  | None               | 100%       | Auto-approve        |
 * | 1 thing missing        | AI fills 1 gap     | 90%        | Review suggested    |
 * | 2 things missing       | AI fills 2 gaps    | 80%        | Must review         |
 * | 3+ missing / garbage   | AI can't resolve   | <80%       | Manual intervention |
 *
 * Gaps counted: brand, reference, dial, price, condition, year
 */
function confidenceTier(extracted, catalogEntry, validationFlags) {
  const gaps = [];

  if (!extracted.brand) gaps.push({ field: 'brand', reason: 'Brand not detected' });
  if (!extracted.ref && !extracted.reference) gaps.push({ field: 'reference', reason: 'Reference not found' });
  if (!extracted.dial) gaps.push({ field: 'dial', reason: 'Dial color not detected' });
  else if (validationFlags && validationFlags.includes('DIAL_MISMATCH')) gaps.push({ field: 'dial', reason: 'Dial does not match catalog' });
  if (!extracted.price || extracted.price <= 0) gaps.push({ field: 'price', reason: 'Price not found' });
  if (!extracted.condition) gaps.push({ field: 'condition', reason: 'Condition not specified' });
  if (!extracted.year) gaps.push({ field: 'year', reason: 'Year not specified' });

  const gapCount = gaps.length;
  let score, action;
  if (gapCount === 0) {
    score = 100;
    action = 'AUTO_APPROVE';
  } else if (gapCount === 1) {
    score = 90;
    action = 'REVIEW_SUGGESTED';
  } else if (gapCount === 2) {
    score = 80;
    action = 'MUST_REVIEW';
  } else {
    score = Math.max(0, 100 - gapCount * 20);
    action = 'MANUAL_INTERVENTION';
  }

  // Boost score if brand + reference + price all matched (core data complete)
  const coreFieldsPresent = !!extracted.brand && !!(extracted.ref || extracted.reference) && !!extracted.price;
  if (coreFieldsPresent && gapCount <= 3 && action !== 'AUTO_APPROVE') {
    score = Math.min(95, score + 10);
  }

  return {
    score,
    action,
    gapCount,
    gaps,
    catalogMatched: !!catalogEntry,
    fields: {
      brand:     { matched: !!extracted.brand,     value: extracted.brand || null,     source: extracted.brand ? 'text' : null },
      reference: { matched: !!(extracted.ref || extracted.reference), value: extracted.ref || extracted.reference || null, source: 'regex' },
      dial:      { matched: !!extracted.dial && !(validationFlags || []).includes('DIAL_MISMATCH'), value: extracted.dial || null, source: extracted.dial ? 'keyword' : null },
      price:     { matched: !!extracted.price,     value: extracted.price || null,     source: extracted.price ? 'regex' : null, currency: extracted.currency || null },
      condition: { matched: !!extracted.condition, value: extracted.condition || null, source: extracted.condition ? 'keyword' : null },
      year:      { matched: !!extracted.year,      value: extracted.year || null,      source: extracted.year ? 'regex' : null },
    },
  };
}

/**
 * Calculate field-level and overall confidence scores.
 */
function calculateConfidence(fields) {
  const fc = {};

  if (fields.brand) {
    fc.brand = 95;
  } else {
    fc.brand = 0;
  }

  if (fields.reference) {
    fc.reference = 90;
  } else {
    fc.reference = 0;
  }

  if (fields.price && fields.price > 0) {
    fc.price = fields.currency ? 95 : 75;
  } else {
    fc.price = 0;
  }

  if (fields.condition) {
    fc.condition = 85;
  } else {
    fc.condition = 30;
  }

  if (fields.dial) {
    fc.dial = 80;
  } else {
    fc.dial = 20;
  }

  if (fields.year) {
    fc.year = 90;
  } else {
    fc.year = 10;
  }

  if (fields.currency) {
    fc.currency = 95;
  } else {
    fc.currency = 50;
  }

  const weights = { brand: 0.20, reference: 0.20, price: 0.20, condition: 0.10, dial: 0.10, year: 0.10, currency: 0.10 };
  let totalWeight = 0;
  let weightedSum = 0;
  for (const [field, weight] of Object.entries(weights)) {
    weightedSum += (fc[field] || 0) * weight;
    totalWeight += weight;
  }

  const confidence = Math.round(weightedSum / totalWeight);
  return { confidence, fieldConfidence: fc };
}

/**
 * Apply a business verdict based on parse confidence and field presence.
 */
function verdict(parsed) {
  const APPROVE_THRESHOLD = getApproveThreshold();
  const HUMAN_THRESHOLD = getHumanThreshold();
  const c = parsed.confidence || 0;

  // v4.0: WTB listings always get REVIEW (never APPROVED)
  if (parsed.listingType === 'WTB') {
    return 'REVIEW';
  }

  // v4.0: Price exceeds cap → REVIEW
  if (parsed.priceExceedsCap) {
    return 'REVIEW';
  }

  if (!parsed.brand || !parsed.reference) {
    return 'RECYCLE';
  }

  // GARBAGE listing type with good data → HUMAN not RECYCLE
  if (parsed.listingType === 'GARBAGE' || parsed.listingType === 'OTHER') {
    if (parsed.brand && parsed.reference && (parsed.price > 0 || parsed.year)) {
      // Has core data, likely just missed the listing type classifier
      if (c >= APPROVE_THRESHOLD) return 'APPROVED';
      if (c >= HUMAN_THRESHOLD) return 'REVIEW';
      return 'HUMAN';
    }
  }

  if (parsed.listingType === 'WTS' && (!parsed.price || parsed.price <= 0)) {
    return 'HUMAN';
  }

  if (c >= APPROVE_THRESHOLD) return 'APPROVED';
  if (c >= HUMAN_THRESHOLD) return 'REVIEW';
  if (c >= 50) return 'HUMAN';
  return 'RECYCLE';
}

/**
 * v4.0: Detect intent (WTB/WTT/GARBAGE) before extracting price.
 * Returns the listing type classification.
 */
function detectIntent(text) {
  return classifyListingType(text);
}

/**
 * Full parse: extract all watch fields from a raw dealer message.
 * v3: Strips WhatsApp decorations before parsing.
 * v3.1-patch1: NORM_001-004 + listing overrides.
 * v4.0: Intent-first parsing, section header rejection, $5M cap.
 */
function parseFull(rawMsg) {
  if (!rawMsg || typeof rawMsg !== 'string') {
    return {
      brand: null,
      ref: null,
      dial: null,
      condition: null,
      year: null,
      price: null,
      currency: null,
      confidence: 0,
      fieldConfidence: {},
      listingType: 'GARBAGE',
      accessories: { hasBox: false, hasPapers: false, note: null },
    };
  }

  // v4.1: Strip WhatsApp decorations (emoji, flags, timestamps)
  let text = stripWhatsAppDecorations(rawMsg);

  // Fix: Period-separated fields — "5711. Chocolate. Unworn." → "5711 Chocolate Unworn"
  // Only replaces period+space, preserving decimal prices like 95.000
  text = text.replace(/\.\s+/g, ' ').replace(/\.$/, '');

  // v4.1: Normalize newlines — dealer messages may have \n within a single listing
  // (address, phone number, etc). Only treat \n as separator when followed by a ref/price pattern
  // Keep \n for multi-watch splitting, but normalize to space for single-watch parse
  
  // v4.0: SECTION HEADER REJECTION — return GARBAGE immediately
  if (isSectionHeader(text)) {
    return {
      brand: null,
      ref: null,
      dial: null,
      condition: null,
      year: null,
      price: null,
      currency: null,
      confidence: 0,
      fieldConfidence: {},
      listingType: 'GARBAGE',
      accessories: { hasBox: false, hasPapers: false, note: null },
      flags: { section_header: true },
      verdict: 'RECYCLE',
    };
  }

  // v4.0: INTENT-FIRST PARSING — detect WTB/WTT/GARBAGE before price extraction
  const intent = detectIntent(text);
  const isWTB = intent === 'WTB';

  // NORM_004: Detect non-watch products
  const isNonWatch = detectNonWatch(text);

  // Detect brand first (helps reference extraction)
  const brand = parseBrand(text);

  // Extract reference
  const ref = parseReference(text, brand || undefined);

  // v4.2/v4.3: Reference-prefix brand inference. For the well-established
  // cross-contamination set (v4.2), auto-override the text brand — these
  // prefixes are unambiguous (PAM/IW/W#/RM etc). For newer brand prefixes
  // (Roger Dubuis, Grand Seiko, Longines, Montblanc, TAG Heuer, Bell & Ross),
  // flag as WRONG_BRAND_SUSPECT instead of silently changing the brand —
  // per Alex's review, these need human confirmation before auto-correcting.
  const refInferredBrand = inferBrandFromRef(ref);
  let finalBrand;
  let wrongBrandSuspect = false;
  if (refInferredBrand && brand && refInferredBrand !== brand) {
    if (AUTO_OVERRIDE_BRANDS.has(refInferredBrand)) {
      // Ref prefix is more reliable than text brand — use ref-based brand
      finalBrand = refInferredBrand;
    } else {
      // Unconfirmed prefix family — flag, don't silently override
      finalBrand = brand;
      wrongBrandSuspect = true;
    }
  } else {
    finalBrand = brand || refInferredBrand;
  }

  // Extract other fields
  const dial = parseDial(text, ref || undefined);
  const { condition } = parseCondition(text);
  const year = parseYear(text);
  const currency = isWTB ? null : (parseCurrency(text) || 'USD');
  let price = isWTB ? null : parsePrice(text, ref || undefined);

  // v4.3: New verdict-taxonomy detectors (checked before confidence scoring,
  // per Alex's cleanup rules — see PROJECT reference-cleanup spec)
  const isHermesBag = finalBrand === 'Hermes' && detectHermesBagModel(text);
  const isAccessory = detectAccessoryListing(text, ref);
  const isMultiWatchStockList = !isWTB && detectMultiWatchStockList(text);

  // v4.0: Post-parse price cap enforcement ($5M USD hard cap)
  let priceExceedsCap = false;
  if (price && price > 5_000_000) {
    priceExceedsCap = true;
    price = null;
  }

  // NORM_003: Validate price is not actually a reference number
  if (!isWTB) price = validatePriceNotReference(price, ref);

  // NORM_002: Price shorthand validation for HKD
  // If HKD and value exceeds $5M USD equivalent, cap it
  if (!isWTB && currency === 'HKD' && price && price > 5_000_000) {
    priceExceedsCap = true;
    price = null;
  }

  // v4.0: Use intent-detected listing type (not re-classified)
  let listingType = intent;

  // NORM_004: Reduce confidence for non-watch products
  if (isNonWatch) {
    listingType = 'OTHER';
  }

  const accessories = parseAccessories(text);

  // v3.4: new schema fields
  const inclusions = parseInclusions(text);
  const notes = parseNotes(rawMsg);       // raw — emojis matter for notes
  const details = parseDetails(text);
  const dateMonth = parseDateMonth(text);

  // Calculate confidence
  let { confidence, fieldConfidence } = calculateConfidence({
    brand: finalBrand,
    reference: ref,
    price,
    currency,
    condition,
    dial,
    year,
  });

  // NORM_004: Reduce confidence significantly for non-watch products
  if (isNonWatch) {
    confidence = Math.round(confidence * 0.3);
  }

  // Apply individual listing overrides
  if (ref && LISTING_OVERRIDES[ref]) {
    const override = LISTING_OVERRIDES[ref];
    if (override.brand) finalBrand = override.brand;
    if (override.price_usd && (!price || price === 0)) price = override.price_usd;
    if (override.nonWatch) listingType = 'OTHER';
  }

  // REF-CATALOG: Validate (brand, reference) against catalog
  const flags = {};
  let validationFlags = [];
  let catalogEntry = null;
  let catalogMatched = false;

  // v4.0: Add price exceeds cap flag
  if (priceExceedsCap) {
    flags.PRICE_EXCEEDS_CAP = true;
    validationFlags.push('PRICE_EXCEEDS_CAP');
  }

  // v4.0: Add WTB intent flag
  if (isWTB) {
    flags.WTB_INTENT = true;
    validationFlags.push('WTB_INTENT');
  }
  if (finalBrand && ref) {
    catalogEntry = lookupCatalog(finalBrand, ref);
    if (catalogEntry) {
      catalogMatched = true;
      flags.catalog_matched = true;
    } else {
      // Not in catalog — mild penalty only, don't crash good data
      validationFlags.push('REFERENCE_UNVERIFIED');
      confidence = Math.round(confidence * 0.90);
    }
  } else if (finalBrand && !ref) {
    // No reference to validate — mild penalty
    confidence = Math.round(confidence * 0.95);
  }

  // CATALOG MATCH BOOST: if catalog matched, confidence = 100
  if (catalogMatched) {
    confidence = 100;
    validationFlags.push('CATALOG_MATCHED');
  }

  // Determine final verdict using the verdict function
  const finalVerdict = (catalogMatched && !isWTB) ? 'APPROVED' : verdict({
    confidence,
    brand: finalBrand,
    reference: ref,
    price,
    listingType,
    priceExceedsCap,
  });

  // v4.3: New verdict taxonomy — overrides the standard verdict when a
  // structural data-quality issue is detected (per Alex's reference-cleanup
  // spec). Checked in priority order: category mismatches first (most
  // specific/certain), then multi-watch ambiguity, then brand mismatch,
  // then generic manual review.
  let reviewReason = null;
  let taxonomyVerdict = null;

  if (isHermesBag) {
    taxonomyVerdict = 'NON_WATCH_OR_WRONG_CATEGORY';
    reviewReason = 'Hermes bag model detected (Birkin/Kelly/Constance/etc.), not a watch.';
  } else if (isNonWatch) {
    taxonomyVerdict = 'NON_WATCH_OR_WRONG_CATEGORY';
    reviewReason = 'Non-watch product keywords detected (bag, leather, apparel).';
  } else if (isAccessory) {
    taxonomyVerdict = 'ACCESSORY_NOT_WATCH';
    reviewReason = 'Strap/bracelet/box/link accessory listing, not a complete watch.';
  } else if (isMultiWatchStockList) {
    taxonomyVerdict = 'MULTI_WATCH_STOCK_LIST';
    reviewReason = 'Multiple distinct brand-specific references found in one message; row boundary unclear.';
  } else if (wrongBrandSuspect) {
    taxonomyVerdict = 'WRONG_BRAND_SUSPECT';
    reviewReason = `Reference format suggests ${refInferredBrand}, but text says ${brand}. Needs confirmation before override.`;
  } else if (finalBrand && !ref) {
    // Brand-only text with no extractable reference (e.g. "BVLGARI", "ZENITH", "DEFY")
    taxonomyVerdict = 'NEEDS_MANUAL_REVIEW';
    reviewReason = 'Brand or model name only — no reference number visible in raw message.';
  }

  if (taxonomyVerdict) {
    flags[taxonomyVerdict] = true;
    validationFlags.push(taxonomyVerdict);
  }

  const finalVerdictWithTaxonomy = taxonomyVerdict || finalVerdict;

  return {
    brand: finalBrand,
    brandExplicit: !!brand,  // true if brand was found in text, false if inferred from ref pattern
    ref,
    dial,
    condition,
    conditionBucket: normalizeConditionBucket(condition, text), // v3.4: BRAND_NEW | MINT | USED
    year,
    price,
    currency,
    inclusions,   // v3.4: FULL_SET | W_AND_C | BOX_ONLY | PAPERS_ONLY | NAKED
    notes,        // v3.4: "+label; Ready in HK; USDT OK"
    details,      // v3.4: "Wimbledon, Pave"
    dateMonth,    // v3.4: "05/2022"
    confidence,
    fieldConfidence,
    listingType,
    accessories,
    flags,
    verdict: finalVerdictWithTaxonomy,
    reviewReason,   // v4.3: human-readable explanation when verdict is a taxonomy flag
    catalogMatched,
    catalogEntry,
    catalogImageUrl: catalogEntry?.imageUrl || catalogEntry?.image_url || null,
    // 4-tier confidence protocol
    confidenceTier: confidenceTier(
      { brand: finalBrand, ref, dial, condition, year, price, currency },
      catalogEntry,
      validationFlags
    ),
  };
}

// ═══════════════════════════════════════════════════════════════
// MODULE EXPORTS
// ═══════════════════════════════════════════════════════════════

module.exports = {
  // Main entry
  parseFull,

  // Individual extractors
  parsePrice,
  parseCurrency,
  verdict,
  splitMultiWatch,
  inferBrandFromRef,
  inferDialFromRef,
  toUSD,
  classifyListingType,
  hashMessage,

  // WhatsApp helpers
  stripWhatsAppDecorations,
  isSectionHeader,

  // NORM validators
  validatePriceNotReference,
  detectNonWatch,
  normalizeDialColor,

  // Data tables
  RATES,
  APPROVE_THRESHOLD,
  HUMAN_THRESHOLD,

  // Internal helpers for testing
  parseBrand,
  parseReference,
  parseDial,
  parseCondition,
  parseYear,
  parseAccessories,
  parseInclusions,
  parseNotes,
  parseDetails,
  parseDateMonth,
  normalizeConditionBucket,
  calculateConfidence,
  confidenceTier,
  inferBrandFromRef,
  inferDialFromRef,

  // v4.3: new taxonomy detectors + normalizer (exported for testing)
  detectHermesBagModel,
  detectAccessoryListing,
  detectMultiWatchStockList,
  normalizeRefFormat,
  AUTO_OVERRIDE_BRANDS,
};
