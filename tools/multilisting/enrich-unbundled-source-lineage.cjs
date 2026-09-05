'use strict';

const fs = require('node:fs');
const path = require('node:path');
const csv = require('csv-parser');

const PAGE_SIZE = Math.max(25, Math.min(Number(process.env.UNBUNDLED_ENRICH_PAGE_SIZE || 100), 200));
const MAX_ATTEMPTS = 4;

function required(name) {
  const value = String(process.env[name] || '').trim().replace(/\/$/, '');
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function text(value) {
  return String(value ?? '').trim();
}

function atomicJson(filePath, value) {
  const temporary = `${filePath}.partial`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`);
  fs.renameSync(temporary, filePath);
}

async function rest(baseUrl, key, resource) {
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    try {
      const response = await fetch(`${baseUrl}/rest/v1/${resource}`, {
        signal: AbortSignal.timeout(30_000),
        headers: { apikey: key, Authorization: `Bearer ${key}` },
      });
      if (!response.ok) throw new Error(`Supabase ${response.status}: ${(await response.text()).slice(0, 500)}`);
      return await response.json();
    } catch (error) {
      if (attempt === MAX_ATTEMPTS || /^Supabase 4/.test(error.message)) throw error;
      await new Promise(resolve => setTimeout(resolve, 500 * (2 ** (attempt - 1))));
    }
  }
  return [];
}

async function loadSourceIds(parentsPath) {
  const ids = [];
  for await (const row of fs.createReadStream(parentsPath).pipe(csv())) {
    const id = text(row.source_record_id);
    if (id) ids.push(id);
  }
  return [...new Set(ids)];
}

async function enrich({ parentsPath, outputDir }) {
  const baseUrl = required('SUPABASE_URL');
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY;
  if (!key) throw new Error('SUPABASE_SERVICE_ROLE_KEY is required');
  fs.mkdirSync(outputDir, { recursive: true });
  const checkpointPath = path.join(outputDir, 'checkpoint.json');
  const outputPath = path.join(outputDir, 'source-lineage.jsonl');
  const checkpoint = fs.existsSync(checkpointPath)
    ? JSON.parse(fs.readFileSync(checkpointPath, 'utf8'))
    : { processed: 0, found: 0, missing: 0 };
  if (checkpoint.processed === 0 && fs.existsSync(outputPath)) {
    throw new Error('Output exists without a usable checkpoint; choose a new output directory');
  }

  const sourceIds = await loadSourceIds(parentsPath);
  for (let index = checkpoint.processed; index < sourceIds.length; index += PAGE_SIZE) {
    const ids = sourceIds.slice(index, index + PAGE_SIZE);
    const params = new URLSearchParams({
      select: 'id,seller_name,seller_phone,region,listing_date,dealer_id,created_at,source,flags',
      id: `in.(${ids.map(id => `"${id.replaceAll('"', '')}"`).join(',')})`,
    });
    const rows = await rest(baseUrl, key, `watch_records?${params}`);
    const foundIds = new Set(rows.map(row => text(row.id)));
    const records = rows.map(row => ({
      source_record_id: text(row.id),
      seller_name: text(row.seller_name) || null,
      seller_phone: text(row.seller_phone) || null,
      region: text(row.region) || null,
      listing_date: text(row.listing_date) || null,
      dealer_id: text(row.dealer_id) || null,
      source_created_at: text(row.created_at) || null,
      source: text(row.source) || null,
      source_flags: row.flags && typeof row.flags === 'object' ? row.flags : {},
    }));
    if (records.length) fs.appendFileSync(outputPath, `${records.map(row => JSON.stringify(row)).join('\n')}\n`);
    checkpoint.processed = Math.min(index + ids.length, sourceIds.length);
    checkpoint.found += records.length;
    checkpoint.missing += ids.filter(id => !foundIds.has(id)).length;
    checkpoint.updatedAt = new Date().toISOString();
    atomicJson(checkpointPath, checkpoint);
    process.stdout.write(`${JSON.stringify({ event: 'unbundled_source_enrichment_checkpoint', ...checkpoint, total: sourceIds.length })}\n`);
  }
  const report = { ...checkpoint, total: sourceIds.length, outputPath, productionWrites: 0 };
  atomicJson(path.join(outputDir, 'report.json'), report);
  return report;
}

async function main() {
  const parentsPath = process.env.UNBUNDLED_PARENT_CSV_PATH || process.argv[2];
  if (!parentsPath) throw new Error('Provide the parent raw-message CSV path');
  const outputDir = path.resolve(process.env.UNBUNDLED_ENRICH_OUTPUT || 'audit-output/unbundled/source-lineage');
  const report = await enrich({ parentsPath, outputDir });
  process.stdout.write(`${JSON.stringify({ event: 'unbundled_source_enrichment_complete', ...report })}\n`);
}

if (require.main === module) {
  main().catch(error => {
    process.stderr.write(`${JSON.stringify({ event: 'unbundled_source_enrichment_error', error: error.message })}\n`);
    process.exitCode = 1;
  });
}

module.exports = { enrich, loadSourceIds };
