/**
 * POST /api/persist
 *
 * Persists reprocessed or live-ingested watch records to Supabase.
 *
 * Request body:
 *   {
 *     records: ReprocessResult[],          // array of watch record objects
 *     mode:    'reprocess' | 'ingest'      // determines target table / field mapping
 *   }
 *
 * Response:
 *   { saved: number, errors: string[] }
 *
 * Environment variables required:
 *   SUPABASE_URL              – e.g. https://xyzcompany.supabase.co
 *   SUPABASE_SERVICE_ROLE_KEY – service-role JWT (bypasses RLS)
 */

const BATCH_SIZE = 500;
const { authorizeMutation } = require('./_lib/authorize-mutation.cjs');

/**
 * Split an array into chunks of at most `size` elements.
 * @param {any[]} arr
 * @param {number} size
 * @returns {any[][]}
 */
function chunk(arr, size) {
  const chunks = [];
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
}

/**
 * Map a raw ReprocessResult to the shape expected by watch_records.
 * Fields absent in the source object are left as undefined (omitted from JSON).
 * @param {Record<string, any>} record
 * @returns {Record<string, any>}
 */
function toWatchRecord(record) {
  return {
    id:             record.id,
    brand:          record.brand          ?? null,
    reference:      record.reference      ?? null,
    dial_color:     record.dial_color     ?? record.dialColor     ?? null,
    condition:      record.condition      ?? null,
    year:           record.year           != null ? Number(record.year)        : null,
    price_raw:      record.price_raw      != null ? Number(record.price_raw)   : null,
    price_usd:      record.price_usd      != null ? Number(record.price_usd)   : null,
    currency:       record.currency       ?? null,
    confidence:     record.confidence     != null ? Number(record.confidence)  : null,
    verdict:        record.verdict        ?? null,
    source:         record.source         ?? null,
    raw_message:    record.raw_message    ?? record.rawMessage    ?? null,
    flags:          record.flags          ?? null,
    reprocessed_at: record.reprocessed_at ?? record.reprocessedAt ?? null,
    created_at:     record.created_at     ?? record.createdAt     ?? undefined,
  };
}

/**
 * Upsert one batch (≤ BATCH_SIZE) of records into watch_records via
 * Supabase PostgREST bulk upsert endpoint.
 *
 * @param {string}               supabaseUrl
 * @param {string}               serviceKey
 * @param {Record<string, any>[]} batch
 * @returns {Promise<{ saved: number, errors: string[] }>}
 */
async function upsertBatch(supabaseUrl, serviceKey, batch) {
  const url = `${supabaseUrl}/rest/v1/watch_records`;

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type':  'application/json',
      'apikey':        serviceKey,
      'Authorization': `Bearer ${serviceKey}`,
      // Tell PostgREST to upsert (merge-duplicates) on PK conflict
      'Prefer':        'resolution=merge-duplicates,return=representation',
    },
    body: JSON.stringify(batch),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '(no body)');
    return {
      saved:  0,
      errors: [`HTTP ${response.status} – ${text}`],
    };
  }

  // PostgREST returns the upserted rows when return=representation is set
  const saved = await response.json().catch(() => []);
  return {
    saved:  Array.isArray(saved) ? saved.length : batch.length,
    errors: [],
  };
}

/**
 * Vercel serverless handler – ESM default export.
 *
 * @param {import('@vercel/node').VercelRequest}  req
 * @param {import('@vercel/node').VercelResponse} res
 */
module.exports = async function handler(req, res) {
  // ── Method guard ────────────────────────────────────────────
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }
  if (!await authorizeMutation(req, res, new Set(['reviewer', 'admin']))) return;

  // ── Env vars ────────────────────────────────────────────────
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey  = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY;

  if (!supabaseUrl || !serviceKey) {
    return res.status(500).json({
      error: 'Missing required environment variables: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY',
    });
  }

  // ── Parse body ──────────────────────────────────────────────
  let body;
  try {
    // Vercel already parses JSON bodies; fall back to manual parse if needed.
    body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
  } catch {
    return res.status(400).json({ error: 'Invalid JSON body' });
  }

  const { records, mode } = body ?? {};

  if (!Array.isArray(records) || records.length === 0) {
    return res.status(400).json({ error: '`records` must be a non-empty array' });
  }

  if (mode !== 'reprocess' && mode !== 'ingest') {
    return res.status(400).json({ error: '`mode` must be "reprocess" or "ingest"' });
  }

  // ── Map & batch upsert ──────────────────────────────────────
  const mapped  = records.map(toWatchRecord);
  const batches = chunk(mapped, BATCH_SIZE);

  let totalSaved = 0;
  const allErrors = [];

  for (const batch of batches) {
    const { saved, errors } = await upsertBatch(supabaseUrl, serviceKey, batch);
    totalSaved += saved;
    allErrors.push(...errors);
  }

  // ── Response ────────────────────────────────────────────────
  const statusCode = allErrors.length > 0 && totalSaved === 0 ? 500 : 200;
  return res.status(statusCode).json({
    saved:  totalSaved,
    errors: allErrors,
  });
}
