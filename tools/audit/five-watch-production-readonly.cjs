#!/usr/bin/env node
'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const mysql = require('mysql2/promise');
const { createClient } = require('@supabase/supabase-js');

const ORIGIN = process.env.WATCHFACTS_ORIGIN || 'https://watchfacts-poc.vercel.app';
const SOURCE_PREFIX = 'mysql_auctions_';
const IMAGE_HOST = 'thecollective-prod.nyc3.digitaloceanspaces.com';
const IMAGE_PATH_PREFIX = '/listings/full/';
const MAX_PUBLIC_PAGES = 200;
const MAX_IMAGE_SAMPLE_BYTES = 64 * 1024;

// This cohort is intentionally immutable. Do not substitute candidates.
const WATCHES = [
  {
    brand: 'Zenith',
    id: 'd7ca9584-c8d0-43a5-8e19-7cf3fc4473e2',
    reference: '95.9000.9004/78.M9000',
    source_record_id: 'mysql_auctions_f5aa2a73-53cf-47fd-b5c9-12d9912ceea6',
  },
  {
    brand: 'Tudor',
    id: '0a6e7949-1717-4123-994c-17377f7e9ab8',
    reference: '79830RB',
    source_record_id: 'mysql_auctions_8dda4207-e65a-415e-825a-684aeea99203',
  },
  {
    brand: 'Omega',
    id: '5f11c5b4-bd08-4976-9a87-af1a9921a8a3',
    reference: '310.60.42.50.01.001',
    source_record_id: 'mysql_auctions_1b50a1b1-a3c1-4747-bdc1-16de9060c729',
  },
  {
    brand: 'Cartier',
    id: 'ec507bd1-9cfc-4be2-aaa4-3f0dd477af80',
    reference: 'WSSA0039',
    source_record_id: 'mysql_auctions_149a44ef-e6b5-4e86-a1fd-1ae7717b0679',
  },
  {
    brand: 'Vacheron Constantin',
    id: 'f125afdc-c21a-4450-a59b-01f3f667edb2',
    reference: '7900V/110A-B546',
    source_record_id: 'mysql_auctions_a562f952-4be0-4571-b27d-a7daa4ff354b',
  },
];

function text(value) {
  return value == null ? '' : String(value).trim();
}

function sha256(value) {
  return crypto.createHash('sha256').update(String(value ?? ''), 'utf8').digest('hex');
}

function redact(value) {
  return String(value ?? '')
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[REDACTED_EMAIL]')
    .replace(/\+\d[\d\s().-]{6,}\d/g, '[REDACTED_PHONE]')
    .replace(/\b(phone|tel(?:ephone)?|whats?app|call)\s*[:=]?\s*\d[\d\s().-]{6,}\d/gi, '$1 [REDACTED_PHONE]');
}

function rawEvidence(value, includeText = true) {
  const raw = String(value ?? '');
  const redacted = redact(raw);
  return {
    present: raw.length > 0,
    length: raw.length,
    sha256: sha256(raw),
    redacted_sha256: sha256(redacted),
    ...(includeText ? { redacted_text: redacted } : {}),
  };
}

function safeUrlMetadata(value) {
  if (!value) return null;
  try {
    const url = new URL(String(value));
    return { protocol: url.protocol, hostname: url.hostname };
  } catch {
    return { protocol: null, hostname: null };
  }
}

function exactSourceImageUrl(value) {
  const raw = text(value);
  if (!raw || raw.includes('..')) return null;
  let candidate = raw;
  if (!/^https?:\/\//i.test(candidate)) {
    const filename = candidate.replace(/^\/+/, '');
    if (!/^[A-Za-z0-9._-]+$/.test(filename)) return null;
    candidate = `https://${IMAGE_HOST}${IMAGE_PATH_PREFIX}${encodeURIComponent(filename)}`;
  }
  try {
    const url = new URL(candidate);
    if (url.protocol !== 'https:' || url.hostname !== IMAGE_HOST
      || !url.pathname.startsWith(IMAGE_PATH_PREFIX)
      || url.username || url.password) return null;
    return url.toString();
  } catch {
    return null;
  }
}

