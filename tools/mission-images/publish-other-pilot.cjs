'use strict';

const APPLY = String(process.env.APPLY_OTHER_PILOT || '').toLowerCase() === 'true';
const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const PUBLIC_BASE = 'https://thecollective-prod.nyc3.digitaloceanspaces.com/jewelryListings/full/';

// Visually reviewed on 2026-07-16. Watch photos and analytics screenshots from
// the same source folder are deliberately excluded.
const ITEMS = [
  ['677bfacf341c3', '677bfacf341c3_front_image.png', '2025-01-06T15:46:23.401Z'],
  ['677d3df386775', '677d3df386775_front_image.png', '2025-01-07T14:45:07.883Z'],
  ['677d469cba0e0', '677d469cba0e0_front_image.png', '2025-01-07T15:22:04.876Z'],
  ['677d496c852e7', '677d496c852e7_front_image.png', '2025-01-07T15:34:04.698Z'],
  ['677d54771f586', '677d54771f586_front_image.png', '2025-01-07T16:21:11.716Z'],
  ['6787f42f1e015', '6787f42f1e015_front_image.png', '2025-01-15T17:45:19.236Z'],
  ['678a7ab3dd3f5', '678a7ab3dd3f5_front_image.png', '2025-01-17T15:43:48.231Z'],
  ['6792c46e82d99', '6792c46e82d99_front_image.png', '2025-01-23T22:36:30.711Z'],
];

function records() {
  return ITEMS.map(([sourceId, filename, createdAt]) => {
    const imageUrl = `${PUBLIC_BASE}${filename}`;
    return {
      id: `media_other_${sourceId}`,
      brand: null,
      reference: null,
      dial_color: null,
      condition: null,
      year: null,
      price_raw: null,
      price_usd: null,
      currency: null,
      confidence: 0,
      verdict: 'HUMAN',
      source: 'DigitalOcean jewelry archive pilot',
      raw_message: `Unnormalized luxury item source ${sourceId}`,
      flags: { source_id: sourceId, normalization_status: 'UNNORMALIZED', media_pilot: true },
      created_at: createdAt,
      parser_version: 'media-other-pilot-v1',
      listing_type: 'OTHER',
      image_urls: [imageUrl],
      thumbnail_url: imageUrl,
      has_images: true,
      review_reason: 'UNNORMALIZED_LUXURY_ITEM',
      source_type: 'jewelry_archive',
      listing_status: 'ACTIVE',
    };
  });
}

async function run() {
  const payload = records();
  if (!APPLY) {
    console.log(JSON.stringify({ status: 'dry_run', records: payload.length, ids: payload.map(row => row.id) }, null, 2));
    return;
  }
  if (!SUPABASE_URL || !SERVICE_KEY) throw new Error('Supabase service credentials are required');

  const response = await fetch(`${SUPABASE_URL}/rest/v1/watch_records?on_conflict=id`, {
    method: 'POST',
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'resolution=merge-duplicates,return=representation',
    },
    body: JSON.stringify(payload),
  });
  const body = await response.text();
  if (!response.ok) throw new Error(`Supabase ${response.status}: ${body}`);
  const written = JSON.parse(body);
  console.log(JSON.stringify({ status: 'applied', records_written: written.length, listing_type: 'OTHER', normalization_status: 'UNNORMALIZED' }, null, 2));
}

if (require.main === module) {
  run().catch(error => {
    console.error(JSON.stringify({ status: 'error', error: error.message }));
    process.exitCode = 1;
  });
}

module.exports = { records };
