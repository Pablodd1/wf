'use strict';

const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { stableJson, sha256 } = require('./lib.cjs');

const PROD_IDENTIFIERS = [
  'bptrvfncppbjnchsaxtb',
  'qnsafosakvonzgfcsphh',
  'aws-0-us-west-1.pooler.supabase.com',
  'aws-1-us-west-2.pooler.supabase.com',
  'watchfacts-poc.vercel.app',
  'wf-production-00b9.up.railway.app',
  'luxuryapp-wf.vercel.app'
];

const { adaptLegacyListingDisplayV1 } = require('../../shared/listing-display-contract.cjs');
// Legacy staging rows are unproven; enumerate contract fields via the explicit
// legacy V1 adapter (strict V2 enforcement fails closed on empty input by design).
const CONTRACT_FIELDS = Object.keys(adaptLegacyListingDisplayV1({}));

function calculateCanonicalPayloadHash(payload) {
  if (typeof payload === 'string') {
    return sha256(payload);
  }
  return sha256(stableJson(payload));
}

function redactSecretString(str) {
  if (!str || typeof str !== 'string') return '';
  return str
    .replace(/(postgres(?:ql)?:\/\/[^:]+:)([^@]+)(@)/gi, '$1[REDACTED_PASSWORD]$3')
    .replace(/eyJ[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{10,}/g, '[REDACTED_JWT]')
    .replace(/sb_secret_[a-zA-Z0-9_-]+/g, '[REDACTED_KEY]');
}

function parseAndValidateUrl(rawUrl, varName) {
  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error(`MALFORMED_URL: Environment variable '${varName}' is not a valid absolute URL.`);
  }

  const normalizedHost = parsed.hostname.toLowerCase();
  for (const prodId of PROD_IDENTIFIERS) {
    if (normalizedHost === prodId || normalizedHost.endsWith(`.${prodId}`)) {
      throw new Error(`PRODUCTION_TARGET_REFUSED: ${varName} host matches production host '${prodId}'.`);
    }
  }

  const fullUrlLower = rawUrl.toLowerCase();
  for (const prodId of PROD_IDENTIFIERS) {
    if (fullUrlLower.includes(prodId.toLowerCase())) {
      throw new Error(`PRODUCTION_TARGET_REFUSED: ${varName} contains forbidden production identifier '${prodId}'.`);
    }
  }

  return parsed;
}

function validateStagingEnvironment(env = process.env) {
  if (env.ALLOW_DISPOSABLE_STAGING_TEST !== 'true') {
    throw new Error("STAGING_AUTHORIZATION_REQUIRED: Execution refused. ALLOW_DISPOSABLE_STAGING_TEST must be explicitly set to 'true'.");
  }

  const expectedProjectId = env.EXPECTED_STAGING_PROJECT_ID;
  if (!expectedProjectId || typeof expectedProjectId !== 'string' || !expectedProjectId.trim()) {
    throw new Error('STAGING_AUTHORIZATION_REQUIRED: EXPECTED_STAGING_PROJECT_ID must be provided and non-empty.');
  }

  const expectedGitSha = env.EXPECTED_STAGING_GIT_SHA;
  if (!expectedGitSha || typeof expectedGitSha !== 'string' || !expectedGitSha.trim()) {
    throw new Error('STAGING_AUTHORIZATION_REQUIRED: EXPECTED_STAGING_GIT_SHA must be provided and non-empty.');
  }

  const required = [
    'STAGING_DATABASE_URL',
    'STAGING_API_URL',
    'STAGING_SERVICE_ROLE_KEY'
  ];

  for (const varName of required) {
    const val = env[varName];
    if (!val || typeof val !== 'string' || !val.trim()) {
      throw new Error(`MISSING_REQUIRED_STAGING_VARIABLE: Environment variable '${varName}' must be provided and non-empty.`);
    }
  }

  const dbUrl = env.STAGING_DATABASE_URL.trim();
  const apiUrl = env.STAGING_API_URL.trim();
  const serviceKey = env.STAGING_SERVICE_ROLE_KEY.trim();

  parseAndValidateUrl(dbUrl, 'STAGING_DATABASE_URL');
  const parsedApi = parseAndValidateUrl(apiUrl, 'STAGING_API_URL');
  if (!['http:', 'https:'].includes(parsedApi.protocol)) {
    throw new Error('INVALID_PROTOCOL: STAGING_API_URL must use http: or https: protocol.');
  }

  if (env.DATABASE_URL && dbUrl === env.DATABASE_URL.trim()) {
    throw new Error('PRODUCTION_TARGET_REFUSED: STAGING_DATABASE_URL is identical to ambient production DATABASE_URL.');
  }

  return {
    valid: true,
    expectedProjectId: expectedProjectId.trim(),
    expectedGitSha: expectedGitSha.trim(),
    dbTargetRedacted: redactSecretString(dbUrl),
    apiTarget: apiUrl,
    apiHost: parsedApi.hostname,
    keyConfigured: Boolean(serviceKey)
  };
}

