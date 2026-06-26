'use strict';
const SUPABASE_URL = 'https://bptrvfncppbjnchsaxtb.supabase.co';
const SUPABASE_KEY = process.env.SUPA_KEY;
const BASE = SUPABASE_URL + '/rest/v1/live_ingest';

async function q(label, url) {
  const resp = await fetch(url, { headers: { 'apikey': SUPABASE_KEY, 'Authorization': 'Bearer ' + SUPABASE_KEY } });
  const data = await resp.json();
  console.log(label);
  if (Array.isArray(data)) data.slice(0,3).forEach(r => console.log('  ', JSON.stringify(r).slice(0,300)));
  else console.log('  ', JSON.stringify(data).slice(0,200));
  console.log('');
}

async function main() {
  // HUMAN records - different confidence levels
  await q('HUMAN confidence=50', BASE + '?verdict=eq.HUMAN&confidence=eq.50&select=id,verdict,confidence,brand,reference,raw_message&limit=3');
  await q('HUMAN confidence=75', BASE + '?verdict=eq.HUMAN&confidence=eq.75&select=id,verdict,confidence,brand,reference,raw_message&limit=3');
  await q('HUMAN confidence<70 (should be RECYCLE?)', BASE + '?verdict=eq.HUMAN&confidence=lt.70&select=id,verdict,confidence,brand,reference,raw_message&limit=5');
  await q('HUMAN confidence distribution', BASE + '?verdict=eq.HUMAN&select=confidence&limit=100');
}
main().catch(e => console.error('FATAL', e.message));
