'use strict';

const DEFAULT_BASE_URL = 'https://watchfacts-poc.vercel.app';
const EXPECTED_RELEASE_BRANDS = ['Rolex', 'Patek Philippe', 'Audemars Piguet', 'Richard Mille', 'Cartier', 'Zenith'];

async function fetchJson(url, fetchImpl) {
  let response;
  for (let attempt = 0; attempt < 6; attempt += 1) {
    response = await fetchImpl(url);
    if (response.ok || ![500, 502, 503, 504].includes(response.status) || attempt === 5) break;
    await new Promise(resolve => setTimeout(resolve, 1000 * (attempt + 1)));
  }
  if (!response.ok) throw new Error(`public release request failed: ${response.status}`);
  return response.json();
}

function digits(value) {
  const result = String(value || '').replace(/[^0-9]/g, '');
  return result.length >= 8 && result.length <= 15 ? result : null;
}

function canonicalBrand(entry) {
  return typeof entry === 'string' ? entry : entry?.brand;
}

async function publicationBrands(baseUrl, fetchImpl) {
  const url = new URL('/api/reviewed-market-inventory', baseUrl);
  url.searchParams.set('pageSize', '1');
  url.searchParams.set('pagination', 'cursor');
  url.searchParams.set('directoryLinkAudit', String(Date.now()));
  const body = await fetchJson(url, fetchImpl);
  const discovered = (body.publicationBrands || body.summary?.publicationBrands || []).map(canonicalBrand).filter(Boolean);
  return [...new Set(discovered.length ? discovered : EXPECTED_RELEASE_BRANDS)];
}

async function releasedRowsForBrand(baseUrl, brand, fetchImpl) {
  const rows = [];
  let cursor = '';
  for (let page = 0; page < 10000; page += 1) {
    const url = new URL('/api/reviewed-market-inventory', baseUrl);
    url.searchParams.set('brand', brand);
    url.searchParams.set('item', 'watches');
    url.searchParams.set('pageSize', '50');
    url.searchParams.set('pagination', 'cursor');
    url.searchParams.set('directoryLinkAudit', String(Date.now()));
    if (cursor) url.searchParams.set('cursor', cursor);
    const body = await fetchJson(url, fetchImpl);
    rows.push(...(body.records || body.listings || []));
    if (!body.hasMore) break;
    if (!body.nextCursor || body.nextCursor === cursor) throw new Error(`${brand} cursor did not advance`);
    cursor = body.nextCursor;
  }
  return rows;
}

async function buildLiveListingLinks({ baseUrl = DEFAULT_BASE_URL, fetchImpl = fetch } = {}) {
  const brands = await publicationBrands(baseUrl, fetchImpl);
  const byId = new Map();
  const brandCounts = {};
  for (const brand of brands) {
    const rows = await releasedRowsForBrand(baseUrl, brand, fetchImpl);
    brandCounts[brand] = rows.length;
    for (const row of rows) byId.set(String(row.id), row);
  }
  const capturedAt = new Date().toISOString();
  const records = [...byId.values()].flatMap(row => {
    const phone = digits(row.seller_phone || row.phone_number);
    return phone && /^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(String(row.id || '')) ? [{
      listing_id: row.id,
      source_record_id: row.source_record_id || null,
      seller_phone: phone,
      seller_name: row.seller_name || row.posted_by || null,
      captured_at: capturedAt,
    }] : [];
  });
  return {
    records,
    report: {
      brands,
      brand_counts: brandCounts,
      unique_public_listings: byId.size,
      exact_phone_link_candidates: records.length,
      unresolved_without_public_phone: byId.size - records.length,
      raw_messages_exported: 0,
    },
  };
}

if (require.main === module) {
  buildLiveListingLinks().then(result => process.stdout.write(JSON.stringify(result)))
    .catch(error => { console.error(error.message); process.exitCode = 1; });
}

module.exports = { buildLiveListingLinks, digits, publicationBrands, releasedRowsForBrand };