function safeImageDescriptor(value) {
  const exact = exactSourceImageUrl(value);
  if (!exact) return value ? { eligible: false, supplied_sha256: sha256(value) } : null;
  const url = new URL(exact);
  return {
    eligible: true,
    protocol: url.protocol,
    hostname: url.hostname,
    pathname: url.pathname,
    pathname_sha256: sha256(url.pathname),
    had_query: Boolean(url.search),
  };
}

async function fetchPayload(pathname, params = {}) {
  const url = new URL(pathname, ORIGIN);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null) url.searchParams.set(key, String(value));
  }
  url.searchParams.set('_canary', `${Date.now()}-${crypto.randomBytes(4).toString('hex')}`);
  const response = await fetch(url, {
    headers: { accept: 'application/json', 'cache-control': 'no-cache' },
    redirect: 'error',
    signal: AbortSignal.timeout(20_000),
  });
  const body = await response.text();
  let payload = null;
  try { payload = body ? JSON.parse(body) : null; } catch { payload = { non_json_sha256: sha256(body) }; }
  return {
    status: response.status,
    ok: response.ok,
    cache_control: response.headers.get('cache-control'),
    age: response.headers.get('age'),
    payload,
  };
}

async function getPublicRecord(watch) {
  let cursor = null;
  let row = null;
  let lastResponse = null;
  let scannedRecords = 0;
  const seenIds = new Set();
  for (let page = 1; page <= MAX_PUBLIC_PAGES; page += 1) {
    const response = await fetchPayload('/api/reviewed-market-inventory', {
      brand: watch.brand,
      reference: watch.reference,
      pageSize: 50,
      pagination: 'cursor',
      cursor,
    });
    lastResponse = response;
    if (!response.ok) throw new Error(`${watch.brand} Trading API returned HTTP ${response.status}`);
    const records = Array.isArray(response.payload?.records) ? response.payload.records : [];
    for (const candidate of records) {
      const id = text(candidate?.id).toLowerCase();
      if (!id) throw new Error(`${watch.brand} Trading API returned a row without an ID`);
      if (seenIds.has(id)) throw new Error(`${watch.brand} Trading API repeated ID ${id}`);
      seenIds.add(id);
      scannedRecords += 1;
      if (id === watch.id) row = candidate;
    }
    if (row || !response.payload?.hasMore || !response.payload?.nextCursor) break;
    cursor = response.payload.nextCursor;
    if (page === MAX_PUBLIC_PAGES) throw new Error(`${watch.brand} exact-ID cursor did not terminate`);
  }
  const response = lastResponse;
  if (!response) throw new Error(`${watch.brand} Trading API returned no response`);
  return {
    response: {
      status: response.status,
      ok: response.ok,
      cache_control: response.cache_control,
      age: response.age,
      scanned_records: scannedRecords,
      scanned_ids_sha256: sha256([...seenIds].join('\n')),
    },
    found_exact_id: Boolean(row),
    row: row ? {
      id: row.id,
      source_record_id: row.source_record_id,
      brand: row.brand,
      model: row.model,
      reference: row.reference,
      reference_raw: row.reference_raw,
      listing_type: row.listing_type,
      price_raw: row.price_raw,
      price_usd: row.price_usd,
      currency: row.currency,
      source_price_amount: row.source_price_amount,
      source_currency: row.source_currency,
      price_evidence_status: row.price_evidence_status,
      price_research_eligible: row.price_research_eligible,
      seller_name: row.seller_name,
      source_seller_name: row.source_seller_name,
      seller_country: row.seller_country,
      region: row.region,
      location: row.location,
      condition: row.condition,
      listing_date: row.listing_date,
      created_at: row.created_at,
      thumbnail_url: safeImageDescriptor(row.thumbnail_url),
      image_urls: (row.image_urls || []).map(safeImageDescriptor),
      has_images: row.has_images,
      source_image_evidence: row.source_image_evidence,
      raw_message_scope: row.raw_message_scope,
      raw_message_evidence_type: row.raw_message_evidence_type,
      raw_message: rawEvidence(row.raw_message),
      publication_lane: row.publication_lane,
    } : null,
  };
}

