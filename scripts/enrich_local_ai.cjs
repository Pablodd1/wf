#!/usr/bin/env node
/**
 * enrich_local_ai.cjs
 * Uses local Ollama (qwen3:8b) to extract watch data from HUMAN records
 * where the regex parser failed to identify brand or reference.
 * 
 * Runs AFTER reanalyze_parallel — targets remaining hard cases.
 * 
 * Usage: node enrich_local_ai.cjs [--limit N]
 */
'use strict';

process.env.SUPABASE_URL = "https://bptrvfncppbjnchsaxtb.supabase.co";
process.env.SUPABASE_SERVICE_ROLE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJwdHJ2Zm5jcHBiam5jaHNheHRiIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4MTU2MjYzMSwiZXhwIjoyMDk3MTM4NjMxfQ.x1KpnBCtgcn02hiBJfuNkm3FYq6elHv3Gnys62nu8SU";

const fs   = require('fs');
const path = require('path');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY;
const TABLE        = 'watch_records';
const OLLAMA_URL   = 'http://localhost:11434';
const OLLAMA_MODEL = 'qwen3.5:4b-q4_K_M';  // faster 4B model, sufficient for extraction
const BATCH        = 10;          // LLM batches — small to avoid OOM
const APPROVE_T    = 90;
const PROGRESS_FILE = path.join(__dirname, 'enrich_ai_progress.json');

// Parse CLI
const args = process.argv.slice(2);
const limitArg = args.indexOf('--limit');
const LIMIT = limitArg >= 0 ? parseInt(args[limitArg + 1]) || 500 : 500;

const SB = {
  'apikey': SERVICE_KEY,
  'Authorization': `Bearer ${SERVICE_KEY}`,
  'Content-Type': 'application/json',
};

// ── Progress ──────────────────────────────────────────────────────────────────
function loadProgress() {
  try { return JSON.parse(fs.readFileSync(PROGRESS_FILE, 'utf8')); }
  catch { return { lastId: null, processed: 0, approved: 0, human: 0, recycle: 0, errors: 0 }; }
}
function saveProgress(p) { fs.writeFileSync(PROGRESS_FILE, JSON.stringify(p, null, 2)); }

// ── Catalog ───────────────────────────────────────────────────────────────────
let catalog = [];
try { catalog = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'public', 'catalog.json'), 'utf8')); }
catch(e) { console.warn('[catalog] not loaded:', e.message); }
const catByRef = new Map(catalog.map(e => [e.reference?.toUpperCase().trim(), e]).filter(([k]) => k));
console.log(`[catalog] ${catalog.length} entries`);

