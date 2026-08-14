'use strict';

const crypto = require('node:crypto');
const { authorizeDealer } = require('./_lib/dealer-auth.cjs');
const { multiItemRisk } = require('./_lib/unsplit-bundle-filter.cjs');

const INTENTS = new Set(['WTS', 'WTB']);
const CATEGORIES = new Set(['WATCH', 'HANDBAG', 'JEWELRY', 'ACCESSORY', 'OTHER']);
const CURRENCIES = new Set(['USD', 'HKD', 'EUR', 'GBP', 'CHF', 'CNY', 'JPY', 'SGD', 'USDT']);
const MAX_BULK_ITEMS = 20;

function clean(value, max = 200) {
  const result = String(value || '').trim();
  return result ? result.slice(0, max) : null;
}

function sameOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return true;
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  try { return new URL(origin).host === host; } catch { return false; }
}

function credentialedLocation(dealer) {
  return [clean(dealer?.city, 120), clean(dealer?.country_code, 3)]
    .filter(Boolean).join(', ') || null;
}

async function loadCredentialedPoster(client, user) {
  const { data: dealer, error } = await client.from('dealers')
    .select('id,display_name,company_name,country_code,city,avatar_url,status,rating,review_count,whatsapp_group_count,metadata')
    .eq('auth_user_id', user.id).maybeSingle();
  if (error) throw error;
  if (!dealer) return null;

  const { data: identities, error: identityError } = await client.from('dealer_source_identities')
    .select('source_identity,identity_type,verification_status')
    .eq('dealer_id', dealer.id)
    .eq('verification_status', 'VERIFIED')
    .in('identity_type', ['PHONE', 'WHATSAPP', 'phone', 'whatsapp']);
  if (identityError) throw identityError;
  const phoneIdentity = (identities || []).find(item => /^(?:phone|whatsapp)$/i.test(item.identity_type));

  return {
    dealer_id: dealer.id,
    auth_user_id: user.id,
    email: user.email || null,
    name: clean(dealer.display_name, 160) || clean(dealer.company_name, 160),
    company: clean(dealer.company_name, 160),
    phone: clean(phoneIdentity?.source_identity, 50),
    location: credentialedLocation(dealer),
    avatar_url: clean(dealer.avatar_url, 2000),
    credential_status: dealer.status,
    rating: dealer.rating == null ? null : Number(dealer.rating),
    review_count: Number(dealer.review_count || 0),
    group_count: Number(dealer.whatsapp_group_count || 0),
    account_type: clean(dealer.metadata?.account_type, 30),
    preferred_language: clean(dealer.metadata?.preferred_language, 20),
    telegram_username: clean(dealer.metadata?.telegram_username, 100),
  };
}

function credentialError(poster) {
  if (!poster) return 'This account is not linked to a dealer profile.';
  if (['SUSPENDED', 'ARCHIVED'].includes(poster.credential_status)) return 'This dealer credential cannot publish listings.';
  const missing = [!poster.name && 'name', !poster.phone && 'verified phone', !poster.location && 'location'].filter(Boolean);
  return missing.length ? `Complete the credentialed dealer profile before posting: ${missing.join(', ')}.` : null;
}

function ownedMediaUrl(value, userId) {
  const exact = clean(value, 2000);
  if (!exact) return null;
  const base = String(process.env.SUPABASE_URL || '').replace(/\/$/, '');
  const prefix = `${base}/storage/v1/object/public/dealer-listing-media/${userId}/`;
  return base && exact.startsWith(prefix) ? exact : null;
}

