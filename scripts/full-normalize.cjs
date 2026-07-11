#!/usr/bin/env node
/**
 * Full normalization — processes all MYSQL_RAW records with JASS parser.
 * Runs locally against Supabase. Applies: brand, ref, dial, price, verdict, listing_type, confidence.
 * Tags: MULTI, WTB, NON_WATCH, parser_version=jass-v5.
 */
const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

const SUPABASE_URL = 'https://bptrvfncppbjnchsaxtb.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJwdHJ2Zm5jcHBiam5jaHNheHRiIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4MTU2MjYzMSwiZXhwIjoyMDk3MTM4NjMxfQ.x1KpnBCtgcn02hiBJfuNkm3FYq6elHv3Gnys62nu8SU';
const s = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false } });

// Load parser
const { parseFull } = require('../api/_lib/parser.js');
const { lookupEnriched, lookupNormalized } = require('../api/_lib/catalog-matcher');

// Progress tracking
const PROGRESS_FILE = '/home/jasme/wf/data/norm-progress.json';

function loadProgress() {
  try {
    return JSON.parse(fs.readFileSync(PROGRESS_FILE, 'utf8'));
  } catch {
    return { offset: 0, total: 0, multi: 0, wtb: 0, nw: 0, enriched: 0 };
  }
}
function saveProgress(p) {
  fs.writeFileSync(PROGRESS_FILE, JSON.stringify(p));
}

