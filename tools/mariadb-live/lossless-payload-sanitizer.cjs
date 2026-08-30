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
 * Inspects a raw MariaDB object for null bytes (\\u0000 / \\0).
 * If found, produces a lossless audit envelope preserving original bytes in Base64
 * and computing the source_hash strictly from original unmodified bytes.
 */
function sanitizeLosslessPayload(rawObj) {
  if (!rawObj || typeof rawObj !== 'object') {
    const rawText = canonicalizeRawPayload(rawObj);
    return {
      isModified: false,
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

  // Deep inspect for null bytes
  const affectedFields = [];
  const bytePositions = {};
  let totalNullBytes = 0;

  function inspectValue(val, keyPath) {
    if (typeof val === 'string' && (val.includes('\0') || val.includes('\\u0000'))) {
      const positions = [];
      for (let i = 0; i < val.length; i++) {
        if (val.charCodeAt(i) === 0) positions.push(i);
      }
      if (positions.length > 0) {
        affectedFields.push(keyPath);
        bytePositions[keyPath] = positions;
        totalNullBytes += positions.length;
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

  if (totalNullBytes === 0) {
    return {
      isModified: false,
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

  const metadata = {
    has_null_bytes: true,
    affected_fields: affectedFields,
    null_byte_count: totalNullBytes,
    byte_positions: bytePositions,
    method: 'STRIP_NULL_BYTES_AND_PRESERVE_ORIGINAL_BASE64',
    parser_version: 'v1-lossless-null-sanitized',
    original_hash: originalHash,
    transport_hash: sha256(canonicalizeRawPayload(sanitizedObj)),
    original_payload_base64: originalPayloadBase64
  };

  // Embed lossless metadata in the sanitized JSON object
  sanitizedObj._lossless_raw_evidence = metadata;

  const transportPayloadText = canonicalizeRawPayload(sanitizedObj);
  const transportHash = sha256(transportPayloadText);

  return {
    isModified: true,
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
