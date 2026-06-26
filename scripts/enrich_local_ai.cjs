'use strict';
process.env.SUPABASE_URL = "https://bptrvfncppbjnchsaxtb.supabase.co";
process.env.SUPABASE_SERVICE_ROLE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJwdHJ2Zm5jcHBiam5jaHNheHRiIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4MTU2MjYzMSwiZXhwIjoyMDk3MTM4NjMxfQ.x1KpnBCtgcn02hiBJfuNkm3FYq6elHv3Gnys62nu8SU";

const fs   = require('fs');
const path = require('path');

const SUPABASE_URL  = process.env.SUPABASE_URL;
const SERVICE_KEY   = process.env.SUPABASE_SERVICE_ROLE_KEY;
const TABLE         = 'watch_records';
const OLLAMA_URL    = 'http://localhost:11434';
const OLLAMA_MODEL  = 'qwen3.5:4b-q4_K_M';
const CONCURRENCY   = 5;
const FETCH_SIZE    = 50;
const APPROVE_T     = 90;
const PROGRESS_FILE = path.join(__dirname, 'enrich_ai_progress.json');
const CATALOG_PATH  = path.join(__dirname, '..', 'public', 'catalog.json');

const args = process.argv.slice(2);
const li = args.indexOf('--limit');
const LIMIT = li >= 0 ? parseInt(args[li+1]) || 200000 : 200000;

const SB = {
  apikey: SERVICE_KEY,
  Authorization: `Bearer ${SERVICE_KEY}`,
  'Content-Type': 'application/json',
};

// Catalog
let catalog = [];
try { catalog = JSON.parse(fs.readFileSync(CATALOG_PATH,'utf8')); } catch(e){}
const catByRef = new Map(catalog.map(e=>[e.reference?.toUpperCase().trim(),e]).filter(([k])=>k));
console.log(`[catalog] ${catalog.length} refs loaded`);

const RATES = {USD:1,USDT:1,HKD:0.128,EUR:1.08,GBP:1.27,CHF:1.13,SGD:0.74,AUD:0.65,CAD:0.73,CNY:0.138};
const isYear = n => typeof n==='number' && n>=1990 && n<=2030;
const toNum  = v => (v===null||v===undefined||v==='null'||v==='')?null:(isNaN(Number(v))?null:Number(v));
const toUSD  = (p,c) => {
  const n=toNum(p); if(!n) return null;
  return Math.round(n*(RATES[(c||'USD').toUpperCase()]||1));
};

// WTB detector — skip buy requests entirely
const WTB_RE = /\b(wtb|looking\s+for|wanted|wts|buy|purchasing|need|searching)\b/i;

function loadProg() {
  try{ return JSON.parse(fs.readFileSync(PROGRESS_FILE,'utf8')); }
  catch{ return {lastId:null,processed:0,approved:0,human:0,recycle:0,errors:0}; }
}
function saveProg(p){ fs.writeFileSync(PROGRESS_FILE,JSON.stringify(p,null,2)); }

// Compact prompt — shorter = faster qwen inference
async function ollamaExtract(msg) {
  if(!msg || msg.length<8) return null;
  if(WTB_RE.test(msg)) return {wtb:true};

  const prompt = `Watch listing. Extract JSON only. Message: "${msg.replace(/"/g,"'").slice(0,300)}"
Fields: brand(string|null), reference(string|null), price(number|null, NOT a year 1990-2030), currency(HKD|USD|USDT|EUR|CHF|null), condition(New|Used|null)
Return ONLY the JSON object:`;

  try {
    const res = await fetch(`${OLLAMA_URL}/api/generate`,{
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({
        model:OLLAMA_MODEL, prompt, stream:false, think:false,
        options:{temperature:0.05,num_predict:100,top_k:5}
      })
    });
    if(!res.ok) return null;
    const d = await res.json();
    const raw = (d.response||'').trim();
    const m = raw.match(/\{[\s\S]*?\}/);
    if(!m) return null;
    return JSON.parse(m[0]);
  } catch{ return null; }
}

function buildUpdate(ex, row) {
  if(!ex || ex.wtb) return null; // WTB — mark as RECYCLE

  const brand = ex.brand || row.brand;
  const ref   = ex.reference || row.reference;
  const priceRaw = toNum(ex.price);
  const price = (priceRaw && !isYear(priceRaw)) ? priceRaw : null;
  const cur   = ex.currency || row.currency || null;

  let conf = 0;
  if(ref)   conf += 40;
  if(brand) conf += 25;
  if(price) conf += 20;
  if(cur)   conf += 5;
  if(ref && catByRef.has(ref.toUpperCase().trim())) conf = Math.min(100,conf+10);
  conf = Math.min(100,conf);

  const verdict = conf>=APPROVE_T?'APPROVED':conf<35?'RECYCLE':'HUMAN';
  if(verdict==='HUMAN') return null; // no change — skip write

  // All rows must have identical keys for Supabase batch upsert
  const update = {
    id:         row.id,
    verdict,
    confidence: conf,
    brand:      brand    || null,
    reference:  ref      || null,
    price_raw:  price    || null,
    price_usd:  price ? toUSD(price,cur) : null,
    currency:   cur      || null,
    condition:  ex?.condition || null,
  };
  return update;
}

