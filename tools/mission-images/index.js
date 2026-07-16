import fs from 'node:fs';
import path from 'node:path';
import csv from 'csv-parser';
import { createClient } from '@supabase/supabase-js';
import { toInventoryRow } from './lib.js';

const config = {
  mode: String(process.env.MISSION_IMAGES_MODE || 'scan').toLowerCase(),
  csvPath: process.env.MISSION_IMAGES_CSV || 'thecollective-prod_inventory.csv',
  baseUrl: process.env.SPACES_PUBLIC_BASE_URL || 'https://thecollective-prod.nyc3.digitaloceanspaces.com',
  batchSize: positiveInt(process.env.MISSION_IMAGES_BATCH_SIZE, 500),
  maxRows: nonNegativeInt(process.env.MISSION_IMAGES_MAX_ROWS, 0),
  progressEvery: positiveInt(process.env.MISSION_IMAGES_PROGRESS_EVERY, 100000),
  checkpointPath: process.env.MISSION_IMAGES_CHECKPOINT || 'mission-images-checkpoint.json',
  orphanLog: process.env.MISSION_IMAGES_ORPHAN_LOG || 'orphaned_images.log',
  failureLog: process.env.MISSION_IMAGES_FAILURE_LOG || 'failed_images.log',
  resume: String(process.env.MISSION_IMAGES_RESUME || 'true').toLowerCase() !== 'false',
};

const allowedModes = new Set(['scan', 'stage', 'link', 'promote']);
if (!allowedModes.has(config.mode)) throw new Error(`Unsupported MISSION_IMAGES_MODE: ${config.mode}`);

function positiveInt(value, fallback) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : fallback;
}

function nonNegativeInt(value, fallback) {
  const number = Number(value);
  return Number.isInteger(number) && number >= 0 ? number : fallback;
}

function supabaseClient() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required for write modes');
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    db: { schema: 'public' },
    global: { headers: { 'X-Client-Info': 'watchfacts-mission-images/1.0' } },
  });
}

function readCheckpoint() {
  if (!config.resume || !fs.existsSync(config.checkpointPath)) return { processedRows: 0 };
  const parsed = JSON.parse(fs.readFileSync(config.checkpointPath, 'utf8'));
  return parsed.mode === config.mode && parsed.csvPath === path.resolve(config.csvPath)
    ? parsed
    : { processedRows: 0 };
}

function writeCheckpoint(state) {
  const payload = JSON.stringify({
    ...state,
    mode: config.mode,
    csvPath: path.resolve(config.csvPath),
    updatedAt: new Date().toISOString(),
  }, null, 2);
  const temporary = `${config.checkpointPath}.tmp`;
  fs.writeFileSync(temporary, payload);
  fs.renameSync(temporary, config.checkpointPath);
}

function appendJsonLine(file, value) {
  fs.appendFileSync(file, `${JSON.stringify({ at: new Date().toISOString(), ...value })}\n`);
}

async function withRetry(operation, context, attempts = 5) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (attempt < attempts) await new Promise(resolve => setTimeout(resolve, 500 * (2 ** (attempt - 1))));
    }
  }
  appendJsonLine(config.failureLog, { context, error: lastError?.message || String(lastError) });
  throw lastError;
}

async function stageBatch(client, rows) {
  await withRetry(async () => {
    const { error } = await client
      .from('media_object_inventory')
      .upsert(rows, { onConflict: 'bucket,object_key', ignoreDuplicates: false });
    if (error) throw error;
  }, { operation: 'stage_batch', rows: rows.length, firstKey: rows[0]?.object_key });
}

async function scanOrStage() {
  if (!fs.existsSync(config.csvPath)) throw new Error(`CSV not found: ${config.csvPath}`);
  const checkpoint = readCheckpoint();
  const client = config.mode === 'stage' ? supabaseClient() : null;
  const stats = {
    processedRows: checkpoint.processedRows || 0,
    currentRunRows: 0,
    extracted: 0,
    unparsed: 0,
    bytes: 0,
    namespaces: {},
    mediaKinds: {},
  };
  let csvRowNumber = 0;
  let batch = [];

  const stream = fs.createReadStream(config.csvPath)
    .pipe(csv({ mapHeaders: ({ header }) => header.replace(/^\uFEFF/, '').trim() }));

  for await (const csvRow of stream) {
    csvRowNumber += 1;
    if (csvRowNumber <= (checkpoint.processedRows || 0)) continue;
    if (config.maxRows && stats.currentRunRows >= config.maxRows) break;

    const row = toInventoryRow(csvRow, config.baseUrl);
    stats.processedRows = csvRowNumber;
    stats.currentRunRows += 1;
    stats.bytes += row.size_bytes || 0;
    stats.namespaces[row.namespace] = (stats.namespaces[row.namespace] || 0) + 1;
    stats.mediaKinds[row.media_kind] = (stats.mediaKinds[row.media_kind] || 0) + 1;
    if (row.extracted_id) stats.extracted += 1;
    else {
      stats.unparsed += 1;
      appendJsonLine(config.orphanLog, { reason: 'ID_NOT_EXTRACTED', bucket: row.bucket, key: row.object_key });
    }

    if (client) {
      batch.push(row);
      if (batch.length >= config.batchSize) {
        await stageBatch(client, batch);
        batch = [];
        writeCheckpoint(stats);
      }
    }

    if (stats.currentRunRows % config.progressEvery === 0) {
      console.log(JSON.stringify({ event: 'mission_images_progress', mode: config.mode, ...stats }));
      if (!client) writeCheckpoint(stats);
    }
  }

  if (client && batch.length) await stageBatch(client, batch);
  writeCheckpoint(stats);
  console.log(JSON.stringify({ event: 'mission_images_complete', mode: config.mode, ...stats }, null, 2));
}

async function runRpcMode() {
  const client = supabaseClient();
  const rpcName = config.mode === 'link' ? 'mission_images_link_batch' : 'mission_images_promote_batch';
  let batches = 0;
  let processed = 0;
  while (true) {
    const result = await withRetry(async () => {
      const { data, error } = await client.rpc(rpcName, { p_limit: config.batchSize });
      if (error) throw error;
      return data || {};
    }, { operation: rpcName, batch: batches + 1 });
    const count = Number(result.processed || 0);
    batches += 1;
    processed += count;
    console.log(JSON.stringify({ event: rpcName, batch: batches, totalProcessed: processed, ...result }));
    if (count === 0 || (config.maxRows && processed >= config.maxRows)) break;
  }
}

try {
  if (config.mode === 'scan' || config.mode === 'stage') await scanOrStage();
  else await runRpcMode();
} catch (error) {
  console.error(JSON.stringify({ event: 'mission_images_error', mode: config.mode, error: error.message }));
  process.exitCode = 1;
}