function validateDatabaseMarkerRecord(marker, expectedProjectId, harnessStartIso) {
  if (!marker) {
    throw new Error(`POSITIVE_ATTESTATION_FAILED: Pre-provisioned marker for staging project '${expectedProjectId}' not found.`);
  }

  if (marker.is_disposable_staging !== true) {
    throw new Error('POSITIVE_ATTESTATION_FAILED: Target database is not flagged as disposable staging.');
  }

  if (!marker.staging_project_id || marker.staging_project_id !== expectedProjectId) {
    throw new Error(`POSITIVE_ATTESTATION_FAILED: Staging project ID mismatch. Expected '${expectedProjectId}', got '${marker.staging_project_id}'.`);
  }

  if (!marker.database_identity_hash || !String(marker.database_identity_hash).trim()) {
    throw new Error('POSITIVE_ATTESTATION_FAILED: Database identity hash is missing or blank.');
  }

  if (!marker.attestation_nonce || !String(marker.attestation_nonce).trim()) {
    throw new Error('POSITIVE_ATTESTATION_FAILED: Attestation nonce is missing or blank.');
  }

  if (!marker.schema_version || !String(marker.schema_version).trim()) {
    throw new Error('POSITIVE_ATTESTATION_FAILED: Schema version is missing or blank.');
  }

  const markerCreatedIso = new Date(marker.created_at).toISOString();
  if (markerCreatedIso >= harnessStartIso) {
    throw new Error(`POSITIVE_ATTESTATION_FAILED: Marker creation timestamp (${markerCreatedIso}) does not predate harness start (${harnessStartIso}).`);
  }

  return true;
}

function validatePositiveApiAttestationResponse(apiData, dbMarker, expectedProjectId, expectedGitSha) {
  if (!apiData || typeof apiData !== 'object') {
    throw new Error('ATTESTATION_MISMATCH: API attestation response is not a valid JSON object.');
  }

  if (apiData.status !== 'ok') {
    throw new Error(`ATTESTATION_MISMATCH: API returned non-ok status: ${JSON.stringify(apiData)}`);
  }

  if (apiData.staging_project_id !== expectedProjectId) {
    throw new Error(`ATTESTATION_MISMATCH: API staging project (${apiData.staging_project_id}) != expected (${expectedProjectId})`);
  }

  if (apiData.database_identity_hash !== dbMarker.database_identity_hash) {
    throw new Error('ATTESTATION_MISMATCH: API database identity hash != database marker.');
  }

  if (apiData.attestation_nonce !== dbMarker.attestation_nonce) {
    throw new Error('ATTESTATION_MISMATCH: API attestation nonce != database marker nonce.');
  }

  if (!expectedGitSha) {
    throw new Error('ATTESTATION_FAILED: EXPECTED_STAGING_GIT_SHA is mandatory for identity verification.');
  }

  if (apiData.git_sha !== expectedGitSha) {
    throw new Error(`ATTESTATION_MISMATCH: API deployed git SHA (${apiData.git_sha}) != expected commit (${expectedGitSha}).`);
  }

  if (apiData.schema_version !== dbMarker.schema_version) {
    throw new Error(`ATTESTATION_MISMATCH: API schema version (${apiData.schema_version}) != database marker (${dbMarker.schema_version}).`);
  }

  const validEnvs = new Set(['preview', 'staging', 'disposable-staging']);
  if (!apiData.deployment_environment || !validEnvs.has(apiData.deployment_environment.toLowerCase())) {
    throw new Error(`ATTESTATION_MISMATCH: Invalid deployment environment '${apiData.deployment_environment}'. Expected preview/staging/disposable-staging.`);
  }

  if (apiData.canary_contract_version !== 'v2.0') {
    throw new Error(`ATTESTATION_MISMATCH: Unexpected canary contract version '${apiData.canary_contract_version}'. Expected 'v2.0'.`);
  }

  return true;
}