async function getPriceResearchDetail(watch) {
  const response = await fetchPayload('/api/price-research-listing', { id: watch.id });
  const row = response.payload?.record || response.payload?.listing || response.payload?.data || response.payload;
  return {
    status: response.status,
    ok: response.ok,
    cache_control: response.cache_control,
    payload_sha256: sha256(JSON.stringify(response.payload)),
    row: response.ok && row && typeof row === 'object' ? {
      id: row.id,
      brand: row.brand,
      model: row.model,
      reference: row.reference,
      price_raw: row.price_raw,
      price_usd: row.price_usd,
      currency: row.currency,
      source_price_amount: row.source_price_amount,
      source_currency: row.source_currency,
      price_evidence_status: row.price_evidence_status,
      listing_date: row.listing_date,
      created_at: row.created_at,
      thumbnail_url: safeImageDescriptor(row.thumbnail_url),
      image_urls: (row.image_urls || []).map(safeImageDescriptor),
      raw_message: rawEvidence(row.raw_message),
    } : null,
    error: response.ok ? null : (response.payload?.error || response.payload?.message || `HTTP_${response.status}`),
  };
}

async function loadMariaDbRows() {
  const required = ['MYSQL_HOST', 'MYSQL_USER', 'MYSQL_PASS', 'MYSQL_DB'];
  const missing = required.filter(key => !process.env[key]);
  if (missing.length) return { error: `missing environment: ${missing.join(',')}`, rows: [] };
  const connection = await mysql.createConnection({
    host: process.env.MYSQL_HOST,
    port: Number(process.env.MYSQL_PORT || 3306),
    user: process.env.MYSQL_USER,
    password: process.env.MYSQL_PASS,
    database: process.env.MYSQL_DB,
    connectTimeout: 20_000,
    ssl: { rejectUnauthorized: true },
  });
  let transactionStarted = false;
  try {
    const [sslRows] = await connection.query("SHOW STATUS LIKE 'Ssl_cipher'");
    if (!text(sslRows?.[0]?.Value)) throw new Error('MariaDB connection is not TLS encrypted');
    await connection.query('SET SESSION TRANSACTION READ ONLY');
    await connection.query('START TRANSACTION READ ONLY');
    transactionStarted = true;
    const ids = WATCHES.map(watch => watch.source_record_id.slice(SOURCE_PREFIX.length));
    const placeholders = ids.map(() => '?').join(',');
    const [rows] = await connection.execute(`
      SELECT id, created_on, updated_on, origin, type, status, is_bundle,
        from_name, region, title, description, comments, brand, model, reference,
        normalized_reference, dial_color, condition_id, price, currency, front_image,
        catalog_confirmed, catalog_canonical_confirmed, identification_status,
        times_posted, reposted_at
      FROM auctions
      WHERE id IN (${placeholders})
    `, ids);
    const imageUrls = [];
    const evidenceRows = rows.map(row => {
      const exactImage = exactSourceImageUrl(row.front_image);
      if (exactImage) imageUrls.push(exactImage);
      const raw = text(row.description) || text(row.title) || text(row.comments);
      return {
        id: String(row.id).toLowerCase(),
        source_record_id: `${SOURCE_PREFIX}${String(row.id).toLowerCase()}`,
        created_on: row.created_on,
        updated_on: row.updated_on,
        origin: row.origin,
        type: row.type,
        status: row.status,
        is_bundle: row.is_bundle,
        seller_name: row.from_name,
        region: row.region,
        brand: row.brand,
        model: row.model,
        reference: row.reference,
        normalized_reference: row.normalized_reference,
        dial_color: row.dial_color,
        condition_id: row.condition_id,
        price: row.price,
        currency: row.currency,
        front_image: safeImageDescriptor(row.front_image),
        catalog_confirmed: row.catalog_confirmed,
        catalog_canonical_confirmed: row.catalog_canonical_confirmed,
        identification_status: row.identification_status,
        times_posted: row.times_posted,
        reposted_at: row.reposted_at,
        raw_message_source: text(row.description) ? 'description' : text(row.title) ? 'title' : text(row.comments) ? 'comments' : null,
        raw_message: rawEvidence(raw, false),
      };
    });
    await connection.rollback();
    transactionStarted = false;
    return {
      error: null,
      tls_encrypted: true,
      transaction_read_only: true,
      rows: evidenceRows,
      image_urls: imageUrls,
    };
  } finally {
    if (transactionStarted) await connection.rollback();
    await connection.end();
  }
}

