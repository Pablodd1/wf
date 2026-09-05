'use strict';

const crypto = require('node:crypto');

function sha256(content) {
  return crypto.createHash('sha256').update(content).digest('hex');
}

function stableJson(obj) {
  if (obj === null || typeof obj !== 'object') return JSON.stringify(obj);
  if (obj instanceof Date) return JSON.stringify(obj.toISOString());
  if (Array.isArray(obj)) return '[' + obj.map(stableJson).join(',') + ']';
  const keys = Object.keys(obj).sort();
  return '{' + keys.map(k => JSON.stringify(k) + ':' + stableJson(obj[k])).join(',') + '}';
}

function canonicalizeRawPayload(rawData) {
  return stableJson(rawData || {});
}

/**
 * Inspects a raw MariaDB object for null characters (\\u0000 / \\0).
 * If found, produces a lossless audit envelope preserving original canonical payload in Base64,
 * recording character positions, and computing the source_hash strictly from the
 * original canonicalized decoded source representation.
 */
function sanitizeLosslessPayload(rawObj) {
  if (!rawObj || typeof rawObj !== 'object') {
    const rawText = canonicalizeRawPayload(rawObj);
    return {
      isModified: false,
      hasNullBytes: false,
      originalHash: sha256(rawText),
      transportHash: sha256(rawText),
      sanitizedObj: rawObj,
      metadata: null,
      originalPayloadText: rawText,
      transportPayloadText: rawText
    };
  }

  const originalPayloadText = canonicalizeRawPayload(rawObj);
  const originalHash = sha256(originalPayloadText);

  // Deep inspect for null characters
  const affectedFields = [];
  const characterPositions = {};
  let totalNullCount = 0;

  function inspectValue(val, keyPath) {
    if (typeof val === 'string' && (val.includes('\0') || val.includes('\\u0000'))) {
      const positions = [];
      for (let i = 0; i < val.length; i++) {
        if (val.charCodeAt(i) === 0) positions.push(i);
      }
      if (positions.length > 0) {
        affectedFields.push(keyPath);
        characterPositions[keyPath] = positions;
        totalNullCount += positions.length;
      }
    } else if (val && typeof val === 'object' && !Array.isArray(val) && !(val instanceof Date)) {
      for (const [k, v] of Object.entries(val)) {
        inspectValue(v, keyPath ? keyPath + '.' + k : k);
      }
    } else if (Array.isArray(val)) {
      val.forEach((item, idx) => inspectValue(item, keyPath + '[' + idx + ']'));
    }
  }

  inspectValue(rawObj, '');

  if (totalNullCount === 0) {
    return {
      isModified: false,
      hasNullBytes: false,
      originalHash,
      transportHash: originalHash,
      sanitizedObj: rawObj,
      metadata: null,
      originalPayloadText,
      transportPayloadText: originalPayloadText
    };
  }

  // Sanitize object for JSON/PostgreSQL transport: strip \\u0000 characters
  function sanitizeValue(val) {
    if (typeof val === 'string') {
      return val.replace(/\0/g, '').replace(/\\u0000/g, '');
    }
    if (val instanceof Date) return val;
    if (Array.isArray(val)) return val.map(sanitizeValue);
    if (val && typeof val === 'object') {
      const clone = {};
      for (const [k, v] of Object.entries(val)) {
        clone[k] = sanitizeValue(v);
      }
      return clone;
    }
    return val;
  }

  const sanitizedObj = sanitizeValue(rawObj);
  const originalPayloadBase64 = Buffer.from(originalPayloadText, 'utf8').toString('base64');
  const transportPayloadText = canonicalizeRawPayload(sanitizedObj);
  const transportHash = sha256(transportPayloadText);

  const metadata = {
    has_null_bytes: true,
    classification: 'CAPTURE_ERROR_LOSSLESS_EVIDENCE',
    affected_fields: affectedFields,
    null_byte_count: totalNullCount,
    character_positions: characterPositions,
    method: 'STRIP_NULL_BYTES_AND_PRESERVE_ORIGINAL_BASE64',
    parser_version: 'v1-lossless-null-sanitized',
    original_hash: originalHash,
    transport_hash: transportHash,
    original_payload_base64: originalPayloadBase64,
    remediation_status: 'CAPTURE_ERROR_LOSSLESS_EVIDENCE_PRESERVED'
  };

  // Embed lossless metadata in the sanitized JSON object
  sanitizedObj._lossless_raw_evidence = metadata;

  return {
    isModified: true,
    hasNullBytes: true,
    originalHash,
    transportHash,
    sanitizedObj,
    metadata,
    originalPayloadText,
    transportPayloadText
  };
}

module.exports = {
  sha256,
  stableJson,
  canonicalizeRawPayload,
  sanitizeLosslessPayload
};
