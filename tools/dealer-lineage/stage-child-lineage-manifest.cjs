'use strict';

const fs = require('node:fs');
const path = require('node:path');
const readline = require('node:readline');

const PAGE_SIZE = Math.max(25, Math.min(Number(process.env.CHILD_LINEAGE_STAGE_PAGE_SIZE || 250), 500));
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

function stagingRow(row) {
  if (row.public_contact_eligible !== false || row.child_image_publication_eligible !== false) {
    throw new Error(`Public release gate failed for ${row.child_id}`);
  }
  if (row.dealer_id || row.approval_status !== 'UNCHANGED' || row.publication_status !== 'UNCHANGED') {
    throw new Error(`Publication authority present for ${row.child_id}`);
  }
  if (row.activity_count_eligible && row.child_intent !== row.source_parent_intent) {
    throw new Error(`Intent gate failed for ${row.child_id}`);
  }
  return {
    child_id: row.child_id,
    source_child_id: row.source_child_id,
    source_system: row.source_system,
    source_record_id: row.source_record_id,
    seller_listing_id: row.seller_listing_id,
    seller_identity_pseudonym: row.observed_seller?.identity_pseudonym,
    source_posted_at: row.source_posted_at,
    source_posted_at_raw: row.source_posted_at_raw,
    child_intent: row.child_intent,
    source_parent_intent: row.source_parent_intent,
    activity_count_eligible: row.activity_count_eligible,
    dealer_id: null,
    dealer_verification_status: 'REQUIRES_VERIFIED_DEALER_MATCH',
    public_contact_eligible: false,
    parent_front_image: row.parent_front_image,
    image_lineage_status: row.image_lineage_status,
    child_image_publication_eligible: false,
    review_status: 'PENDING',
    review_reasons: row.review_reasons,
    evidence: row.evidence,
    listing_fingerprint: row.listing_fingerprint,
  };
}

async function request(baseUrl, key, rows) {
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    try {
      const response = await fetch(`${baseUrl}/rest/v1/seller_child_lineage_staging?on_conflict=child_id`, {
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
    process.stdout.write(`${JSON.stringify({ event: 'seller_child_lineage_stage_checkpoint', write, ...checkpoint })}\n`);
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
  return { ...checkpoint, write, maxRows, target: 'seller_child_lineage_staging', productionRowsMutated: 0, publicRowsMutated: 0 };
}

async function main() {
  const manifestPath = path.resolve(process.env.CHILD_LINEAGE_MANIFEST || process.argv[2] || 'audit-output/dealer-lineage/batch-002-child-reconciliation-full/private-child-lineage.jsonl');
  if (!fs.existsSync(manifestPath)) throw new Error(`Manifest not found: ${manifestPath}`);
  const write = String(process.env.APPLY_CHILD_LINEAGE_STAGING || 'false').toLowerCase() === 'true';
  const maxRows = Math.max(1, Number(process.env.CHILD_LINEAGE_STAGE_MAX_ROWS || 100));
  const checkpointPath = path.resolve(process.env.CHILD_LINEAGE_STAGE_CHECKPOINT || `${manifestPath}.${write ? 'write' : 'dry-run'}.checkpoint.json`);
  const result = await stage({ manifestPath, checkpointPath, write, maxRows });
  process.stdout.write(`${JSON.stringify({ event: 'seller_child_lineage_stage_complete', ...result }, null, 2)}\n`);
}

if (require.main === module) main().catch(error => {
  process.stderr.write(`${JSON.stringify({ event: 'seller_child_lineage_stage_error', error: error.message })}\n`);
  process.exitCode = 1;
});

module.exports = { stage, stagingRow };
