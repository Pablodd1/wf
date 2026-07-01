#!/usr/bin/env node
/**
 * Build lightweight brand/reference index files for Price Research dropdowns.
 * v3: Watches-only filtering + reference quality gates.
 *
 * Changes from v2:
 * - Skips rows with flags.needs_review = 'non_watch' (Ferrari, Apple, etc.)
 * - Skips garbage brand values (pure numbers, too short, known junk)
 * - Skips garbage reference values (zero-padded, price fragments, too short)
 * - Maps model-name-as-brand to canonical brand where known
 */

const fs = require('fs');
const https = require('https');

const SUPABASE_URL = 'https://bptrvfncppbjnchsaxtb.supabase.co';
const SUPABASE_KEY = 'eyJhbG...u8SU';

// Known non-watch brands to exclude
const NON_WATCH_BRANDS = new Set([
  'Ferrari','Apple','Mercedes-Benz','Ducati','Coca-Cola','ASICS','Garmin',
  'Fear of God','Birkin','Christian Dior','Dior','Chanel','Gucci','Fendi',
  'Burberry','Bottega Veneta','Chrome Hearts','David Yurman','Fred',
  'FRED','Glenn Spiro','Grassotti','Angela Cummings','Constance',
  'Australian Kangaroo','Czech Leopard','Granat','Bluecroft','Baltic',
  'Beaubleu','Boneta Inc.','BonetaWholesale.com','BT Watches','Buchira',
  'Brickell Watches','ChronoGrid','Depeche','Factory','FIN','BIG','PJ',
  'RX','UN','GOA','E','Used','Unbranded','Branded','037','16613'
]);

// Model names that should map to real brands
const MODEL_TO_BRAND = {
  'Datejust': 'Rolex',
  'Day-date': 'Rolex',
  'Submariner': 'Rolex',
  'Gmt-master': 'Rolex',
  'Gmt-master Ii': 'Rolex',
  'Big Bang': 'Hublot',
  'Ballon Bleu': 'Cartier',
  'Diva Dream': 'Bulgari',
  'B.Zero1': 'Bulgari',
  'Nautilus': 'Patek Philippe',
  'Aquanaut': 'Patek Philippe',
  'Royal Oak': 'Audemars Piguet',
  'Overseas': 'Vacheron Constantin',
  'Patrimony': 'Vacheron Constantin',
  'Overseas': 'Vacheron Constantin',
  'Overseas': 'Vacheron Constantin',
  'Overseas': 'Vacheron Constantin',
};

function isGarbageBrand(brand) {
  if (!brand || brand === 'Unknown') return true;
  if (NON_WATCH_BRANDS.has(brand)) return true;
  if (/^\d+$/.test(brand)) return true;           // pure numbers like "037", "16613"
  if (brand.length <= 2) return true;              // too short: "E", "RX", "UN", "PJ"
  if (/^(Used|Factory|Unbranded|Branded)$/i.test(brand)) return true;
  return false;
}

function isGarbageReference(ref) {
  if (!ref) return true;
  if (ref.length < 4 || ref.length > 25) return true;
  if (/^(19|20)\d{2}$/.test(ref)) return true;     // years
  if (/^0\d+$/.test(ref)) return true;              // zero-padded: "0002", "0011"
  if (/\b(HKD|AED|USD|EUR|GBP|CHF|JPY|CNY)\b/i.test(ref)) return true; // currency codes
  if (/\b(GREY|MSRP|WANT|ONLY|BEST|BOX|PAPERS|FULL|SET|BNIB|B&P)\b/i.test(ref)) return true;
  if (/^\d{1,3}$/.test(ref)) return true;           // 1-3 digit pure numbers
  if (/^\d{4}$/.test(ref) && !/^[1-9]\d{3}$/.test(ref)) return true; // 4-digit starting with 0
  return false;
}

