#!/usr/bin/env node
// Detect multi-watch stock lists and non-watch items, export to Excel
const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');

const SUPABASE_URL = 'https://bptrvfncppbjnchsaxtb.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJwdHJ2Zm5jcHBiam5jaHNheHRiIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4MTU2MjYzMSwiZXhwIjoyMDk3MTM4NjMxfQ.x1KpnBCtgcn02hiBJfuNkm3FYq6elHv3Gnys62nu8SU';
const s = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false } });

// Multi-watch indicators (dealer stock lists)
const MULTI_INDICATORS = [
  /[⭐🌟★●♦◆▶☞📦🟢🔴]/,
  /\d+\/\d+\/\d+/,  // date patterns like 5/2026  
  /\b\d{1,2}k\b.*\b\d{1,2}k\b/i,  // multiple prices like 855k...440k
  /\bnew\b.*\bused\b.*\bnew\b/i,  // mixed conditions
  /hkd\b.*\bhkd\b/i,  // multiple HKD mentions
];

// Non-watch item patterns
const NON_WATCH_PATTERNS = [
  /(?:^|\n)[^w]*(?:pen|pens)(?:\s|\n|$)/i,
  /(?:tool|flashlight|knife|wallet|belt|shirt|shoe|purse|necklace|earring|sunglass|perfume|phone|charger|cable|headphone|speaker|bag\b(?!.*watch))/i,
  /(?:cufflink|cuff\s*link)/i,
  /(?:bracelet|ring|pendant|brooch|anklet)(?!(?:.|\n)*watch)/i,
  /(?:accessor|jewelry|jewellery)(?!(?:.|\n)*watch)/i,
];

async function exportReports() {
  const multiWatches = [];
  const nonWatches = [];
  let total = 0, offset = 0;
  
  while (offset < 200000) {
    const { data } = await s.from('watch_records')
      .select('id,brand,reference,dial_color,price_usd,verdict,listing_type,raw_message,created_at')
      .eq('source', 'MYSQL_RAW')
      .range(offset, offset + 999)
      .order('id', { ascending: true });
    
    if (!data || data.length === 0) break;
    
    for (const r of data) {
      const msg = r.raw_message || '';
      if (!msg || msg.length < 20) continue;
      
      // Multi-watch: multiple price points in one message
      const priceMatches = msg.match(/\$[\d,]+|[\d,]+k\s*(?:hkd|usd)|[\d,]+\s*(?:hkd|usd)/gi) || [];
      const uniquePrices = [...new Set(priceMatches.map(p => p.toLowerCase()))];
      
      const hasBullets = /[⭐🌟★●♦▶☞📦]/.test(msg);
      const isStockList = hasBullets && uniquePrices.length >= 2;
      const isMultiPrice = uniquePrices.length >= 3 && msg.length > 100;
      
      if ((isStockList || isMultiPrice) && r.id) {
        multiWatches.push({
          id: r.id.substring(0, 30),
          brand: r.brand || 'Unknown',
          reference: r.reference || '-',
          price_usd: r.price_usd || 0,
          verdict: r.verdict,
          listing_type: r.listing_type,
          price_count: uniquePrices.length,
          snippet: msg.replace(/[\n\r]+/g, ' | ').substring(0, 250),
        });
      }
      
      // Non-watch: accessory/jewelry patterns
      const hasWatchBrand = /\b(rolex|patek|audemars|omega|cartier|panerai|breitling|hublot|iwc|tudor|zenith|richard mille|ap|pp)\b/i.test(msg);
      const hasNonWatch = NON_WATCH_PATTERNS.some(p => p.test(msg));
      
      if (hasNonWatch && !hasWatchBrand) {
        nonWatches.push({
          id: r.id.substring(0, 30),
          brand: r.brand || 'Unknown',
          reference: r.reference || '-',
          price_usd: r.price_usd || 0,
          verdict: r.verdict,
          listing_type: r.listing_type,
          snippet: msg.replace(/[\n\r]+/g, ' | ').substring(0, 200),
        });
      }
    }
    
    total += data.length;
    offset += 1000;
    if (total % 10000 === 0) {
      console.log('Scanned: ' + total.toLocaleString() + ' | multi=' + multiWatches.length + ' nonWatch=' + nonWatches.length);
    }
  }
  
  console.log('\n=== RESULTS ===');
  console.log('Scanned: ' + total.toLocaleString() + ' records');
  console.log('Multi-watch listings: ' + multiWatches.length);
  console.log('Non-watch items: ' + nonWatches.length);
  
  // Save JSON
  fs.writeFileSync('/home/jasme/wf/data/multi-watch-listings.json', JSON.stringify(multiWatches, null, 2));
  fs.writeFileSync('/home/jasme/wf/data/non-watch-items.json', JSON.stringify(nonWatches, null, 2));
  
  // Generate Excel using simple CSV (no exceljs dependency needed)
  // Multi-watch CSV
  const multiCSV = ['ID,Brand,Reference,Price_USD,Verdict,Listing_Type,Price_Count,Snippet'];
  multiWatches.forEach(r => {
    multiCSV.push([
      r.id, r.brand, r.reference, r.price_usd, r.verdict, r.listing_type,
      r.price_count, '"' + r.snippet.replace(/"/g, '""') + '"'
    ].join(','));
  });
  fs.writeFileSync('/mnt/c/Users/jasme/Desktop/multi-watch-listings.csv', multiCSV.join('\n'));
  
  // Non-watch CSV
  const nwCSV = ['ID,Brand,Reference,Price_USD,Verdict,Listing_Type,Snippet'];
  nonWatches.forEach(r => {
    nwCSV.push([
      r.id, r.brand, r.reference, r.price_usd, r.verdict, r.listing_type,
      '"' + r.snippet.replace(/"/g, '""') + '"'
    ].join(','));
  });
  fs.writeFileSync('/mnt/c/Users/jasme/Desktop/non-watch-items.csv', nwCSV.join('\n'));
  
  console.log('\nExported to Desktop:');
  console.log('  /mnt/c/Users/jasme/Desktop/multi-watch-listings.csv (' + multiWatches.length + ' rows)');
  console.log('  /mnt/c/Users/jasme/Desktop/non-watch-items.csv (' + nonWatches.length + ' rows)');
  
  // Sample output
  if (multiWatches.length > 0) {
    console.log('\nMulti-watch samples:');
    multiWatches.slice(0, 5).forEach(r => console.log('  ' + r.id + ' | ' + r.brand + ' | prices=' + r.price_count + ' | ' + r.snippet.substring(0, 80)));
  }
  if (nonWatches.length > 0) {
    console.log('\nNon-watch samples:');
    nonWatches.slice(0, 5).forEach(r => console.log('  ' + r.id + ' | ' + r.brand + ' | ' + r.snippet.substring(0, 80)));
  }
}

exportReports().catch(e => console.error(e));
