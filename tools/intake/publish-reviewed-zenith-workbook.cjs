'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const XLSX = require('xlsx');
const { createClient } = require('@supabase/supabase-js');
const { extractPriceObservations } = require('../../api/_lib/normalization-v4.cjs');

const VERSION = 'reviewed-zenith-workbook-v2';
const SOURCE = 'ZENITH_REVIEWED_XLSX_20260730';
const EXPECTED_SHA256 = '108f1383d5ef23e6ac938008b9cb702cd07525cc940015a35a573ac963eda8ae';
const EXPECTED_ROWS = 1403;
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
const DECISIONS_PATH = path.join(
  __dirname,
  'fixtures',
  'zenith-visual-decisions-20260730.json',
);

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

function recordId(rowNumber, auctionId) {
  return `reviewed_zenith_${String(rowNumber).padStart(6, '0')}_${sourceId(auctionId)}`;
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
  return text(value).toUpperCase().replace(/\s+/g, '') || null;
}

function readWorkbook(inputPath) {
  const buffer = fs.readFileSync(inputPath);
  const workbookSha256 = sha256(buffer);
  const workbook = XLSX.read(buffer, { type: 'buffer', cellDates: true });
  if (workbook.SheetNames.length !== 1 || workbook.SheetNames[0] !== 'Zenith') {
    throw new Error(`Expected the single worksheet Zenith, found ${workbook.SheetNames.join(', ')}`);
  }
  const sheet = workbook.Sheets.Zenith;
  const matrix = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null, raw: true });
  const headers = (matrix[0] || []).map(text);
  if (JSON.stringify(headers) !== JSON.stringify(REQUIRED_HEADERS)) {
    throw new Error('Zenith workbook headers do not match the reviewed publication contract');
  }
  const rows = XLSX.utils.sheet_to_json(sheet, { defval: null, raw: true })
    .filter(row => Object.values(row).some(value => text(value)));
  return { workbookSha256, headers, rows };
}

function exactDuplicateSignature(row) {
  return [
    row.posting_date,
    row.raw_message.toLowerCase().replace(/\s+/g, ' ').trim(),
    row.reference || '',
    row.workbook_price_usd ?? '',
  ].join('|');
}

function duplicateMembership(rows) {
  const groups = new Map();
  for (const row of rows) {
    const signature = exactDuplicateSignature(row);
    const members = groups.get(signature) || [];
    members.push(row.record_id);
    groups.set(signature, members);
  }
  const duplicatesById = new Map();
  const duplicateGroups = [];
  for (const [signature, members] of groups) {
    if (members.length < 2) continue;
    const groupId = sha256(Buffer.from(signature)).slice(0, 16);
    duplicateGroups.push({ group_id: groupId, member_count: members.length, record_ids: members });
    for (const id of members) duplicatesById.set(id, { groupId, members });
  }
  return { duplicatesById, duplicateGroups };
}

