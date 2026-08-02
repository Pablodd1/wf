'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const CONTRACT = 'wf-mariadb-auctions-raw-v1';
const SOURCE_TABLE = 'auctions';

function clean(value) {
  if (value == null) return null;
  const text = String(value).trim();
  return text || null;
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
    open_unique_key: clean(row.open_unique_key),
    created_on: clean(row.created_on),
    updated_on: clean(row.updated_on),
    origin: clean(row.origin),
    type: clean(row.type),
    status: clean(row.status),
    is_bundle: Number(row.is_bundle) === 1,
    category_id: row.category_id == null ? null : Number(row.category_id),
    company_id: row.company_id == null ? null : Number(row.company_id),
    from_number: clean(row.from_number),
    from_name: clean(row.from_name),
    region: clean(row.region),
    title: row.title == null ? null : String(row.title),
    description: row.description == null ? null : String(row.description),
    brand: clean(row.brand),
    model: clean(row.model),
    reference: clean(row.reference),
    normalized_reference: clean(row.normalized_reference),
    dial_color: clean(row.dial_color),
    condition_id: row.condition_id == null ? null : Number(row.condition_id),
    year: clean(row.year),
    box: clean(row.box),
    papers: clean(row.papers),
    price: row.price == null ? null : String(row.price),
    reserve_price: row.reserve_price == null ? null : String(row.reserve_price),
    front_image: clean(row.front_image),
  };
  const rawMessage = rawData.title ?? rawData.description;
  return {
    contract: CONTRACT,
    source_table: SOURCE_TABLE,
    source_id: rawData.id,
    source_record_id: `mysql_auctions_${rawData.id}`,
    source_created_on: rawData.created_on,
    observed_at: observedAt,
    raw_message: rawMessage,
    raw_sha256: sha256(stableJson(rawData)),
    raw_data: rawData,
  };
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
  SOURCE_TABLE,
  assertReadOnlyGrants,
  atomicJson,
  boundedInteger,
  csv,
  normalizationInput,
  sha256,
  sourceRecord,
  stableJson,
};
