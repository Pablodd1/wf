#!/usr/bin/env node
/**
 * Revert the "garbage brand nulled" operation — v4 (final).
 *
 * Root cause of prior timeouts: deep OFFSET or id-cursor pagination over
 * this table times out regardless of filter, confirmed via testing at
 * offset=39000 (500/57014) even on the already-narrow brand=is.null
 * subset. BUT a small, unordered LIMIT combined with the exact known
 * filter value returns fast (1.45s) since Postgres can stop scanning as
 * soon as it finds enough matching rows — it doesn't need to sort or
 * walk a cursor.
 *
 * Fix: for each of the 27 known original brand values, repeatedly fetch
 * small batches (limit=50, no ORDER BY) and patch by id, looping until a
 * fetch returns zero rows (meaning all matching rows for that value have
 * had their flags cleared, so the WHERE no longer matches them).
 */
const https = require('https');

const SUPABASE_URL = 'https://bptrvfncppbjnchsaxtb.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJwdHJ2Zm5jcHBiam5jaHNheHRiIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4MTU2MjYzMSwiZXhwIjoyMDk3MTM4NjMxfQ.x1KpnBCtgcn02hiBJfuNkm3FYq6elHv3Gnys62nu8SU';

const NULLED_VALUES = [
  '16613', '037', 'null', 'WGBB0016', 'M79360N-0024', 'W388104', 'Wsta0028',
  'WJTA0037', 'M91550-0005', 'WGPN0048', 'WGBA0047', 'E', 'NOS', 'W5200005',
  'Used', 'WJBB0002', 'WSTA0121', 'w26019L1', 'M79360N', 'W51027Q4',
  'W2BB0029', 'WJPN0066', 'W51008Q3', 'Naked', 'WatchOps', 'Unbranded', 'Branded',
];
// NOTE: safe to re-run — once a row's brand is restored it no longer
// matches brand=is.null, so already-reverted rows are naturally skipped.

function getJson(pathQuery) {
  return new Promise((resolve, reject) => {
    https.get(new URL(`${SUPABASE_URL}${pathQuery}`), {
      headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` }
    }, res => {
      let body = '';
      res.on('data', d => body += d);
      res.on('end', () => { try { resolve(JSON.parse(body)); } catch (e) { reject(e); } });
    }).on('error', reject);
  });
}

function patch(pathQuery, body) {
  return new Promise((resolve, reject) => {
    const url = new URL(`${SUPABASE_URL}${pathQuery}`);
    const data = JSON.stringify(body);
    const req = https.request({
      hostname: url.hostname, path: url.pathname + url.search, method: 'PATCH',
      headers: {
        apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`,
        'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data),
        Prefer: 'return=minimal',
      },
    }, res => { res.on('data', () => {}); res.on('end', () => resolve(res.statusCode)); });
    req.on('error', reject);
    req.write(data); req.end();
  });
}

async function main() {
  let totalOk = 0, totalErr = 0;

  for (const originalValue of NULLED_VALUES) {
    const encoded = encodeURIComponent(originalValue);
    let valueOk = 0, safety = 0, consecutiveFailures = 0;

    while (safety++ < 60) {
      const rows = await getJson(
        `/rest/v1/watch_records?select=id&brand=is.null&flags->>garbage_brand_nulled=eq.${encoded}&limit=50`
      );
      if (!Array.isArray(rows)) {
        // Likely a transient timeout, not "no more rows" — retry a few
        // times before giving up on this value.
        consecutiveFailures++;
        if (consecutiveFailures >= 4) {
          console.log(`  Giving up on "${originalValue}" after ${consecutiveFailures} failed fetches.`);
          break;
        }
        await new Promise(r => setTimeout(r, 1500));
        continue;
      }
      consecutiveFailures = 0;
      if (rows.length === 0) break;

      for (const row of rows) {
        const status = await patch(`/rest/v1/watch_records?id=eq.${row.id}`, { brand: originalValue, flags: {} });
        if (status >= 200 && status < 300) { valueOk++; totalOk++; }
        else { totalErr++; console.log(`  Failed id=${row.id}: HTTP ${status}`); }
      }

      if (rows.length < 50) break; // last page for this value
    }

    console.log(`"${originalValue}": reverted ${valueOk} rows`);
  }

  console.log(`\nDone. Total reverted: ${totalOk}, errors: ${totalErr}.`);
}

main().catch(e => { console.error(e.message); process.exit(1); });
