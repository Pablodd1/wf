#!/usr/bin/env node
'use strict';

const crypto = require('node:crypto');
const mysql = require('mysql2/promise');
const { getClient } = require('../../api/_lib/supabase');
const { bindPrice, stable } = require('./build-four-brand-private-enrichment-manifest.cjs');
const { exactImageUrl, sourceAuctionId } = require('../audit/audit-four-brand-source-completeness.cjs');

const BRANDS = ['Omega', 'Zenith', 'Cartier', 'Tudor'];
const MODES = new Set(['audit', 'canary', 'full', 'rollback']);

function sha(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function positive(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

function parseArgs(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 2) {
    if (!argv[index]?.startsWith('--')) throw new Error(`Unexpected argument ${argv[index]}`);
    result[argv[index].slice(2)] = argv[index + 1];
  }
  result.mode = String(result.mode || '').toLowerCase();
  if (!MODES.has(result.mode) || !result['run-key'] || !result.confirm) {
    throw new Error('--mode, --run-key, and --confirm are required');
  }
  return result;
}

function assertTargets({ requireMariaDb = true } = {}) {
  const url = String(process.env.SUPABASE_URL || '').replace(/\/$/, '');
  if (url !== 'https://qnsafosakvonzgfcsphh.supabase.co') throw new Error('Refusing non-QNSA Supabase target');
  const required = ['SUPABASE_SERVICE_ROLE_KEY'];
  if (requireMariaDb) required.push('MYSQL_HOST', 'MYSQL_USER', 'MYSQL_PASS');
  for (const name of required) {
    if (!String(process.env[name] || '').trim()) throw new Error(`${name} is required`);
  }
}

async function json(url, attempts = 6) {
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const response = await fetch(url, { headers: { accept: 'application/json' } });
    if (response.ok) return response.json();
    if (attempt === attempts || (response.status < 500 && response.status !== 429)) {
      throw new Error(`Public inventory request failed with ${response.status}`);
    }
    await new Promise(resolve => setTimeout(resolve, attempt * 700));
  }
  throw new Error('Public inventory request failed');
}

async function crawlBrand(origin, brand) {
  const rows = [];
  const ids = new Set();
  let cursor = '';
  let expected = null;
  for (let page = 1; page <= 500; page += 1) {
    const url = new URL('/api/reviewed-market-inventory', origin);
    url.searchParams.set('brand', brand);
    url.searchParams.set('pageSize', '100');
    url.searchParams.set('pagination', 'cursor');
    if (cursor) url.searchParams.set('cursor', cursor);
    const body = await json(url);
    if (page === 1 && Number.isInteger(Number(body.total))) expected = Number(body.total);
    for (const row of body.records || []) {
      if (!row?.id || ids.has(row.id)) throw new Error(`${brand} public cursor repeated an ID`);
      ids.add(row.id);
      rows.push(row);
    }
    if (!body.hasMore || !body.nextCursor) {
      if (expected !== null && rows.length !== expected) {
        throw new Error(`${brand} public count mismatch: ${rows.length}/${expected}`);
      }
      return rows;
    }
    cursor = body.nextCursor;
  }
  throw new Error(`${brand} public cursor did not terminate`);
}

async function privateRows(client, ids) {
  const rows = [];
  for (let offset = 0; offset < ids.length; offset += 500) {
    const { data, error } = await client.rpc('qnsa_four_brand_private_enrichment_candidates', {
      p_listing_ids: ids.slice(offset, offset + 500),
    });
    if (error) throw new Error(`Private QNSA candidates: ${error.message || error}`);
    rows.push(...(data || []).map(value => value?.row_data || value));
  }
  return rows;
}

async function sourceRows(ids) {
  const connection = await mysql.createConnection({
    host: process.env.MYSQL_HOST,
    port: Number(process.env.MYSQL_PORT || 3306),
    user: process.env.MYSQL_USER,
    password: process.env.MYSQL_PASS,
    database: process.env.MYSQL_DB || 'thecollective_inventory',
    connectTimeout: 15_000,
  });
  const rows = [];
  try {
    for (let offset = 0; offset < ids.length; offset += 250) {
      const batch = ids.slice(offset, offset + 250);
      const placeholders = batch.map(() => '?').join(',');
      const [page] = await connection.execute(`SELECT id,type,is_bundle,price,front_image
        FROM auctions WHERE id IN (${placeholders})`, batch);
      rows.push(...page);
    }
  } finally {
    await connection.end();
  }
  return rows;
}

