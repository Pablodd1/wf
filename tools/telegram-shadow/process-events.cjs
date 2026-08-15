'use strict';

const { segmentDealerMessage } = require('../../api/_lib/normalization-v4.cjs');

const PARSER_VERSION = 'v4.3-mint-condition';
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

function required(name, fallback) {
  const value = process.env[name] || fallback;
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function baseConfig() {
  const baseUrl = required('SUPABASE_URL').replace(/\/$/, '');
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY;
  if (!key) throw new Error('SUPABASE_SERVICE_ROLE_KEY or SUPABASE_SECRET_KEY is required');
  return { baseUrl, key };
}

async function rest(path, options = {}) {
  const { baseUrl, key } = baseConfig();
  const response = await fetch(`${baseUrl}/rest/v1/${path}`, {
    ...options,
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });
  if (!response.ok) throw new Error(`Supabase ${options.method || 'GET'} ${path} failed (${response.status})`);
  const body = await response.text();
  return body ? JSON.parse(body) : null;
}

function deterministicSuggestion(rawText) {
  const candidates = segmentDealerMessage(rawText || '');
  return {
    parser_version: PARSER_VERSION,
    candidate_count: candidates.length,
    candidates: candidates.map(candidate => ({
      raw_line: candidate.rawLine,
      brand: candidate.context?.brand_context || null,
      reference: candidate.reference || null,
      intent: candidate.context?.intent_context || null,
      condition: candidate.context?.condition_context || null,
      prices: (candidate.prices || []).map(price => ({
        price_type: price.price_type || null,
        amount_original: price.amount_original ?? null,
        currency_original: price.currency_original || null,
        amount_usd: price.amount_usd ?? null,
        raw_price_text: price.raw_price_text || null,
        currency_evidence: price.currency_evidence || null,
      })),
      review_flags: candidate.emoji_price_ambiguous ? ['EMOJI_PRICE_AMBIGUOUS'] : [],
    })),
  };
}

async function telegramImage(fileId) {
  const token = required('TELEGRAM_BOT_TOKEN');
  const metadataResponse = await fetch(`https://api.telegram.org/bot${token}/getFile?file_id=${encodeURIComponent(fileId)}`);
  if (!metadataResponse.ok) throw new Error(`Telegram getFile failed (${metadataResponse.status})`);
  const metadata = await metadataResponse.json();
  const filePath = metadata?.result?.file_path;
  if (!filePath) throw new Error('Telegram getFile returned no file_path');

  const imageResponse = await fetch(`https://api.telegram.org/file/bot${token}/${filePath}`);
  if (!imageResponse.ok) throw new Error(`Telegram image download failed (${imageResponse.status})`);
  const declaredSize = Number(imageResponse.headers.get('content-length') || 0);
  if (declaredSize > MAX_IMAGE_BYTES) throw new Error('Telegram image exceeds the 10 MB vision limit');
  const bytes = Buffer.from(await imageResponse.arrayBuffer());
  if (bytes.length > MAX_IMAGE_BYTES) throw new Error('Telegram image exceeds the 10 MB vision limit');
  return bytes.toString('base64');
}

async function visionSuggestion(event, deterministic) {
  if (process.env.TELEGRAM_SHADOW_VISION_ENABLED !== 'true') return null;
  const photo = (event.media || []).find(item => item.type === 'photo' && item.file_id);
  if (!photo) return null;

  const visionUrl = required('TELEGRAM_VISION_API_URL');
  const serviceToken = required('INGEST_API_TOKEN');
  const imageBase64 = await telegramImage(photo.file_id);
  const reference = deterministic.candidates.find(candidate => candidate.reference)?.reference || null;
  const response = await fetch(visionUrl, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${serviceToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ imageBase64, reference }),
  });
  if (!response.ok) throw new Error(`Vision suggestion failed (${response.status})`);
  const payload = await response.json();
  return {
    advisory_only: true,
    model: payload.model || null,
    source: payload.source || null,
    suggestion: payload.parsed || null,
  };
}

async function upsertResult(eventId, values) {
  await rest('telegram_ingest_shadow_results?on_conflict=event_id', {
    method: 'POST',
    headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify({ event_id: eventId, ...values, updated_at: new Date().toISOString() }),
  });
}

async function run() {
  const batchSize = Math.max(1, Math.min(100, Number(process.env.TELEGRAM_SHADOW_BATCH_SIZE || 20)));
  const maxAttempts = Math.max(1, Math.min(10, Number(process.env.TELEGRAM_SHADOW_MAX_ATTEMPTS || 3)));
  const events = await rest('rpc/claim_telegram_shadow_events', {
    method: 'POST',
    body: JSON.stringify({ p_limit: batchSize, p_max_attempts: maxAttempts }),
  });
  if (!Array.isArray(events) || !events.length) {
    console.log(JSON.stringify({ event: 'telegram_shadow_idle', scanned: 0 }));
    return;
  }

  let ready = 0;
  let errors = 0;

  for (const event of events) {
    try {
      const deterministic = deterministicSuggestion(event.raw_text);
      const vision = await visionSuggestion(event, deterministic);
      await upsertResult(event.id, {
        processing_status: 'READY_FOR_REVIEW',
        review_status: 'PENDING',
        parser_version: PARSER_VERSION,
        deterministic_result: deterministic,
        vision_result: vision,
        last_error: null,
        analyzed_at: new Date().toISOString(),
      });
      ready += 1;
    } catch (error) {
      await upsertResult(event.id, {
        processing_status: 'ERROR',
        last_error: String(error.message || error).slice(0, 1000),
      });
      errors += 1;
    }
  }

  console.log(JSON.stringify({
    event: 'telegram_shadow_batch_complete',
    scanned: events.length,
    ready_for_review: ready,
    errors,
    max_attempts: maxAttempts,
    production_writes: 0,
  }));
}

if (require.main === module) {
  run().catch(error => {
    console.error(JSON.stringify({ event: 'telegram_shadow_worker_failed', error: error.message }));
    process.exitCode = 1;
  });
}

module.exports = { deterministicSuggestion, run, telegramImage, visionSuggestion };