function normalizeRows(sourceRows, workbookSha256, decisions) {
  const errors = [];
  const auctionIds = new Set();
  const normalized = sourceRows.map((source, index) => {
    const rowNumber = index + 2;
    const auctionId = text(source['Auction ID']);
    const rawMessage = text(source.raw_line);
    const identityOverride = decisions.identity_overrides_by_worksheet_row[String(rowNumber)] || null;
    const sourceDial = nullable(source['Catalog Dial'] || source['Dial Color']);
    const imageUrl = nullable(source['Final Image URL']);
    const visualDial = Object.prototype.hasOwnProperty.call(
      decisions.dial_by_worksheet_row,
      String(rowNumber),
    )
      ? decisions.dial_by_worksheet_row[String(rowNumber)]
      : undefined;
    const blockedReasons = decisions.blocked_by_worksheet_row[String(rowNumber)] || [];
    const imageWithheldReasons = decisions.image_withheld_by_worksheet_row[String(rowNumber)] || [];
    const rowErrors = [];

    if (!auctionId || auctionIds.has(auctionId)) rowErrors.push('AUCTION_ID_MISSING_OR_DUPLICATE');
    auctionIds.add(auctionId);
    if (!Date.parse(text(source['Posting Date']))) rowErrors.push('POSTING_DATE_INVALID');
    if (!rawMessage) rowErrors.push('RAW_LINE_MISSING');
    if (text(source.Brand).toLowerCase() !== 'zenith') rowErrors.push('BRAND_NOT_ZENITH');
    if (!normalizeIntent(source['Intent / Type'])) rowErrors.push('INTENT_INVALID');
    if (imageUrl && !sourceDial && visualDial === undefined) {
      rowErrors.push('MISSING_VISUAL_DECISION');
    }

    if (rowErrors.length) errors.push({ row_number: rowNumber, auction_id: auctionId, errors: rowErrors });
    return {
      row_number: rowNumber,
      auction_id: auctionId,
      record_id: recordId(rowNumber, auctionId),
      posting_date: text(source['Posting Date']),
      listing_date: datePart(source['Posting Date']),
      raw_message: rawMessage,
      seller_name: nullable(source['Posted By']),
      seller_phone: nullable(source['Phone Number']),
      listing_type: normalizeIntent(source['Intent / Type']),
      brand: nullable(identityOverride?.brand) || 'Zenith',
      model: nullable(identityOverride?.model) || nullable(source['Catalog Model'] || source.Model),
      source_model: nullable(source.Model),
      raw_reference: nullable(source['Raw Reference']),
      reference: normalizeReference(
        identityOverride?.reference || source['Catalog Reference'] || source['Normalized Reference'],
      ),
      normalized_reference: normalizeReference(source['Normalized Reference']),
      source_dial: nullable(source['Dial Color']),
      workbook_dial: sourceDial,
      dial_color: nullable(identityOverride?.dial_color) || sourceDial || visualDial || null,
      visual_dial_color: visualDial === undefined ? null : visualDial,
      condition: nullable(source.Condition),
      workbook_price_usd: positiveNumber(source['Price ($ USD)']),
      verification_tier: nullable(source['Verification Tier']),
      source_confidence: parseConfidence(source['Confidence %']),
      verification_status: nullable(identityOverride?.verification_status)
        || nullable(source['Verification Status']),
      catalog_confirmed: identityOverride
        ? identityOverride.catalog_confirmed === true
        : /^Catalog Confirmed$/i.test(text(source['Verification Status'])),
      identity_correction_basis: nullable(identityOverride?.basis),
      user_image_url: nullable(source['User Image URL']),
      catalog_image_url: nullable(source['Catalog Image URL']),
      final_image_url: imageUrl,
      blocked_reasons: blockedReasons,
      image_withheld_reasons: imageWithheldReasons,
      publishable: blockedReasons.length === 0,
      image_publishable: Boolean(imageUrl && blockedReasons.length === 0 && imageWithheldReasons.length === 0),
      source_row_sha256: sha256(Buffer.from(JSON.stringify(source))),
      workbook_sha256: workbookSha256,
      errors: rowErrors,
    };
  });
  return { rows: normalized, errors };
}

