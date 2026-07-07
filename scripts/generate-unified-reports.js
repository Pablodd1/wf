const XLSX = require('xlsx');
const fs = require('fs');
const path = require('path');

const DESKTOP = '/mnt/c/Users/jasme/Desktop';
const DOWNLOADS = '/mnt/c/Users/jasme/Downloads';

// 1. WTS: Read all WF_WTS_*_corrected.tsv files
const wtsFiles = fs.readdirSync(DESKTOP)
  .filter(f => f.startsWith('WF_WTS_') && f.endsWith('_corrected.tsv'));

let wtsRows = [];
wtsFiles.forEach(file => {
  const lines = fs.readFileSync(path.join(DESKTOP, file), 'utf8').split('\n');
  const header = lines[0].split('\t');
  for (let i = 1; i < lines.length; i++) {
    if (!lines[i].trim()) continue;
    const cols = lines[i].split('\t');
    const row = {};
    header.forEach((h, idx) => { row[h] = cols[idx] || null; });
    if (row.verdict === 'WTS' || row.verdict === 'APPROVED' || row.verdict === 'REVIEW') {
      wtsRows.push(row);
    }
  }
});

// 2. WTB: Read WF_WTB_corrected.tsv
let wtbRows = [];
const wtbFile = path.join(DESKTOP, 'WF_WTB_corrected.tsv');
if (fs.existsSync(wtbFile)) {
  const lines = fs.readFileSync(wtbFile, 'utf8').split('\n');
  const header = lines[0].split('\t');
  for (let i = 1; i < lines.length; i++) {
    if (!lines[i].trim()) continue;
    const cols = lines[i].split('\t');
    const row = {};
    header.forEach((h, idx) => { row[h] = cols[idx] || null; });
    wtbRows.push(row);
  }
}

// 3. Generate WTS report (1 sheet)
const wtsWS = XLSX.utils.json_to_sheet(wtsRows.map(r => ({
  brand: r.brand,
  reference: r.reference,
  dialColor: r.dial_color || '',
  price: r.price_usd || r.price || '',
  currency: r.currency || '',
  condition: r.condition || '',
  year: r.year || '',
  confidence: r.confidence || '',
  verdict: r.verdict || '',
  raw_message: r.raw_message || r.RAW_MESSAGE || ''
})));

const wtsWB = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(wtsWB, wtsWS, 'WTS_All');
XLSX.writeFile(wtsWB, path.join(DOWNLOADS, 'WF_WTS_Selling.xlsx'));
console.log(`✓ WF_WTS_Selling.xlsx: ${wtsRows.length} rows`);

// 4. Generate WTB report (1 sheet)
const wtbWS = XLSX.utils.json_to_sheet(wtbRows.map(r => ({
  brand: r.brand,
  reference: r.reference,
  dialColor: r.dial_color || '',
  price: r.price_usd || r.price || '',
  currency: r.currency || '',
  condition: r.condition || '',
  year: r.year || '',
  confidence: r.confidence || '',
  verdict: r.verdict || '',
  raw_message: r.raw_message || r.RAW_MESSAGE || ''
})));

const wtbWB = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(wtbWB, wtbWS, 'WTB_All');
XLSX.writeFile(wtbWB, path.join(DOWNLOADS, 'WF_WTB_Looking.xlsx'));
console.log(`✓ WF_WTB_Looking.xlsx: ${wtbRows.length} rows`);

console.log('\nDone — 2 reports generated in Downloads.');
