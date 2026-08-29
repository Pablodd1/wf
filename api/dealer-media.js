'use strict';

const crypto = require('node:crypto');
const { authorizeDealer } = require('./_lib/dealer-auth.cjs');

const BUCKET = 'dealer-listing-media';
const TYPES = new Map([
  ['image/jpeg', 'jpg'],
  ['image/png', 'png'],
  ['image/webp', 'webp'],
  ['image/heic', 'heic'],
  ['image/heif', 'heif'],
]);

function sameOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return true;
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  try { return new URL(origin).host === host; } catch { return false; }
}

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'private, no-store');
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (!sameOrigin(req)) return res.status(403).json({ error: 'Invalid request origin.' });

  const authorization = await authorizeDealer(req, res);
  if (authorization.error) return res.status(authorization.status).json({ error: authorization.error });

  const contentType = String(req.body?.content_type || '').toLowerCase();
  const byteSize = Number(req.body?.byte_size);
  const kind = req.body?.kind === 'poster' ? 'poster' : 'listing';
  if (!TYPES.has(contentType)) return res.status(400).json({ error: 'Use a JPG, PNG, WebP, HEIC, or HEIF image.' });
  if (!Number.isInteger(byteSize) || byteSize < 1 || byteSize > 8 * 1024 * 1024) {
    return res.status(400).json({ error: 'Each image must be 8 MB or smaller.' });
  }

  const path = `${authorization.user.id}/${kind}/${crypto.randomUUID()}.${TYPES.get(contentType)}`;
  const { data, error } = await authorization.client.storage.from(BUCKET).createSignedUploadUrl(path);
  if (error || !data?.signedUrl) return res.status(500).json({ error: 'Unable to prepare image upload.' });
  const { data: publicData } = authorization.client.storage.from(BUCKET).getPublicUrl(path);
  return res.status(200).json({ success: true, signedUrl: data.signedUrl, publicUrl: publicData.publicUrl, path });
};

module.exports.BUCKET = BUCKET;
module.exports.TYPES = TYPES;
