'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

const CONTRACT = 'wf-mariadb-auctions-raw-v1';
const SOURCE_TABLE = 'auctions';

const SOURCE_COLUMNS = [
  'id', 'open_unique_key', 'created_on', 'updated_on', 'origin', 'type', 'status',
  'is_bundle', 'category_id', 'company_id', 'from_number', 'from_name', 'phone_code',
  'region', 'title', 'description', 'comments', 'brand', 'model', 'reference',
  'normalized_reference', 'dial_color', 'dial_color_source', 'condition_id', 'year',
  'box', 'papers', 'price', 'currency', 'reserve_price', 'min', 'max', 'avg',
  'front_image', 'report_url', 'dealer_rating', 'is_from_verified_user',
  'is_from_paid_user', 'is_seller_approved', 'catalog_confirmed',
  'catalog_canonical_confirmed', 'are_attributes_extracted', 'identification_status',
  'wf_inspection', 'times_posted', 'reposted_at',
];

function clean(value) {
  if (value == null) return null;
  const text = String(value).trim();
  return text || null;
}

function rawText(value) {
  if (value == null) return null;
  return String(value);
}

function firstNonBlank(entries) {
  for (const [source, value] of entries) {
    if (value != null && String(value).trim()) return { source, value: String(value) };
  }
  return { source: null, value: null };
}

function boundedInteger(value, fallback, minimum, maximum, label) {
  if (value == null || value === '') return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`${label} must be an integer from ${minimum} to ${maximum}`);
  }
  return parsed;
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function atomicJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`);
  fs.renameSync(temporary, filePath);
}

function csv(value) {
  const text = value == null ? '' : String(value);
  return `"${text.replaceAll('"', '""')}"`;
}

function sourceRecord(row, observedAt = new Date().toISOString()) {
  const rawData = {
    id: String(row.id),
    open_unique_key: rawText(row.open_unique_key),
    created_on: rawText(row.created_on),
    updated_on: rawText(row.updated_on),
    origin: rawText(row.origin),
    type: rawText(row.type),
    status: rawText(row.status),
    is_bundle: Number(row.is_bundle) === 1,
    category_id: row.category_id == null ? null : Number(row.category_id),
    company_id: row.company_id == null ? null : Number(row.company_id),
    from_number: rawText(row.from_number),
    from_name: rawText(row.from_name),
    phone_code: rawText(row.phone_code),
    region: rawText(row.region),
    title: rawText(row.title),
    description: rawText(row.description),
    comments: rawText(row.comments),
    brand: rawText(row.brand),
    model: rawText(row.model),
    reference: rawText(row.reference),
    normalized_reference: rawText(row.normalized_reference),
    dial_color: rawText(row.dial_color),
    dial_color_source: rawText(row.dial_color_source),
    condition_id: row.condition_id == null ? null : Number(row.condition_id),
    year: rawText(row.year),
    box: rawText(row.box),
    papers: rawText(row.papers),
    price: rawText(row.price),
    currency: rawText(row.currency),
    reserve_price: rawText(row.reserve_price),
    min: rawText(row.min),
    max: rawText(row.max),
    avg: rawText(row.avg),
    front_image: rawText(row.front_image),
    report_url: rawText(row.report_url),
    dealer_rating: rawText(row.dealer_rating),
    is_from_verified_user: row.is_from_verified_user == null ? null : Number(row.is_from_verified_user) === 1,
    is_from_paid_user: row.is_from_paid_user == null ? null : Number(row.is_from_paid_user) === 1,
    is_seller_approved: row.is_seller_approved == null ? null : Number(row.is_seller_approved) === 1,
    catalog_confirmed: row.catalog_confirmed == null ? null : Number(row.catalog_confirmed) === 1,
    catalog_canonical_confirmed: row.catalog_canonical_confirmed == null ? null : Number(row.catalog_canonical_confirmed) === 1,
    are_attributes_extracted: row.are_attributes_extracted == null ? null : Number(row.are_attributes_extracted) === 1,
    identification_status: rawText(row.identification_status),
    wf_inspection: row.wf_inspection == null ? null : Number(row.wf_inspection) === 1,
    times_posted: row.times_posted == null ? null : Number(row.times_posted),
    reposted_at: rawText(row.reposted_at),
  };
  const rawMessage = firstNonBlank([
    ['description', rawData.description],
    ['title', rawData.title],
    ['comments', rawData.comments],
  ]);
  return {
    contract: CONTRACT,
    source_table: SOURCE_TABLE,
    source_id: rawData.id,
    source_record_id: `mysql_auctions_${rawData.id}`,
    source_created_on: rawData.created_on,
    observed_at: observedAt,
    raw_message: rawMessage.value,
    raw_message_source: rawMessage.source,
    raw_sha256: sha256(stableJson(rawData)),
    raw_data: rawData,
  };
}

function jsonLine(value) {
  return `${JSON.stringify(value)
    .replaceAll('\u2028', '\\u2028')
    .replaceAll('\u2029', '\\u2029')}\n`;
}

async function* readJsonLines(file) {
  const source = fs.createReadStream(file);
  const input = file.toLowerCase().endsWith('.gz') ? source.pipe(zlib.createGunzip()) : source;
  input.setEncoding('utf8');
  let buffer = '';
  for await (const chunk of input) {
    buffer += chunk;
    let boundary = buffer.indexOf('\n');
    while (boundary >= 0) {
      let line = buffer.slice(0, boundary);
      if (line.endsWith('\r')) line = line.slice(0, -1);
      yield line;
      buffer = buffer.slice(boundary + 1);
      boundary = buffer.indexOf('\n');
    }
  }
  if (buffer.length) yield buffer.endsWith('\r') ? buffer.slice(0, -1) : buffer;
}

function normalizationInput(record) {
  const raw = record.raw_data || {};
  const listingType = String(raw.type || '').toLowerCase() === 'search' ? 'WTB' : 'WTS';
  return {
    id: record.source_record_id,
    raw_message: record.raw_message || '',
    brand: raw.brand || null,
    reference: raw.reference || null,
    dial_color: raw.dial_color || null,
    // MariaDB's collapsed price has no trustworthy currency evidence. The
    // deterministic parser must recover both values from the raw message.
    price_raw: null,
    price_usd: null,
    currency: null,
    listing_type: listingType,
    parser_version: 'mariadb-live-source-v1',
  };
}

function assertReadOnlyGrants(grants) {
  const unsafe = (grants || []).filter(grant => {
    const normalized = String(grant || '').toUpperCase();
    return !/^GRANT USAGE ON /.test(normalized)
      && !/^GRANT (?:SELECT|SELECT, SHOW VIEW|SHOW VIEW, SELECT) ON /.test(normalized);
  });
  if (unsafe.length) throw new Error('MariaDB account has privileges beyond read-only SELECT/SHOW VIEW');
}

module.exports = {
  CONTRACT,
  SOURCE_COLUMNS,
  SOURCE_TABLE,
  assertReadOnlyGrants,
  atomicJson,
  boundedInteger,
  csv,
  jsonLine,
  normalizationInput,
  readJsonLines,
  sha256,
  sourceRecord,
  stableJson,
};