function fetchPage(p) {
  return new Promise((resolve, reject) => {
    https.get(`${SUPABASE_URL}${p}`, {
      headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` }
    }, res => {
      let body = '';
      res.on('data', d => body += d);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(body);
          resolve({ status: res.statusCode, data: parsed });
        }
        catch (e) { reject(new Error(`Parse error: ${e.message}`)); }
      });
    }).on('error', reject);
  });
}

async function main() {
  console.log('Building brand/reference index — v3 (watches-only, quality gates)...');

  const brandIndex = {};
  const refCount = {};
  const PAGE_SIZE = 1000;
  let lastId = '00000000-0000-0000-0000-000000000000';
  let total = 0;
  let skipped = 0;
  let consecutiveErrors = 0;
  const MAX_CONSECUTIVE_ERRORS = 5;

  while (true) {
    let result;
    try {
      result = await fetchPage(
        `/rest/v1/watch_records?select=id,brand,reference,flags&id=gt.${lastId}&order=id.asc&limit=${PAGE_SIZE}`
      );
    } catch (e) {
      consecutiveErrors++;
      console.log(`  Fetch error (${consecutiveErrors}/${MAX_CONSECUTIVE_ERRORS}): ${e.message}`);
      if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
        console.log('  Too many consecutive errors, stopping.');
        break;
      }
      await new Promise(r => setTimeout(r, 2000));
      continue;
    }

    if (result.status !== 200) {
      consecutiveErrors++;
      console.log(`  HTTP ${result.status} at lastId=${lastId} (${consecutiveErrors}/${MAX_CONSECUTIVE_ERRORS})`);
      if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) break;
      await new Promise(r => setTimeout(r, 2000));
      continue;
    }
    consecutiveErrors = 0;

    const batch = result.data;
    if (!Array.isArray(batch) || batch.length === 0) break;

    for (const r of batch) {
      // Skip non-watch items
      if (r.flags && r.flags.needs_review === 'non_watch') {
        skipped++;
        continue;
      }

      let brand = r.brand || 'Unknown';

      // Map model-name-as-brand to canonical
      if (MODEL_TO_BRAND[brand]) {
        brand = MODEL_TO_BRAND[brand];
      }

      // Skip garbage brands
      if (isGarbageBrand(brand)) {
        skipped++;
        continue;
      }

      if (!brandIndex[brand]) brandIndex[brand] = new Set();

      const ref = r.reference;
      if (ref && !isGarbageReference(ref)) {
        brandIndex[brand].add(ref);
        refCount[ref] = (refCount[ref] || 0) + 1;
      }
    }

    lastId = batch[batch.length - 1].id;
    total += batch.length;
    if (total % 200000 === 0) console.log(`  ${total.toLocaleString()} rows scanned... (skipped=${skipped})`);

    if (batch.length < PAGE_SIZE) break;
  }

  console.log(`Scanned ${total.toLocaleString()} rows total. Skipped ${skipped} garbage/non-watch rows.`);

  const brandIndexObj = {};
  for (const [b, refs] of Object.entries(brandIndex)) {
    brandIndexObj[b] = [...refs].filter(Boolean).sort();
  }
  fs.writeFileSync('public/watchfacts-brand-index.json', JSON.stringify(brandIndexObj));
  const brandIndexSize = fs.statSync('public/watchfacts-brand-index.json').size;
  console.log(`Brand index: ${Object.keys(brandIndexObj).length} brands, ${(brandIndexSize/1024).toFixed(0)} KB`);

  const topRefs = Object.entries(refCount)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10000)
    .map(([ref, count]) => ({ ref, count }));
  fs.writeFileSync('public/watchfacts-ref-index.json', JSON.stringify(topRefs));
  const refIndexSize = fs.statSync('public/watchfacts-ref-index.json').size;
  console.log(`Ref index: ${topRefs.length} references, ${(refIndexSize/1024).toFixed(0)} KB`);

  console.log('\n✅ Index build complete.');
}

main().catch(e => {
  console.error('Index build failed:', e.message);
  process.exit(1);
});