function getSupabaseClient() {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) return null;
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function loadSupabaseEvidence() {
  const client = getSupabaseClient();
  if (!client) return { error: 'missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY' };
  const fourIds = WATCHES.slice(0, 4).map(watch => watch.id);
  const [privateRows, rawVersions, vacheronRows] = await Promise.all([
    client.rpc('qnsa_four_brand_private_enrichment_candidates', { p_listing_ids: fourIds }),
    client.from('raw_message_versions')
      .select('id,raw_message_id,source_record_id,source_hash,source_created_on,source_updated_on,observed_at,raw_message_source,raw_text,media,created_at')
      .in('source_record_id', WATCHES.map(watch => watch.source_record_id))
      .order('created_at', { ascending: false }),
    client.rpc('qnsa_vacheron_overseas_reference_rows', {
      p_reference: WATCHES[4].reference,
      p_limit: 101,
      p_offset: 0,
      p_listing_type: null,
    }),
  ]);

  const imageUrls = [];
  const compactPrivate = (privateRows.data || []).map(wrapper => {
    const row = wrapper?.row_data || wrapper;
    return {
      listing_id: row?.listing_id,
      canonical_brand: row?.canonical_brand,
      raw_message_version_id: row?.raw_message_version_id,
      source_record_id: row?.source_record_id,
      source_hash: row?.source_hash,
      source_candidate_hash: row?.source_candidate_hash,
      raw_message: rawEvidence(row?.raw_message, false),
      listing_type: row?.listing_type,
      model: row?.model,
      reference: row?.reference,
      dial_color: row?.dial_color,
      condition: row?.condition,
      price_usd: row?.price_usd,
      price_normalized: row?.price_normalized,
      currency: row?.currency,
      source_price_amount: row?.source_price_amount,
      source_currency: row?.source_currency,
      fx_rate: row?.fx_rate,
      fx_source: row?.fx_source,
      fx_date: row?.fx_date,
    };
  });
  const compactRaw = (rawVersions.data || []).map(row => ({
    id: row.id,
    raw_message_id: row.raw_message_id,
    source_record_id: row.source_record_id,
    source_hash: row.source_hash,
    observed_at: row.observed_at,
    raw_message_source: row.raw_message_source,
    raw_text: rawEvidence(row.raw_text, false),
    media_count: Array.isArray(row.media) ? row.media.length : null,
    media_sha256: sha256(JSON.stringify(row.media || [])),
    created_at: row.created_at,
  }));
  const compactVacheron = (vacheronRows.data || []).map(wrapper => {
    const row = wrapper?.row_data || wrapper;
    const imageUrl = exactSourceImageUrl(row?.user_image_url);
    if (imageUrl) imageUrls.push(imageUrl);
    return {
      id: row?.id,
      source_record_id: row?.source_record_id,
      posting_date: row?.posting_date,
      seller_name: row?.seller_name,
      listing_type: row?.listing_type,
      canonical_brand: row?.canonical_brand,
      model: row?.model,
      normalized_reference: row?.normalized_reference,
      raw_reference: row?.raw_reference,
      dial_color: row?.dial_color,
      condition: row?.condition,
      price_usd: row?.price_usd ?? row?.workbook_price_usd,
      source_price_amount: row?.source_price_amount,
      source_currency: row?.source_currency,
      price_evidence_status: row?.price_evidence_status,
      user_image_url: safeImageDescriptor(row?.user_image_url),
      has_exact_source_image: row?.has_exact_source_image,
      location: row?.location,
      publication_lane: row?.publication_lane,
      raw_message: rawEvidence(row?.raw_message, false),
    };
  });

  return {
    error: null,
    project: safeUrlMetadata(process.env.SUPABASE_URL),
    four_brand_private: { error: privateRows.error?.message || null, rows: compactPrivate },
    raw_message_versions: { error: rawVersions.error?.message || null, rows: compactRaw },
    vacheron_release_rpc: { error: vacheronRows.error?.message || null, rows: compactVacheron },
    image_urls: imageUrls,
  };
}