function isKeysetTupleOrderValid(a, b) {
  // Tuple: (priced_rank ASC, image_rank ASC, price_usd DESC NULLS LAST, source_created_at DESC, listing_id ASC)
  if (a.priced_rank !== b.priced_rank) {
    return a.priced_rank < b.priced_rank;
  }
  if (a.image_rank !== b.image_rank) {
    return a.image_rank < b.image_rank;
  }

  const pA = a.price_usd != null ? Number(a.price_usd) : null;
  const pB = b.price_usd != null ? Number(b.price_usd) : null;
  if (pA !== null && pB !== null) {
    if (pA !== pB) return pA > pB;
  } else if (pA !== null && pB === null) {
    return true; // Not null comes before null (DESC NULLS LAST)
  } else if (pA === null && pB !== null) {
    return false; // Null comes after not null
  }

  const tA = new Date(a.source_created_at).getTime();
  const tB = new Date(b.source_created_at).getTime();
  if (tA !== tB) {
    return tA > tB; // source_created_at DESC
  }

  return String(a.listing_id) <= String(b.listing_id); // listing_id ASC
}

function verifyPageKeysetOrdering(records, prevPageLastRecord = null) {
  if (prevPageLastRecord && records.length > 0) {
    if (!isKeysetTupleOrderValid(prevPageLastRecord, records[0])) {
      throw new Error(`KEYSET_ORDER_VIOLATION: Cross-page order invalid between '${prevPageLastRecord.listing_id}' and '${records[0].listing_id}'`);
    }
  }

  for (let i = 0; i < records.length - 1; i++) {
    if (!isKeysetTupleOrderValid(records[i], records[i + 1])) {
      throw new Error(`KEYSET_ORDER_VIOLATION: In-page order invalid at index ${i} between '${records[i].listing_id}' and '${records[i + 1].listing_id}'`);
    }
  }

  return true;
}

function calculatePaginationIdentityLedger(seenIds, baselineIds, mutatedIds = new Set(), insertedIds = new Set()) {
  const seenCount = new Map();
  for (const id of seenIds) {
    seenCount.set(id, (seenCount.get(id) || 0) + 1);
  }

  const duplicates = [];
  for (const [id, count] of seenCount.entries()) {
    if (count > 1) duplicates.push(id);
  }

  const baselineSet = new Set(baselineIds);
  const unmutatedBaselineIds = baselineIds.filter(id => !mutatedIds.has(id));
  const missingUnmutatedBaseline = unmutatedBaselineIds.filter(id => !seenCount.has(id));

  const unexpectedIds = seenIds.filter(id => !baselineSet.has(id) && !insertedIds.has(id));

  return {
    duplicate_ids: duplicates,
    missing_baseline_ids: missingUnmutatedBaseline,
    unexpected_ids: unexpectedIds,
    is_valid: duplicates.length === 0 && missingUnmutatedBaseline.length === 0 && unexpectedIds.length === 0
  };
}

