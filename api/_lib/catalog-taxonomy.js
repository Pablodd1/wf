/**
 * CANONICAL CATALOG TAXONOMY ROLLUP ENGINE
 * 
 * Normalizes model names and resolves fragmented sub-collections, complication types,
 * and edition nicknames into canonical parent collection hierarchies.
 */

const PATEK_COLLECTION_ROLLUPS = [
  // Nautilus Rollups
  { pattern: /^nautilus\b/i, canonical: 'Nautilus' },
  
  // Aquanaut Rollups
  { pattern: /^aquanaut\b/i, canonical: 'Aquanaut' },

  // Cubitus Rollups
  { pattern: /^cubitus\b/i, canonical: 'Cubitus' },

  // Gondolo Rollups
  { pattern: /^gondolo\b/i, canonical: 'Gondolo' },

  // Twenty~4 Rollups
  { pattern: /^twenty[~\-\s]?4\b/i, canonical: 'Twenty~4' },

  // Calatrava Rollups
  { pattern: /^calatrava\b/i, canonical: 'Calatrava' },

  // Ellipse Rollups
  { pattern: /^(golden\s+)?ellipse\b/i, canonical: 'Golden Ellipse' },

  // Complications & Grand Complications Rollups (Grand Complications first)
  {
    pattern: /^(grand\s+complication|perpetual\s+calendar|tourbillon|minute\s+repeater\s+perpetual)/i,
    canonical: 'Grand Complications'
  },
  {
    pattern: /^(annual\s+calendar|chronograph|minute\s+repeater|split[ \-]?seconds|world\s+time|travel\s+time|flyback|regulator|celestial|astronomy|alarm)/i,
    canonical: 'Complications'
  }
];

