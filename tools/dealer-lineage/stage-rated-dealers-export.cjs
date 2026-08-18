'use strict';

const fs = require('node:fs');
const path = require('node:path');
const readline = require('node:readline');
const csv = require('csv-parser');

const SOURCE_SYSTEM = 'WATCHFACTS_RATED_DEALERS_AUTHENTICATED';
const APPLY_CONFIRMATION = 'I_HAVE_REVIEWED_EXPORT';

function required(name) {
  const value = String(process.env[name] || '').trim().replace(/\/$/, '');
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function first(row, names) {
  for (const name of names) {
    const value = row[name];
    if (value !== undefined && String(value).trim() !== '') return String(value).trim();
  }
  return null;
}

function integer(value) {
  if (value == null) return null;
  const parsed = Number.parseInt(String(value).replace(/,/g, ''), 10);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : null;
}

function rating(value) {
  if (value == null) return null;
  const parsed = Number.parseFloat(String(value).replace(',', '.'));
  return Number.isFinite(parsed) && parsed >= 0 && parsed <= 5 ? parsed : null;
}

function normalizePhone(value) {
  if (!value) return null;
  const text = String(value).trim();
  const digits = text.replace(/[^0-9]/g, '');
  if (digits.length < 7 || digits.length > 15) return null;
  return text.startsWith('+') ? `+${digits}` : digits;
}

function normalizeRow(row, rowNumber) {
  const directoryUrl = first(row, ['directory_url', 'profile_url', 'url', 'profile']);
  const sourceId = first(row, ['source_id', 'directory_source_id', 'profile_id', 'user_id', 'id']) || directoryUrl;
  if (!sourceId) throw new Error(`row ${rowNumber}: source_id or directory_url is required`);

  const displayName = first(row, ['display_name', 'name', 'full_name', 'dealer_name']);
  const companyName = first(row, ['company_name', 'company', 'business']);
  const phone = first(row, ['phone_normalized', 'phone', 'whatsapp', 'whatsapp_phone', 'whatsapp_url', 'chat_url']);
  const groups = first(row, ['whatsapp_group_count', 'group_count', 'common_groups']);
  const original = { ...row };
  return {
    source_system: SOURCE_SYSTEM,
    source_id: sourceId.slice(0, 500),
    display_name: displayName,
    company_name: companyName,
    phone_normalized: normalizePhone(phone),
    country_code: first(row, ['country_code', 'country', 'region']),
    city: first(row, ['city', 'location']),
    rating: rating(first(row, ['rating', 'score'])),
    review_count: integer(first(row, ['review_count', 'feedback_count', 'profile_rating_count', 'feedback_received'])),
    whatsapp_group_count: integer(groups),
    avatar_url: first(row, ['avatar_url', 'avatar', 'image_url']),
    directory_url: directoryUrl,
    raw_payload: original,
    comparison_status: 'PENDING',
    matched_dealer_id: null,
  };
}

async function rowsFromFile(inputPath) {
  const extension = path.extname(inputPath).toLowerCase();
  if (extension === '.json') {
    const parsed = JSON.parse(fs.readFileSync(inputPath, 'utf8'));
    if (Array.isArray(parsed)) return parsed;
    if (parsed && Array.isArray(parsed.profiles)) {
      return parsed.profiles.map((profile, index) => ({
        ...profile,
        source_rank: index + 1,
        source_snapshot_url: parsed.source || null,
        source_crawled_at: parsed.crawled_at || null,
      }));
    }
    throw new Error('JSON export must contain an array of rows or a profiles array');
  }
  if (extension === '.jsonl' || extension === '.ndjson') {
    const rows = [];
    for await (const line of readline.createInterface({ input: fs.createReadStream(inputPath), crlfDelay: Infinity })) {
      if (line.trim()) rows.push(JSON.parse(line));
    }
    return rows;
  }
  return new Promise((resolve, reject) => {
    const rows = [];
    fs.createReadStream(inputPath)
      .pipe(csv())
      .on('data', row => rows.push(row))
      .on('end', () => resolve(rows))
      .on('error', reject);
  });
}

async function request(baseUrl, key, rows) {
  const response = await fetch(`${baseUrl}/rest/v1/dealer_directory_import_staging?on_conflict=source_system,source_id`, {
    method: 'POST',
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
      Prefer: 'resolution=merge-duplicates,return=minimal',
    },
    body: JSON.stringify(rows),
    signal: AbortSignal.timeout(30000),
  });
  if (!response.ok) throw new Error(`Supabase ${response.status}: ${(await response.text()).slice(0, 500)}`);
}

async function run({ inputPath, outputPath, apply = false, maxRows = Infinity, batchSize = 250 } = {}) {
  if (!inputPath) throw new Error('DIRECTORY_EXPORT_PATH is required');
  if (!fs.existsSync(inputPath)) throw new Error(`Export not found: ${inputPath}`);
  const rawRows = await rowsFromFile(inputPath);
  const rows = [];
  const errors = [];
  for (let index = 0; index < Math.min(rawRows.length, maxRows); index += 1) {
    try { rows.push(normalizeRow(rawRows[index], index + 2)); }
    catch (error) { errors.push(error.message); }
  }

  const sourceIds = new Set();
  const duplicateSourceIds = [];
  for (const row of rows) {
    if (sourceIds.has(row.source_id)) duplicateSourceIds.push(row.source_id);
    sourceIds.add(row.source_id);
  }

  const summary = {
    sourceSystem: SOURCE_SYSTEM,
    inputPath: path.resolve(inputPath),
    inputRows: Math.min(rawRows.length, maxRows),
    validRows: rows.length,
    rejectedRows: errors.length,
    duplicateSourceIds: [...new Set(duplicateSourceIds)].length,
    apply,
    target: 'dealer_directory_import_staging',
    productionDealersChanged: 0,
    productionListingsChanged: 0,
    errors,
  };
  if (outputPath) {
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, `${JSON.stringify({ summary, rows }, null, 2)}\n`);
  }
  if (!apply) return summary;
  if (process.env.DIRECTORY_IMPORT_APPROVED !== APPLY_CONFIRMATION) {
    throw new Error(`Write blocked. Set DIRECTORY_IMPORT_APPROVED=${APPLY_CONFIRMATION} after reviewing the dry-run output.`);
  }
  const baseUrl = required('SUPABASE_URL');
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY;
  if (!key) throw new Error('SUPABASE_SERVICE_ROLE_KEY is required for staging writes');
  for (let index = 0; index < rows.length; index += batchSize) await request(baseUrl, key, rows.slice(index, index + batchSize));
  return { ...summary, stagedRows: rows.length };
}

if (require.main === module) {
  run({
    inputPath: process.env.DIRECTORY_EXPORT_PATH,
    outputPath: process.env.DIRECTORY_IMPORT_OUTPUT || 'audit-output/dealer-lineage/rated-dealers-import-preview.json',
    apply: process.env.DIRECTORY_IMPORT_APPLY === 'true',
    maxRows: Math.max(1, Number(process.env.DIRECTORY_IMPORT_MAX_ROWS || Infinity)),
    batchSize: Math.min(500, Math.max(25, Number(process.env.DIRECTORY_IMPORT_BATCH_SIZE || 250))),
  }).then(summary => process.stdout.write(`${JSON.stringify({ event: 'rated_dealers_staging_complete', ...summary }, null, 2)}\n`))
    .catch(error => { process.stderr.write(`${JSON.stringify({ event: 'rated_dealers_staging_error', error: error.message })}\n`); process.exitCode = 1; });
}

module.exports = { normalizeRow, run, rowsFromFile };
