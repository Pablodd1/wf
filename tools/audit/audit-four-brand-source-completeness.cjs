#!/usr/bin/env node
'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const mysql = require('mysql2/promise');

const BRANDS = ['Omega', 'Zenith', 'Cartier', 'Tudor'];
const SOURCE_PREFIX = 'mysql_auctions_';
const IMAGE_ORIGIN = 'https://thecollective-prod.nyc3.digitaloceanspaces.com/listings/full/';

function option(name, fallback = '') {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? String(process.argv[index + 1] || '') : fallback;
}

function flag(name) {
  return process.argv.includes(`--${name}`);
}

function text(value) {
  return value === null || value === undefined ? '' : String(value).trim();
}

function positive(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

function sha256(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

function normalizedRaw(value) {
  return text(value).toLowerCase().replace(/\s+/g, ' ');
}

function sourceAuctionId(sourceRecordId) {
  const value = text(sourceRecordId);
  if (!value.startsWith(SOURCE_PREFIX)) return null;
  const id = value.slice(SOURCE_PREFIX.length);
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)
    ? id.toLowerCase()
    : null;
}

function exactImageUrl(value) {
  const raw = text(value);
  if (!raw || raw.includes('..')) return null;
  if (/^https:\/\/thecollective-prod\.nyc3\.digitaloceanspaces\.com\/listings\/full\/[^\s]+$/i.test(raw)) {
    return raw;
  }
  const filename = raw.replace(/^\/+/, '');
  if (!/^[A-Za-z0-9._-]+$/.test(filename)) return null;
  return `${IMAGE_ORIGIN}${encodeURIComponent(filename)}`;
}

async function fetchJson(url, attempts = 6) {
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const response = await fetch(url, { headers: { accept: 'application/json' } });
    if (response.ok) return response.json();
    if (response.status < 500 && response.status !== 429) {
      throw new Error(`${response.status} ${response.statusText}: ${url}`);
    }
    if (attempt === attempts) throw new Error(`${response.status} ${response.statusText}: ${url}`);
    await new Promise(resolve => setTimeout(resolve, attempt * 750));
  }
  throw new Error(`Unable to load ${url}`);
}

async function crawlBrand(origin, brand) {
  const rows = [];
  const ids = new Set();
  let expected = null;
  let cursor = null;
  for (let page = 1; page <= 2_000; page += 1) {
    const url = new URL('/api/reviewed-market-inventory', origin);
    url.searchParams.set('brand', brand);
    url.searchParams.set('pageSize', '100');
    url.searchParams.set('pagination', 'cursor');
    if (cursor) url.searchParams.set('cursor', cursor);
    const payload = await fetchJson(url);
    if (page === 1 || page % 25 === 0) {
      process.stderr.write(`[audit] ${brand}: page ${page}, ${rows.length} rows collected\n`);
    }
    if (page === 1 && Number.isInteger(Number(payload.total))) expected = Number(payload.total);
    for (const row of payload.records || []) {
      if (!row?.id || ids.has(row.id)) throw new Error(`${brand} repeated or missing public ID on page ${page}`);
      ids.add(row.id);
      rows.push(row);
    }
    if (!payload.hasMore || !payload.nextCursor) {
      if (expected !== null && rows.length !== expected) {
        throw new Error(`${brand} crawl did not reconcile: expected ${expected}, received ${rows.length}`);
      }
      return rows;
    }
    cursor = payload.nextCursor;
  }
  throw new Error(`${brand} cursor did not terminate`);
}

async function loadAuctions(connection, ids) {
  const rows = [];
  for (let start = 0; start < ids.length; start += 250) {
    const batch = ids.slice(start, start + 250);
    const placeholders = batch.map(() => '?').join(',');
    const [page] = await connection.execute(`
      SELECT id, type, is_bundle, price, dealer_rating, front_image,
        title_hash, from_number, company_id, times_posted, reposted_at,
        created_on, normalized_reference
      FROM auctions
      WHERE id IN (${placeholders})
    `, batch);
    rows.push(...page);
  }
  return rows;
}

async function verifyUrls(urls, concurrency = 12) {
  const results = new Map();
  let next = 0;
  async function worker() {
    while (next < urls.length) {
      const index = next;
      next += 1;
      const url = urls[index];
      try {
        const response = await fetch(url, { method: 'HEAD' });
        results.set(url, {
          reachable: response.ok,
          status: response.status,
          content_type: response.headers.get('content-type'),
        });
      } catch {
        results.set(url, { reachable: false, status: null, content_type: null });
      }
      if (results.size === urls.length || results.size % 500 === 0) {
        process.stderr.write(`[audit] images: ${results.size}/${urls.length} checked\n`);
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, urls.length) }, () => worker()));
  return results;
}

