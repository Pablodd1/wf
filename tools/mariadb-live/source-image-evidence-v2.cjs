'use strict';
const crypto = require('node:crypto');
const { verifySourceContent } = require('./content-provenance.cjs');
const { stableJson } = require('./lossless-payload-sanitizer.cjs');
const { constructCandidateImageUrl, DO_SPACES_BASE } = require('../../shared/listing-display-contract.cjs');
const hash = value => crypto.createHash('sha256').update(value).digest('hex');

function imageSignature(bytes) {
  return (bytes.length >= 8 && bytes.subarray(0,8).equals(Buffer.from('89504e470d0a1a0a','hex')))
    || (bytes.length >= 3 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255)
    || (bytes.length >= 6 && /^GIF8[79]a$/.test(bytes.subarray(0,6).toString('ascii')))
    || (bytes.length >= 12 && bytes.subarray(0,4).toString('ascii') === 'RIFF' && bytes.subarray(8,12).toString('ascii') === 'WEBP');
}
async function prefix(response) {
  const reader = response.body?.getReader();
  if (!reader) throw new Error('IMAGE_BODY_UNAVAILABLE');
  const chunks = []; let total = 0;
  try {
    while (total < 4096) {
      const { done, value } = await reader.read(); if (done) break;
      const bytes = Buffer.from(value).subarray(0,4096-total); chunks.push(bytes); total += bytes.length;
    }
  } finally { await reader.cancel(); }
  return Buffer.concat(chunks);
}

async function captureSourceImageEvidence(raw, options = {}) {
  if (verifySourceContent(raw).lossless) throw new Error('PROVENANCE_LOSSLESS_REVIEW_REQUIRED');
  const key = raw.raw_payload.front_image || raw.raw_payload.image || null;
  if (!key) return { outcome: 'NO_SOURCE_IMAGE', proof: null };
  if (typeof key !== 'string' || Buffer.byteLength(key.trim()) > 2048) return { outcome: 'SOURCE_IMAGE_KEY_REQUIRES_REVIEW', proof: null };
  const candidate = constructCandidateImageUrl(key);
  if (!candidate) return { outcome: 'SOURCE_IMAGE_KEY_REQUIRES_REVIEW', proof: null };
  let url = candidate, disposable = false;
  if (options.disposableBase) {
    const base = new URL(options.disposableBase);
    if (raw.raw_payload.synthetic_fixture !== true || base.protocol !== 'https:'
      || !base.hostname.endsWith('.trycloudflare.com') || base.username || base.password || base.port
      || base.pathname !== '/images' || base.search || base.hash) throw new Error('DISPOSABLE_IMAGE_ORIGIN_REFUSED');
    url = base.href.replace(/\/$/,'') + candidate.slice(DO_SPACES_BASE.length); disposable = true;
  }
  const fetchImpl = options.fetchImpl || fetch;
  const document = { contract: 'wf-source-image-evidence-v2', raw_row_id: raw.id, source_id: raw.source_id,
    source_hash: raw.source_hash, image_key: key, candidate_url: candidate, verified_url: url,
    disposable, checked_at: (options.now || new Date()).toISOString(), head_status: 0, get_status: 0,
    head_content_type: null, get_content_type: null, body_prefix_sha256: null, body_prefix_bytes: 0, body_signature_verified: false };
  try {
    const head = await fetchImpl(url, { method: 'HEAD', redirect: 'error', signal: AbortSignal.timeout(8000) });
    document.head_status = head.status; document.head_content_type = head.headers.get('content-type');
    const response = await fetchImpl(url, { method: 'GET', redirect: 'error', headers: { Range: 'bytes=0-4095' }, signal: AbortSignal.timeout(8000) });
    document.get_status = response.status; document.get_content_type = response.headers.get('content-type');
    const bytes = await prefix(response);
    document.body_prefix_sha256 = hash(bytes); document.body_prefix_bytes = bytes.length; document.body_signature_verified = imageSignature(bytes);
  } catch { /* Retain unsuccessful probe evidence; never guess reachability. */ }
  const canonical = stableJson(document);
  const verified = document.head_status === 200 && [200,206].includes(document.get_status)
    && document.head_content_type?.startsWith('image/') && document.get_content_type?.startsWith('image/')
    && document.body_signature_verified;
  return { outcome: verified ? 'VERIFIED_SOURCE_IMAGE' : 'SOURCE_IMAGE_UNAVAILABLE',
    proof: { document, canonical_json: canonical, evidence_hash: hash(canonical) } };
}
module.exports = { captureSourceImageEvidence, imageSignature };