const GENERAL_MODEL_ROLLUPS = {
  'Audemars Piguet': [
    { pattern: /^royal\s+oak\s+offshore\b/i, canonical: 'Royal Oak Offshore' },
    { pattern: /^royal\s+oak\s+concept\b/i, canonical: 'Royal Oak Concept' },
    { pattern: /^royal\s+oak\b/i, canonical: 'Royal Oak' },
    { pattern: /^code\s*11\.?59\b/i, canonical: 'Code 11.59' }
  ],
  'Rolex': [
    { pattern: /^daytona\b/i, canonical: 'Daytona' },
    { pattern: /^submariner\b/i, canonical: 'Submariner' },
    { pattern: /^datejust\b/i, canonical: 'Datejust' },
    { pattern: /^day[ \-]?date\b/i, canonical: 'Day-Date' },
    { pattern: /^gmt[ \-]?master\b/i, canonical: 'GMT-Master II' },
    { pattern: /^sea[ \-]?dweller\b/i, canonical: 'Sea-Dweller' },
    { pattern: /^yacht[ \-]?master\b/i, canonical: 'Yacht-Master' },
    { pattern: /^explorer\b/i, canonical: 'Explorer' },
    { pattern: /^sky[ \-]?dweller\b/i, canonical: 'Sky-Dweller' },
    { pattern: /^oyster\s+perpetual\b/i, canonical: 'Oyster Perpetual' }
  ],
  'Tudor': [
    { pattern: /^black\s*bay\s*gmt\b/i, canonical: 'Black Bay GMT' },
    { pattern: /^black\s*bay\s*p01\b/i, canonical: 'Black Bay P01' },
    { pattern: /^black\s*bay\s*chrono\b/i, canonical: 'Black Bay Chrono' },
    { pattern: /^black\s*bay\b/i, canonical: 'Black Bay' },
    { pattern: /^pelagos\b/i, canonical: 'Pelagos' },
    { pattern: /^glamour\b/i, canonical: 'Glamour' },
    { pattern: /^ranger\b/i, canonical: 'Ranger' },
    { pattern: /^heritage\s*chrono\b/i, canonical: 'Heritage Chrono' },
    { pattern: /^heritage\b/i, canonical: 'Heritage' },
    { pattern: /^submariner\b/i, canonical: 'Submariner' },
    { pattern: /^clair\s*de\s*rose\b/i, canonical: 'Clair de Rose' },
    { pattern: /^fastrider\b/i, canonical: 'Fastrider' },
    { pattern: /^tiger\b/i, canonical: 'Tiger' },
    { pattern: /^1926\b/i, canonical: '1926' }
  ],
  'Cartier': [
    { pattern: /^tank\s*louis\b/i, canonical: 'Tank Louis Cartier' },
    { pattern: /^tank\s*solo\b/i, canonical: 'Tank Solo' },
    { pattern: /^tank\s*must\b/i, canonical: 'Tank Must' },
    { pattern: /^tank\s*am[eé]ricaine\b/i, canonical: 'Tank Américaine' },
    { pattern: /^tank\b/i, canonical: 'Tank' },
    { pattern: /^santos[\s\-]?100\b/i, canonical: 'Santos 100' },
    { pattern: /^santos[\s\-]?dumont\b/i, canonical: 'Santos-Dumont' },
    { pattern: /^santos\b/i, canonical: 'Santos' },
    { pattern: /^panth[eè]re\b/i, canonical: 'Panthère' },
    { pattern: /^ballon\s*bleu\b/i, canonical: 'Ballon Bleu' },
    { pattern: /^ronde\s*louis\b/i, canonical: 'Ronde Louis Cartier' },
    { pattern: /^ronde\b/i, canonical: 'Ronde de Cartier' },
    { pattern: /^pasha\b/i, canonical: 'Pasha de Cartier' },
    { pattern: /^drive\b/i, canonical: 'Drive de Cartier' },
    { pattern: /^calibre\b/i, canonical: 'Calibre de Cartier' },
    { pattern: /^cl[eé]\b/i, canonical: 'Clé de Cartier' },
    { pattern: /^tortue\b/i, canonical: 'Tortue' },
    { pattern: /^rotonde\b/i, canonical: 'Rotonde de Cartier' },
    { pattern: /^declaration\b/i, canonical: 'Déclaration' },
    { pattern: /^crash\b/i, canonical: 'Crash' },
    { pattern: /^baignoire\b/i, canonical: 'Baignoire' }
  ],
  'Omega': [
    { pattern: /^speedmaster\s*moonwatch\b/i, canonical: 'Speedmaster Moonwatch' },
    { pattern: /^speedmaster\s*racing\b/i, canonical: 'Speedmaster Racing' },
    { pattern: /^speedmaster\b/i, canonical: 'Speedmaster' },
    { pattern: /^seamaster\s*aqua\s*terra\b/i, canonical: 'Seamaster Aqua Terra' },
    { pattern: /^seamaster\s*planet\s*ocean\b/i, canonical: 'Seamaster Planet Ocean' },
    { pattern: /^seamaster\s*diver\b/i, canonical: 'Seamaster Diver 300M' },
    { pattern: /^seamaster\b/i, canonical: 'Seamaster' },
    { pattern: /^constellation\b/i, canonical: 'Constellation' },
    { pattern: /^de\s*ville\s*tresor\b/i, canonical: 'De Ville Trésor' },
    { pattern: /^de\s*ville\s*hour\s*vision\b/i, canonical: 'De Ville Hour Vision' },
    { pattern: /^de\s*ville\b/i, canonical: 'De Ville' },
    { pattern: /^aqua\s*terra\b/i, canonical: 'Seamaster Aqua Terra' },
    { pattern: /^planet\s*ocean\b/i, canonical: 'Seamaster Planet Ocean' }
  ],
  'TAG Heuer': [
    { pattern: /^carrera\b/i, canonical: 'Carrera' },
    { pattern: /^formula\s*1\b/i, canonical: 'Formula 1' },
    { pattern: /^monaco\b/i, canonical: 'Monaco' },
    { pattern: /^link\b/i, canonical: 'Link' },
    { pattern: /^aquaracer\b/i, canonical: 'Aquaracer' },
    { pattern: /^autavia\b/i, canonical: 'Autavia' },
    { pattern: /^connected\b/i, canonical: 'Connected' },
    { pattern: /^heuer[\s\-]?01\b/i, canonical: 'Heuer-01' },
    { pattern: /^heuer[\s\-]?02\b/i, canonical: 'Heuer-02' },
    { pattern: /^mikrograph\b/i, canonical: 'Mikrograph' },
    { pattern: /^professional\b/i, canonical: 'Professional' }
  ]
};

/**
 * Normalizes a raw model string into its canonical parent collection.
 * 
 * @param {string} rawModel 
 * @param {string} brand 
 * @returns {string} canonical model name
 */
function normalizeCanonicalModel(rawModel, brand = '') {
  const model = String(rawModel || '').trim();
  if (!model || model === 'Reference-only listings') return model;

  const brandNormalized = String(brand || '').trim().toLowerCase();

  // Patek Philippe Normalization Rules
  if (brandNormalized.includes('patek')) {
    for (const rule of PATEK_COLLECTION_ROLLUPS) {
      if (rule.pattern.test(model)) {
        return rule.canonical;
      }
    }
  }

  // General Brand Normalization Rules
  for (const [brandKey, rules] of Object.entries(GENERAL_MODEL_ROLLUPS)) {
    if (brandNormalized.includes(brandKey.toLowerCase())) {
      for (const rule of rules) {
        if (rule.pattern.test(model)) {
          return rule.canonical;
        }
      }
    }
  }

  return model;
}

module.exports = {
  normalizeCanonicalModel,
  PATEK_COLLECTION_ROLLUPS,
  GENERAL_MODEL_ROLLUPS
};