async function checkImage(url) {
  const exact = exactSourceImageUrl(url);
  if (!exact) return { source: safeImageDescriptor(url), ok: false, error: 'DISALLOWED_SOURCE_IMAGE_URL' };
  try {
    const response = await fetch(exact, {
      method: 'GET',
      headers: { range: `bytes=0-${MAX_IMAGE_SAMPLE_BYTES - 1}`, accept: 'image/*' },
      redirect: 'manual',
      signal: AbortSignal.timeout(20_000),
    });
    if (response.status >= 300 && response.status < 400) {
      return { source: safeImageDescriptor(exact), ok: false, status: response.status, error: 'REDIRECT_REJECTED' };
    }
    const chunks = [];
    let sampledBytes = 0;
    if (response.body) {
      const reader = response.body.getReader();
      try {
        while (sampledBytes < MAX_IMAGE_SAMPLE_BYTES) {
          const { done, value } = await reader.read();
          if (done) break;
          const remaining = MAX_IMAGE_SAMPLE_BYTES - sampledBytes;
          const chunk = Buffer.from(value).subarray(0, remaining);
          chunks.push(chunk);
          sampledBytes += chunk.length;
          if (value.length > remaining) break;
        }
      } finally {
        await reader.cancel().catch(() => {});
      }
    }
    const bytes = Buffer.concat(chunks);
    const contentType = response.headers.get('content-type');
    return {
      source: safeImageDescriptor(exact),
      status: response.status,
      ok: response.ok && /^image\//i.test(text(contentType)) && bytes.length > 0,
      content_type: contentType,
      content_length: response.headers.get('content-length'),
      sampled_bytes: sampledBytes,
      sample_sha256: sha256(bytes),
    };
  } catch (error) {
    return { source: safeImageDescriptor(exact), ok: false, error: error.message };
  }
}

