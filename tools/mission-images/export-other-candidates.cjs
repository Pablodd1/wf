'use strict';

const fs = require('node:fs');
const path = require('node:path');
const csv = require('csv-parser');

const CSV_PATH = process.env.MEDIA_INVENTORY_CSV || 'C:/Users/jasme/Downloads/thecollective-prod_inventory.csv';
const OUTPUT_PATH = process.env.OTHER_CANDIDATES_OUTPUT || path.resolve('audit-output/other-luxury-candidates.json');
const PUBLIC_BASE = String(process.env.DO_PUBLIC_BASE_URL || 'https://thecollective-prod.nyc3.digitaloceanspaces.com/').replace(/\/+$/, '');
const REVIEWED_IDS = new Set([
  '677bfacf341c3', '677d3df386775', '677d469cba0e0', '677d496c852e7',
  '677d54771f586', '6787f42f1e015', '678a7ab3dd3f5', '6792c46e82d99',
]);

function sourceId(key) {
  const match = key.match(/(?:^|\/)([a-f0-9]{12,36})(?:_[^/]+)?\.(?:jpg|jpeg|png|webp)$/i);
  return match ? match[1] : null;
}

async function run() {
  if (!fs.existsSync(CSV_PATH)) throw new Error(`Inventory CSV not found: ${CSV_PATH}`);
  const rows = [];
  const seen = new Set();
  let scanned = 0;
  const stream = fs.createReadStream(CSV_PATH).pipe(csv());

  for await (const row of stream) {
    scanned += 1;
    const key = String(row.Key || '').trim();
    if (!/^jewelryListings\/full\//i.test(key)) continue;
    const id = sourceId(key);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    rows.push({
      id: `media_other_${id}`,
      source_id: id,
      source_object_key: key,
      public_url: `${PUBLIC_BASE}/${key.split('/').map(encodeURIComponent).join('/')}`,
      source_size: Number(row.Size) || null,
      source_modified_at: row.LastModified || null,
      pilot_status: REVIEWED_IDS.has(id) ? 'published_pilot' : 'candidate_review_required',
      listing_type: 'OTHER',
      normalization_status: 'UNNORMALIZED',
      publish_policy: 'Do not publish until image and source metadata are reviewed',
    });
  }

  fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
  fs.writeFileSync(OUTPUT_PATH, JSON.stringify({
    generated_at: new Date().toISOString(),
    source_csv: CSV_PATH,
    scanned_rows: scanned,
    total_jewelry_candidates: rows.length,
    already_published_pilot: rows.filter(row => row.pilot_status === 'published_pilot').length,
    pending_review: rows.filter(row => row.pilot_status === 'candidate_review_required').length,
    records: rows,
  }, null, 2));
  console.log(JSON.stringify({
    status: 'written', output: OUTPUT_PATH, scanned_rows: scanned,
    total_jewelry_candidates: rows.length,
    already_published_pilot: rows.filter(row => row.pilot_status === 'published_pilot').length,
    pending_review: rows.filter(row => row.pilot_status === 'candidate_review_required').length,
  }, null, 2));
}

run().catch(error => {
  console.error(JSON.stringify({ status: 'error', error: error.message }));
  process.exitCode = 1;
});
