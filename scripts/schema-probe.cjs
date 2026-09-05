// One-shot schema truth-check for the price-research drill-down feature.
// Run: node scripts/schema-probe.js  (from watchfacts-poc root)
const fs = require('fs');
const path = require('path');

// --- robust .env.local loader (handles key=value and key="value") ---
const envPath = path.resolve(__dirname, '..', '.env.local');
for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('#')) continue;
  const i = trimmed.indexOf('=');
  if (i < 0) continue;
  const k = trimmed.slice(0, i).trim();
  const v = trimmed.slice(i + 1).trim().replace(/^["']|["']$/g, '');
  process.env[k] = v;
}

console.log('env check -> URL set:', !!process.env.SUPABASE_URL,
            '| https:', (process.env.SUPABASE_URL || '').startsWith('https://'),
            '| KEY set:', !!process.env.SUPABASE_SERVICE_ROLE_KEY);

// require AFTER env is populated (supabase.js reads process.env at import)
const { getClient } = require('../api/_lib/supabase');

async function cols(client, table, extra) {
  const { data, error } = await client.from(table).select('*').limit(1);
  if (error) { console.log(`\n=== ${table} === ERR: ${error.message}`); return; }
  const c = Object.keys(data[0] || {});
  console.log(`\n=== ${table} cols (${c.length}) ===`);
  console.log(c.join(', '));
  if (extra) extra.forEach(col => console.log(`  has ${col}:`, c.includes(col)));
}

async function main() {
  const client = getClient();
  await cols(client, 'watch_records',
    ['model', 'dial_color', 'normalized_reference', 'brand', 'reference', 'price_usd', 'verdict']);
  await cols(client, 'cached_price_guide_watches', ['brand_name', 'model_name', 'reference_name']);
  await cols(client, 'watches_catalog', ['brand_id', 'model_id', 'reference_id', 'searchable']);

  const { data: rows, error } = await client
    .from('watch_records')
    .select('reference, dial_color, price_usd, model')
    .eq('brand', 'Rolex').eq('verdict', 'APPROVED').limit(6);
  console.log('\n=== sample Rolex APPROVED rows ===');
  if (error) { console.log('ERR:', error.message); }
  else (rows || []).forEach(r =>
    console.log(`  ref=${r.reference} | model=${r.model} | dial=${r.dial_color} | price=${r.price_usd}`));
}

main().then(() => process.exit(0)).catch(e => { console.error('FAIL:', e.message); process.exit(1); });