function validateSubmission(body = {}) {
  const submittedAsBundle = body.is_bundle === true;
  const intent = clean(body.intent, 3)?.toUpperCase();
  const category = clean(body.category, 20)?.toUpperCase();
  const rawInput = typeof body.raw_message === 'string' ? body.raw_message : '';
  // Validate with trimmed text but retain the submitted bytes exactly. Leading
  // whitespace, trailing whitespace, and line breaks are source evidence.
  const rawMessage = rawInput.trim() ? rawInput : null;
  const detectedMultiItem = category === 'WATCH' ? multiItemRisk(rawMessage) : { is_multi: false, reasons: [] };
  const isBundle = submittedAsBundle || detectedMultiItem.is_multi;
  if (!INTENTS.has(intent)) return { error: 'Choose For sale or Want to buy.' };
  if (!CATEGORIES.has(category)) return { error: 'Choose a valid category.' };
  if (isBundle && category !== 'WATCH') return { error: 'A deferred multi-item post must contain watches.' };
  if (!rawMessage || rawMessage.length < 3) return { error: 'Enter the original listing or request message.' };
  if (rawMessage.length > 10000) return { error: 'Original message is limited to 10,000 characters.' };

  const claimed = {
    brand: clean(body.brand), model: clean(body.model), reference: clean(body.reference),
    dial_color: clean(body.dial_color), condition: clean(body.condition, 40),
    material: clean(body.material, 120), size: clean(body.size, 80),
    year: clean(body.year, 20), completeness: clean(body.completeness, 160),
    price_amount: body.price_amount == null || body.price_amount === '' ? null : Number(body.price_amount),
    currency: clean(body.currency, 8)?.toUpperCase() || null,
    title: clean(body.title, 240),
  };
  if (category === 'WATCH' && !isBundle) {
    const missing = ['brand', 'model', 'reference', 'dial_color'].filter(field => !claimed[field]);
    if (missing.length) return { error: `Required watch fields: ${missing.join(', ')}.` };
  }
  if (category !== 'WATCH' && !isBundle && (!claimed.brand || !claimed.title)) {
    return { error: 'Required luxury-item fields: brand or maker, item name or style.' };
  }
  if (claimed.year && !/^(?:18|19|20)\d{2}$/.test(claimed.year)) {
    return { error: 'Year must be a four-digit year between 1800 and 2099.' };
  }
  if (claimed.price_amount != null && (!Number.isFinite(claimed.price_amount) || claimed.price_amount <= 0 || claimed.price_amount > 1_000_000_000)) {
    return { error: 'Enter a valid positive price.' };
  }
  if (claimed.currency && !CURRENCIES.has(claimed.currency)) return { error: 'Choose a supported currency.' };
  if (intent === 'WTS' && claimed.price_amount && !claimed.currency) return { error: 'Choose the original price currency.' };
  const imageUrls = Array.isArray(body.image_urls) ? body.image_urls.map(value => clean(value, 2000)).filter(Boolean).slice(0, 5) : [];
  if (!imageUrls.length) return { error: 'Add at least one item photo.' };
  if (imageUrls.some(value => !/^https:\/\//i.test(value))) return { error: 'Invalid item photo URL.' };
  return { intent, category, rawMessage, claimed, imageUrls, isBundle, multiItemReasons: detectedMultiItem.reasons };
}

function validateBatch(body = {}) {
  const items = Array.isArray(body.items) ? body.items : [body];
  if (!items.length || items.length > MAX_BULK_ITEMS) return { error: `Submit between 1 and ${MAX_BULK_ITEMS} items at a time.` };
  const validated = items.map(item => validateSubmission(item));
  const failedIndex = validated.findIndex(item => item.error);
  if (failedIndex >= 0) return { error: `Item ${failedIndex + 1}: ${validated[failedIndex].error}` };
  if (validated.some(item => item.isBundle) && validated.length !== 1) return { error: 'Submit a bundle by itself so its message and group photos stay together.' };
  return { items: validated };
}

async function handler(req, res) {
  res.setHeader('Cache-Control', 'private, no-store');
  const authorization = await authorizeDealer(req, res);
  if (authorization.error) return res.status(authorization.status).json({ error: authorization.error });

  let poster;
  try {
    poster = await loadCredentialedPoster(authorization.client, authorization.user);
  } catch (error) {
    console.error('[dealer-submissions-credential]', error.message);
    return res.status(500).json({ error: 'Unable to load the credentialed poster profile.' });
  }

  if (req.method === 'GET') {
    const { data, error } = await authorization.client.from('dealer_listing_submissions')
      .select('id,intent,category,claimed_fields,review_status,publication_status,bulk_submission_id,created_at')
      .eq('auth_user_id', authorization.user.id)
      .order('created_at', { ascending: false }).limit(25);
    if (error) return res.status(500).json({ error: 'Unable to load submissions.' });
    return res.status(200).json({ success: true, submissions: data || [], poster, credential_error: credentialError(poster) });
  }

  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (!sameOrigin(req)) return res.status(403).json({ error: 'Invalid request origin.' });
  if (req.body?.source_evidence_confirmed !== true) {
    return res.status(400).json({ error: 'Confirm that every raw message and photo belongs to the submitted item or request.' });
  }
  const batch = validateBatch(req.body);
  if (batch.error) return res.status(400).json({ error: batch.error });
  const posterError = credentialError(poster);
  if (posterError) return res.status(409).json({ error: posterError });

  for (const item of batch.items) {
    if (item.imageUrls.some(url => !ownedMediaUrl(url, authorization.user.id))) {
      return res.status(400).json({ error: 'Every item photo must come from this credentialed account upload.' });
    }
  }
  const submittedPosterImage = ownedMediaUrl(req.body?.poster_image_url, authorization.user.id);
  if (req.body?.poster_image_url && !submittedPosterImage) return res.status(400).json({ error: 'Invalid posting-user photo.' });
  const posterImageUrl = submittedPosterImage || poster.avatar_url || null;
  if (submittedPosterImage && submittedPosterImage !== poster.avatar_url) {
    const { error: avatarError } = await authorization.client.from('dealers')
      .update({ avatar_url: submittedPosterImage, updated_at: new Date().toISOString() })
      .eq('id', poster.dealer_id).eq('auth_user_id', authorization.user.id);
    if (avatarError) return res.status(500).json({ error: 'Unable to update the credentialed profile photo.' });
  }

  // Every posting event has a batch identity, even when it contains one item.
  // This gives the user one stable receipt for single, multi-item, and bundle flows.
  const bulkSubmissionId = crypto.randomUUID();
  const posterSnapshot = {
    poster_name: poster.name, poster_phone: poster.phone, location: poster.location,
    dealer_rating: poster.rating, review_count: poster.review_count,
    group_count: poster.group_count, credential_status: poster.credential_status,
    account_type: poster.account_type, preferred_language: poster.preferred_language,
    telegram_username: poster.telegram_username,
    source_evidence_confirmed: true, source_evidence_confirmed_at: new Date().toISOString(),
  };
  const submissionRows = batch.items.map(validated => ({
    id: crypto.randomUUID(),
    auth_user_id: authorization.user.id, dealer_id: poster.dealer_id,
    intent: validated.intent, category: validated.category, raw_message: validated.rawMessage,
    claimed_fields: {
      ...validated.claimed,
      ...posterSnapshot,
      is_bundle: validated.isBundle,
      multi_item_detection_reasons: validated.multiItemReasons,
    }, image_urls: validated.imageUrls,
    poster_image_url: posterImageUrl,
    submission_checksum: crypto.createHash('sha256').update(JSON.stringify({
      intent: validated.intent, category: validated.category, raw_message: validated.rawMessage, is_bundle: validated.isBundle,
      claimed: validated.claimed, image_urls: validated.imageUrls,
    })).digest('hex'),
    bulk_submission_id: bulkSubmissionId, publication_status: 'QUEUED',
    review_status: 'PENDING_REVIEW', normalized_at: null,
  }));
  const { data, error } = await authorization.client.from('dealer_listing_submissions').insert(submissionRows)
    .select('id,review_status,publication_status,created_at,intent,category,claimed_fields,image_urls,poster_image_url');
  if (error) {
    console.error('[dealer-submissions]', error.message);
    if (error.code === '23505') return res.status(409).json({ error: 'This exact item post already exists.' });
    return res.status(500).json({ error: 'Unable to save the submission.' });
  }

  const submissionIds = data.map(item => item.id);
  const { data: queued, error: queueError } = await authorization.client.rpc('enqueue_dealer_submission_batch', {
    p_submission_ids: submissionIds,
  });
  if (queueError) {
    await authorization.client.from('dealer_listing_submissions')
      .update({ publication_status: 'QUEUE_FAILED', review_status: 'IN_REVIEW' })
      .in('id', submissionIds);
    console.error('[dealer-submissions-queue]', queueError.message);
    return res.status(500).json({ error: 'Items were saved, but the review queue needs attention.' });
  }
  return res.status(202).json({
    success: true,
    submissions: data,
    submission: data[0],
    bulk_submission_id: bulkSubmissionId,
    publication: 'QUEUED_FOR_REVIEW',
    queue: queued || [],
    count: data.length,
  });
}

module.exports = handler;
module.exports.validateSubmission = validateSubmission;
module.exports.validateBatch = validateBatch;
module.exports.MAX_BULK_ITEMS = MAX_BULK_ITEMS;
module.exports.credentialError = credentialError;
module.exports.credentialedLocation = credentialedLocation;
module.exports.loadCredentialedPoster = loadCredentialedPoster;
module.exports.ownedMediaUrl = ownedMediaUrl;
