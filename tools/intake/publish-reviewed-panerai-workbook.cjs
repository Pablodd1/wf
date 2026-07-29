'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const XLSX = require('xlsx');
const { createClient } = require('@supabase/supabase-js');

const VERSION = 'reviewed-panerai-workbook-v1';
const SOURCE = 'PANERAI_REVIEWED_XLSX_20260729';
const REQUIRED_HEADERS = [
  'Auction ID',
  'Posting Date',
  'Posted By',
  'raw_line',
  'Phone Number',
  'Intent / Type',
  'Brand',
  'Model',
  'Raw Reference',
  'Normalized Reference',
  'Catalog Reference',
  'Catalog Model',
  'Dial Color',
  'Catalog Dial',
  'Condition',
  'Price ($ USD)',
  'Verification Tier',
  'Confidence %',
  'Verification Status',
  'User Image URL',
  'Catalog Image URL',
  'Final Image URL',
];

function text(value) {
  return value === null || value === undefined ? '' : String(value).trim();
}

function nullable(value) {
  return text(value) || null;
}

function positiveNumber(value) {
  if (value === null || value === undefined || text(value) === '') return null;
  const parsed = Number(String(value).replace(/[$,]/g, ''));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function sourceId(value) {
  return text(value).replace(/[^a-zA-Z0-9_-]/g, '_');
}

function recordId(value) {
  return `reviewed_panerai_${sourceId(value)}`;
}

function datePart(value) {
  return text(value).match(/^(\d{4}-\d{2}-\d{2})/)?.[1] || null;
}

function parseConfidence(value) {
  const parsed = Number(text(value).replace('%', ''));
  return Number.isFinite(parsed) ? Math.round(parsed) : null;
}

function normalizeIntent(value) {
  const intent = text(value).toUpperCase();
  return ['WTS', 'WTB', 'NTQ'].includes(intent) ? intent : null;
}

function normalizeReference(value) {
  return text(value).toUpperCase().replace(/\s+/g, '');
}

function decodeHtml(value) {
  return String(value || '')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>');
}

function metadataImage(html, baseUrl) {
  const patterns = [
    /<meta[^>]+property=["']og:image(?::secure_url)?["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image(?::secure_url)?["']/i,
    /<meta[^>]+name=["']twitter:image(?::src)?["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]+name=["']twitter:image(?::src)?["']/i,
    /<link[^>]+rel=["']image_src["'][^>]+href=["']([^"']+)["']/i,
  ];
  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (!match?.[1]) continue;
    try {
      return new URL(decodeHtml(match[1]), baseUrl).toString();
    } catch {
      // Try the next metadata candidate.
    }
  }
  return null;
}

async function fetchWithTimeout(url, options = {}, timeoutMs = 15_000) {
  return fetch(url, {
    redirect: 'follow',
    signal: AbortSignal.timeout(timeoutMs),
    headers: {
      'User-Agent': 'Mozilla/5.0 (compatible; WatchFactsReviewedImport/1.0)',
      Accept: 'text/html,image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
      ...(options.headers || {}),
    },
    ...options,
  });
}

async function verifyDirectImage(url, referer) {
  try {
    const response = await fetchWithTimeout(url, {
      method: 'GET',
      headers: {
        Range: 'bytes=0-2047',
        ...(referer ? { Referer: referer } : {}),
      },
    });
    const contentType = text(response.headers.get('content-type')).split(';')[0].toLowerCase();
    try {
      await response.body?.cancel();
    } catch {
      // The response is already complete.
    }
    return {
      reachable: response.ok && contentType.startsWith('image/'),
      public_url: response.url || url,
      content_type: contentType || null,
      http_status: response.status,
    };
  } catch (error) {
    return {
      reachable: false,
      public_url: url,
      content_type: null,
      http_status: null,
      error: error.message,
    };
  }
}

async function resolveImagePage(url) {
  const sourcePage = text(url);
  if (!/^https?:\/\//i.test(sourcePage)) {
    return { source_page_url: sourcePage || null, reachable: false, error: 'INVALID_URL' };
  }
  try {
    const response = await fetchWithTimeout(sourcePage);
    const contentType = text(response.headers.get('content-type')).split(';')[0].toLowerCase();
    if (contentType.startsWith('image/')) {
      try {
        await response.body?.cancel();
      } catch {
        // The response is already complete.
      }
      return {
        source_page_url: sourcePage,
        reachable: response.ok,
        public_url: response.url || sourcePage,
        content_type: contentType,
        http_status: response.status,
        resolution_method: 'DIRECT_IMAGE',
      };
    }
    const html = await response.text();
    const candidate = metadataImage(html, response.url || sourcePage);
    if (!response.ok || !candidate) {
      return {
        source_page_url: sourcePage,
        reachable: false,
        content_type: contentType || null,
        http_status: response.status,
        error: !response.ok ? `SOURCE_PAGE_HTTP_${response.status}` : 'IMAGE_METADATA_NOT_FOUND',
      };
    }
    const verification = await verifyDirectImage(candidate, response.url || sourcePage);
    return {
      source_page_url: sourcePage,
      ...verification,
      resolution_method: 'PAGE_METADATA',
    };
  } catch (error) {
    return {
      source_page_url: sourcePage,
      reachable: false,
      error: error.message,
    };
  }
}

async function mapConcurrent(items, concurrency, mapper) {
  const results = new Array(items.length);
  let cursor = 0;
  const workers = Array.from(
    { length: Math.max(1, Math.min(concurrency, items.length || 1)) },
    async () => {
      while (cursor < items.length) {
        const index = cursor;
        cursor += 1;
        results[index] = await mapper(items[index], index);
      }
    },
  );
  await Promise.all(workers);
  return results;
}

function readWorkbook(inputPath) {
  const workbookBuffer = fs.readFileSync(inputPath);
  const workbookSha256 = sha256(workbookBuffer);
  const workbook = XLSX.read(workbookBuffer, { type: 'buffer', cellDates: true });
  if (workbook.SheetNames.length !== 1) {
    throw new Error(`Expected exactly one worksheet, found ${workbook.SheetNames.length}`);
  }
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const matrix = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null, raw: true });
  const headers = (matrix[0] || []).map(text);
  const missingHeaders = REQUIRED_HEADERS.filter(header => !headers.includes(header));
  const unexpectedHeaders = headers.filter(header => !REQUIRED_HEADERS.includes(header));
  if (missingHeaders.length || unexpectedHeaders.length) {
    throw new Error(JSON.stringify({ missingHeaders, unexpectedHeaders }));
  }
  const rows = XLSX.utils.sheet_to_json(sheet, { defval: null, raw: true })
    .filter(row => Object.values(row).some(value => text(value)));
  return {
    workbookSha256,
    sheetName: workbook.SheetNames[0],
    headers,
    rows,
  };
}

function validateAndNormalize(sourceRows, workbookSha256) {
  const errors = [];
  const ids = new Set();
  const rows = sourceRows.map((source, index) => {
    const rowNumber = index + 2;
    const auctionId = text(source['Auction ID']);
    const postingDate = text(source['Posting Date']);
    const rawMessage = text(source.raw_line);
    const brand = text(source.Brand);
    const listingType = normalizeIntent(source['Intent / Type']);
    const reference = normalizeReference(
      source['Catalog Reference'] || source['Normalized Reference'],
    );
    const model = text(source['Catalog Model'] || source.Model);
    const dialColor = text(source['Catalog Dial'] || source['Dial Color']);
    const priceUsd = positiveNumber(source['Price ($ USD)']);
    const confidence = parseConfidence(source['Confidence %']);
    const finalImagePage = text(source['Final Image URL']);
    const verificationStatus = text(source['Verification Status']);
    const rowErrors = [];

    if (!auctionId || ids.has(auctionId)) rowErrors.push('AUCTION_ID_MISSING_OR_DUPLICATE');
    ids.add(auctionId);
    if (!Date.parse(postingDate)) rowErrors.push('POSTING_DATE_INVALID');
    if (!rawMessage) rowErrors.push('RAW_LINE_MISSING');
    if (brand.toLowerCase() !== 'panerai') rowErrors.push('BRAND_NOT_PANERAI');
    if (!listingType) rowErrors.push('INTENT_INVALID');
    if (!reference) rowErrors.push('REFERENCE_MISSING');
    if (!model) rowErrors.push('MODEL_MISSING');
    if (!dialColor) rowErrors.push('DIAL_MISSING');
    if (!confidence || confidence < 1 || confidence > 100) rowErrors.push('CONFIDENCE_INVALID');
    if (!finalImagePage) rowErrors.push('FINAL_IMAGE_URL_MISSING');
    if (!/^Catalog (?:Confirmed|Partial)$/i.test(verificationStatus)) {
      rowErrors.push('VERIFICATION_STATUS_INVALID');
    }
    if (listingType === 'WTS' && priceUsd == null) rowErrors.push('WTS_PRICE_MISSING');

    if (rowErrors.length) {
      errors.push({ row_number: rowNumber, auction_id: auctionId || null, errors: rowErrors });
    }

    return {
      row_number: rowNumber,
      auction_id: auctionId,
      proposed_record_id: recordId(auctionId),
      posting_date: postingDate,
      listing_date: datePart(postingDate),
      raw_message: rawMessage,
      seller_name: nullable(source['Posted By']),
      seller_phone: nullable(source['Phone Number']),
      listing_type: listingType,
      brand,
      source_model: nullable(source.Model),
      raw_reference: nullable(source['Raw Reference']),
      normalized_reference: normalizeReference(source['Normalized Reference']),
      reference,
      model,
      source_dial: nullable(source['Dial Color']),
      dial_color: dialColor,
      condition: nullable(source.Condition),
      price_usd: priceUsd,
      currency: priceUsd == null ? null : 'USD',
      verification_tier: text(source['Verification Tier']),
      confidence,
      verification_status: verificationStatus,
      user_image_url: nullable(source['User Image URL']),
      catalog_image_url: nullable(source['Catalog Image URL']),
      final_image_page_url: finalImagePage,
      source_row_sha256: sha256(Buffer.from(JSON.stringify(source))),
      workbook_sha256: workbookSha256,
      blockers: rowErrors,
    };
  });
  return { rows, errors };
}

function exactDuplicateSignature(row) {
  return [
    row.posting_date,
    row.raw_message.toLowerCase().replace(/\s+/g, ' ').trim(),
    row.reference,
    row.price_usd ?? '',
  ].join('|');
}

function internalDuplicateGroups(rows) {
  const groups = new Map();
  for (const row of rows) {
    const key = exactDuplicateSignature(row);
    const members = groups.get(key) || [];
    members.push(row.auction_id);
    groups.set(key, members);
  }
  return [...groups.values()].filter(members => members.length > 1);
}

async function fetchExistingPanerai(client, workbookRows) {
  const columns = 'id,brand,model,reference,dial_color,condition,price_usd,currency,raw_message,created_at,listing_date,listing_type,source,source_type,seller_name,seller_phone,dealer_id,region,flags';
  const byId = new Map();
  const proposedIds = workbookRows.map(row => row.proposed_record_id);
  for (let index = 0; index < proposedIds.length; index += 100) {
    const result = await client
      .from('watch_records')
      .select(columns)
      .in('id', proposedIds.slice(index, index + 100));
    if (result.error) throw result.error;
    for (const row of result.data) byId.set(row.id, row);
  }

  const references = [...new Set(workbookRows.map(row => row.reference))];
  for (let index = 0; index < references.length; index += 20) {
    const referenceBatch = references.slice(index, index + 20);
    for (let from = 0; ; from += 1000) {
      const result = await client
        .from('watch_records')
        .select(columns)
        .ilike('brand', 'Panerai')
        .in('reference', referenceBatch)
        .order('id', { ascending: true })
        .range(from, from + 999);
      if (result.error) throw result.error;
      for (const row of result.data) byId.set(row.id, row);
      if (result.data.length < 1000) break;
    }
  }
  return [...byId.values()];
}

function chooseTargets(rows, existingRows) {
  const existingById = new Map(existingRows.map(row => [row.id, row]));
  const byRaw = new Map();
  for (const row of existingRows) {
    const key = text(row.raw_message);
    if (!key) continue;
    const members = byRaw.get(key) || [];
    members.push(row);
    byRaw.set(key, members);
  }

  return rows.map(row => {
    const proposed = existingById.get(row.proposed_record_id);
    if (proposed) {
      return { ...row, record_id: proposed.id, match_type: 'IDEMPOTENT_RECORD_ID', existing: proposed };
    }
    const exact = (byRaw.get(row.raw_message) || []).filter(candidate => (
      normalizeReference(candidate.reference) === row.reference
      && (datePart(candidate.listing_date) || datePart(candidate.created_at)) === row.listing_date
      && (positiveNumber(candidate.price_usd) ?? null) === row.price_usd
      && text(candidate.listing_type).toUpperCase() === row.listing_type
    ));
    if (exact.length === 1) {
      return {
        ...row,
        record_id: exact[0].id,
        match_type: 'UNIQUE_EXACT_EXISTING_LISTING',
        existing: exact[0],
      };
    }
    return {
      ...row,
      record_id: row.proposed_record_id,
      match_type: exact.length > 1 ? 'AMBIGUOUS_EXISTING_MATCH_NEW_ID' : 'NEW_RECORD_ID',
      existing: null,
      ambiguous_existing_ids: exact.map(candidate => candidate.id),
    };
  });
}

function watchRecord(row) {
  const existing = row.existing || {};
  const flags = new Set(Array.isArray(existing.flags) ? existing.flags : []);
  flags.add('HUMAN_REVIEWED_WORKBOOK');
  flags.add('USER_CONFIRMED_FOR_PUBLICATION_20260729');
  if (row.price_usd == null) flags.add('MISSING_PRICE');
  if (/Partial/i.test(row.verification_status)) flags.add('CATALOG_PARTIAL_HUMAN_APPROVED');

  return {
    id: row.record_id,
    brand: row.brand,
    model: row.model,
    reference: row.reference,
    dial_color: row.dial_color,
    condition: row.condition,
    year: null,
    price_raw: null,
    price_usd: row.price_usd,
    currency: row.currency,
    confidence: 100,
    verdict: 'APPROVED',
    source: existing.source || SOURCE,
    raw_message: row.raw_message,
    flags: [...flags],
    created_at: row.posting_date,
    processed_at: new Date().toISOString(),
    parser_version: VERSION,
    listing_type: row.listing_type,
    field_confidence: {
      exact_raw_lineage: true,
      human_reviewed: true,
      source_workbook_confidence: row.confidence,
      catalog_confirmed: /Catalog Confirmed/i.test(row.verification_status),
      source_workbook_sha256: row.workbook_sha256,
      source_row_number: row.row_number,
      source_auction_id: row.auction_id,
      normalized_price_currency: row.price_usd == null ? null : 'USD',
    },
    human_edited: true,
    edit_source: `${SOURCE}:${row.workbook_sha256}:${row.row_number}`,
    seller_name: row.seller_name || existing.seller_name || null,
    seller_phone: row.seller_phone || existing.seller_phone || null,
    dealer_id: existing.dealer_id || null,
    region: existing.region || null,
    source_type: existing.source_type || 'reviewed_workbook',
    listing_date: row.listing_date,
    listing_status: 'ACTIVE',
    catalog_confirmed: /Catalog Confirmed/i.test(row.verification_status),
    catalog_match: {
      brand: row.brand,
      model: row.model,
      reference: row.reference,
      dial_color: row.dial_color,
      status: row.verification_status,
      tier: row.verification_tier,
      evidence_source: 'reviewed_workbook',
    },
  };
}

function identityEvidence(row) {
  return {
    source: SOURCE,
    workbook_sha256: row.workbook_sha256,
    worksheet_row: row.row_number,
    auction_id: row.auction_id,
    verification_status: row.verification_status,
    verification_tier: row.verification_tier,
    user_instruction: 'revised and confirmed to push',
  };
}

async function applyInBatches(items, batchSize, applyBatch) {
  const results = [];
  for (let index = 0; index < items.length; index += batchSize) {
    results.push(await applyBatch(items.slice(index, index + batchSize)));
  }
  return results;
}

async function verifyPublished(client, rows) {
  const ids = rows.map(row => row.record_id);
  const chunks = [];
  for (let index = 0; index < ids.length; index += 100) chunks.push(ids.slice(index, index + 100));
  const output = { watch_records: [], identity_reviews: [], image_reviews: [], trading: [], price: [] };
  for (const chunk of chunks) {
    const [
      watches,
      identities,
      images,
      trading,
      price,
    ] = await Promise.all([
      client.from('watch_records').select('id,brand,model,reference,dial_color,price_usd,listing_type,has_images,thumbnail_url').in('id', chunk),
      client.from('listing_identity_reviews').select('record_id,status').in('record_id', chunk),
      client.from('listing_image_reviews').select('record_id,status,source_object_key').in('record_id', chunk),
      client.from('trading_floor_verified_listings').select('id,has_images,thumbnail_url').in('id', chunk),
      client.from('price_research_verified_source').select('id,price_usd,has_images,thumbnail_url').in('id', chunk),
    ]);
    for (const result of [watches, identities, images, trading, price]) {
      if (result.error) throw result.error;
    }
    output.watch_records.push(...watches.data);
    output.identity_reviews.push(...identities.data);
    output.image_reviews.push(...images.data);
    output.trading.push(...trading.data);
    output.price.push(...price.data);
  }
  return output;
}

async function run() {
  const inputPath = path.resolve(process.env.PANERAI_WORKBOOK_PATH || process.argv[2] || '');
  const outputDir = path.resolve(
    process.env.PANERAI_AUDIT_OUTPUT
      || path.join('audit-output', `panerai-reviewed-publication-${new Date().toISOString().slice(0, 10).replaceAll('-', '')}`),
  );
  const apply = String(process.env.APPLY_PANERAI_REVIEWED || '').toLowerCase() === 'true';
  const expectedSha256 = text(process.env.PANERAI_WORKBOOK_SHA256).toLowerCase();
  const expectedRows = Number(process.env.PANERAI_EXPECTED_ROWS || 99);
  if (!inputPath || !fs.existsSync(inputPath)) throw new Error('PANERAI_WORKBOOK_PATH must name the reviewed workbook');

  fs.mkdirSync(outputDir, { recursive: true });
  const source = readWorkbook(inputPath);
  const normalized = validateAndNormalize(source.rows, source.workbookSha256);
  if (source.rows.length !== expectedRows) {
    throw new Error(`Expected ${expectedRows} rows, found ${source.rows.length}`);
  }
  if (apply && (!expectedSha256 || expectedSha256 !== source.workbookSha256)) {
    throw new Error('PANERAI_WORKBOOK_SHA256 is required and must match before apply');
  }

  const pageUrls = [...new Set(normalized.rows.map(row => row.final_image_page_url))];
  const imageResolutionPath = path.join(outputDir, 'image-resolution.json');
  const browserImageMapPath = path.join(
    __dirname,
    'fixtures',
    'panerai-watchbase-image-map-20260729.json',
  );
  const browserImageMap = fs.existsSync(browserImageMapPath)
    ? JSON.parse(fs.readFileSync(browserImageMapPath, 'utf8'))
    : {};
  let cachedImages = [];
  if (fs.existsSync(imageResolutionPath)) {
    try {
      cachedImages = JSON.parse(fs.readFileSync(imageResolutionPath, 'utf8'));
    } catch {
      cachedImages = [];
    }
  }
  const cacheByPage = new Map(
    cachedImages
      .filter(row => row?.source_page_url && row?.reachable && row?.public_url)
      .map(row => [row.source_page_url, row]),
  );
  const browserMappedPages = pageUrls.filter(url => browserImageMap[url]);
  const verifiedBrowserImages = await mapConcurrent(browserMappedPages, 8, async url => ({
    source_page_url: url,
    ...(await verifyDirectImage(browserImageMap[url], url)),
    resolution_method: 'BROWSER_DOM_CONFIRMED',
  }));
  browserMappedPages.forEach((url, index) => {
    cacheByPage.set(url, verifiedBrowserImages[index]);
  });
  const missingPageUrls = pageUrls.filter(url => !cacheByPage.has(url));
  const newlyResolved = await mapConcurrent(missingPageUrls, 8, resolveImagePage);
  let resolvedList = pageUrls.map(url => (
    cacheByPage.get(url) || newlyResolved[missingPageUrls.indexOf(url)]
  ));
  const publicImageUrls = [...new Set(
    resolvedList.filter(row => row?.reachable && row?.public_url).map(row => row.public_url),
  )];
  const publicChecks = await mapConcurrent(
    publicImageUrls,
    12,
    async url => verifyDirectImage(url, null),
  );
  const publicCheckByUrl = new Map(
    publicImageUrls.map((url, index) => [url, publicChecks[index]]),
  );
  resolvedList = resolvedList.map(row => {
    if (!row?.reachable || !row?.public_url) return row;
    const publicCheck = publicCheckByUrl.get(row.public_url);
    if (!publicCheck?.reachable) {
      return {
        ...row,
        reachable: false,
        error: 'PUBLIC_HOTLINK_UNREACHABLE',
        public_http_status: publicCheck?.http_status ?? null,
      };
    }
    return {
      ...row,
      public_url: publicCheck.public_url,
      content_type: publicCheck.content_type,
      public_http_status: publicCheck.http_status,
    };
  });
  fs.writeFileSync(imageResolutionPath, `${JSON.stringify(resolvedList, null, 2)}\n`);
  const resolvedByPage = new Map(pageUrls.map((url, index) => [url, resolvedList[index]]));
  const rowsWithImages = normalized.rows.map(row => ({
    ...row,
    image: resolvedByPage.get(row.final_image_page_url),
  }));

  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required');
  const client = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const existingPanerai = await fetchExistingPanerai(client, normalized.rows);
  const targetedRows = chooseTargets(rowsWithImages, existingPanerai);
  const unresolvedImages = targetedRows.filter(row => !row.image?.reachable || !row.image?.public_url);
  const blockingErrors = normalized.errors.filter(error => (
    error.errors.some(reason => reason !== 'WTS_PRICE_MISSING')
  ));
  const duplicateGroups = internalDuplicateGroups(targetedRows);
  const matchCounts = {};
  for (const row of targetedRows) {
    matchCounts[row.match_type] = (matchCounts[row.match_type] || 0) + 1;
  }

  const reconciliation = {
    input_rows: source.rows.length,
    normalized_rows: normalized.rows.length,
    row_errors: normalized.errors.length,
    blocking_row_errors: blockingErrors.length,
    image_resolved: targetedRows.length - unresolvedImages.length,
    image_unresolved: unresolvedImages.length,
    target_rows: targetedRows.length,
    exact: source.rows.length === normalized.rows.length && targetedRows.length === source.rows.length,
  };

  const manifest = {
    generated_at: new Date().toISOString(),
    version: VERSION,
    mode: apply ? 'apply' : 'dry_run',
    source: {
      path: inputPath,
      sha256: source.workbookSha256,
      worksheet: source.sheetName,
      rows: source.rows.length,
      headers: source.headers,
    },
    scope: {
      brand: 'Panerai',
      source_file_only: true,
      expected_rows: expectedRows,
    },
    existing_paneraix_rows_scanned: existingPanerai.length,
    match_counts: matchCounts,
    exact_duplicate_groups_in_workbook: duplicateGroups,
    reconciliation,
    database_writes: 0,
  };

  fs.writeFileSync(
    path.join(outputDir, 'publication-rows.private.jsonl'),
    `${targetedRows.map(row => JSON.stringify(row)).join('\n')}\n`,
  );
  fs.writeFileSync(
    path.join(outputDir, 'errors.json'),
    `${JSON.stringify({
      row_errors: normalized.errors,
      blocking_row_errors: blockingErrors,
      unresolved_images: unresolvedImages.map(row => ({
        auction_id: row.auction_id,
        record_id: row.record_id,
        source_page_url: row.final_image_page_url,
        image: row.image,
      })),
    }, null, 2)}\n`,
  );
  fs.writeFileSync(
    path.join(outputDir, 'run-manifest.json'),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );

  if (blockingErrors.length || unresolvedImages.length || !reconciliation.exact) {
    process.stdout.write(`${JSON.stringify({
      status: 'blocked',
      output_dir: outputDir,
      manifest,
      blocking_errors: blockingErrors,
      unresolved_images: unresolvedImages.length,
    }, null, 2)}\n`);
    process.exitCode = 2;
    return;
  }

  let applyResults = null;
  if (apply) {
    const watchRows = targetedRows.map(watchRecord);
    await applyInBatches(watchRows, 100, async batch => {
      const result = await client.from('watch_records').upsert(batch, { onConflict: 'id' });
      if (result.error) throw result.error;
      return { rows: batch.length };
    });

    await mapConcurrent(targetedRows, 4, async row => {
      const result = await client.rpc('apply_listing_identity_review', {
        p_record_id: row.record_id,
        p_decision: 'HUMAN_APPROVED',
        p_operator_id: 'jaismel_reviewed_workbook_20260729',
        p_reason: 'Owner supplied revised workbook and explicitly confirmed publication.',
        p_canonical: {
          brand: row.brand,
          model: row.model,
          reference: row.reference,
          dial_color: row.dial_color,
        },
        p_evidence: identityEvidence(row),
      });
      if (result.error) throw result.error;
      return result.data;
    });

    const mediaPayload = targetedRows.map(row => ({
      record_id: row.record_id,
      source_id: row.auction_id,
      source_object_key: `reviewed-workbooks/${row.workbook_sha256}/${sourceId(row.auction_id)}.image`,
      source_bucket: 'external-reviewed-workbook',
      public_url: row.image.public_url,
      mime_type: row.image.content_type,
      verification_status: 'url_reachable',
    }));
    await applyInBatches(mediaPayload, 100, async payload => {
      const result = await client.rpc('attach_listing_media_batch', { payload });
      if (result.error) throw result.error;
      return result.data;
    });

    await mapConcurrent(targetedRows, 4, async row => {
      const sourceObjectKey = `reviewed-workbooks/${row.workbook_sha256}/${sourceId(row.auction_id)}.image`;
      const result = await client.rpc('apply_listing_image_review', {
        p_source_object_key: sourceObjectKey,
        p_record_id: row.record_id,
        p_decision: 'VISUALLY_VERIFIED',
        p_operator_id: 'jaismel_reviewed_workbook_20260729',
        p_reason: 'Owner supplied revised workbook with a confirmed final catalog image.',
        p_identity_snapshot: {
          brand: row.brand,
          model: row.model,
          reference: row.reference,
          dial_color: row.dial_color,
        },
        p_evidence: {
          visual_match: 'MATCH',
          source: SOURCE,
          workbook_sha256: row.workbook_sha256,
          worksheet_row: row.row_number,
          auction_id: row.auction_id,
          source_page_url: row.final_image_page_url,
          resolved_image_url: row.image.public_url,
          resolution_method: row.image.resolution_method,
          user_instruction: 'revised and confirmed to push',
        },
      });
      if (result.error) throw result.error;
      return result.data;
    });

    const readback = await verifyPublished(client, targetedRows);
    applyResults = {
      watch_records: readback.watch_records.length,
      human_approved_identity: readback.identity_reviews
        .filter(row => row.status === 'HUMAN_APPROVED').length,
      visually_verified_images: readback.image_reviews
        .filter(row => row.status === 'VISUALLY_VERIFIED').length,
      trading_floor_verified: readback.trading.length,
      price_research_verified_source: readback.price.length,
      trading_floor_with_images: readback.trading.filter(row => row.has_images).length,
      price_research_with_images: readback.price.filter(row => row.has_images).length,
    };
    manifest.database_writes = (
      applyResults.watch_records
      + applyResults.human_approved_identity
      + applyResults.visually_verified_images
    );
    manifest.apply_results = applyResults;
    fs.writeFileSync(
      path.join(outputDir, 'readback.json'),
      `${JSON.stringify({ apply_results: applyResults, readback }, null, 2)}\n`,
    );
    fs.writeFileSync(
      path.join(outputDir, 'run-manifest.json'),
      `${JSON.stringify(manifest, null, 2)}\n`,
    );
  }

  process.stdout.write(`${JSON.stringify({
    status: apply ? 'published' : 'ready',
    output_dir: outputDir,
    workbook_sha256: source.workbookSha256,
    rows: targetedRows.length,
    match_counts: matchCounts,
    exact_duplicate_groups: duplicateGroups.length,
    warnings: normalized.errors,
    apply_results: applyResults,
  }, null, 2)}\n`);
}

if (require.main === module) {
  run().catch(error => {
    process.stderr.write(`${JSON.stringify({ status: 'error', error: error.message })}\n`);
    process.exitCode = 1;
  });
}

module.exports = {
  chooseTargets,
  exactDuplicateSignature,
  metadataImage,
  normalizeReference,
  readWorkbook,
  recordId,
  resolveImagePage,
  validateAndNormalize,
  watchRecord,
};
