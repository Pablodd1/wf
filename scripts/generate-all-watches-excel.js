const XLSX = require('xlsx');
const fs = require('fs');
const path = require('path');

const DESKTOP = '/mnt/c/Users/jasme/Desktop';
const DOWNLOADS = '/mnt/c/Users/jasme/Downloads';

// 1. Read TSV files from Desktop
const tsvFiles = fs.readdirSync(DESKTOP)
  .filter(f => f.endsWith('_corrected.tsv') && f.startsWith('WF_'));
console.log(`Found ${tsvFiles.length} TSV files`);

// 2. Collect all watches grouped by brand
const brandSheets = {};

tsvFiles.forEach(file => {
  const lines = fs.readFileSync(path.join(DESKTOP, file), 'utf8').split('\n');
  const header = lines[0].split('\t');
  
  for (let i = 1; i < lines.length; i++) {
    if (!lines[i].trim()) continue;
    const cols = lines[i].split('\t');
    const row = {};
    header.forEach((h, idx) => { row[h] = cols[idx] || null; });
    
    const brand = row.brand || 'Unknown';
    if (!brandSheets[brand]) brandSheets[brand] = [];
    
    // Apply JASS v corrections (handle both camelCase and snake_case)
    const corrected = {
      brand: row.brand || 'Unknown',
      reference: row.reference || '',
      price: row.price_usd || row.price || '',
      dial: row.dialColor === 'undefined' || row.dialColor === 'null' ? '' : (row.dialColor || row.dial_color || ''),
      condition: row.condition || '',
      year: row.year || '',
      raw_message: row.raw_message || row.rawMessage || row.RAW_MESSAGE || '',
      verdict: row.verdict || '',
      confidence: row.confidence || '',
      catalog_match: row.catalogMatched || row.catalog_matched || 'NO',
      multi_flag: row.multiWatch === 'YES' ? 'MULTI' : (row.listingType === 'MULTI_WATCH_STOCK_LIST' ? 'MULTI' : (row.multi_flag || 'SINGLE')),
      watches_in_msg: row.watches_in_msg || '1',
      missing_fields: row.reviewReason || (row.review_reason ? row.review_reason.replace(/_/g, ' ') : ''),
    };
    
    brandSheets[brand].push(corrected);
  }
});

// 3. Create SUMMARY sheet (brand-level stats)
const summaryRows = [];
Object.keys(brandSheets).sort().forEach(brand => {
  const rows = brandSheets[brand];
  const approved = rows.filter(r => r.verdict === 'APPROVED').length;
  const review = rows.filter(r => r.verdict === 'REVIEW').length;
  const manual = rows.filter(r => r.verdict === 'HUMAN').length;
  const avgScore = rows.reduce((s, r) => s + (parseInt(r.confidence) || 0), 0) / rows.length || 0;
  
  summaryRows.push({
    BRAND: brand,
    WATCHES: rows.length,
    AVG_SCORE: Math.round(avgScore),
    APPROVED: approved,
    REVIEW: review,
    MANUAL: manual,
    '% APPROVED': rows.length ? Math.round(approved / rows.length * 100) + '%' : '0%',
    CATALOG_MATCH: rows.filter(r => r.catalog_match === 'YES').length,
    MULTI_LISTINGS: rows.filter(r => r.multi_flag === 'MULTI').length,
  });
});

// 4. Write Excel
const wb = XLSX.utils.book_new();

// SUMMARY sheet
const summaryWS = XLSX.utils.json_to_sheet(summaryRows);
XLSX.utils.book_append_sheet(wb, summaryWS, 'SUMMARY');

// Brand sheets
Object.keys(brandSheets).sort().forEach(brand => {
  const rows = brandSheets[brand];
  const ws = XLSX.utils.json_to_sheet(rows);
  XLSX.utils.book_append_sheet(wb, ws, brand.substring(0, 31)); // Excel sheet name limit
});

// Save
const outputPath = path.join(DOWNLOADS, 'WATCHES_FINAL_V3.xlsx');
XLSX.writeFile(wb, outputPath);
console.log(`\n✓ Saved: ${outputPath}`);
console.log(`  Sheets: ${wb.SheetNames.length} (SUMMARY + ${Object.keys(brandSheets).length} brands)`);
console.log(`  Total watches: ${Object.values(brandSheets).reduce((s, r) => s + r.length, 0)}`);
