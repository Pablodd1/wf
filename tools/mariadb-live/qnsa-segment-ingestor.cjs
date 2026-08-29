'use strict';

const { boundedInteger } = require('./lib.cjs');

const QNSA_PROJECT = 'qnsafosakvonzgfcsphh';
const CONFIRMATION = 'INGEST_QNSA_LIVE_SHADOW_SEGMENTS_NO_PUBLICATION';

function config(env = process.env) {
  const url = String(env.SUPABASE_URL || '').replace(/\/$/, '');
  const key = env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SECRET_KEY;
  if (!url || !key) throw new Error('QNSA segment ingestor requires server-only Supabase credentials');
  const parsedUrl = new URL(url);
  const expectedOrigin = `https://${QNSA_PROJECT}.supabase.co`;
  if (parsedUrl.origin !== expectedOrigin || parsedUrl.username || parsedUrl.password
    || parsedUrl.pathname !== '/' || parsedUrl.search || parsedUrl.hash) {
    throw new Error('QNSA HTTPS origin pin mismatch');
  }
  if (env.MARIADB_SEGMENT_BRIDGE_CONFIRMATION !== CONFIRMATION) throw new Error('QNSA shadow-ingest confirmation mismatch');
  return { url, key, maxRows: boundedInteger(env.MARIADB_SEGMENT_RPC_MAX_ROWS, 500, 1, 500) };
}

function createQnsaSegmentIngestor(options = {}) {
  const runConfig = options.config || config(options.env);
  const fetchImpl = options.fetchImpl || fetch;
  return async request => {
    if (request.publication_authorized !== false) throw new Error('Customer publication is prohibited');
    if (!Array.isArray(request.raw_records) || !Array.isArray(request.staging_records)
      || request.raw_records.length !== request.staging_records.length
      || request.raw_records.length < 1 || request.raw_records.length > runConfig.maxRows) {
      throw new Error('QNSA segment record count is invalid');
    }
    const response = await fetchImpl(`${runConfig.url}/rest/v1/rpc/ingest_live_shadow_segment`, {
      method: 'POST',
      headers: { apikey: runConfig.key, Authorization: `Bearer ${runConfig.key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        p_contract: request.contract,
        p_batch_token: request.batch_token,
        p_sequence: request.sequence,
        p_expected_last_created_on: request.expected_previous_cursor.last_created_on,
        p_expected_last_source_id: request.expected_previous_cursor.last_source_id,
        p_next_last_created_on: request.next_cursor.last_created_on,
        p_next_last_source_id: request.next_cursor.last_source_id,
        p_expected_previous_chain_sha256: request.expected_previous_segment_chain_sha256,
        p_next_chain_sha256: request.next_segment_chain_sha256,
        p_raw_file_sha256: request.raw_file_sha256,
        p_proposal_file_sha256: request.proposal_file_sha256,
        p_raw_records: request.raw_records,
        p_staging_records: request.staging_records,
      }),
      signal: AbortSignal.timeout(120000),
    });
    const text = await response.text();
    if (!response.ok) {
      const error = new Error(`QNSA shadow segment RPC failed with HTTP ${response.status}; secure operator review required`);
      error.code = 'QNSA_SHADOW_RPC_FAILED';
      throw error;
    }
    try {
      return text ? JSON.parse(text) : null;
    } catch {
      const error = new Error('QNSA shadow segment RPC returned an invalid response; secure operator review required');
      error.code = 'QNSA_SHADOW_RPC_INVALID_RESPONSE';
      throw error;
    }
  };
}

module.exports = { CONFIRMATION, QNSA_PROJECT, config, createQnsaSegmentIngestor };
