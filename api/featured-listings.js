'use strict';

const { lookupCatalog, normalizeRef } = require('./_lib/catalog');
const { verifyFeaturedRecord } = require('./_lib/featured-quality.cjs');

function keyFromEnv() {
  return process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY || null;
}

async function readJson(url, key) {
  const response = await fetch(url, {
    headers: { apikey: key, Authorization: `Bearer ${key}` },
  });
  if (!response.ok) throw new Error(`Supabase returned ${response.status}`);
  return response.json();
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const base = process.env.SUPABASE_URL;
  const key = keyFromEnv();
  if (!base || !key) return res.status(200).json({ status: 'not_configured', records: [] });

  try {
    const candidateQuery = new URLSearchParams({
      select: 'id,brand,reference,price_usd,price_raw,currency,dial_color,condition,year,verdict,listing_type,source,source_type,listing_date,listing_status,created_at,confidence,has_images,thumbnail_url,region',
      listing_type: 'eq.WTS',
      verdict: 'eq.APPROVED',
      has_images: 'eq.true',
      order: 'created_at.desc',
      limit: '300',
    });
    const candidates = await readJson(`${base}/rest/v1/trading_floor_listings?${candidateQuery}`, key);
    const rows = Array.isArray(candidates) ? candidates : [];
    if (!rows.length) return res.status(200).json({ status: 'ok', records: [], withheld: 0 });

    const ids = rows.map(row => row.id).filter(Boolean);
    const sourceRows = [];
    for (let offset = 0; offset < ids.length; offset += 75) {
      const batch = ids.slice(offset, offset + 75);
      const sourceQuery = new URLSearchParams({
        select: 'id,raw_message,flags,field_confidence',
        id: `in.(${batch.join(',')})`,
        limit: String(batch.length),
      });
      const batchRows = await readJson(`${base}/rest/v1/watch_records?${sourceQuery}`, key);
      if (Array.isArray(batchRows)) sourceRows.push(...batchRows);
    }
    const sourceById = new Map((Array.isArray(sourceRows) ? sourceRows : []).map(row => [row.id, row]));

    const references = [...new Set(rows.map(row => normalizeRef(row.reference)).filter(Boolean))];
    const comparableRows = references.length
      ? await readJson(`${base}/rest/v1/trading_floor_listings?${new URLSearchParams({
        select: 'reference,dial_color,price_usd',
        listing_type: 'eq.WTS',
        verdict: 'eq.APPROVED',
        price_usd: 'gt.0',
        reference: `in.(${references.join(',')})`,
        limit: '10000',
      })}`, key)
      : [];
    const comparableByKey = new Map();
    for (const row of Array.isArray(comparableRows) ? comparableRows : []) {
      const keyName = `${normalizeRef(row.reference)}|${String(row.dial_color || '').trim().toUpperCase()}`;
      const bucket = comparableByKey.get(keyName) || [];
      bucket.push(row);
      comparableByKey.set(keyName, bucket);
    }

    const records = [];
    let withheld = 0;
    for (const listing of rows) {
      const source = sourceById.get(listing.id);
      const catalog = lookupCatalog(listing.reference, listing.brand);
      const bucketKey = `${normalizeRef(listing.reference)}|${String(listing.dial_color || '').trim().toUpperCase()}`;
      const verification = verifyFeaturedRecord(listing, source, catalog, comparableByKey.get(bucketKey) || []);
      if (!verification.verified) {
        withheld += 1;
        continue;
      }
      records.push({
        ...listing,
        reference: verification.reference,
        price_usd: verification.price_usd,
        featured_verified: true,
        featured_price_source: verification.price_source,
        featured_reference_source: verification.reference_source,
        featured_comparable_count: verification.comparable_count,
        featured_comparable_min: verification.comparable_min,
        featured_comparable_max: verification.comparable_max,
        featured_comparable_avg: verification.comparable_avg,
      });
      if (records.length >= 24) break;
    }
    return res.status(200).json({ status: 'ok', records, withheld, candidates: rows.length });
  } catch (error) {
    console.error('[featured-listings]', error.message);
    return res.status(500).json({ status: 'error', error: 'Featured inventory verification failed' });
  }
};