function publicSignature(row) {
  const identity = [row.brand, row.reference, row.listing_type, row.price_usd, row.seller_name,
    String(row.listing_date || '').slice(0, 10), normalizedRaw(row.raw_message)].join('\u001f');
  return sha256(identity);
}

function sourceRepostKey(row) {
  const titleHash = text(row.title_hash);
  const sourceIdentity = text(row.from_number) || (row.company_id ? `company:${row.company_id}` : '');
  return titleHash && sourceIdentity ? sha256(`${sourceIdentity}\u001f${titleHash}\u001f${text(row.type)}`) : null;
}

function summarizeBrand(publicRows, auctionById, imageChecks) {
  const summary = {
    public_rows: publicRows.length,
    public_duplicate_ids: publicRows.length - new Set(publicRows.map(row => row.id)).size,
    source_id_valid: 0,
    source_row_found: 0,
    public_image_present: 0,
    public_image_missing: 0,
    source_exact_image_present: 0,
    source_exact_image_missing: 0,
    source_exact_image_reachable: 0,
    source_exact_image_unreachable: 0,
    priced_wts: 0,
    unpriced_wts: 0,
    unpriced_wts_with_source_price: 0,
    public_numeric_dealer_rating: 0,
    missing_public_rating_with_source_rating: 0,
    source_times_posted_gt_one: 0,
    exact_public_repost_groups: 0,
    exact_public_repost_rows: 0,
    source_repost_groups: 0,
    source_repost_rows: 0,
  };
  const exactImages = [];
  const sourcePriceCandidates = [];
  const sourceRatingCandidates = [];
  const publicGroups = new Map();
  const sourceGroups = new Map();

  for (const row of publicRows) {
    const auctionId = sourceAuctionId(row.source_record_id);
    if (auctionId) summary.source_id_valid += 1;
    const source = auctionId ? auctionById.get(auctionId) : null;
    if (source) summary.source_row_found += 1;
    const publicImage = row.has_images === true && /^https?:\/\/[^\s]+$/i.test(text(row.thumbnail_url));
    summary.public_image_present += Number(publicImage);
    summary.public_image_missing += Number(!publicImage);
    const imageUrl = source ? exactImageUrl(source.front_image) : null;
    summary.source_exact_image_present += Number(Boolean(imageUrl));
    summary.source_exact_image_missing += Number(!imageUrl);
    if (imageUrl) {
      const check = imageChecks.get(imageUrl);
      summary.source_exact_image_reachable += Number(check?.reachable === true && /^image\//i.test(text(check.content_type)));
      summary.source_exact_image_unreachable += Number(check && !(check.reachable === true && /^image\//i.test(text(check.content_type))));
      if (!publicImage) exactImages.push({
        listing_id: row.id,
        source_record_id: row.source_record_id,
        image_url: imageUrl,
        source_front_image_sha256: sha256(text(source.front_image)),
        reachable: check?.reachable ?? null,
        content_type: check?.content_type || null,
      });
    }

    const wts = text(row.listing_type).toUpperCase() === 'WTS';
    const publicPrice = positive(row.price_usd) || positive(row.price_raw);
    summary.priced_wts += Number(wts && publicPrice !== null);
    summary.unpriced_wts += Number(wts && publicPrice === null);
    const sourcePrice = source ? positive(source.price) : null;
    if (wts && publicPrice === null && sourcePrice !== null && Number(source.is_bundle) === 0
      && /^(?:sale|wts)$/i.test(text(source.type))) {
      summary.unpriced_wts_with_source_price += 1;
      sourcePriceCandidates.push({
        listing_id: row.id,
        source_record_id: row.source_record_id,
        source_price: sourcePrice,
        public_reference: row.reference || null,
        raw_message_sha256: sha256(row.raw_message || ''),
      });
    }

    const publicRating = positive(row.seller_rating);
    summary.public_numeric_dealer_rating += Number(publicRating !== null);
    const sourceRating = source ? positive(source.dealer_rating) : null;
    if (publicRating === null && sourceRating !== null) {
      summary.missing_public_rating_with_source_rating += 1;
      sourceRatingCandidates.push({
        listing_id: row.id,
        source_record_id: row.source_record_id,
        source_rating: sourceRating,
      });
    }
    summary.source_times_posted_gt_one += Number(Number(source?.times_posted || 0) > 1);

    const publicKey = publicSignature(row);
    const publicMembers = publicGroups.get(publicKey) || [];
    publicMembers.push(row.id);
    publicGroups.set(publicKey, publicMembers);
    const sourceKey = source ? sourceRepostKey(source) : null;
    if (sourceKey) {
      const sourceMembers = sourceGroups.get(sourceKey) || [];
      sourceMembers.push(row.id);
      sourceGroups.set(sourceKey, sourceMembers);
    }
  }

  const publicDuplicateGroups = [...publicGroups.entries()].filter(([, ids]) => ids.length > 1);
  const sourceDuplicateGroups = [...sourceGroups.entries()].filter(([, ids]) => ids.length > 1);
  summary.exact_public_repost_groups = publicDuplicateGroups.length;
  summary.exact_public_repost_rows = publicDuplicateGroups.reduce((sum, [, ids]) => sum + ids.length, 0);
  summary.source_repost_groups = sourceDuplicateGroups.length;
  summary.source_repost_rows = sourceDuplicateGroups.reduce((sum, [, ids]) => sum + ids.length, 0);

  return {
    summary,
    exact_image_candidates: exactImages,
    source_price_candidates: sourcePriceCandidates,
    source_rating_candidates: sourceRatingCandidates,
    public_duplicate_groups: publicDuplicateGroups.map(([signature, ids]) => ({ signature, ids })),
    source_repost_groups: sourceDuplicateGroups.map(([signature, ids]) => ({ signature, ids })),
  };
}

async function main() {
  const origin = option('origin', 'https://watchfacts-poc.vercel.app').replace(/\/$/, '');
  const output = path.resolve(option('output', path.join('audit-output', `four-brand-source-completeness-${Date.now()}.json`)));
  const verifyImages = flag('verify-images');
  for (const required of ['MYSQL_HOST', 'MYSQL_USER', 'MYSQL_PASS']) {
    if (!text(process.env[required])) throw new Error(`${required} is required`);
  }

  const publicByBrand = new Map();
  for (const brand of BRANDS) {
    publicByBrand.set(brand, await crawlBrand(origin, brand));
    process.stderr.write(`[audit] ${brand}: crawl complete (${publicByBrand.get(brand).length})\n`);
  }
  const auctionIds = [...new Set([...publicByBrand.values()].flat()
    .map(row => sourceAuctionId(row.source_record_id)).filter(Boolean))];
  const connection = await mysql.createConnection({
    host: process.env.MYSQL_HOST,
    port: Number(process.env.MYSQL_PORT || 3306),
    user: process.env.MYSQL_USER,
    password: process.env.MYSQL_PASS,
    database: process.env.MYSQL_DB || 'thecollective_inventory',
    connectTimeout: 15_000,
  });
  let auctions;
  try {
    auctions = await loadAuctions(connection, auctionIds);
  } finally {
    await connection.end();
  }
  const auctionById = new Map(auctions.map(row => [text(row.id).toLowerCase(), row]));
  const urls = [...new Set(auctions.map(row => exactImageUrl(row.front_image)).filter(Boolean))];
  process.stderr.write(`[audit] MariaDB: ${auctions.length}/${auctionIds.length} exact source rows found\n`);
  const imageChecks = verifyImages ? await verifyUrls(urls, 20) : new Map();

  const brands = {};
  for (const brand of BRANDS) brands[brand] = summarizeBrand(publicByBrand.get(brand), auctionById, imageChecks);
  const report = {
    contract: 'FOUR_BRAND_SOURCE_COMPLETENESS_AUDIT_V1',
    generated_at: new Date().toISOString(),
    source: { public_origin: origin, mariadb_database: process.env.MYSQL_DB || 'thecollective_inventory' },
    read_only: true,
    public_writes: 0,
    public_rows: [...publicByBrand.values()].reduce((sum, rows) => sum + rows.length, 0),
    source_ids: auctionIds.length,
    source_rows_found: auctions.length,
    image_urls_checked: imageChecks.size,
    brands,
  };
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify({
    output,
    read_only: true,
    public_rows: report.public_rows,
    source_ids: report.source_ids,
    source_rows_found: report.source_rows_found,
    image_urls_checked: report.image_urls_checked,
    by_brand: Object.fromEntries(BRANDS.map(brand => [brand, brands[brand].summary])),
  }, null, 2)}\n`);
}

if (require.main === module) {
  main().catch(error => {
    process.stderr.write(`${String(error?.message || error).replace(/[\r\n]+/g, ' ').slice(0, 500)}\n`);
    process.exitCode = 1;
  });
}

module.exports = { exactImageUrl, sourceAuctionId, summarizeBrand };
