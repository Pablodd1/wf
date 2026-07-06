/**
 * /api/green-api-media.js
 * ========================
 * NEW v4.3: Handles imageMessage / videoMessage from Green API webhooks.
 * Downloads the media via Green API's download endpoint, uploads to Supabase
 * Storage, and links the URL to the matching watch_records row.
 *
 * Deployed alongside green-api-live.js as a dual-webhook pattern:
 *   - green-api-live.js → text messages with watch data
 *   - green-api-media.js → image/video attachments → dealer_photos column
 *
 * Green API Webhook URL: https://watchfacts-poc.vercel.app/api/green-api-media
 *
 * POST /api/green-api-media
 *   Body: { typeWebhook, instanceData, messageData, senderData, timestamp }
 *
 * Green API media messageData fields:
 *   - typeMessage: 'imageMessage' | 'videoMessage' | 'documentMessage'
 *   - fileMessageData.downloadUrl: direct download URL (valid ~24h)
 *   - fileMessageData.fileName, fileMessageData.mimeType, fileMessageData.caption
 *   - senderData.chatId → group ID to correlate with text messages
 */
'use strict';

const { withRateLimit } = require('./_lib/rate-limiter');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const GREEN_API_SECRET = process.env.GREEN_API_SECRET;

const HEADERS = {
  'apikey': SUPABASE_KEY,
  'Authorization': `Bearer ${SUPABASE_KEY}`,
  'Content-Type': 'application/json',
};

function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', process.env.ALLOWED_ORIGIN || '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}

/**
 * Check if this is a media message from Green API (image, video, document).
 */
function isMediaMessage(body) {
  if (!body || body.typeWebhook !== 'incomingMessageReceived') return false;
  if (!body.messageData) return false;
  const type = body.messageData.typeMessage || '';
  return type.includes('image') || type.includes('video') || type.includes('document');
}

/**
 * Extract media metadata from the Green API payload.
 * Returns { downloadUrl, caption, mimeType, fileName, chatId, sender, timestamp }
 * or null if the payload doesn't contain downloadable media.
 */
function extractMediaMetadata(body) {
  try {
    const msg = body.messageData;
    const fileData = msg.fileMessageData || msg.imageMessageData || msg.videoMessageData || {};
    const downloadUrl = fileData.downloadUrl || null;
    if (!downloadUrl) return null;

    return {
      downloadUrl,
      caption: fileData.caption || '',
      mimeType: fileData.mimeType || 'image/jpeg',
      fileName: fileData.fileName || `${Date.now()}.jpg`,
      chatId: body.senderData?.chatId || body.instanceData?.wid || 'unknown',
      sender: body.senderData?.sender || body.senderData?.senderName || 'unknown',
      timestamp: body.timestamp ? body.timestamp * 1000 : Date.now(),
    };
  } catch (e) {
    return null;
  }
}

/**
 * Download media from Green API's temporary URL and upload to Supabase Storage.
 * Green API download URLs are valid ~24h — must download within that window.
 * Saves to: dealer-photos/<chatId>/<timestamp>_<originalFilename>
 */
async function downloadAndUpload(meta) {
  // Step 1: Download from Green API's CDN
  const mediaRes = await fetch(meta.downloadUrl, { timeout: 30000 });
  if (!mediaRes.ok) throw new Error(`Green API download failed: ${mediaRes.status}`);
  const buffer = await mediaRes.arrayBuffer();
  if (!buffer || buffer.byteLength === 0) throw new Error('Empty media response');

  // Step 2: Upload to Supabase Storage
  const storagePath = `dealer-photos/${meta.chatId.replace(/[^a-zA-Z0-9_-]/g, '_')}/${meta.timestamp}_${meta.fileName}`;
  
  const uploadRes = await fetch(
    `${SUPABASE_URL}/storage/v1/object/${storagePath}`,
    {
      method: 'POST',
      headers: {
        ...HEADERS,
        'Content-Type': meta.mimeType,
        'Cache-Control': 'public, max-age=31536000',
        'x-upsert': 'true',
      },
      body: buffer,
    }
  );
  if (!uploadRes.ok) throw new Error(`Supabase upload failed: ${uploadRes.status}`);

  // Step 3: Get the public URL
  const { data: publicUrlData } = await fetch(
    `${SUPABASE_URL}/storage/v1/object/public/${storagePath}`,
    { method: 'HEAD', headers: HEADERS }
  ).then(r => ({ data: { publicUrl: `${SUPABASE_URL}/storage/v1/object/public/${storagePath}` } }));

  return {
    url: `${SUPABASE_URL}/storage/v1/object/public/${storagePath}`,
    path: storagePath,
    mimeType: meta.mimeType,
    caption: meta.caption || null,
  };
}