async function run() {
  const BATCH = 500;
  let p = loadProgress();
  let start = Date.now();
  
  console.log('Starting from offset ' + p.offset.toLocaleString());
  console.log('Loaded: enriched=' + (typeof lookupEnriched === 'function') + ' norm=' + (typeof lookupNormalized === 'function'));
  
  for (let i = 0; i < 5000; i++) {
    // Fetch batch
    const { data, error } = await s.from('watch_records')
      .select('id,raw_message,brand,reference,dial_color,price_usd,currency,verdict,listing_type,confidence,parser_version')
      .eq('source', 'MYSQL_RAW')
      .range(p.offset, p.offset + BATCH - 1);
    
    if (error || !data || data.length === 0) {
      console.log('No more data at offset ' + p.offset + ': ' + (error?.message || 'empty'));
      break;
    }
    
    let batchProc = 0, batchSkipped = 0;
    const updates = [];
    
    for (const rec of data) {
      // Skip already processed
      if (rec.parser_version === 'jass-v5') {
        batchSkipped++;
        continue;
      }
      
      const msg = rec.raw_message || '';
      if (msg.length < 10) {
        // Mark short messages as RECYCLE
        try {
          await s.from('watch_records').update({
            parser_version: 'jass-v5',
            verdict: 'RECYCLE',
            listing_type: 'NON_WATCH'
          }).eq('id', rec.id);
        } catch {}
        batchProc++;
        continue;
      }
      
      // Parse
      let parsed;
      try { parsed = parseFull(msg); } catch { continue; }
      if (!parsed) continue;
      
      const patch = {};
      
      // Brand
      if (parsed.brand && parsed.brand !== 'Unknown' && parsed.brand !== rec.brand) {
        patch.brand = parsed.brand;
      }
      
      // Reference with normalization lookup
      const rawRef = parsed.reference || parsed.ref;
      let finalRef = rawRef;
      if (rawRef) {
        const normHit = lookupNormalized ? lookupNormalized(rawRef) : null;
        if (normHit) {
          finalRef = normHit.r || rawRef;
          if (normHit.b && (!rec.brand || rec.brand === 'Unknown')) {
            patch.brand = normHit.b;
          }
        }
        if (finalRef && finalRef !== rec.reference) {
          patch.reference = finalRef;
        }
      }
      
      // Dial
      if (parsed.dial || parsed.dial_color) {
        const dial = parsed.dial || parsed.dial_color;
        if (dial && dial !== 'Unknown' && dial !== rec.dial_color) {
          patch.dial_color = dial;
        }
      }
      // Enriched dial fallback
      if (!patch.dial_color && !rec.dial_color && (patch.reference || rec.reference) && (patch.brand || rec.brand)) {
        try {
          const enr = lookupEnriched(patch.brand || rec.brand, patch.reference || rec.reference);
          if (enr && enr.dial_color) {
            patch.dial_color = enr.dial_color;
            p.enriched++;
          }
        } catch {}
      }
      
      // Price
      if (parsed.price && parsed.price > 0 && parsed.price < 5000000) {
        if (parsed.price !== rec.price_usd) patch.price_usd = parsed.price;
      }
      if (parsed.currency) patch.currency = parsed.currency;
      
      // Confidence
      if (parsed.confidence && typeof parsed.confidence === 'number') {
        patch.confidence = parsed.confidence;
      }
      
      // ── Classification ──
      const prices = msg.match(/\$[\d,]+|[\d,]+k?\s*(?:hkd|usd)/gi) || [];
      const uniquePrices = new Set(prices.map(p => p.toLowerCase()));
      const hasBullets = /[⭐🌟★●♦▶☞📦🎁💝💥]/.test(msg);
      const isMulti = (hasBullets && uniquePrices.size >= 2) || (uniquePrices.size >= 3 && msg.length > 100);
      const isWTB = /\b(WTB|WANT TO BUY|looking for|anyone have|need to buy|need to find|searching for)\b/i.test(msg);
      const nonWatchRe = /\b(tool|flashlight|knife|wallet|belt|shirt|shoe|purse|necklace|earring|sunglass|perfume|cufflink|charger|headphone|speaker|bag\b(?!.*watch)|pen\b(?!.*pen.*watch)|ring\b(?!.*(watch|rolex|patek|ap|audemars))|bracelet\b(?!.*watch))/i;
      const hasWatchBrand = /\b(rolex|patek|audemars|omega|cartier|panerai|breitling|hublot|iwc|tudor|zenith|richard mille|breguet|blancpain|vacheron)\b/i;
      const isNonWatch = nonWatchRe.test(msg) && !hasWatchBrand;
      
      if (isMulti) {
        patch.verdict = 'HUMAN';
        patch.listing_type = 'WTS';
        patch.flags = { ...(rec.flags || {}), multi_listing: true, price_lines: uniquePrices.size };
        p.multi++;
      } else if (isNonWatch) {
        patch.verdict = 'RECYCLE';
        patch.listing_type = 'WTS';
        patch.flags = { ...(rec.flags || {}), non_watch: true };
        p.nw++;
      } else if (isWTB) {
        patch.verdict = parsed.verdict || 'REVIEW';
        patch.listing_type = 'WTB';
        p.wtb++;
      } else {
        patch.verdict = parsed.verdict || 'REVIEW';
        patch.listing_type = 'WTS';
      }
      
      patch.parser_version = 'jass-v5';
      
      updates.push({ id: rec.id, ...patch, parser_version: 'jass-v5' });
      batchProc++;
    }
    
    // Bulk upsert the entire batch at once
    if (updates.length > 0) {
      // Split into chunks of 100 to avoid payload limits
      for (let j = 0; j < updates.length; j += 100) {
        const chunk = updates.slice(j, j + 100);
        try {
          const { error: upsertErr } = await s.from('watch_records').upsert(chunk, { onConflict: 'id' });
          if (upsertErr) console.error('Upsert error:', upsertErr.message);
        } catch (e) {
          console.error('Upsert chunk error:', e.message);
        }
      }
    }
    
    p.total += batchProc;
    p.offset += BATCH;
    
    const elapsed = ((Date.now() - start) / 1000).toFixed(0);
    const rate = elapsed > 0 ? Math.round(p.total / elapsed) : 0;
    
    if (i % 5 === 0 || batchProc > 0) {
      console.log('#' + i + ' offset=' + p.offset.toLocaleString()
        + ' | +' + batchProc + ' proc (+' + batchSkipped + ' skip)'
        + ' | total=' + p.total.toLocaleString()
        + ' | multi=' + p.multi.toLocaleString()
        + ' wtb=' + p.wtb.toLocaleString()
        + ' nw=' + p.nw.toLocaleString()
        + ' | ' + rate + '/s | ' + elapsed + 's');
      saveProgress(p);
    }
    
    if (data.length < BATCH) break;
  }
  
  saveProgress(p);
  console.log('\n=== DONE ===');
  console.log('Total: ' + p.total.toLocaleString());
  console.log('Multi: ' + p.multi.toLocaleString());
  console.log('WTB: ' + p.wtb.toLocaleString());
  console.log('Non-watch: ' + p.nw.toLocaleString());
  console.log('Dials enriched: ' + p.enriched.toLocaleString());
}

run().catch(e => { console.error('FATAL:', e); process.exit(1); });
