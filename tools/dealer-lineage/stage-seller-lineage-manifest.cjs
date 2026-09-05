'use strict';

const fs = require('node:fs');
const path = require('node:path');
const readline = require('node:readline');

const PAGE_SIZE = Math.max(25, Math.min(Number(process.env.SELLER_LINEAGE_STAGE_PAGE_SIZE || 250), 500));
const MAX_ATTEMPTS = 4;

function atomicJson(filePath, value) {
  const temporary = `${filePath}.partial`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`);
  fs.renameSync(temporary, filePath);
}

function required(name) {
  const value = String(process.env[name] || '').trim().replace(/\/$/, '');
  if (!value) throw new Error(`${name} is required`);
  return value;
}

async function request(baseUrl, key, rows) {
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    try {
      const response = await fetch(`${baseUrl}/rest/v1/seller_listing_lineage_staging?on_conflict=source_system,source_record_id,seller_listing_id`, {
        method: 'POST',
        signal: AbortSignal.timeout(30_000),
        headers: {
          apikey: key,
          Authorization: `Bearer ${key}`,
          'Content-Type': 'application/json',
          Prefer: 'resolution=merge-duplicates,return=minimal',
        },
        body: JSON.stringify(rows),
      });
      if (!response.ok) throw new Error(`Supabase ${response.status}: ${(await response.text()).slice(0, 500)}`);
      return;
    } catch (error) {
      if (attempt === MAX_ATTEMPTS || /^Supabase 4/.test(error.message)) throw error;
      await new Promise(resolve => setTimeout(resolve, 500 * (2 ** (attempt - 1))));
    }
  }
}

function stagingRow(row) {
  if (row.match_status !== 'A_AUTO_STAGE') throw new Error(`Unsafe manifest row ${row.source_record_id}`);
  if (!row.match_evidence?.exact_raw_message_sha1 || !row.match_evidence?.exact_wall_clock_second || !row.match_evidence?.unique_phone_identity || !row.match_evidence?.intent_agreement) {
    throw new Error(`Release gate failed for ${row.source_record_id}`);
  }
  return {
    source_system: row.source_system,
    source_record_id: row.source_record_id,
    seller_listing_id: row.seller_listing_id,
    title_sha1: row.title_sha1,
    source_identity: row.seller_phone_normalized,
    identity_type: 'PHONE',
    observed_name: row.observed_names?.[0] || null,
    origin: row.origin,
    source_listing_type: row.source_listing_type,
    source_posted_at: row.source_posted_at,
    source_posted_at_raw: row.source_posted_at_raw,
    front_image: row.front_image,
    match_status: 'MATCH_READY',
    match_evidence: row.match_evidence,
  };
}

async function stage({ manifestPath, checkpointPath, write, maxRows }) {
  const checkpoint = fs.existsSync(checkpointPath)
    ? JSON.parse(fs.readFileSync(checkpointPath, 'utf8'))
    : { processed: 0, persisted: 0 };
  const baseUrl = write ? required('SUPABASE_URL') : null;
  const key = write ? (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY) : null;
  if (write && !key) throw new Error('SUPABASE_SERVICE_ROLE_KEY is required');
  let seen = 0;
  let batch = [];

  async function flush() {
    if (!batch.length) return;
    if (write) await request(baseUrl, key, batch);
    checkpoint.processed += batch.length;
    if (write) checkpoint.persisted += batch.length;
    checkpoint.updatedAt = new Date().toISOString();
    atomicJson(checkpointPath, checkpoint);
    process.stdout.write(`${JSON.stringify({ event: 'seller_lineage_stage_checkpoint', write, ...checkpoint })}\n`);
    batch = [];
  }

  for await (const line of readline.createInterface({ input: fs.createReadStream(manifestPath), crlfDelay: Infinity })) {
    if (!line.trim()) continue;
    seen += 1;
    if (seen <= checkpoint.processed) continue;
    if (checkpoint.processed + batch.length >= maxRows) break;
    batch.push(stagingRow(JSON.parse(line)));
    if (batch.length >= PAGE_SIZE) await flush();
  }
  await flush();
  return { ...checkpoint, write, maxRows, target: 'seller_listing_lineage_staging', publicRowsMutated: 0 };
}

async function main() {
  const manifestPath = path.resolve(process.env.SELLER_LINEAGE_MANIFEST || process.argv[2] || 'audit-output/dealer-lineage/seller-lineage/match-ready.jsonl');
  if (!fs.existsSync(manifestPath)) throw new Error(`Manifest not found: ${manifestPath}`);
  const write = String(process.env.APPLY_SELLER_LINEAGE_STAGING || 'false').toLowerCase() === 'true';
  const maxRows = Math.max(1, Number(process.env.SELLER_LINEAGE_STAGE_MAX_ROWS || 100));
  const checkpointPath = path.resolve(process.env.SELLER_LINEAGE_STAGE_CHECKPOINT || `${manifestPath}.${write ? 'write' : 'dry-run'}.checkpoint.json`);
  const result = await stage({ manifestPath, checkpointPath, write, maxRows });
  process.stdout.write(`${JSON.stringify({ event: 'seller_lineage_stage_complete', ...result }, null, 2)}\n`);
}

if (require.main === module) main().catch(error => {
  process.stderr.write(`${JSON.stringify({ event: 'seller_lineage_stage_error', error: error.message })}\n`);
  process.exitCode = 1;
});

module.exports = { stage, stagingRow };