function reconcileDuplicateObservations(observations) {
  if (!Array.isArray(observations) || observations.length === 0) {
    throw new Error('INVALID_OBSERVATIONS: Observations must be a non-empty array.');
  }

  const sourceId = observations[0].source_id;
  const hashes = new Set(observations.map(o => o.source_hash));

  if (hashes.size === 1) {
    const canonicalHash = observations[0].source_hash;
    const proposal = {
      source_id: sourceId,
      source_hash: canonicalHash,
      brand: observations[0].brand || null,
      reference: observations[0].reference || null,
      price_usd: observations[0].price_usd || null,
      status: 'CANONICAL_CANDIDATE'
    };
    return {
      source_id: sourceId,
      distinct_hashes_count: 1,
      raw_observations_count: observations.length,
      status: 'IDENTICAL_DUPLICATE_RECONCILED',
      proposals: [proposal],
      duplicates_count: observations.length - 1,
      quarantined_count: 0
    };
  }

  return {
    source_id: sourceId,
    distinct_hashes_count: hashes.size,
    raw_observations_count: observations.length,
    status: 'SOURCE_HASH_REVISION_CONFLICT',
    proposals: [],
    duplicates_count: 0,
    quarantined_count: 1,
    quarantine_record: {
      source_id: sourceId,
      conflict_reason: 'SOURCE_HASH_REVISION_CONFLICT',
      distinct_hashes: Array.from(hashes),
      remediation_status: 'PENDING_HUMAN_REVIEW'
    }
  };
}

function verifyProvenanceContractFields(rawRow, propRow, canaryRow, viewRow, apiRow, fields = CONTRACT_FIELDS) {
  if (!fields || fields.length === 0) {
    throw new Error('PROVENANCE_ERROR: Contract fields array must be non-empty.');
  }

  const fieldMatrix = [];
  for (const fieldName of fields) {
    const rawVal = rawRow[fieldName] !== undefined ? rawRow[fieldName] : null;
    const propVal = propRow[fieldName] !== undefined ? propRow[fieldName] : null;
    const canaryVal = canaryRow[fieldName] !== undefined ? canaryRow[fieldName] : null;
    const viewVal = viewRow[fieldName] !== undefined ? viewRow[fieldName] : null;

    // API field mapping normalization
    let apiVal = apiRow[fieldName] !== undefined ? apiRow[fieldName] : null;
    if (fieldName === 'price_usd' && apiRow.price !== undefined) {
      apiVal = apiRow.price;
    } else if (fieldName === 'seller_display_name' && apiRow.sellerName !== undefined) {
      apiVal = apiRow.sellerName;
    } else if (fieldName === 'image_url' && apiRow.imageUrl !== undefined) {
      apiVal = apiRow.imageUrl;
    }

    // Number normalization for prices
    const normCanary = (fieldName === 'price_usd' && canaryVal != null) ? Number(canaryVal) : canaryVal;
    const normView = (fieldName === 'price_usd' && viewVal != null) ? Number(viewVal) : viewVal;
    const normApi = (fieldName === 'price_usd' && apiVal != null) ? Number(apiVal) : apiVal;

    // Check consistency across populated tiers
    if (canaryVal !== null && viewVal !== null && normCanary !== normView) {
      throw new Error(`PROVENANCE_FIELD_MISMATCH on '${fieldName}': canary=${normCanary} != view=${normView}`);
    }
    if (viewVal !== null && apiVal !== null && normView !== normApi) {
      throw new Error(`PROVENANCE_FIELD_MISMATCH on '${fieldName}': view=${normView} != api=${normApi}`);
    }

    fieldMatrix.push({
      field: fieldName,
      raw: rawVal,
      proposal: propVal,
      canary: canaryVal,
      view: viewVal,
      api: apiVal,
      verified: true
    });
  }

  // Ensure unobserved facts remain null
  const nullFacts = ['seller_display_name', 'seller_id', 'location_country'];
  for (const fact of nullFacts) {
    if (viewRow[fact] !== null && viewRow[fact] !== undefined && !rawRow[fact]) {
      throw new Error(`PROVENANCE_FACT_FABRICATED: Field '${fact}' must remain null when unobserved, but found '${viewRow[fact]}'.`);
    }
  }

  return {
    verified: true,
    verified_fields_count: fieldMatrix.length,
    field_matrix: fieldMatrix
  };
}

function verifyRunOwnershipAndCleanup(targetRunId, activeRunId, executeDeleteFn) {
  if (!targetRunId || typeof targetRunId !== 'string' || !targetRunId.startsWith('synth_')) {
    throw new Error(`CLEANUP_REFUSED: Invalid run ID '${targetRunId}'. Ownership cannot be proven.`);
  }

  if (targetRunId !== activeRunId) {
    throw new Error(`CLEANUP_REFUSED: Object ownership check failed for run '${targetRunId}'. Must match active run '${activeRunId}'.`);
  }

  const result = executeDeleteFn(targetRunId);
  if (!result || result.residual_rows > 0) {
    throw new Error(`CLEANUP_FAILED: Residual rows detected after cleanup for run '${targetRunId}'.`);
  }

  return { cleaned: true, deleted_count: result.deleted_count };
}

