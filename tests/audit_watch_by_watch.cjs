const fs = require('fs');
const path = require('path');

console.log('=' .repeat(80));
console.log('WATCH-BY-WATCH & MODEL REFERENCE COMPREHENSIVE AUDIT');
console.log('=' .repeat(80));

const jsonPath = path.resolve(process.cwd(), 'enriched_refs.json');
if (!fs.existsSync(jsonPath)) {
  console.error('enriched_refs.json not found!');
  process.exit(1);
}

const payload = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
const totalRefs = Object.keys(payload).length;
console.log(`Total pre-computed reference entries in payload: ${totalRefs.toLocaleString()}\n`);

const TEST_REFERENCES = [
  // Patek Philippe
  { brand: 'Patek Philippe', ref: '5711/1A', code: '5711/1A' },
  { brand: 'Patek Philippe', ref: '5712/1A', code: '5712/1A' },
  { brand: 'Patek Philippe', ref: '5980/1A', code: '5980/1A' },
  { brand: 'Patek Philippe', ref: '5167A', code: '5167A' },
  { brand: 'Patek Philippe', ref: '5270G', code: '5270G' },

  // Rolex
  { brand: 'Rolex', ref: '116500LN', code: '116500LN' },
  { brand: 'Rolex', ref: '126500LN', code: '126500LN' },
  { brand: 'Rolex', ref: '116610LV', code: '116610LV' },
  { brand: 'Rolex', ref: '126710BLRO', code: '126710BLRO' },
  { brand: 'Rolex', ref: '228238', code: '228238' },

  // Audemars Piguet
  { brand: 'Audemars Piguet', ref: '15202ST', code: '15202ST' },
  { brand: 'Audemars Piguet', ref: '15500ST', code: '15500ST' },
  { brand: 'Audemars Piguet', ref: '26331ST', code: '26331ST' },
  { brand: 'Audemars Piguet', ref: '26240ST', code: '26240ST' },

  // Richard Mille
  { brand: 'Richard Mille', ref: 'RM11-03', code: 'RM1103' },
  { brand: 'Richard Mille', ref: 'RM055', code: 'RM055' },

  // Omega
  { brand: 'Omega', ref: '311.30.42.30.01.005', code: '31130423001005' },

  // Vacheron Constantin
  { brand: 'Vacheron Constantin', ref: '4500V', code: '4500V' }
];

const auditResults = [];

for (const t of TEST_REFERENCES) {
  // Normalize search key
  const cleanKey = t.ref.toUpperCase().replace(/[^A-Z0-9]/g, '');
  const matchKey = Object.keys(payload).find(k => k.replace(/[^A-Z0-9]/g, '') === cleanKey);
  const data = matchKey ? payload[matchKey] : null;

  if (data) {
    auditResults.push({
      brand: data.brand || t.brand,
      ref: data.reference || t.ref,
      key: matchKey,
      count: data.count || 0,
      wtb_demand: data.wtb_demand || 0,
      min: data.min || 0,
      avg: data.avg || 0,
      max: data.max || 0,
      median: data.median || 0,
      dials: (data.dial_breakdown || []).map(d => `${d.dial_color}: ${d.count}`).join(', '),
      samples: (data.sampledListings || []).length
    });
  } else {
    auditResults.push({
      brand: t.brand,
      ref: t.ref,
      key: cleanKey,
      count: 0,
      wtb_demand: 0,
      min: 0, avg: 0, max: 0, median: 0,
      dials: 'None',
      samples: 0
    });
  }
}

console.table(auditResults);

// Summary Metrics across entire dataset
let totalWTS = 0;
let totalWTB = 0;
let refsWithWTB = 0;
let refsWithDials = 0;

for (const [key, item] of Object.entries(payload)) {
  totalWTS += item.count || 0;
  totalWTB += item.wtb_demand || 0;
  if (item.wtb_demand > 0) refsWithWTB += 1;
  if (item.dial_breakdown && item.dial_breakdown.length > 0) refsWithDials += 1;
}

console.log('\n' + '=' .repeat(80));
console.log('GRAND DATASET SUMMARY METRICS');
console.log('=' .repeat(80));
console.log(`Pre-computed References:       ${totalRefs.toLocaleString()}`);
console.log(`Total WTS Listings Covered:   ${totalWTS.toLocaleString()}`);
console.log(`Total WTB Demand Signals:     ${totalWTB.toLocaleString()}`);
console.log(`References with WTB Demand:   ${refsWithWTB.toLocaleString()}`);
console.log(`References with Dial Colors:  ${refsWithDials.toLocaleString()}`);
console.log('=' .repeat(80));
