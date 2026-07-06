/**
 * Canonical Brand Normalization Map
 *
 * Purpose: collapse duplicate casings/unicode variants/typos into one
 * canonical brand name, and flag clearly non-watch entries for review.
 *
 * Built from analysis of the full 2.39M-row watch_records table (399
 * distinct brand values found via public/watchfacts-brand-index.json).
 *
 * Categories:
 *   - canonical: the correct display name for a real luxury watch brand
 *   - aliases: known variant spellings/casings/unicode issues that map to it
 *   - nonWatch: brand values that are NOT watch brands (cars, tech, food,
 *     generic terms) — these listings should be reviewed/recycled, not
 *     just relabeled
 *   - garbage: values that are clearly not a brand at all (reference
 *     numbers, single letters, condition words) — these rows have brand
 *     detection failures and should route to brand=null for re-parsing,
 *     not be force-mapped to a fake brand
 */

// Canonical brand -> array of known alias strings (lowercased comparison)
const CANONICAL_BRANDS = {
  'Rolex': ['rolex', 'rlx', 'submariner', 'gmt-master ii', 'datejust', 'day-date', 'yachtmaster', 'oysterquartz', 'turn-o', 'hulk', 'rootbeer', 'sundust'],
  'Patek Philippe': ['patek philippe', 'patek'],
  'Audemars Piguet': ['audemars piguet', 'audemars', 'royal oak'],
  'Richard Mille': ['richard mille', 'rm03-01'],
  'Cartier': ['cartier', 'ballon bleu', 'santos-dumont', 'tank', 'love sm', 'love full diamond'],
  'Vacheron Constantin': ['vacheron constantin', 'vacheron', 'vc'],
  'Omega': ['omega', 'speedy', 'speedmaster', 'moonwatch'],
  'Hublot': ['hublot', 'big bang'],
  'IWC': ['iwc'],
  'Breitling': ['breitling'],
  'A. Lange & Sohne': ['a. lange & sohne', 'a. lange & söhne', 'a. lange & s\ufffdhne', 'lange', '朗格'],
  'Jaeger-LeCoultre': ['jaeger-lecoultre', 'jaeger lecoultre', 'jaeger', 'jlc', 'lecoultre'],
  'Panerai': ['panerai'],
  'Tudor': ['tudor'],
  'Bulgari': ['bulgari', 'bvlgari', 'serpenti', 'b.zero1'],
  'F.P. Journe': ['f.p. journe', 'f.p.journe', 'f.p. journe', 'fp journe', 'montres journe'],
  'Breguet': ['breguet', '宝玑', '寶璣'],
  'Zenith': ['zenith'],
  'Blancpain': ['blancpain'],
  'TAG Heuer': ['tag heuer', 'tagheuer', 'heuer', 'tag x k!ith'],
  'Ulysse Nardin': ['ulysse nardin', '雅典表', '雅典'],
  'Piaget': ['piaget'],
  'Girard-Perregaux': ['girard-perregaux', 'girard perregaux'],
  'MB&F': ['mb&f'],
  'Grand Seiko': ['grand seiko'],
  'Franck Muller': ['franck muller', 'frank muller'],
  'Seiko': ['seiko'],
  'Jacob & Co': ['jacob & co', 'jacob & co.', 'jacob&co', 'jacob and co', 'jacob and co.', 'jacob', 'jacob casino', 'jacob flawless dragon astronomia'],
  'Chopard': ['chopard'],
  'De Bethune': ['de bethune'],
  'Greubel Forsey': ['greubel forsey'],
  'Bell & Ross': ['bell & ross'],
  'Jaquet Droz': ['jaquet droz'],
  'Harry Winston': ['harry winston'],
  'Corum': ['corum'],
  'Van Cleef & Arpels': ['van cleef & arpels', 'van cleef', 'vca'],
  'Glashutte Original': ['glashütte original', 'glashutte original', 'glashütte', 'glashutte', 'glasshutte', 'glas hutte'],
  'Ferrari': ['ferrari'],
  'Hermes': ['hermès', 'hermes', 'kelly', 'birkin', 'constance', 'new mini kelly', 'new mini kelly 20 blue de nord palladium hardware w stamp'],
  'Louis Vuitton': ['louis vuitton'],
  'Roger Dubuis': ['roger dubuis'],
  'Parmigiani Fleurier': ['parmigiani fleurier', 'parmigiani'],
  'Chanel': ['chanel'],
  'Gerald Genta': ['gerald genta', 'gérald genta', 'g.genta'],
  'H. Moser & Cie': ['h. moser & cie.', 'h. moser & cie', 'h.moser & cie.', 'h.moser & cie', 'h.moser', 'h. moser', 'moser'],
  'Bovet': ['bovet'],
  'Universal Geneve': ['universal genève', 'universal geneve', 'universal'],
  'Longines': ['longines'],
  'Urwerk': ['urwerk'],
  'Tiffany & Co.': ['tiffany', 'tiffany & co.', 'tiffany & co', 't&co'],
  'Christian Dior': ['christian dior', 'dior'],
  'Czapek': ['czapek'],
  'Arnold & Son': ['arnold & son'],
  'Laurent Ferrier': ['laurent ferrier'],
  'HYT': ['hyt'],
  'Konstantin Chaykin': ['konstantin chaykin', 'behrens x konstantin chaykin', 'bëhrens x konstantin chäykin'],
  'Gerald Charles': ['gerald charles'],
  'Daniel Roth': ['daniel roth'],
  'Graham': ['graham'],
  'Rado': ['rado'],
  'Ressence': ['ressence'],
  'Gucci': ['gucci'],
  'Krayon': ['krayon'],
  'Chronoswiss': ['chronoswiss'],
  'Voutilainen': ['voutilainen', 'kari voutilainen'],
  'Louis Moinet': ['louis moinet'],
  'Baume & Mercier': ['baume & mercier'],
  'FRED': ['fred'],
  'Movado': ['movado'],
  'Studio Underd0g': ['studio underd0g'],
  'Prada': ['prada'],
  'Ebel': ['ebel'],
  'Hamilton': ['hamilton'],
  'Carl F. Bucherer': ['carl f. bucherer', 'carl f.bucherer', 'bucherer'],
  'Casio': ['casio', 'g-shock'],
  'Otsuka Lotec': ['otsuka lotec', 'otsuka'],
  'Tissot': ['tissot'],
  'Graff': ['graff'],
  'Cvstos': ['cvstos'],
  'Montblanc': ['montblanc', 'montblanc '.trim()],
  'Porsche Design': ['porsche design'],
  'Swatch': ['swatch'],
  'Bamford': ['bamford'],
  'DeLaneau': ['delaneau'],
  'Nomos': ['nomos'],
  'Berneron': ['berneron'],
  'Chaumet': ['chaumet'],
  'Ball': ['ball'],
  'Gevril': ['gevril'],
  'Romain Jerome': ['romain jerome'],
  'Burberry': ['burberry'],
  'MING': ['ming'],
  'Frederique Constant': ['frederique constant'],
  'Petermann Bedat': ['petermann bedat', 'petermann bédat'],
  'Bremont': ['bremont'],
  'Philip Stein': ['philip stein'],
  'Armin Strom': ['armin strom'],
  'Akrivia': ['akrivia'],
  'De Grisogono': ['de grisogono', 'de grisogono'],
  'Lang & Heyne': ['lang & heyne'],
  'Bulova': ['bulova'],
  'Artisans de Geneve': ['artisans de genève'],
  'Trilobe': ['trilobe'],
  'MeisterSinger': ['meistersinger'],
  'Christophe Claret': ['christophe claret'],
  'Cuervo y Sobrinos': ['cuervo y sobrinos'],
  'Aero Watch': ['aero watch'],
  'Gronefeld': ['gronefeld', 'grönefeld', 'grone'],
  'Fears': ['fears'],
  'Norqain': ['norqain'],
  'Urban Jurgensen': ['urban jurgensen', 'urban jürgensen'],
  'Jaguar': ['jaguar'],
  'Concord': ['concord'],
  'Bottega Veneta': ['bottega veneta'],
  'Mido': ['mido'],
  'Muhle Glashutte': ['muhle glashutte'],
  'Invicta': ['invicta'],
  'Anonimo': ['anonimo'],
  'Fendi': ['fendi'],
  'Marco Bicego': ['marco bicego'],
  'Ducati': ['ducati'],
  'Jack Panther': ['jack panther'],
  'Boucheron': ['boucheron'],
  'Ferdinand Berthoud': ['ferdinand berthoud', 'ferdinand berthound'],
  'Raymond Weil': ['raymond weil'],
  'Certina': ['certina'],
  'Favre Leuba': ['favre leuba'],
  'Alain Silberstein': ['alain silberstein'],
  'Christiaan van der Klaauw': ['christiaan van der klaauw'],
};