// ── Ollama call ───────────────────────────────────────────────────────────────
async function ollamaExtract(message) {
  const prompt = `You are a luxury watch listing parser. Extract structured data from this WhatsApp dealer message.

Message: "${message.replace(/"/g, "'").slice(0, 400)}"

Return ONLY valid JSON with these fields (null if not found):
{
  "brand": "brand name or null",
  "reference": "reference number or null",
  "price": number or null,
  "currency": "HKD|USD|USDT|EUR|CHF or null",
  "dial_color": "color or null",
  "condition": "New|Used or null",
  "year": number or null
}

Rules:
- brand: one of Rolex, Patek Philippe, Audemars Piguet, Richard Mille, Cartier, Vacheron Constantin, Omega, Tudor, IWC, Panerai, Hublot, A. Lange & Sohne, Jaeger-LeCoultre, F.P. Journe, Breitling, Blancpain, Grand Seiko, Breguet, or null
- reference: alphanumeric code like 126610LV, 5711/1A, RM35-03, PAM00441, not a year
- price: numeric value only, NOT a year (reject 2019-2026), NOT a reference number
- currency: detect from context (HKD, USD, USDT, k=thousands, m=millions)
- If message is a buy request (WTB/looking for/wanted), all fields null

JSON only, no explanation:`;

  try {
    const res = await fetch(`${OLLAMA_URL}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: OLLAMA_MODEL,
        prompt,
        stream: false,
        think: false,
        options: { temperature: 0.05, num_predict: 180, top_k: 5 }
      }),
    });
    if (!res.ok) throw new Error(`Ollama ${res.status}`);
    const data = await res.json();
    const raw = data.response?.trim() || '';
    // Extract JSON from response (model may add thinking tags)
    const jsonMatch = raw.match(/\{[\s\S]*?\}/);
    if (!jsonMatch) return null;
    return JSON.parse(jsonMatch[0]);
  } catch(e) {
    return null;
  }
}

// ── Scoring ───────────────────────────────────────────────────────────────────
const RATES = { USD:1,USDT:1,HKD:0.128,EUR:1.08,GBP:1.27,CHF:1.13,SGD:0.74 };
const isYear = n => Number.isFinite(n) && n >= 1990 && n <= 2030;
const toUSD = (p, c) => p && c ? Math.round(p * (RATES[c.toUpperCase()] || 1)) : p;

function scoreAndVerdict(extracted, row) {
  const brand = extracted?.brand || row.brand;
  const ref   = extracted?.reference || row.reference;
  const price = (!isYear(extracted?.price) ? extracted?.price : null);
  const cur   = extracted?.currency || row.currency;
  
  let conf = 0;
  if (ref)   conf += 40;
  if (brand) conf += 25;
  if (price) conf += 20;
  if (cur)   conf += 5;
  if (ref && catByRef.has(ref.toUpperCase().trim())) conf = Math.min(100, conf + 10);
  conf = Math.min(100, conf);
  
  const verdict = conf >= APPROVE_T ? 'APPROVED' : conf < 35 ? 'RECYCLE' : 'HUMAN';
  
  return {
    brand:     brand || null,
    reference: ref   || null,
    price_raw: price,
    price_usd: toUSD(price, cur),
    currency:  cur   || null,
    dial_color: extracted?.dial_color || row.dial_color || null,
    condition: extracted?.condition  || row.condition  || null,
    year:      (!isYear(extracted?.year) ? null : extracted?.year) || row.year || null,
    confidence: conf,
    verdict,
  };
}

// ── Supabase helpers ──────────────────────────────────────────────────────────
async function fetchHumanNoBrand(afterId, limit) {
  const filter = afterId ? `&id=gt.${encodeURIComponent(afterId)}` : '';
  // Target HUMAN records where brand is null AND raw_message has content
  const url = `${SUPABASE_URL}/rest/v1/${TABLE}` +
    `?verdict=eq.HUMAN&brand=is.null&raw_message=not.is.null` +
    `&select=id,raw_message,brand,reference,dial_color,condition,year,price_raw,currency` +
    `&order=id.asc&limit=${limit}${filter}`;
  const r = await fetch(url, { headers: SB });
  if (!r.ok) throw new Error(`fetch ${r.status}: ${(await r.text()).slice(0,200)}`);
  return r.json();
}

async function upsertBatch(rows) {
  if (!rows.length) return;
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${TABLE}`, {
    method: 'POST',
    headers: { ...SB, 'Prefer': 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify(rows),
  });
  if (!r.ok) console.error(`[upsert] ${r.status}: ${(await r.text()).slice(0,200)}`);
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  console.log('\n=============================================');
  console.log(`  WatchFacts Local AI Enrichment`);
  console.log(`  Model: ${OLLAMA_MODEL} @ ${OLLAMA_URL}`);
  console.log(`  Target: HUMAN records with brand=null`);
  console.log(`  Limit: ${LIMIT} records`);
  console.log('=============================================\n');

  // Test Ollama is running
  try {
    const ping = await fetch(`${OLLAMA_URL}/api/tags`);
    if (!ping.ok) throw new Error('not ok');
    const tags = await ping.json();
    const model = tags.models?.find(m => m.name.startsWith('qwen3'));
    if (!model) { console.error('[fatal] qwen3 model not found in Ollama'); process.exit(1); }
    console.log(`[ollama] Connected — using ${model.name}`);
  } catch(e) {
    console.error('[fatal] Ollama not reachable:', e.message);
    process.exit(1);
  }

  const prog = loadProgress();
  let lastId = prog.lastId;
  let totalProcessed = prog.processed;
  let totalToProcess = Math.max(0, LIMIT - totalProcessed);

  console.log(`[resume] lastId=${lastId || 'START'} processed=${totalProcessed}`);

  const t0 = Date.now();

  while (totalToProcess > 0) {
    const fetchN = Math.min(BATCH, totalToProcess);
    let rows;
    try { rows = await fetchHumanNoBrand(lastId, fetchN); }
    catch(e) {
      console.error('[fetch]', e.message, '— retry in 5s');
      await new Promise(r => setTimeout(r, 5000));
      continue;
    }
    if (!rows?.length) { console.log('[done] No more HUMAN+brand=null records'); break; }

    // Process each through Ollama
    const updates = [];
    for (const row of rows) {
      const msg = row.raw_message || '';
      if (msg.length < 8) { 
        updates.push({ id: row.id, confidence: 0, verdict: 'RECYCLE' });
        continue;
      }
      
      const extracted = await ollamaExtract(msg);
      const fields = scoreAndVerdict(extracted, row);
      
      if (fields.verdict !== 'HUMAN') {
        // Only bother updating if verdict changed (saves write quota)
        updates.push({ id: row.id, ...fields });
      }
      
      if (fields.verdict === 'APPROVED') prog.approved++;
      else if (fields.verdict === 'RECYCLE') prog.recycle++;
      else prog.human++;
    }

    if (updates.length) await upsertBatch(updates);

    lastId = rows[rows.length - 1].id;
    prog.lastId = lastId;
    prog.processed += rows.length;
    prog.errors = 0;
    totalProcessed += rows.length;
    totalToProcess -= rows.length;
    saveProgress(prog);

    const elapsed = ((Date.now() - t0) / 1000).toFixed(0);
    const upgraded = prog.approved + prog.recycle;
    console.log(`[batch] processed=${prog.processed} upgraded=${upgraded} (A=${prog.approved} R=${prog.recycle}) elapsed=${elapsed}s`);

    if (rows.length < fetchN) { console.log('[done] Exhausted'); break; }
  }

  const mins = ((Date.now() - t0) / 60000).toFixed(1);
  console.log(`\n  DONE in ${mins} min`);
  console.log(`  Total processed : ${prog.processed}`);
  console.log(`  Upgraded to APPROVED: ${prog.approved}`);
  console.log(`  Moved to RECYCLE    : ${prog.recycle}`);
  console.log(`  Stayed HUMAN        : ${prog.human}`);
}

main().catch(e => { console.error('[fatal]', e); process.exit(1); });
