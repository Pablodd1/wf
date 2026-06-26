'use strict';
// reanalyze_parallel.cjs — cursor-based parallel re-analysis
// Avoids Supabase offset-scan timeouts by paginating with id > last_seen_id
// 3 workers — each processes all HUMAN records sequentially with id-cursor

process.env.SUPABASE_URL = "https://bptrvfncppbjnchsaxtb.supabase.co";
process.env.SUPABASE_SERVICE_ROLE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJwdHJ2Zm5jcHBiam5jaHNheHRiIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4MTU2MjYzMSwiZXhwIjoyMDk3MTM4NjMxfQ.x1KpnBCtgcn02hiBJfuNkm3FYq6elHv3Gnys62nu8SU";


const fs   = require('fs');
const path = require('path');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY;
const TABLE        = 'watch_records';
const BATCH        = 500;
const APPROVE_T    = 90;
const PROGRESS_DIR = path.join(__dirname, 'parallel_progress');
const CATALOG_PATH = path.join(__dirname, '..', 'public', 'catalog.json');

if (!fs.existsSync(PROGRESS_DIR)) fs.mkdirSync(PROGRESS_DIR, { recursive: true });

// Catalog
let catalog = [];
try { catalog = JSON.parse(fs.readFileSync(CATALOG_PATH,'utf8')); } catch(e) {}
const catByRef = new Map();
for (const e of catalog) if (e.reference) catByRef.set(e.reference.toUpperCase().trim(), e);
console.log(`[catalog] ${catalog.length} entries`);

const RATES = { USD:1,USDT:1,HKD:0.128,EUR:1.08,GBP:1.27,CHF:1.13,SGD:0.74,AUD:0.65,CAD:0.73,JPY:0.0066,CNY:0.138,RMB:0.138 };
const toUSD = (n,c) => Math.round(n * (RATES[(c||'USD').toUpperCase()] || 1));
const isYear = n => Number.isFinite(n) && n >= 1990 && n <= 2030;

function parsePrice(t) {
  t = t.replace(/,/g,'');
  let m;
  const p = n => isYear(n) ? null : n;
  if ((m=t.match(/HKD\s*(\d{1,4}(?:\.\d{1,3})?)\s*m\b/i))) return p(Math.round(parseFloat(m[1])*1e6));
  if ((m=t.match(/HKD\s*(\d{1,4}(?:\.\d{1,2})?)\s*k\b/i))) return p(Math.round(parseFloat(m[1])*1e3));
  if ((m=t.match(/HKD\s*(\d{4,8})/i)))   return p(parseInt(m[1],10));
  if ((m=t.match(/(\d{5,8})\s*HKD/i)))   return p(parseInt(m[1],10));
  if ((m=t.match(/(\d{4,8})\s*(?:USD|USDT)/i))) return p(parseInt(m[1],10));
  if ((m=t.match(/(\d{1,4}(?:\.\d{1,2})?)\s*k\s*(?:HKD|USD|USDT)/i))) return p(Math.round(parseFloat(m[1])*1e3));
  if ((m=t.match(/(?:USD|USDT|\$)\s*(\d{4,8})/i))) return p(parseInt(m[1],10));
  if ((m=t.match(/\b(\d{5,8})\b/))) return p(parseInt(m[1],10));
  return null;
}

function parseCur(t) {
  const u = t.toUpperCase();
  if (/USDT/.test(u)) return 'USDT';
  if (/HKD/.test(u)) return 'HKD';
  if (/\bEUR\b|€/.test(u)) return 'EUR';
  if (/\bGBP\b|£/.test(u)) return 'GBP';
  if (/\bCHF\b/.test(u)) return 'CHF';
  if (/\bUSD\b|\$/.test(u)) return 'USD';
  return null;
}

const BRANDS = [
  ['Rolex',/\b(?:ROLEX|Rolex)\b/i],
  ['Patek Philippe',/\b(?:PP|Patek)\b/i],
  ['Audemars Piguet',/\b(?:AP|Audemars)\b/i],
  ['Richard Mille',/\b(?:RM|Richard\s*Mille)\b/i],
  ['Cartier',/\bCartier\b/i],
  ['Vacheron Constantin',/\b(?:VC|Vacheron)\b/i],
  ['Omega',/\bOmega\b/i],
  ['Tudor',/\bTudor\b/i],
  ['Panerai',/\b(?:PAM|Panerai)\b/i],
  ['IWC',/\bIWC\b/i],
  ['Hublot',/\bHublot\b/i],
  ['A. Lange & Sohne',/\bLange\b|A\.\s*Lange/i],
  ['Jaeger-LeCoultre',/\b(?:JLC|Jaeger)\b/i],
  ['F.P. Journe',/\bJourne\b/i],
  ['Breitling',/\bBreitling\b/i],
  ['Blancpain',/\bBlancpain\b/i],
  ['Grand Seiko',/\bGrand\s*Seiko\b/i],
  ['Breguet',/\bBreguet\b/i],
];
const REF_RE = /\b([A-Z]{2,4}[\d]{4,6}[A-Z0-9\/\-]{0,10}|\d{4,6}[A-Z0-9\/\-]{0,8}|\d{3}\.\d{3}|RM[\-\s]?\d{2}-\d{2}|PAM\d{3,5}|IW\d{6}|WGTA\d{4})\b/i;