async function reachableImage(url) {
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const response = await fetch(url, { method: 'HEAD', redirect: 'follow', signal: AbortSignal.timeout(15_000) });
      if (response.ok && /^image\//i.test(response.headers.get('content-type') || '')) return true;
      if (response.status < 500 && response.status !== 429) return false;
    } catch {
      // Retry transient transport failures.
    }
    await new Promise(resolve => setTimeout(resolve, attempt * 350));
  }
  return false;
}

async function verifyImages(records, concurrency = 24) {
  const imageRecords = records.filter(record => record.proposed_image_url);
  let next = 0;
  const failures = [];
  async function worker() {
    while (next < imageRecords.length) {
      const record = imageRecords[next++];
      if (!(await reachableImage(record.proposed_image_url))) failures.push(record.listing_id);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, imageRecords.length) }, () => worker()));
  if (failures.length) throw new Error(`${failures.length} exact source images are unreachable or not images`);
}

function priceProposal(publicRow, privateRow, source) {
  const publicPrice = positive(publicRow.price_usd) || positive(publicRow.price_raw);
  if (publicPrice || String(publicRow.listing_type || '').toUpperCase() !== 'WTS'
    || !positive(source.price) || Number(source.is_bundle) !== 0
    || !/^(?:sale|wts)$/i.test(String(source.type || ''))) return null;
  return bindPrice(String(privateRow.raw_message || ''), { proposed_value: Number(source.price) }, privateRow);
}

function canonicalRecord(record) {
  const canonical = stable(record);
  return { ...record, proposal_canonical: canonical, proposal_sha256: sha(canonical) };
}

async function buildPlan(client, origin) {
  const publicRows = [];
  for (const brand of BRANDS) publicRows.push(...await crawlBrand(origin, brand));
  if (publicRows.length !== 17033) throw new Error(`Expected 17,033 four-brand public rows; received ${publicRows.length}`);
  const ids = publicRows.map(row => String(row.id).toLowerCase());
  const privateCandidates = await privateRows(client, ids);
  const privateById = new Map(privateCandidates.map(row => [String(row.listing_id).toLowerCase(), row]));
  if (privateById.size !== ids.length) throw new Error(`Private QNSA lineage reconciled ${privateById.size}/${ids.length}`);
  const auctionIds = publicRows.map(row => sourceAuctionId(row.source_record_id));
  if (auctionIds.some(id => !id)) throw new Error('A public source_record_id is not an exact mysql_auctions UUID');
  const sources = await sourceRows(auctionIds);
  const sourceById = new Map(sources.map(row => [String(row.id).toLowerCase(), row]));
  if (sourceById.size !== ids.length) throw new Error(`MariaDB reconciled ${sourceById.size}/${ids.length}`);
  const verifiedAt = new Date().toISOString();
  const records = [];
  for (const publicRow of publicRows) {
    const listingId = String(publicRow.id).toLowerCase();
    const privateRow = privateById.get(listingId);
    const auctionId = sourceAuctionId(publicRow.source_record_id);
    const source = sourceById.get(auctionId);
    const imageUrl = publicRow.has_images === true ? null : exactImageUrl(source.front_image);
    const price = priceProposal(publicRow, privateRow, source);
    if (!imageUrl && !price) continue;
    const mediaKey = imageUrl ? decodeURIComponent(new URL(imageUrl).pathname.split('/').pop()) : null;
    records.push(canonicalRecord({
      listing_id: listingId,
      canonical_brand: privateRow.canonical_brand,
      raw_message_version_id: privateRow.raw_message_version_id,
      source_record_id: privateRow.source_record_id,
      source_hash: privateRow.source_hash,
      source_candidate_hash: privateRow.source_candidate_hash,
      source_auction_id: auctionId,
      ...(imageUrl ? {
        proposed_image_url: imageUrl,
        source_media_key: mediaKey,
        source_media_sha256: sha(mediaKey),
        image_verified_at: verifiedAt,
      } : {}),
      ...(price ? {
        proposed_price_usd: price.value,
        source_price_amount: price.source_amount,
        source_currency: price.source_currency || null,
        price_evidence_status: price.status,
        fx_rate: price.fx_rate || null,
        fx_source: price.fx_source || null,
        fx_date: price.fx_date || null,
        price_evidence_quote: price.quote,
      } : {}),
    }));
  }
  records.sort((left, right) => left.listing_id.localeCompare(right.listing_id));
  await verifyImages(records);
  return { records, publicRows };
}

