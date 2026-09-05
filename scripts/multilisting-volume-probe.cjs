// Volume probe for the multilisting/bundle report — sizes the scan before building the detector.
// Reads only columns already confirmed in production (raw_message, verdict). No catalog join.
// Run: node scripts/multilisting-volume-probe.js  (from watchfacts-poc root)
const fs = require('fs');
const path = require('path');

const envPath = path.resolve(__dirname, '..', '.env.local');
for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
  const t = line.trim();
  if (!t || t.startsWith('#')) continue;
  const i = t.indexOf('=');
  if (i < 0) continue;
  process.env[t.slice(0, i).trim()] = t.slice(i + 1).trim().replace(/^["']|["']$/g, '');
}

const { getClient } = require('../api/_lib/supabase');

const KW = /\b(bundle|pair|set of|both|plus|and a|includes|package|x2|lot of)\b/i;
const REF = /\b\d{4,6}[A-Z]{0,4}\b/g;

async function main() {
  const client = getClient();
  const batch = 5000;
  let lastId = null, scanned = 0;
  const hits = { keyword: 0, multi_ref: 0, total: 0 };
  const byVerdict = {}; // verdict -> flagged count

  while (true) {
    let q = client.from('watch_records')
      .select('id, verdict, reference, raw_message')
      .order('id', { ascending: true }).limit(batch);
    if (lastId) q = q.gt('id', lastId);
    const { data, error } = await q;
    if (error) throw error;
    if (!data || !data.length) break;

    for (const r of data) {
      scanned++;
      const msg = r.raw_message || '';
      if (!msg) continue;
      let flagged = false;
      if (KW.test(msg)) { hits.keyword++; flagged = true; }
      // multi-ref: ref-like tokens in message beyond the stored reference
      const toks = [...new Set((msg.match(REF) || []))];
      const extra = toks.filter(t => t !== r.reference);
      if (extra.length >= 1 && toks.length >= 2) { hits.multi_ref++; flagged = true; }
      if (flagged) {
        hits.total++;
        byVerdict[r.verdict] = (byVerdict[r.verdict] || 0) + 1;
      }
    }
    lastId = data[data.length - 1].id;
    if (scanned % 25000 === 0) console.error(`  ...scanned ${scanned}`);
    if (scanned > 1_500_000) break; // safety
  }

  console.log('=== MULTILISTING VOLUME PROBE ===');
  console.log('total rows scanned:', scanned);
  console.log('flagged (any signal):', hits.total, `(${(hits.total / scanned * 100).toFixed(1)}%)`);
  console.log('  keyword hits:', hits.keyword);
  console.log('  multi-ref hits:', hits.multi_ref);
  console.log('\nflagged by verdict (wrongly-APPROVED = the real risk):');
  Object.entries(byVerdict).sort((a, b) => b[1] - a[1]).forEach(([v, n]) => console.log(`  ${v}: ${n}`));
}

main().then(() => process.exit(0)).catch(e => { console.error('FAIL:', e.message); process.exit(1); });