/**
 * Find the most recent watch_records row from the same chat within the
 * surrounding time window (30 min before/after) — this is the likely
 * parent listing that the image belongs to. Dealers typically send
 * text listing first, then follow with photos seconds later.
 */
async function findParentRecord(chatId, timestamp) {
  const pad = 30 * 60 * 1000; // 30 min window
  const from = new Date(timestamp - pad).toISOString();
  const to = new Date(timestamp + pad).toISOString();

  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/watch_records?channel_id=eq.${encodeURIComponent(chatId)}` +
    `&created_at=gte.${from}&created_at=lte.${to}&order=created_at.desc&limit=1&select=id,raw_message,brand,reference,created_at`,
    { headers: HEADERS }
  );
  if (!res.ok) return null;
  const data = await res.json();
  return data?.[0] || null;
}

/**
 * Append a dealer photo URL to the target record's dealer_photos array.
 * Uses Supabase REST PATCH with jsonb append.
 */
async function appendDealerPhoto(recordId, photoObj) {
  // First fetch current dealer_photos
  const getRes = await fetch(
    `${SUPABASE_URL}/rest/v1/watch_records?id=eq.${recordId}&select=dealer_photos`,
    { headers: HEADERS }
  );
  if (!getRes.ok) return false;
  const data = await getRes.json();
  const current = (data?.[0]?.dealer_photos) || [];

  const updated = [...current, photoObj];

  const patchRes = await fetch(
    `${SUPABASE_URL}/rest/v1/watch_records?id=eq.${recordId}`,
    {
      method: 'PATCH',
      headers: { ...HEADERS, 'Prefer': 'return=minimal' },
      body: JSON.stringify({ dealer_photos: updated }),
    }
  );
  return patchRes.ok;
}

/**
 * Standalone handler: if no parent record found within window, save the
 * photo as a "media-only" row in a dedicated watch_media table so it can
 * be surfaced for human review (WTB listings, accessory-only photos, etc.)
 * without a text listing to anchor on.
 */
async function saveStandaloneMedia(meta, photoObj) {
  const record = {
    raw_message: meta.caption || '(no caption)',
    channel_id: meta.chatId,
    dealer_name: meta.sender,
    source: 'green_api_media',
    verdict: 'HUMAN',
    dealer_photos: [photoObj],
    created_at: new Date(meta.timestamp).toISOString(),
    processed_at: new Date().toISOString(),
    parser_version: 'v4.3-media-only',
    flags: ['STANDALONE_MEDIA_NO_PARENT_TEXT'],
  };

  const res = await fetch(`${SUPABASE_URL}/rest/v1/watch_records`, {
    method: 'POST',
    headers: { ...HEADERS, 'Prefer': 'return=representation' },
    body: JSON.stringify(record),
  });
  return res.ok;
}

// ─── MAIN HANDLER ──────────────────────────────────────────────────────────
const handler = async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const body = req.body || {};

  // Quick reject: not a media message
  if (!isMediaMessage(body)) {
    return res.status(200).json({ ok: true, skipped: true, reason: 'not_media_message' });
  }

  const meta = extractMediaMetadata(body);
  if (!meta) {
    return res.status(200).json({ ok: true, skipped: true, reason: 'no_download_url' });
  }

  try {
    // Download + upload to Supabase Storage
    const photoObj = await downloadAndUpload(meta);

    // Find parent listing in the chat
    const parentRecord = await findParentRecord(meta.chatId, meta.timestamp);

    if (parentRecord) {
      // Found matching text listing — attach photo
      await appendDealerPhoto(parentRecord.id, photoObj);
      return res.status(200).json({
        ok: true,
        attached: true,
        recordId: parentRecord.id,
        brand: parentRecord.brand,
        reference: parentRecord.reference,
        photoUrl: photoObj.url,
      });
    } else {
      // Standalone media — save as its own row for human review
      await saveStandaloneMedia(meta, photoObj);
      return res.status(200).json({
        ok: true,
        attached: false,
        standalone: true,
        reason: 'no_parent_text_record_found_in_window',
        photoUrl: photoObj.url,
      });
    }
  } catch (e) {
    console.error('[green-api-media] Error:', e.message);
    return res.status(500).json({ ok: false, error: e.message });
  }
};

module.exports = withRateLimit('/api/green-api-media', handler);
