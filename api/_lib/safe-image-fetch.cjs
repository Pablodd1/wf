'use strict';

const dns = require('node:dns').promises;
const net = require('node:net');

const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

function isPrivateAddress(address) {
  if (net.isIPv4(address)) {
    const [a, b] = address.split('.').map(Number);
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254)
      || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)
      || (a === 100 && b >= 64 && b <= 127) || a >= 224;
  }
  if (net.isIPv6(address)) {
    const normalized = address.toLowerCase();
    return normalized === '::1' || normalized === '::' || normalized.startsWith('fc')
      || normalized.startsWith('fd') || normalized.startsWith('fe8')
      || normalized.startsWith('fe9') || normalized.startsWith('fea')
      || normalized.startsWith('feb');
  }
  return true;
}

async function validatePublicHttpsUrl(value) {
  let url;
  try { url = new URL(String(value || '').trim()); } catch { throw new Error('Invalid image URL'); }
  if (url.protocol !== 'https:' || url.username || url.password) throw new Error('Image URL must use HTTPS');
  if (url.port && url.port !== '443') throw new Error('Image URL uses a disallowed port');
  const addresses = await dns.lookup(url.hostname, { all: true, verbatim: true });
  if (!addresses.length || addresses.some(item => isPrivateAddress(item.address))) {
    throw new Error('Image URL resolves to a private or reserved network');
  }
  return url;
}

async function readLimited(response, maxBytes) {
  const declared = Number(response.headers.get('content-length') || 0);
  if (declared > maxBytes) throw new Error('Image exceeds the 10 MB limit');
  const reader = response.body?.getReader();
  if (!reader) {
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.length > maxBytes) throw new Error('Image exceeds the 10 MB limit');
    return buffer;
  }
  const chunks = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new Error('Image exceeds the 10 MB limit');
    }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks, total);
}

async function fetchPublicImage(value, { maxBytes = MAX_IMAGE_BYTES, redirects = 3 } = {}) {
  let url = await validatePublicHttpsUrl(value);
  for (let hop = 0; hop <= redirects; hop += 1) {
    const response = await fetch(url, {
      redirect: 'manual',
      signal: AbortSignal.timeout(15000),
      headers: { Accept: 'image/jpeg,image/png,image/webp,image/*;q=0.8' },
    });
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location');
      if (!location || hop === redirects) throw new Error('Image redirect limit exceeded');
      url = await validatePublicHttpsUrl(new URL(location, url).toString());
      continue;
    }
    if (!response.ok) throw new Error(`Image fetch failed: ${response.status}`);
    const mime = String(response.headers.get('content-type') || '').split(';')[0].toLowerCase();
    if (!mime.startsWith('image/')) throw new Error('Remote resource is not an image');
    return { buffer: await readLimited(response, maxBytes), mime, finalUrl: url.toString() };
  }
  throw new Error('Image fetch failed');
}

module.exports = { fetchPublicImage, isPrivateAddress, validatePublicHttpsUrl };

