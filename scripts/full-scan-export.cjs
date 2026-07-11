#!/usr/bin/env node
const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');

const s = createClient(
  'https://bptrvfncppbjnchsaxtb.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJwdHJ2Zm5jcHBiam5jaHNheHRiIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4MTU2MjYzMSwiZXhwIjoyMDk3MTM4NjMxfQ.x1KpnBCtgcn02hiBJfuNkm3FYq6elHv3Gnys62nu8SU',
  { auth: { persistSession: false } }
);
const DESKTOP = '/mnt/c/Users/jasme/Desktop';

function clean(s) {
  if (!s) return '';
  return String(s).replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F-\x9F]/g, '')
    .replace(/"/g, '""').replace(/\n/g, ' | ').replace(/\r/g, '');
}
function csv(fields) { return fields.map(f => '"' + clean(f) + '"').join(','); }

async function doBatch(offset) {
  const { data, error } = await s.from('watch_records')
    .select('id,brand,reference,dial_color,price_usd,verdict,listing_type,raw_message,created_at,source')
    .range(offset, offset + 499);
  return { data, error };
}

async function run() {
  const multi = [], nonWatch = [], wtb = [];
  let total = 0;
  
  console.log('Scanning...');
  
  for (let offset = 0; offset < 500000; offset += 500) {
    const { data, error } = await doBatch(offset);
    if (error) {
      console.error('Error at offset ' + offset + ':', error.message);
      break;
    }
    if (!data || data.length === 0) break;
    
    for (const r of data) {
      if (r.source !== 'MYSQL_RAW') continue;
      const m = (r.raw_message || '');
      if (m.length < 15) continue;
      
      const priceMatches = m.match(/\$[\d,]+|[\d,]+k?\s*(?:hkd|usd)|[\d,]+\s*(?:hkd|usd)/gi) || [];
      const uniquePrices = new Set(priceMatches.map(p => p.toLowerCase().trim()));
      const hasPriceBullets = /[⭐🌟★●♦▶☞📦🎁💝💥🔴🟢]/.test(m);
      const isMulti = (hasPriceBullets && uniquePrices.size >= 2) || (uniquePrices.size >= 3 && m.length > 100);
      
      const isWTB = /\b(WTB|WANT TO BUY|looking for|anyone have|need to buy|need to find|searching for)\b/i.test(m);
      
      const nonWatchRe = /\b(tool|flashlight|knife|wallet|belt|shirt|shoe|purse|necklace|earring|sunglass|perfume|cufflink|charger|cable|headphone|speaker)\b|phone\b(?!.*watch)|bag\b(?!.*watch)|pen\b(?!.*pen.*watch)|ring\b(?!.*(watch|rolex|patek|ap|audemars))|bracelet\b(?!.*watch)/i;
      const hasWatchBrand = /\b(rolex|patek|audemars|omega|cartier|panerai|breitling|hublot|iwc|tudor|zenith|richard mille|breguet|blancpain|vacheron|chopard|bvlgar|tag heuer|jaeger|grand seiko|franck muller)\b/i;
      const isNonWatch = nonWatchRe.test(m) && !hasWatchBrand;
      
      const base = {
        id: (r.id || '').substring(0, 35),
        brand: r.brand || '',
        reference: r.reference || '',
        dial: r.dial_color || '',
        price: r.price_usd || 0,
        verdict: r.verdict || '',
        listing_type: r.listing_type || '',
        date: (r.created_at || '').substring(0, 10),
        snippet: m.substring(0, 300)
      };
      
      if (isMulti) multi.push({ ...base, price_lines: uniquePrices.size });
      else if (isWTB) wtb.push(base);
      else if (isNonWatch) nonWatch.push(base);
    }
    
    total += data.length;
    if (total % 25000 === 0) {
      console.log('  ' + total.toLocaleString() + ' | multi=' + multi.length + ' nw=' + nonWatch.length + ' wtb=' + wtb.length);
    }
  }
  
  console.log('\n=== RESULTS ===');
  console.log('Scanned: ' + total.toLocaleString());
  console.log('Multi-listings: ' + multi.length);
  console.log('Non-watch: ' + nonWatch.length);
  console.log('WTB (looking): ' + wtb.length);
  
  // EXPORT CSVs
  if (multi.length > 0) {
    const h = 'ID,Brand,Reference,Dial,Price_USD,Verdict,Listing_Type,Date,Price_Lines,Snippet\n';
    const rows = multi.map(r => csv([r.id, r.brand, r.reference, r.dial, r.price, r.verdict, r.listing_type, r.date, r.price_lines, r.snippet]));
    fs.writeFileSync(DESKTOP + '/multi-listings.csv', h + rows.join('\n'));
    console.log('\n→ Desktop/multi-listings.csv: ' + multi.length + ' rows');
  }
  if (nonWatch.length > 0) {
    const h = 'ID,Brand,Reference,Dial,Price_USD,Verdict,Listing_Type,Date,Snippet\n';
    const rows = nonWatch.map(r => csv([r.id, r.brand, r.reference, r.dial, r.price, r.verdict, r.listing_type, r.date, r.snippet]));
    fs.writeFileSync(DESKTOP + '/non-watch-items.csv', h + rows.join('\n'));
    console.log('→ Desktop/non-watch-items.csv: ' + nonWatch.length + ' rows');
  }
  if (wtb.length > 0) {
    const h = 'ID,Brand,Reference,Dial,Price_USD,Verdict,Listing_Type,Date,Snippet\n';
    const rows = wtb.map(r => csv([r.id, r.brand, r.reference, r.dial, r.price, r.verdict, r.listing_type, r.date, r.snippet]));
    fs.writeFileSync(DESKTOP + '/wtb-looking.csv', h + rows.join('\n'));
    console.log('→ Desktop/wtb-looking.csv: ' + wtb.length + ' rows');
  }
  
  // Stats
  const mb = {}; multi.forEach(r => { const b = r.brand || 'Unknown'; mb[b] = (mb[b]||0)+1; });
  console.log('\nMulti-listing top brands:');
  Object.entries(mb).sort((a,b) => b[1]-a[1]).slice(0, 8).forEach(([b,c]) => console.log('  ' + b + ': ' + c));
  
  const wb = {}; wtb.forEach(r => { const b = r.brand || 'Unknown'; wb[b] = (wb[b]||0)+1; });
  console.log('\nWTB top brands:');
  Object.entries(wb).sort((a,b) => b[1]-a[1]).slice(0, 8).forEach(([b,c]) => console.log('  ' + b + ': ' + c));
  
  console.log('\nDone.');
}
run().catch(e => console.error('FATAL:', e));
