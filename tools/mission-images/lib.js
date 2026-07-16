import path from 'node:path';

const UUID_PATTERN = /(?:^|[^0-9a-f])([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})(?=$|[^0-9a-f])/i;
const HEX_ID_PATTERN = /(?:^|[_/.-])([0-9a-f]{13,24})(?=$|[_/.-])/gi;
const NUMERIC_ID_PATTERN = /(?:^|[_/.-])(\d{1,12})(?=$|[_/.-])/g;

export function extractObjectId(key) {
  const value = String(key || '').trim();
  const uuid = value.match(UUID_PATTERN)?.[1];
  if (uuid) return { id: uuid.toLowerCase(), type: 'uuid' };

  const matches = [...value.matchAll(HEX_ID_PATTERN)];
  const candidate = matches.at(-1)?.[1];
  if (candidate) return { id: candidate.toLowerCase(), type: 'hex' };

  // Legacy listing keys use numeric MySQL IDs, e.g.
  // listings/250/1007_front_image.jpg. The final filename token is the record
  // hint; the preceding directory (250/full/etc.) is a rendition namespace.
  const numericMatches = [...value.matchAll(NUMERIC_ID_PATTERN)];
  const numeric = numericMatches.at(-1)?.[1];
  return numeric ? { id: numeric, type: 'integer' } : null;
}

export function classifyNamespace(key) {
  const normalized = String(key || '').replace(/^\/+/, '').toLowerCase();
  if (normalized.startsWith('auctions/chats/')) return 'auction_chat';
  if (normalized.startsWith('listings/')) return 'listings';
  if (normalized.startsWith('jewelrylistings/')) return 'jewelry_listings';
  if (normalized.startsWith('certifications/')) return 'certifications';
  if (normalized.startsWith('products/')) return 'products';
  return normalized.split('/')[0] || 'unknown';
}

export function classifyMediaKind(key) {
  const extension = path.extname(String(key || '')).toLowerCase();
  if (['.jpg', '.jpeg', '.png', '.webp', '.gif', '.avif', '.heic'].includes(extension)) return 'image';
  if (extension === '.pdf') return 'document';
  if (['.mp4', '.mov', '.webm', '.m4v'].includes(extension)) return 'video';
  return 'other';
}

export function buildPublicUrl(baseUrl, key) {
  const base = String(baseUrl || '').replace(/\/+$/, '');
  const encodedKey = String(key || '')
    .replace(/^\/+/, '')
    .split('/')
    .map(segment => encodeURIComponent(segment))
    .join('/');
  return `${base}/${encodedKey}`;
}

export function toInventoryRow(csvRow, baseUrl) {
  const objectKey = String(csvRow.Key || '').trim();
  const extracted = extractObjectId(objectKey);
  const size = Number(csvRow.Size);
  const lastModified = new Date(csvRow.LastModified);
  return {
    bucket: String(csvRow.Bucket || '').trim(),
    object_key: objectKey,
    size_bytes: Number.isFinite(size) ? size : null,
    last_modified: Number.isNaN(lastModified.getTime()) ? null : lastModified.toISOString(),
    etag: String(csvRow.ETag || '').replace(/^"|"$/g, '').trim() || null,
    public_url: buildPublicUrl(baseUrl, objectKey),
    extracted_id: extracted?.id || null,
    id_type: extracted?.type || null,
    namespace: classifyNamespace(objectKey),
    media_kind: classifyMediaKind(objectKey),
    mapping_status: extracted ? 'PENDING' : 'UNPARSED',
  };
}
