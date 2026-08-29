const fs = require('fs');
const path = require('path');

const jsonPath = path.resolve(process.cwd(), 'enriched_refs.json');
const payload = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));

const TEST_REFERENCES = [
  { brand: 'Patek Philippe', ref: '5711/1A' },
  { brand: 'Patek Philippe', ref: '5712/1A' },
  { brand: 'Patek Philippe', ref: '5980/1A' },
  { brand: 'Patek Philippe', ref: '5167A' },
  { brand: 'Patek Philippe', ref: '5270G' },

  { brand: 'Rolex', ref: '116500LN' },
  { brand: 'Rolex', ref: '126500LN' },
  { brand: 'Rolex', ref: '116610LV' },
  { brand: 'Rolex', ref: '126710BLRO' },
  { brand: 'Rolex', ref: '228238' },

  { brand: 'Audemars Piguet', ref: '15202ST' },
  { brand: 'Audemars Piguet', ref: '15500ST' },
  { brand: 'Audemars Piguet', ref: '26331ST' },
  { brand: 'Audemars Piguet', ref: '26240ST' },

  { brand: 'Richard Mille', ref: 'RM11-03' },
  { brand: 'Richard Mille', ref: 'RM055' },

  { brand: 'Omega', ref: '311.30.42.30.01.005' },
  { brand: 'Vacheron Constantin', ref: '4500V' }
];

console.log('| Brand | Reference | WTS Count | WTB Demand | Median Price | Min Price | Max Price | Dials Covered |');
console.log('| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |');

for (const t of TEST_REFERENCES) {
  const cleanKey = t.ref.toUpperCase().replace(/[^A-Z0-9]/g, '');
  const matchKey = Object.keys(payload).find(k => k.replace(/[^A-Z0-9]/g, '') === cleanKey);
  const data = matchKey ? payload[matchKey] : null;

  if (data) {
    const dials = (data.dial_breakdown || []).map(d => d.dial_color).slice(0, 4).join(', ');
    console.log(`| ${data.brand || t.brand} | \`${data.reference || t.ref}\` | ${data.count.toLocaleString()} | ${data.wtb_demand.toLocaleString()} | $${data.median.toLocaleString()} | $${data.min.toLocaleString()} | $${data.max.toLocaleString()} | ${dials || 'Default'} |`);
  } else {
    console.log(`| ${t.brand} | \`${t.ref}\` | 0 | 0 | $0 | $0 | $0 | N/A |`);
  }
}
