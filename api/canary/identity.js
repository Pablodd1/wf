'use strict';

const { getClient } = require('../_lib/supabase');

const ALLOWED_ENVIRONMENTS = new Set(['preview', 'staging', 'disposable-staging']);
const CANARY_CONTRACT_VERSION = 'v2.0';

function validateIdentityEnvironment(env = process.env) {
  let gitSha = env.VERCEL_GIT_COMMIT_SHA || env.GIT_COMMIT_SHA || env.EXPECTED_STAGING_GIT_SHA;
  if (!gitSha || typeof gitSha !== 'string' || !gitSha.trim()) {
    try {
      gitSha = require('child_process').execSync('git rev-parse HEAD', { encoding: 'utf-8' }).trim();
    } catch {}
  }
  if (!gitSha || typeof gitSha !== 'string' || !gitSha.trim()) {
    return { valid: false, error: 'IDENTIFIER_MISSING: VERCEL_GIT_COMMIT_SHA is missing or empty' };
  }

  const vercelEnv = env.VERCEL_ENV || env.DEPLOYMENT_ENVIRONMENT;
  if (!vercelEnv || typeof vercelEnv !== 'string' || !ALLOWED_ENVIRONMENTS.has(vercelEnv.trim().toLowerCase())) {
    return {
      valid: false,
      error: `ENVIRONMENT_INVALID: Deployment environment '${vercelEnv}' is not in permitted staging environments ('preview', 'staging', 'disposable-staging')`
    };
  }

  return { valid: true, gitSha: gitSha.trim(), vercelEnv: vercelEnv.trim().toLowerCase() };
}

async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const envCheck = validateIdentityEnvironment(process.env);
  if (!envCheck.valid) {
    return res.status(503).json({
      status: 'unattested',
      error: envCheck.error
    });
  }

  try {
    const supabase = getClient();
    const { data: marker, error } = await supabase
      .from('staging_environment_marker')
      .select('staging_project_id, is_disposable_staging, database_identity_hash, attestation_nonce, schema_version, created_at')
      .maybeSingle();

    if (error || !marker) {
      return res.status(503).json({
        status: 'unattested',
        error: error ? error.message : 'Staging environment marker not found'
      });
    }

    if (marker.is_disposable_staging !== true) {
      return res.status(403).json({
        status: 'refused',
        error: 'Target database is not marked as disposable staging'
      });
    }

    if (!marker.staging_project_id || !marker.database_identity_hash || !marker.attestation_nonce || !marker.schema_version) {
      return res.status(503).json({
        status: 'unattested',
        error: 'Marker record is missing required fields (staging_project_id, database_identity_hash, attestation_nonce, schema_version)'
      });
    }

    return res.status(200).json({
      status: 'ok',
      git_sha: envCheck.gitSha,
      staging_project_id: marker.staging_project_id,
      database_identity_hash: marker.database_identity_hash,
      attestation_nonce: marker.attestation_nonce,
      schema_version: marker.schema_version,
      deployment_environment: envCheck.vercelEnv,
      canary_contract_version: CANARY_CONTRACT_VERSION,
      marker_created_at: marker.created_at
    });
  } catch (err) {
    return res.status(500).json({ status: 'error', error: err.message });
  }
}

module.exports = handler;
module.exports.validateIdentityEnvironment = validateIdentityEnvironment;
module.exports.ALLOWED_ENVIRONMENTS = ALLOWED_ENVIRONMENTS;
module.exports.CANARY_CONTRACT_VERSION = CANARY_CONTRACT_VERSION;