function parse(text) {
  if (!text || text.length < 5) return { brand:null, ref:null, price:null, cur:null };
  const be = BRANDS.find(([,re]) => re.test(text));
  const rm = text.match(REF_RE);
  return { brand: be?.[0]||null, ref: rm?.[1]||null, price: parsePrice(text), cur: parseCur(text) };
}

function score(p, eb, er) {
  const brand = p.brand || eb, ref = p.ref || er;
  let c = 0;
  if (ref)   c += 40;
  if (brand) c += 25;
  if (p.price) c += 20;
  if (p.cur)   c += 5;
  if (ref && catByRef.has(ref.toUpperCase().trim())) c = Math.min(100, c+10);
  return Math.min(100, c);
}
const verdict = c => c >= APPROVE_T ? 'APPROVED' : c < 35 ? 'RECYCLE' : 'HUMAN';

const HDR = { 'apikey':SERVICE_KEY,'Authorization':`Bearer ${SERVICE_KEY}`,'Content-Type':'application/json' };

async function fetchPage(afterId, limit) {
  const filter = afterId ? `&id=gt.${encodeURIComponent(afterId)}` : '';
  const url = `${SUPABASE_URL}/rest/v1/${TABLE}?verdict=eq.HUMAN&select=id,raw_message,brand,reference&order=id.asc&limit=${limit}${filter}`;
  const r = await fetch(url, { headers: HDR });
  if (!r.ok) throw new Error(`${r.status}: ${(await r.text()).slice(0,200)}`);
  return r.json();
}

async function upsert(rows) {
  if (!rows.length) return 0;
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${TABLE}`, {
    method:'POST',
    headers:{ ...HDR, 'Prefer':'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify(rows),
  });
  if (!r.ok) { console.error(`[upsert] ${r.status}: ${(await r.text()).slice(0,200)}`); return rows.length; }
  return 0;
}

// Each worker processes ALL remaining HUMAN records using cursor pagination
// Workers are differentiated by their cursor start-point (from progress file)
// In practice for a single machine, run 1 sequential worker with large batch
// for max throughput without connection saturation

async function worker(id) {
  const pf = path.join(PROGRESS_DIR, `w${id}.json`);
  let prog = { lastId: null, approved:0, human:0, recycle:0, errors:0, total:0 };
  if (fs.existsSync(pf)) { try { prog = JSON.parse(fs.readFileSync(pf,'utf8')); } catch(e){} }

  console.log(`[W${id}] resume lastId=${prog.lastId || 'START'}`);
  let batches = 0;

  while (true) {
    let rows;
    try { rows = await fetchPage(prog.lastId, BATCH); }
    catch(e) {
      console.error(`[W${id}] fetch err: ${e.message} — retry in 5s`);
      await new Promise(r=>setTimeout(r,5000));
      continue;
    }
    if (!rows || !rows.length) { console.log(`[W${id}] done`); break; }

    const updates = rows.map(row => {
      const p = parse(row.raw_message||'');
      const c = score(p, row.brand, row.reference);
      const v = verdict(c);
      if (v==='APPROVED') prog.approved++;
      else if (v==='RECYCLE') prog.recycle++;
      else prog.human++;
      return { id:row.id, brand:p.brand||row.brand||null, reference:p.ref||row.reference||null,
               price_raw:p.price, price_usd:p.price&&p.cur?toUSD(p.price,p.cur):p.price,
               currency:p.cur, confidence:c, verdict:v };
    });

    prog.errors += await upsert(updates);
    prog.lastId = rows[rows.length-1].id;
    prog.total += rows.length;
    batches++;
    fs.writeFileSync(pf, JSON.stringify(prog));

    if (batches % 20 === 0) {
      process.stdout.write(`[W${id}] processed=${prog.total.toLocaleString()} A=${prog.approved} H=${prog.human} R=${prog.recycle} err=${prog.errors}\n`);
    }
    if (rows.length < BATCH) { console.log(`[W${id}] exhausted`); break; }
  }

  console.log(`\n[W${id}] DONE total=${prog.total} A=${prog.approved} H=${prog.human} R=${prog.recycle}`);
  return prog;
}

async function main() {
  console.log('\n=============================================');
  console.log('  WatchFacts Cursor-Based Re-Analysis');
  console.log(`  Batch: ${BATCH} | Catalog: ${catalog.length}`);
  console.log('=============================================\n');

  // Single sequential worker — most efficient for one machine
  // Run multiple terminal instances of this script to parallelize
  const t0 = Date.now();
  const result = await worker(0);
  const mins = ((Date.now()-t0)/60000).toFixed(1);
  const g = result.approved + result.human + result.recycle;

  console.log('\n=============================================');
  console.log(`  DONE in ${mins} min`);
  console.log(`  APPROVED : ${result.approved.toLocaleString()} (${g?((result.approved/g)*100).toFixed(1):0}%)`);
  console.log(`  HUMAN    : ${result.human.toLocaleString()}`);
  console.log(`  RECYCLE  : ${result.recycle.toLocaleString()}`);
  console.log(`  ERRORS   : ${result.errors}`);
  console.log('=============================================\n');
}

main().catch(e => { console.error('[fatal]', e); process.exit(1); });