function normalizeReference(value) {
  return text(value).toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function evidenceCompletenessIssues(publicRows, maria, supabase, imageChecks) {
  const issues = [];
  const mariaBySource = new Map((maria.rows || []).map(row => [row.source_record_id, row]));
  const privateById = new Map((supabase.four_brand_private?.rows || [])
    .map(row => [text(row.listing_id).toLowerCase(), row]));
  const rawSources = new Set((supabase.raw_message_versions?.rows || []).map(row => row.source_record_id));
  const vacheronIds = new Set((supabase.vacheron_release_rpc?.rows || [])
    .map(row => text(row.id).toLowerCase()));

  if (maria.error) issues.push(`MARIADB_ERROR:${maria.error}`);
  if (supabase.error) issues.push(`SUPABASE_ERROR:${supabase.error}`);
  if (supabase.four_brand_private?.error) issues.push(`PRIVATE_RPC_ERROR:${supabase.four_brand_private.error}`);
  if (supabase.raw_message_versions?.error) issues.push(`RAW_VERSION_ERROR:${supabase.raw_message_versions.error}`);
  if (supabase.vacheron_release_rpc?.error) issues.push(`VACHERON_RPC_ERROR:${supabase.vacheron_release_rpc.error}`);

  for (const entry of publicRows) {
    const { watch, trading } = entry;
    const publicRow = trading.row;
    if (!trading.found_exact_id || !publicRow) {
      issues.push(`${watch.brand}:PUBLIC_ID_NOT_FOUND`);
      continue;
    }
    if (text(publicRow.source_record_id).toLowerCase() !== watch.source_record_id) {
      issues.push(`${watch.brand}:PUBLIC_SOURCE_ID_MISMATCH`);
    }
    if (text(publicRow.brand).toLowerCase() !== watch.brand.toLowerCase()) {
      issues.push(`${watch.brand}:PUBLIC_BRAND_MISMATCH`);
    }
    if (normalizeReference(publicRow.reference) !== normalizeReference(watch.reference)) {
      issues.push(`${watch.brand}:PUBLIC_REFERENCE_MISMATCH`);
    }
    const source = mariaBySource.get(watch.source_record_id);
    if (!source) issues.push(`${watch.brand}:MARIADB_SOURCE_NOT_FOUND`);
    else {
      if (text(source.brand).toLowerCase() !== watch.brand.toLowerCase()) {
        issues.push(`${watch.brand}:MARIADB_BRAND_MISMATCH`);
      }
      if (!source.raw_message?.present) issues.push(`${watch.brand}:MARIADB_RAW_MISSING`);
      if (!source.front_image?.eligible) issues.push(`${watch.brand}:MARIADB_EXACT_IMAGE_MISSING`);
    }
    if (!rawSources.has(watch.source_record_id)) issues.push(`${watch.brand}:RAW_VERSION_NOT_FOUND`);
    if (watch.brand === 'Vacheron Constantin') {
      if (!vacheronIds.has(watch.id)) issues.push(`${watch.brand}:RELEASE_ROW_NOT_FOUND`);
    } else {
      const privateRow = privateById.get(watch.id);
      if (!privateRow) issues.push(`${watch.brand}:PRIVATE_ROW_NOT_FOUND`);
      else if (text(privateRow.source_record_id).toLowerCase() !== watch.source_record_id) {
        issues.push(`${watch.brand}:PRIVATE_SOURCE_ID_MISMATCH`);
      }
    }
  }
  const reachableImagePaths = new Set(imageChecks.filter(check => check?.ok)
    .map(check => check.source?.pathname));
  for (const row of maria.rows || []) {
    if (row.front_image?.eligible && !reachableImagePaths.has(row.front_image.pathname)) {
      issues.push(`${row.source_record_id}:SOURCE_IMAGE_UNREACHABLE`);
    }
  }
  return issues;
}

async function main() {
  const startedAt = new Date().toISOString();
  const publicRows = [];
  for (const watch of WATCHES) {
    publicRows.push({
      watch,
      trading: await getPublicRecord(watch),
      price_research_detail: await getPriceResearchDetail(watch),
    });
  }

  let maria;
  try {
    maria = await loadMariaDbRows();
  } catch (error) {
    maria = {
      error: error?.message || String(error),
      tls_encrypted: false,
      transaction_read_only: false,
      rows: [],
      image_urls: [],
    };
  }
  let supabase;
  try {
    supabase = await loadSupabaseEvidence();
  } catch (error) {
    supabase = { error: error?.message || String(error), image_urls: [] };
  }
  const imageUrls = new Set();
  for (const entry of publicRows) {
    const row = entry.trading.row;
    for (const descriptor of [row?.thumbnail_url, ...(row?.image_urls || [])]) {
      if (descriptor?.eligible) imageUrls.add(`https://${descriptor.hostname}${descriptor.pathname}`);
    }
  }
  for (const url of maria.image_urls || []) imageUrls.add(url);
  for (const url of supabase.image_urls || []) imageUrls.add(url);
  const imageChecks = [];
  for (const url of imageUrls) imageChecks.push(await checkImage(url));

  const completenessIssues = evidenceCompletenessIssues(publicRows, maria, supabase, imageChecks);
  const { image_urls: _mariaImageUrls, ...mariaReport } = maria;
  const { image_urls: _supabaseImageUrls, ...supabaseReport } = supabase;

  const databaseUrl = safeUrlMetadata(process.env.DATABASE_URL);
  const report = {
    contract: 'watchfacts-five-watch-production-readonly-v1',
    read_only: true,
    cohort_locked: true,
    started_at: startedAt,
    completed_at: new Date().toISOString(),
    origin: ORIGIN,
    environment: {
      database_url: databaseUrl,
      supabase_url: safeUrlMetadata(process.env.SUPABASE_URL),
      mysql_host_sha256: process.env.MYSQL_HOST ? sha256(process.env.MYSQL_HOST) : null,
    },
    watches: publicRows,
    evidence_complete: completenessIssues.length === 0,
    evidence_completeness_issues: completenessIssues,
    mariadb: mariaReport,
    supabase: supabaseReport,
    image_checks: imageChecks,
  };
  const outputIndex = process.argv.indexOf('--output');
  const outputPath = outputIndex >= 0 ? text(process.argv[outputIndex + 1]) : '';
  const serialized = `${JSON.stringify(report, null, 2)}\n`;
  if (outputPath) {
    const resolved = path.resolve(outputPath);
    fs.mkdirSync(path.dirname(resolved), { recursive: true });
    const temporary = `${resolved}.${process.pid}.tmp`;
    fs.writeFileSync(temporary, serialized, { encoding: 'utf8', mode: 0o600 });
    fs.renameSync(temporary, resolved);
    process.stdout.write(`Wrote read-only five-watch evidence: ${resolved}\n`);
  } else {
    process.stdout.write(serialized);
  }
  if (completenessIssues.length) {
    process.stderr.write(`Five-watch evidence incomplete: ${completenessIssues.join('; ')}\n`);
    process.exitCode = 2;
  }
}

main().catch(error => {
  process.stderr.write(`${error.stack || error.message || error}\n`);
  process.exitCode = 1;
});