async function fetchBatch(afterId, limit) {
  const f = afterId?`&id=gt.${encodeURIComponent(afterId)}`:'';
  const url = `${SUPABASE_URL}/rest/v1/${TABLE}?verdict=eq.HUMAN&brand=is.null`+
    `&select=id,raw_message,brand,reference,currency,condition`+
    `&order=id.asc&limit=${limit}${f}`;
  const r = await fetch(url,{headers:SB});
  if(!r.ok) throw new Error(`${r.status}: ${(await r.text()).slice(0,200)}`);
  return r.json();
}

async function upsertBatch(rows) {
  if(!rows.length) return 0;
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${TABLE}`,{
    method:'POST',
    headers:{...SB,'Prefer':'resolution=merge-duplicates,return=minimal'},
    body:JSON.stringify(rows)
  });
  if(!r.ok){
    const e=await r.text();
    console.error(`[upsert] ${r.status}: ${e.slice(0,150)}`);
    return 1;
  }
  return 0;
}

async function main() {
  console.log('\n============================================');
  console.log(`  WatchFacts AI Enrichment v2`);
  console.log(`  Model: ${OLLAMA_MODEL} | Concurrency: ${CONCURRENCY}`);
  console.log(`  Limit: ${LIMIT.toLocaleString()} | Skip unchanged HUMAN`);
  console.log('============================================\n');

  try{
    const p=await(await fetch(`${OLLAMA_URL}/api/tags`)).json();
    const m=p.models?.find(m=>m.name.includes('qwen'));
    console.log(`[ollama] ${m?.name||'connected'}`);
  }catch(e){console.error('[fatal] Ollama offline:',e.message);process.exit(1);}

  const prog = loadProg();
  let lastId  = prog.lastId;
  let left    = Math.max(0, LIMIT - prog.processed);
  console.log(`[resume] lastId=${lastId||'START'} processed=${prog.processed.toLocaleString()} left=${left.toLocaleString()}`);

  const t0 = Date.now();
  let errCount = 0;

  while(left > 0) {
    const n = Math.min(FETCH_SIZE, left);
    let rows;
    try{ rows = await fetchBatch(lastId, n); }
    catch(e){
      console.error('[fetch]',e.message,'— retry 8s');
      await new Promise(r=>setTimeout(r,8000));
      errCount++;
      if(errCount>10){console.error('[abort] too many fetch errors');break;}
      continue;
    }
    errCount=0;
    if(!rows?.length){console.log('[done] No more HUMAN+brand=null records');break;}

    // Parallel inference
    const results = await Promise.all(
      rows.map(row=>ollamaExtract(row.raw_message||'')
        .then(ex=>buildUpdate(ex,row)))
    );

    // Only upsert records that changed (non-HUMAN verdict)
    const updates = results.filter(Boolean);
    let upsertErr = 0;
    if(updates.length) upsertErr = await upsertBatch(updates);

    // Stats
    for(const u of updates){
      if(u.verdict==='APPROVED') prog.approved++;
      else if(u.verdict==='RECYCLE') prog.recycle++;
    }
    prog.human += (rows.length - updates.length);
    prog.errors += upsertErr;

    lastId = rows[rows.length-1].id;
    prog.lastId   = lastId;
    prog.processed += rows.length;
    left -= rows.length;
    saveProg(prog);

    const elapsed = (Date.now()-t0)/1000;
    const rate    = prog.processed/elapsed;
    const etaMin  = (left/rate/60).toFixed(0);
    const upgraded = prog.approved+prog.recycle;
    if(prog.processed % 500 === 0 || rows.length<n){
      process.stdout.write(
        `[${(prog.processed/1000).toFixed(1)}K] upgraded=${upgraded} A=${prog.approved} R=${prog.recycle} | ${rate.toFixed(1)}/s | ETA ${etaMin}min\n`
      );
    }
    if(rows.length<n){console.log('[done] Exhausted');break;}
  }

  const mins=((Date.now()-t0)/60000).toFixed(1);
  const g=prog.approved+prog.human+prog.recycle;
  console.log(`\n  DONE in ${mins} min`);
  console.log(`  Processed : ${prog.processed.toLocaleString()}`);
  console.log(`  APPROVED  : ${prog.approved.toLocaleString()} (${(prog.approved/(g||1)*100).toFixed(1)}%)`);
  console.log(`  RECYCLE   : ${prog.recycle.toLocaleString()}`);
  console.log(`  Skipped   : ${prog.human.toLocaleString()} (stayed HUMAN)`);
  console.log(`  Errors    : ${prog.errors}`);
}
main().catch(e=>{console.error('[fatal]',e);process.exit(1);});