function canary(records) {
  const selected = [];
  for (const brand of BRANDS) {
    const candidates = records.filter(record => record.canonical_brand === brand);
    const lanes = [
      record => Boolean(record.proposed_image_url && record.proposed_price_usd),
      record => Boolean(record.proposed_image_url && !record.proposed_price_usd),
      record => record.price_evidence_status === 'SOURCE_EXPLICIT_USD_USDT',
      record => record.price_evidence_status === 'DATED_VERIFIED_FX',
      record => record.price_evidence_status === 'OWNER_ASSUMED_USD',
    ];
    for (const lane of lanes) {
      const found = candidates.find(record => lane(record) && !selected.includes(record));
      if (found) selected.push(found);
    }
  }
  return [...new Map(selected.map(record => [record.listing_id, record])).values()]
    .sort((left, right) => left.listing_id.localeCompare(right.listing_id));
}

async function rpc(client, name, args) {
  const { data, error } = await client.rpc(name, args);
  if (error) throw new Error(`${name}: ${error.message || error}`);
  return data;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  assertTargets({ requireMariaDb: options.mode !== 'rollback' });
  const client = getClient();
  if (options.mode === 'rollback') {
    if (options.confirm !== `ROLLBACK_${options['run-key']}`) throw new Error('Exact rollback confirmation required');
    const result = await rpc(client, 'rollback_qnsa_four_brand_source_completion', { p_run_key: options['run-key'] });
    process.stdout.write(`${JSON.stringify({ event: 'source_completion_rollback', result })}\n`);
    return;
  }
  const plan = await buildPlan(client, options.origin || 'https://watchfacts-poc.vercel.app');
  const selected = options.mode === 'canary' ? canary(plan.records) : plan.records;
  const counts = Object.fromEntries(BRANDS.map(brand => [brand, {
    records: plan.records.filter(record => record.canonical_brand === brand).length,
    images: plan.records.filter(record => record.canonical_brand === brand && record.proposed_image_url).length,
    prices: plan.records.filter(record => record.canonical_brand === brand && record.proposed_price_usd).length,
  }]));
  const planSha = sha(stable(plan.records));
  process.stdout.write(`${JSON.stringify({ event: 'source_completion_plan', total: plan.records.length,
    selected: selected.length, plan_sha256: planSha, counts, public_writes: 0 })}\n`);
  if (options.mode === 'audit') {
    if (options.confirm !== `AUDIT_${options['run-key']}`) throw new Error('Exact audit confirmation required');
    return;
  }
  const expected = options.mode === 'canary'
    ? `ACTIVATE_CANARY_${options['run-key']}` : `ACTIVATE_FULL_${options['run-key']}`;
  if (options.confirm !== expected) throw new Error(`Exact confirmation required: ${expected}`);
  let began = false;
  let active = false;
  try {
    await rpc(client, 'begin_qnsa_four_brand_source_completion', {
      p_run_key: options['run-key'], p_mode: options.mode.toUpperCase(),
      p_plan_sha256: planSha, p_expected_count: selected.length,
    });
    began = true;
    for (let offset = 0; offset < selected.length; offset += 500) {
      await rpc(client, 'stage_qnsa_four_brand_source_completion', {
        p_run_key: options['run-key'], p_records: selected.slice(offset, offset + 500),
      });
    }
    await rpc(client, 'finalize_qnsa_four_brand_source_completion', { p_run_key: options['run-key'] });
    const result = await rpc(client, 'activate_qnsa_four_brand_source_completion', { p_run_key: options['run-key'] });
    active = true;
    if (Number(result?.updated) !== selected.length) throw new Error('Activation readback count mismatch');
    process.stdout.write(`${JSON.stringify({ event: 'source_completion_active', result })}\n`);
  } catch (error) {
    if (began && active) {
      try { await rpc(client, 'rollback_qnsa_four_brand_source_completion', { p_run_key: options['run-key'] }); }
      catch (rollbackError) { error.message += `; rollback failed: ${rollbackError.message}`; }
    }
    throw error;
  }
}

if (require.main === module) main().catch(error => {
  process.stderr.write(`${String(error?.message || error).replace(/[\r\n]+/g, ' ').slice(0, 500)}\n`);
  process.exitCode = 1;
});

module.exports = { buildPlan, canary, canonicalRecord, priceProposal };
