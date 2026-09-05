'use strict';

const { createHash } = require('node:crypto');

const CORRECTION_FIELDS = new Set([
  'brand',
  'reference',
  'dial_color',
  'condition',
  'year',
  'price_raw',
  'price_usd',
  'currency',
  'listing_type',
]);
const NUMERIC_FIELDS = new Set(['year', 'price_raw', 'price_usd']);
const SHA256 = /^[a-f0-9]{64}$/i;
const SAFE_ID = /^[A-Za-z0-9:_-]{1,180}$/;

function sha256(value) {
  return createHash('sha256').update(String(value ?? ''), 'utf8').digest('hex');
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, stableValue(value[key])]));
  }
  return value;
}

function proposalSha256(value) {
  return sha256(JSON.stringify(stableValue(value)));
}

function maskName(value) {
  return String(value || '').trim().split(/\s+/).filter(Boolean)
    .map(part => `${part[0]}***`).join(' ') || null;
}

function maskPhone(value) {
  const digits = String(value || '').replace(/\D/g, '');
  return digits ? `***${digits.slice(-4)}` : null;
}

function sameOrigin(req) {
  const origin = req.headers?.origin;
  if (!origin) return true;
  const host = req.headers?.['x-forwarded-host'] || req.headers?.host;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

function boundedInteger(value, fallback, minimum, maximum) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? Math.max(minimum, Math.min(parsed, maximum)) : fallback;
}

function validId(value) {
  const id = String(value || '').trim();
  return SAFE_ID.test(id) ? id : null;
}

function validateCorrection(body) {
  const decision = String(body?.decision || '').trim().toUpperCase();
  if (decision !== 'CORRECTION_PROPOSED') return { error: 'decision must be CORRECTION_PROPOSED' };

  const fields = body?.fields;
  if (!fields || Array.isArray(fields) || typeof fields !== 'object') {
    return { error: 'fields must be a structured object' };
  }
  const entries = Object.entries(fields);
  if (!entries.length || entries.some(([key]) => !CORRECTION_FIELDS.has(key))) {
    return { error: 'fields contains no supported correction' };
  }

  const normalized = {};
  for (const [key, value] of entries) {
    if (value === null) {
      normalized[key] = null;
      continue;
    }
    if (NUMERIC_FIELDS.has(key)) {
      if (typeof value !== 'number' || !Number.isFinite(value) || (key === 'year' && !Number.isInteger(value))) {
        return { error: `${key} must be a finite number or null` };
      }
      if (key === 'year' && (value < 1000 || value > new Date().getUTCFullYear() + 1)) {
        return { error: 'year is outside the supported range' };
      }
      if (key !== 'year' && value <= 0) return { error: `${key} must be positive or null` };
      normalized[key] = value;
      continue;
    }
    if (typeof value !== 'string' || !value.trim() || value.trim().length > 200) {
      return { error: `${key} must be a non-empty string of at most 200 characters or null` };
    }
    normalized[key] = value.trim();
  }

  const rationale = String(body?.rationale || '').trim();
  if (rationale.length < 10 || rationale.length > 2000) {
    return { error: 'rationale must contain 10 to 2000 characters' };
  }
  const expectedRawSha256 = String(body?.expectedRawSha256 || '').trim().toLowerCase();
  const expectedProposalSha256 = String(body?.expectedProposalSha256 || '').trim().toLowerCase();
  if (!SHA256.test(expectedRawSha256) || !SHA256.test(expectedProposalSha256)) {
    return { error: 'expected evidence hashes must be SHA-256 values' };
  }
  const evidenceHashes = [...new Set((Array.isArray(body?.evidenceHashes) ? body.evidenceHashes : [])
    .map(value => String(value || '').trim().toLowerCase()))];
  if (evidenceHashes.length < 2 || evidenceHashes.length > 10 || evidenceHashes.some(value => !SHA256.test(value))) {
    return { error: 'evidenceHashes must contain 2 to 10 SHA-256 values' };
  }
  if (!evidenceHashes.includes(expectedRawSha256) || !evidenceHashes.includes(expectedProposalSha256)) {
    return { error: 'evidenceHashes must include the expected raw and proposal hashes' };
  }

  return {
    value: {
      decision,
      fields: normalized,
      rationale,
      expectedRawSha256,
      expectedProposalSha256,
      evidenceHashes,
    },
  };
}

module.exports = {
  CORRECTION_FIELDS,
  boundedInteger,
  maskName,
  maskPhone,
  proposalSha256,
  sameOrigin,
  sha256,
  stableValue,
  validId,
  validateCorrection,
};
