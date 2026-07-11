#!/usr/bin/env node
const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');

const SUPABASE_URL = 'https://bptrvfncppbjnchsaxtb.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJwdHJ2Zm5jcHBiam5jaHNheHRiIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4MTU2MjYzMSwiZXhwIjoyMDk3MTM4NjMxfQ.x1KpnBCtgcn02hiBJfuNkm3FYq6elHv3Gnys62nu8SU';
const s = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false } });

// Load enrichment data
const path = require('path');
const PROJ = path.resolve(__dirname, '..');
const enrichedRefs = JSON.parse(fs.readFileSync(PROJ + '/public/enriched_refs.json', 'utf8'));
const enrichedIdx = new Map();
enrichedRefs.forEach(e => {
  if (e.brand && e.reference) {
    enrichedIdx.set(e.brand.toUpperCase() + '|' + e.reference.toUpperCase(), e);
  }
});
console.log('Enrichment index: ' + enrichedIdx.size + ' entries');

async function process() {
  const BATCH = 500;
  let offset = 0;
  let enriched = 0, multiTagged = 0, nonWatchTagged = 0, total = 0;
  
  while (true) {
    const { data } = await s.from('watch_records')
      .select('id,brand,reference,dial_color,raw_message,listing_type,verdict')
      .eq('source', 'MYSQL_RAW')
      .range(offset, offset + BATCH - 1)
      .order('id', { ascending: true });
    
    if (!data || data.length === 0) break;
    if (offset > 500000) break; // Limit to 500K for now
    
    for (const r of data) {
      const patch = {};
      let changed = false;
      
      // 1. Dial enrichment from enriched_refs.json
      if (!r.dial_color && r.brand && r.reference) {
        const key = r.brand.toUpperCase() + '|' + r.reference.toUpperCase();
        const enr = enrichedIdx.get(key);
        if (enr && enr.dial_color) {
          patch.dial_color = enr.dial_color;
          enriched++;
          changed = true;
        }
      }
      
      // 2. Multi-watch stock list detection
      const msg = r.raw_message || '';
      const priceLines = msg.split('\n').filter(l => /\$\s?\d[\d,]+/.test(l) || /\d[\d,]+k?\s*hkd/i.test(l));
      const hasBullets = /[⭐🌟★●♦▶☞📦]/.test(msg);
      const isMulti = (hasBullets && msg.length > 150 && priceLines.length >= 2) || priceLines.length >= 3;
      
      if (isMulti && r.verdict !== 'HUMAN') {
        patch.verdict = 'HUMAN';
        patch.listing_type = 'MULTI';
        multiTagged++;
        changed = true;
      }
      
      // 3. Non-watch detection
      const nonWatchRe = /^(?!.*\b(watch|rolex|patek|audemars|omega|cartier|panerai|breitling|hublot|iwc|tudor|zenith|richard mille)\b).*\b(pen|tool|flashlight|knife|wallet|belt|shirt|shoe|purse|cufflink|necklace|earring|sunglass|phone|charger|cable)\b/i;
      if (nonWatchRe.test(msg) && r.verdict !== 'RECYCLE') {
        patch.verdict = 'RECYCLE';
        patch.listing_type = 'NON_WATCH';
        nonWatchTagged++;
        changed = true;
      }
      
      if (changed) {
        try {
          await s.from('watch_records').update(patch).eq('id', r.id);
        } catch(e) { /* skip */ }
      }
    }
    
    total += data.length;
    offset += BATCH;
    if (total % 2000 === 0) {
      console.log('Progress: ' + total.toLocaleString() + ' | dials=' + enriched + ' multi=' + multiTagged + ' nonWatch=' + nonWatchTagged);
    }
  }
  
  console.log('\nDONE: ' + total.toLocaleString() + ' records processed');
  console.log('  Dial enriched: ' + enriched);
  console.log('  Multi-watch tagged: ' + multiTagged);
  console.log('  Non-watch tagged: ' + nonWatchTagged);
}
process().catch(e => console.error(e));