async function verifyImage(url) {
  if (!/^https:\/\/thecollective-prod\.nyc3\.digitaloceanspaces\.com\//i.test(url || '')) {
    return { url, reachable: false, error: 'UNAPPROVED_IMAGE_HOST' };
  }
  try {
    const response = await fetch(url, {
      method: 'GET',
      redirect: 'follow',
      signal: AbortSignal.timeout(15_000),
      headers: {
        Range: 'bytes=0-2047',
        'User-Agent': 'WatchFactsZenithReviewedImport/1.0',
      },
    });
    const contentType = text(response.headers.get('content-type')).split(';')[0].toLowerCase();
    try {
      await response.body?.cancel();
    } catch {
      // The requested prefix is already complete.
    }
    return {
      url,
      public_url: response.url || url,
      reachable: response.ok && contentType.startsWith('image/'),
      content_type: contentType || null,
      http_status: response.status,
    };
  } catch (error) {
    return { url, reachable: false, error: error.message };
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

async function applyInBatches(items, batchSize, mapper) {
  const results = [];
  for (let index = 0; index < items.length; index += batchSize) {
    results.push(await mapper(items.slice(index, index + batchSize)));
  }
  return results;
}

function primaryPriceObservation(rawMessage) {
  return extractPriceObservations(rawMessage, {}).find(observation => observation.is_primary) || null;
}

function hasCompleteIdentity(row) {
  return Boolean(row.brand && row.model && row.reference && row.dial_color);
}

function watchRecord(row, duplicate) {
  const sourcePrice = primaryPriceObservation(row.raw_message);
  const flags = new Set([
    'HUMAN_REVIEWED_WORKBOOK',
    'USER_CONFIRMED_FOR_PUBLICATION_20260730',
  ]);
  if (row.seller_phone) flags.add('OWNER_APPROVED_CONTACT_PUBLIC');
  if (row.visual_dial_color) flags.add('DIAL_VISUALLY_CONFIRMED_20260730');
  if (row.identity_correction_basis) flags.add('IDENTITY_CORRECTED_FROM_SOURCE_EVIDENCE_20260730');
  if (!row.reference) flags.add('MISSING_REFERENCE');
  if (!row.model) flags.add('MISSING_MODEL');
  if (!row.dial_color) flags.add('MISSING_DIAL');
  if (row.publishable && !hasCompleteIdentity(row)) flags.add('CONTROLLED_FLOOR_IDENTITY_INCOMPLETE');
  if (row.workbook_price_usd == null) flags.add('MISSING_PRICE');
  if (row.workbook_price_usd != null && sourcePrice?.currency_evidence !== 'EXPLICIT') {
    flags.add('WORKBOOK_USD_PRICE_ANALYTICS_INELIGIBLE');
  }
  if (duplicate) flags.add('POTENTIAL_EXACT_DUPLICATE');
  for (const reason of row.blocked_reasons) flags.add(reason);
  for (const reason of row.image_withheld_reasons) flags.add(reason);

  return {
    id: row.record_id,
    brand: row.brand,
    model: row.model,
    reference: row.reference,
    dial_color: row.dial_color,
    condition: row.condition,
    year: null,
    price_raw: sourcePrice?.amount_original || null,
    price_usd: row.workbook_price_usd,
    currency: sourcePrice?.currency_evidence === 'EXPLICIT'
      ? sourcePrice.currency_original
      : null,
    confidence: row.publishable ? 100 : Math.max(0, Math.min(100, row.source_confidence || 0)),
    verdict: row.publishable ? 'APPROVED' : 'HUMAN',
    source: SOURCE,
    raw_message: row.raw_message,
    flags: [...flags],
    created_at: row.posting_date,
    processed_at: new Date().toISOString(),
    parser_version: VERSION,
    listing_type: row.listing_type,
    field_confidence: {
      exact_workbook_lineage: true,
      owner_reviewed: true,
      source_workbook_confidence: row.source_confidence,
      source_workbook_sha256: row.workbook_sha256,
      source_row_sha256: row.source_row_sha256,
      source_row_number: row.row_number,
      source_auction_id: row.auction_id,
      catalog_confirmed: row.catalog_confirmed,
      visual_dial_confirmed: Boolean(row.visual_dial_color),
      identity_corrected_from_source_evidence: Boolean(row.identity_correction_basis),
      identity_correction_basis: row.identity_correction_basis,
      visual_review_status: row.publishable ? 'MATCH_OR_OWNER_CONFIRMED' : 'REJECTED',
      workbook_price_usd: row.workbook_price_usd,
      price_research_currency_status: sourcePrice?.currency_evidence === 'EXPLICIT'
        ? 'SOURCE_EXPLICIT'
        : 'ANALYTICS_INELIGIBLE_WITHOUT_SOURCE_CURRENCY_OR_FX',
      source_price_text: sourcePrice?.raw_price_text || null,
      source_price_currency_evidence: sourcePrice?.currency_evidence || null,
      duplicate_review_status: duplicate ? 'PENDING' : null,
    },
    human_edited: true,
    edit_source: `${SOURCE}:${row.workbook_sha256}:${row.row_number}`,
    seller_name: row.seller_name,
    seller_phone: row.seller_phone,
    dealer_id: null,
    region: null,
    source_type: 'reviewed_workbook',
    listing_date: row.listing_date,
    listing_status: row.publishable ? 'ACTIVE' : 'REJECTED',
    catalog_confirmed: row.catalog_confirmed,
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
    source_row_sha256: row.source_row_sha256,
    worksheet_row: row.row_number,
    auction_id: row.auction_id,
    verification_status: row.verification_status,
    verification_tier: row.verification_tier,
    visual_dial_color: row.visual_dial_color,
    identity_correction_basis: row.identity_correction_basis,
    visual_blockers: row.blocked_reasons,
    user_instruction: 'Owner supplied the Zenith workbook for publication; source-evidence conflicts are corrected or separated.',
  };
}

async function readback(client, rows) {
  const ids = rows.map(row => row.record_id);
  const output = { watches: [], identities: [], images: [], trading: [], price: [] };
  for (let index = 0; index < ids.length; index += 100) {
    const chunk = ids.slice(index, index + 100);
    const results = await Promise.all([
      client.from('watch_records').select('id,brand,model,reference,dial_color,price_usd,listing_type,listing_status,has_images,thumbnail_url,seller_name,seller_phone').in('id', chunk),
      client.from('listing_identity_reviews').select('record_id,status').in('record_id', chunk),
      client.from('listing_image_reviews').select('record_id,status,source_object_key').in('record_id', chunk),
      client.from('trading_floor_verified_listings').select('id,has_images,thumbnail_url').in('id', chunk),
      client.from('price_research_verified_source').select('id,price_usd,has_images,thumbnail_url').in('id', chunk),
    ]);
    const failure = results.find(result => result.error)?.error;
    if (failure) throw failure;
    const [watches, identities, images, trading, price] = results;
    output.watches.push(...watches.data);
    output.identities.push(...identities.data);
    output.images.push(...images.data);
    output.trading.push(...trading.data);
    output.price.push(...price.data);
  }
  return output;
}

async function run() {
  const inputPath = path.resolve(process.env.ZENITH_WORKBOOK_PATH || process.argv[2] || '');
  const outputDir = path.resolve(
    process.env.ZENITH_AUDIT_OUTPUT
      || path.join('audit-output', 'zenith-reviewed-publication-20260730'),
  );
  const apply = String(process.env.APPLY_ZENITH_REVIEWED || '').toLowerCase() === 'true';
  if (!inputPath || !fs.existsSync(inputPath)) {
    throw new Error('ZENITH_WORKBOOK_PATH must name the reviewed Zenith workbook');
  }
  fs.mkdirSync(outputDir, { recursive: true });

  const decisions = JSON.parse(fs.readFileSync(DECISIONS_PATH, 'utf8'));
  const source = readWorkbook(inputPath);
  if (source.workbookSha256 !== EXPECTED_SHA256 || decisions.workbook_sha256 !== EXPECTED_SHA256) {
    throw new Error('Zenith workbook SHA-256 does not match the reviewed release');
  }
  if (source.rows.length !== EXPECTED_ROWS) {
    throw new Error(`Expected ${EXPECTED_ROWS} rows, found ${source.rows.length}`);
  }

  const normalized = normalizeRows(source.rows, source.workbookSha256, decisions);
  const missingDialImages = normalized.rows.filter(row => row.final_image_url && !row.workbook_dial);
  if (missingDialImages.length !== decisions.reviewed_image_count) {
    throw new Error(`Expected ${decisions.reviewed_image_count} missing-dial image decisions, found ${missingDialImages.length}`);
  }
  const unresolvedVisualRows = missingDialImages.filter(row => (
    !Object.prototype.hasOwnProperty.call(decisions.dial_by_worksheet_row, String(row.row_number))
  ));
  if (unresolvedVisualRows.length) {
    throw new Error(`Missing visual decisions for worksheet rows ${unresolvedVisualRows.map(row => row.row_number).join(', ')}`);
  }

  const uniqueImageUrls = [...new Set(normalized.rows.map(row => row.final_image_url).filter(Boolean))];
  const imageChecks = await mapConcurrent(uniqueImageUrls, 16, verifyImage);
  const imageByUrl = new Map(imageChecks.map(check => [check.url, check]));
  const rows = normalized.rows.map(row => ({ ...row, image: imageByUrl.get(row.final_image_url) || null }));
  const unreachableImages = rows.filter(row => row.final_image_url && !row.image?.reachable);
  const duplicates = duplicateMembership(rows);

  const publishableRows = rows.filter(row => row.publishable);
  const blockedRows = rows.filter(row => !row.publishable);
  const completeIdentityRows = publishableRows.filter(hasCompleteIdentity);
  const incompleteIdentityRows = publishableRows.filter(row => !hasCompleteIdentity(row));
  const publicImageRows = publishableRows.filter(row => (
    row.image_publishable && hasCompleteIdentity(row)
  ));
  const rejectedImageRows = rows.filter(row => (
    row.final_image_url
      && (!row.publishable || !row.image_publishable || !hasCompleteIdentity(row))
  ));
  const missingDialWithoutImage = publishableRows.filter(row => !row.dial_color && !row.final_image_url);
  const missingReference = publishableRows.filter(row => !row.reference);
  const priceResearchCandidateRows = publishableRows.filter(row => (
    row.reference && row.listing_type === 'WTS' && row.workbook_price_usd != null
  ));

  const reconciliation = {
    input_rows: source.rows.length,
    publishable_rows: publishableRows.length,
    blocked_rows: blockedRows.length,
    reconciled: source.rows.length === publishableRows.length + blockedRows.length,
    image_rows: rows.filter(row => row.final_image_url).length,
    public_image_rows: publicImageRows.length,
    rejected_or_withheld_image_rows: rejectedImageRows.length,
    no_image_rows: rows.filter(row => !row.final_image_url).length,
    image_rows_reconciled: rows.filter(row => row.final_image_url).length
      === publicImageRows.length + rejectedImageRows.length,
  };
  const manifest = {
    generated_at: new Date().toISOString(),
    mode: apply ? 'apply' : 'dry_run',
    version: VERSION,
    source: {
      path: inputPath,
      sha256: source.workbookSha256,
      worksheet: 'Zenith',
      rows: source.rows.length,
      headers: source.headers,
    },
    scope: {
      source_file_only: true,
      brand: 'Zenith',
      source: SOURCE,
    },
    counts: {
      publishable: publishableRows.length,
      blocked: blockedRows.length,
      seller_name: rows.filter(row => row.seller_name).length,
      seller_phone: rows.filter(row => row.seller_phone).length,
      images: rows.filter(row => row.final_image_url).length,
      reachable_images: imageChecks.filter(check => check.reachable).length,
      visual_dials_added: rows.filter(row => row.visual_dial_color).length,
      identity_overrides: rows.filter(row => row.identity_correction_basis).length,
      canonical_zenith: publishableRows.filter(row => row.brand === 'Zenith').length,
      canonical_other_brands: publishableRows.filter(row => row.brand !== 'Zenith').length,
      complete_identity: completeIdentityRows.length,
      incomplete_identity_controlled_floor_only: incompleteIdentityRows.length,
      missing_dial_without_image: missingDialWithoutImage.length,
      missing_reference: missingReference.length,
      price_research_candidates_before_currency_and_catalog_gates: priceResearchCandidateRows.length,
      exact_duplicate_groups: duplicates.duplicateGroups.length,
      exact_duplicate_rows: [...duplicates.duplicatesById.keys()].length,
    },
    reconciliation,
    database_writes: 0,
  };

  fs.writeFileSync(
    path.join(outputDir, 'run-manifest.json'),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );
  fs.writeFileSync(
    path.join(outputDir, 'reconciliation.json'),
    `${JSON.stringify(reconciliation, null, 2)}\n`,
  );
  fs.writeFileSync(
    path.join(outputDir, 'errors.json'),
    `${JSON.stringify({
      structural_errors: normalized.errors,
      unreachable_images: unreachableImages.map(row => ({
        worksheet_row: row.row_number,
        auction_id: row.auction_id,
        image: row.image,
      })),
      blocked_rows: blockedRows.map(row => ({
        worksheet_row: row.row_number,
        auction_id: row.auction_id,
        record_id: row.record_id,
        reasons: row.blocked_reasons,
      })),
      withheld_images: rows
        .filter(row => row.image_withheld_reasons.length)
        .map(row => ({
          worksheet_row: row.row_number,
          auction_id: row.auction_id,
          record_id: row.record_id,
          reasons: row.image_withheld_reasons,
        })),
    }, null, 2)}\n`,
  );
  fs.writeFileSync(
    path.join(outputDir, 'duplicate-groups.json'),
    `${JSON.stringify(duplicates.duplicateGroups, null, 2)}\n`,
  );

  if (normalized.errors.length || unreachableImages.length || !reconciliation.reconciled || !reconciliation.image_rows_reconciled) {
    process.stdout.write(`${JSON.stringify({ status: 'blocked', manifest }, null, 2)}\n`);
    process.exitCode = 2;
    return;
  }

  if (!apply) {
    process.stdout.write(`${JSON.stringify({ status: 'dry_run_ready', manifest }, null, 2)}\n`);
    return;
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) {
    throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required for apply');
  }
  const client = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const watchRows = rows.map(row => watchRecord(row, duplicates.duplicatesById.get(row.record_id)));
  await applyInBatches(watchRows, 100, async batch => {
    const result = await client.from('watch_records').upsert(batch, { onConflict: 'id' });
    if (result.error) throw result.error;
    return batch.length;
  });

  const identityDecisionRows = rows.filter(row => !row.publishable || hasCompleteIdentity(row));
  await mapConcurrent(identityDecisionRows, 6, async row => {
    const result = await client.rpc('apply_listing_identity_review', {
      p_record_id: row.record_id,
      p_decision: row.publishable ? 'HUMAN_APPROVED' : 'CONFLICT',
      p_operator_id: 'jaismel_reviewed_zenith_workbook_20260730',
      p_reason: row.publishable
        ? 'Owner supplied normalized Zenith workbook and explicitly confirmed publication.'
        : `Visual review separated this row: ${row.blocked_reasons.join(', ')}.`,
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

  const incompleteIdentityApplyRows = rows.filter(row => row.publishable && !hasCompleteIdentity(row));
  await applyInBatches(incompleteIdentityApplyRows, 1000, async batch => {
    const result = await client.rpc('stage_listing_identity_classifications', {
      p_rows: batch.map(row => ({
        record_id: row.record_id,
        status: 'UNVERIFIED',
        canonical_brand: row.brand,
        canonical_model: row.model,
        canonical_reference: row.reference,
        canonical_dial_color: row.dial_color,
        evidence: identityEvidence(row),
      })),
    });
    if (result.error) throw result.error;
    return result.data;
  });

  const mediaRows = rows.filter(row => row.final_image_url);
  const mediaPayload = mediaRows.map(row => ({
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

  await mapConcurrent(mediaRows, 6, async row => {
    const sourceObjectKey = `reviewed-workbooks/${row.workbook_sha256}/${sourceId(row.auction_id)}.image`;
    const imagePublishable = row.image_publishable && hasCompleteIdentity(row);
    const decision = imagePublishable ? 'VISUALLY_VERIFIED' : 'REJECTED';
    const result = await client.rpc('apply_listing_image_review', {
      p_source_object_key: sourceObjectKey,
      p_record_id: row.record_id,
      p_decision: decision,
      p_operator_id: 'jaismel_reviewed_zenith_workbook_20260730',
      p_reason: imagePublishable
        ? (row.visual_dial_color
            ? 'Source image visually reviewed against the listing; missing dial color recorded.'
            : (row.identity_correction_basis
                ? 'Source image visually reviewed against the corrected listing identity.'
                : 'Owner supplied this exact final image with the reviewed workbook.'))
        : `Image withheld after visual review: ${[
            ...row.blocked_reasons,
            ...row.image_withheld_reasons,
            ...(!hasCompleteIdentity(row) ? ['IDENTITY_INCOMPLETE'] : []),
          ].join(', ')}.`,
      p_identity_snapshot: {
        brand: row.brand,
        model: row.model,
        reference: row.reference,
        dial_color: row.dial_color,
      },
      p_evidence: {
        visual_match: imagePublishable ? 'MATCH' : 'NO_MATCH',
        review_basis: imagePublishable
          ? (row.visual_dial_color || row.identity_correction_basis
              ? 'AGENT_VISUAL_MATCH'
              : 'OWNER_CONFIRMED_WORKBOOK')
          : 'REJECTED_MISMATCH_NON_LISTING_MEDIA_OR_INCOMPLETE_IDENTITY',
        source: SOURCE,
        workbook_sha256: row.workbook_sha256,
        source_row_sha256: row.source_row_sha256,
        worksheet_row: row.row_number,
        auction_id: row.auction_id,
        source_image_url: row.final_image_url,
        resolved_image_url: row.image.public_url,
        visual_dial_color: row.visual_dial_color,
        blockers: [
          ...row.blocked_reasons,
          ...row.image_withheld_reasons,
          ...(!hasCompleteIdentity(row) ? ['IDENTITY_INCOMPLETE'] : []),
        ],
      },
    });
    if (result.error) throw result.error;
    return result.data;
  });

  const verified = await readback(client, rows);
  const publishableIds = new Set(publishableRows.map(row => row.record_id));
  const publicImageIds = new Set(publicImageRows.map(row => row.record_id));
  const applyResults = {
    watch_records: verified.watches.length,
    human_approved_identity: verified.identities
      .filter(row => row.status === 'HUMAN_APPROVED').length,
    unverified_identity_controlled_floor_only: verified.identities
      .filter(row => row.status === 'UNVERIFIED').length,
    identity_conflicts_separated: verified.identities
      .filter(row => row.status === 'CONFLICT').length,
    visually_verified_images: verified.images
      .filter(row => row.status === 'VISUALLY_VERIFIED').length,
    rejected_images: verified.images
      .filter(row => row.status === 'REJECTED').length,
    verified_source_rows: verified.price.filter(row => publishableIds.has(row.id)).length,
    strict_trading_rows: verified.trading.filter(row => publishableIds.has(row.id)).length,
    strict_trading_rows_with_images: verified.trading
      .filter(row => publishableIds.has(row.id) && publicImageIds.has(row.id) && row.has_images).length,
  };
  manifest.database_writes = (
    applyResults.watch_records
    + applyResults.human_approved_identity
    + applyResults.unverified_identity_controlled_floor_only
    + applyResults.identity_conflicts_separated
    + applyResults.visually_verified_images
    + applyResults.rejected_images
  );
  manifest.apply_results = applyResults;
  fs.writeFileSync(
    path.join(outputDir, 'run-manifest.json'),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );
  fs.writeFileSync(
    path.join(outputDir, 'apply-readback.json'),
    `${JSON.stringify(applyResults, null, 2)}\n`,
  );
  process.stdout.write(`${JSON.stringify({ status: 'applied', manifest }, null, 2)}\n`);
}

run().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