function scanFullResponseForPii(serializedPayload, sensitiveTokens = []) {
  if (typeof serializedPayload !== 'string') {
    serializedPayload = JSON.stringify(serializedPayload);
  }

  const findings = [];
  for (const token of sensitiveTokens) {
    if (token && typeof token === 'string' && token.trim().length > 3) {
      if (serializedPayload.includes(token.trim())) {
        findings.push(token.trim());
      }
    }
  }

  const phonePattern = /(?:\+?\d{1,3}[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/g;
  const emailPattern = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
  const telegramPattern = /t\.me\/[a-zA-Z0-9_]+/gi;

  const phones = serializedPayload.match(phonePattern) || [];
  const emails = serializedPayload.match(emailPattern) || [];
  const tele = serializedPayload.match(telegramPattern) || [];
  const rawKeyPatterns = ['private_phone', 'private_email', 'private_telegram', 'raw_payload'];
  const rawKeysLeaked = rawKeyPatterns.filter(k => serializedPayload.includes(`"${k}"`));

  return {
    leaked: findings.length > 0 || phones.length > 0 || emails.length > 0 || tele.length > 0 || rawKeysLeaked.length > 0,
    matchedTokensCount: findings.length,
    detectedPhonesCount: phones.length,
    detectedEmailsCount: emails.length,
    detectedTelegramCount: tele.length,
    raw_keys_leaked: rawKeysLeaked
  };
}

function buildChildEnvironment(env = process.env) {
  validateStagingEnvironment(env);

  const sanitized = {
    ALLOW_DISPOSABLE_STAGING_TEST: 'true',
    EXPECTED_STAGING_PROJECT_ID: env.EXPECTED_STAGING_PROJECT_ID.trim(),
    EXPECTED_STAGING_GIT_SHA: env.EXPECTED_STAGING_GIT_SHA.trim(),
    STAGING_DATABASE_URL: env.STAGING_DATABASE_URL.trim(),
    STAGING_API_URL: env.STAGING_API_URL.trim(),
    STAGING_SERVICE_ROLE_KEY: env.STAGING_SERVICE_ROLE_KEY.trim(),
    PYTHONUNBUFFERED: '1'
  };

  if (process.env.PATH) sanitized.PATH = process.env.PATH;
  if (process.env.SYSTEMROOT) sanitized.SYSTEMROOT = process.env.SYSTEMROOT;
  if (process.env.TEMP) sanitized.TEMP = process.env.TEMP;
  if (process.env.TMP) sanitized.TMP = process.env.TMP;

  return sanitized;
}

function runStagingValidationHarness(env = process.env, options = {}) {
  const childEnv = buildChildEnvironment(env);
  const pyScript = path.resolve(__dirname, 'staging_validation_harness.py');

  try {
    const stdout = execFileSync('python', ['-u', pyScript], {
      env: childEnv,
      encoding: 'utf-8',
      maxBuffer: 20 * 1024 * 1024,
      timeout: options.timeoutMs || 120000
    });
    return JSON.parse(stdout.trim());
  } catch (err) {
    const safeError = redactSecretString(err.message || String(err));
    throw new Error(`STAGING_HARNESS_EXECUTION_FAILED: ${safeError}`);
  }
}

module.exports = {
  PROD_IDENTIFIERS,
  CONTRACT_FIELDS,
  calculateCanonicalPayloadHash,
  redactSecretString,
  parseAndValidateUrl,
  validateStagingEnvironment,
  validateDatabaseMarkerRecord,
  validatePositiveApiAttestationResponse,
  isKeysetTupleOrderValid,
  verifyPageKeysetOrdering,
  calculatePaginationIdentityLedger,
  reconcileDuplicateObservations,
  verifyProvenanceContractFields,
  verifyRunOwnershipAndCleanup,
  scanFullResponseForPii,
  buildChildEnvironment,
  runStagingValidationHarness
};