// Brand values that represent NON-WATCH products (accessories, cars, tech,
// generic terms) — leaked into the brand field from misparsed listings.
// These should be flagged for review, NOT canonicalized as a watch brand.
const NON_WATCH_BRANDS = new Set([
  'apple', 'ferrari', 'mercedes-benz', 'jaguar', 'ducati', 'porsche design',
  'casio', 'garmin', 'asics', 'tether', 'coca-cola', 'nike', 'mclaren',
  'jordan', 'saucony', 'tommy hilfiger', 'ysl', 'saint laurent',
  'royal canadian mint', 'pcgs', 'watch centre', 'time crown',
]);

// Values that are clearly NOT a brand at all — reference numbers, single
// letters, condition/status words, or other field data leaked into brand.
// Regex-based since these follow patterns rather than a fixed list.
const GARBAGE_BRAND_PATTERNS = [
  /^\d+$/,                          // pure numbers: "037", "16613"
  /^[a-z]$/i,                       // single letter: "E"
  /^(null|used|new|nos|naked|branded|unbranded)$/i,
  /^w[a-z0-9]{6,}$/i,               // reference-like: "WGBA0047", "W388104"
  /^m\d+/i,                         // reference-like: "M79360N", "M91550-0005"
];

/**
 * Look up the canonical brand name for a raw brand string.
 * Returns { canonical, category } where category is one of:
 *   'matched'    — confidently mapped to a canonical luxury brand
 *   'non_watch'  — a real brand name, but not a watch brand (flag for review)
 *   'garbage'    — not a brand value at all (likely a parsing error)
 *   'unmatched'  — looks like it could be a brand but isn't in our map yet
 */
function normalizeBrand(raw) {
  if (!raw || typeof raw !== 'string') return { canonical: null, category: 'garbage', original: raw };
  const trimmed = raw.trim();
  const lower = trimmed.toLowerCase();

  // "Unknown" is a legitimate placeholder — the parser genuinely could not
  // determine a brand. Keep it as-is; do not null it out or treat as garbage.
  if (lower === 'unknown') {
    return { canonical: 'Unknown', category: 'already_canonical', original: raw };
  }

  if (NON_WATCH_BRANDS.has(lower)) {
    return { canonical: trimmed, category: 'non_watch', original: raw };
  }

  for (const pattern of GARBAGE_BRAND_PATTERNS) {
    if (pattern.test(trimmed)) {
      return { canonical: null, category: 'garbage', original: raw };
    }
  }

  for (const [canonical, aliases] of Object.entries(CANONICAL_BRANDS)) {
    if (aliases.includes(lower)) {
      return { canonical, category: canonical === trimmed ? 'already_canonical' : 'matched', original: raw };
    }
  }

  return { canonical: trimmed, category: 'unmatched', original: raw };
}

module.exports = { CANONICAL_BRANDS, NON_WATCH_BRANDS, GARBAGE_BRAND_PATTERNS, normalizeBrand };
