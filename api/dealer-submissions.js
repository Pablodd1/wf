'use strict';

const crypto = require('node:crypto');
const { authorizeDealer } = require('./_lib/dealer-auth.cjs');

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
  try {
    const { data: dealer, error } = await client.from('dealers')
      .select('id,display_name,company_name,country_code,city,avatar_url,status,rating,review_count,whatsapp_group_count')
      .eq('auth_user_id', user.id).maybeSingle();
    if (error || !dealer) return null;

    const { data: identities, error: identityError } = await client.from('dealer_source_identities')
      .select('source_identity,identity_type,verification_status')
      .eq('dealer_id', dealer.id)
      .eq('verification_status', 'VERIFIED')
      .in('identity_type', ['PHONE', 'WHATSAPP', 'phone', 'whatsapp']);
    
    // Ignore identity errors if the table is missing; just proceed without phone
    const phoneIdentity = (identityError ? [] : (identities || [])).find(item => /^(?:phone|whatsapp)$/i.test(item.identity_type));

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
  };
  } catch (err) {
    console.error('[dealer-submissions-credential] Database missing or error:', err.message);
    return null;
  }
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
  const isBundle = body.is_bundle === true;
  const intent = clean(body.intent, 3)?.toUpperCase();
  const category = clean(body.category, 20)?.toUpperCase();
  const rawInput = String(body.raw_message || '').trim();
  const rawMessage = rawInput || null;
  if (!INTENTS.has(intent)) return { error: 'Choose For sale or Want to buy.' };
  if (!CATEGORIES.has(category)) return { error: 'Choose a valid category.' };
  if (isBundle && (intent !== 'WTS' || category !== 'WATCH')) return { error: 'A deferred bundle must be a For sale watch listing.' };
  if (!rawMessage || rawMessage.length < 3) return { error: 'Enter the original listing or request message.' };
  if (rawMessage.length > 10000) return { error: 'Original message is limited to 10,000 characters.' };

  const claimed = {
    brand: clean(body.brand), model: clean(body.model), reference: clean(body.reference),
    dial_color: clean(body.dial_color), condition: clean(body.condition, 40),
    price_amount: body.price_amount == null || body.price_amount === '' ? null : Number(body.price_amount),
    currency: clean(body.currency, 8)?.toUpperCase() || null,
    title: clean(body.title, 240),
  };
  if (category === 'WATCH' && !isBundle) {
    const missing = ['brand', 'model', 'reference', 'dial_color'].filter(field => !claimed[field]);
    if (missing.length) return { error: `Required watch fields: ${missing.join(', ')}.` };
  }
  if (claimed.price_amount != null && (!Number.isFinite(claimed.price_amount) || claimed.price_amount <= 0 || claimed.price_amount > 1_000_000_000)) {
    return { error: 'Enter a valid positive price.' };
  }
  if (claimed.currency && !CURRENCIES.has(claimed.currency)) return { error: 'Choose a supported currency.' };
  if (intent === 'WTS' && claimed.price_amount && !claimed.currency) return { error: 'Choose the original price currency.' };
  const imageUrls = Array.isArray(body.image_urls) ? body.image_urls.map(value => clean(value, 2000)).filter(Boolean).slice(0, 5) : [];
  if (!imageUrls.length) return { error: 'Add at least one item photo.' };
  if (imageUrls.some(value => !/^https:\/\//i.test(value))) return { error: 'Invalid item photo URL.' };
  return { intent, category, rawMessage, claimed, imageUrls, isBundle };
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
  };
  const submissionRows = batch.items.map(validated => ({
    auth_user_id: authorization.user.id, dealer_id: poster.dealer_id,
    intent: validated.intent, category: validated.category, raw_message: validated.rawMessage,
    claimed_fields: { ...validated.claimed, ...posterSnapshot, is_bundle: validated.isBundle }, image_urls: validated.imageUrls,
    poster_image_url: posterImageUrl,
    submission_checksum: crypto.createHash('sha256').update(JSON.stringify({
      intent: validated.intent, category: validated.category, raw_message: validated.rawMessage, is_bundle: validated.isBundle,
      claimed: validated.claimed, image_urls: validated.imageUrls,
    })).digest('hex'),
    bulk_submission_id: bulkSubmissionId, publication_status: 'PUBLISHED',
    review_status: validated.isBundle ? 'IN_REVIEW' : 'APPROVED', normalized_at: new Date().toISOString(),
  }));
  const { data, error } = await authorization.client.from('dealer_listing_submissions').insert(submissionRows)
    .select('id,review_status,publication_status,created_at,intent,category,claimed_fields,image_urls,poster_image_url');
  if (error) {
    console.error('[dealer-submissions]', error.message);
    if (error.code === '23505') return res.status(409).json({ error: 'This exact item post already exists.' });
    return res.status(500).json({ error: 'Unable to save the submission.' });
  }

  const stagingRows = data.map((submission, index) => {
    const validated = batch.items[index];
    const price = validated.claimed.price_amount;
    return {
      source_submission_id: submission.id, dealer_id: poster.dealer_id,
      raw_message_text: validated.rawMessage, category: validated.category,
      intent: validated.intent, listing_type: validated.isBundle ? 'BUNDLE' : validated.intent, is_bundle: validated.isBundle,
      brand_original: validated.claimed.brand, brand_normalized: validated.claimed.brand,
      model_original: validated.claimed.model, model_normalized: validated.claimed.model,
      reference_original: validated.claimed.reference, reference_normalized: validated.claimed.reference,
      dial_color_original: validated.claimed.dial_color, dial_color_normalized: validated.claimed.dial_color,
      condition_original: validated.claimed.condition, condition_normalized: validated.claimed.condition,
      price_original: price, price_normalized: price,
      price_usd: validated.claimed.currency === 'USD' ? price : null,
      currency_original: validated.claimed.currency, currency_normalized: validated.claimed.currency,
      image_url: validated.imageUrls[0], image_urls: validated.imageUrls,
      user_image_url: posterImageUrl,
      user_name: poster.name, from_name: poster.name,
      contact_number: poster.phone, from_number: poster.phone,
      location: poster.location, rating: poster.rating, dealer_rating: poster.rating,
      contact_consent: true, is_verified_user: poster.credential_status === 'VERIFIED',
      is_seller_approved: poster.credential_status === 'VERIFIED', are_attributes_extracted: !validated.isBundle,
      identification_status: validated.isBundle ? 'bundle_pending_separation' : validated.category === 'WATCH' ? 'identified' : 'normalized',
      verdict: validated.isBundle ? 'needs_review' : 'approved',
      normalization_status: validated.isBundle ? 'needs_review' : 'normalized',
      trading_floor_status: validated.isBundle ? 'bundle_pending_separation' : 'published',
      price_research_status: validated.isBundle ? 'ineligible_bundle' : validated.category !== 'WATCH' ? 'ineligible_non_watch' : price == null ? 'ineligible_no_price' : validated.claimed.currency === 'USD' ? 'eligible' : 'provisional_needs_review',
      provenance_metadata: {
        source: 'authenticated_user_form', submission_id: submission.id,
        bulk_submission_id: bulkSubmissionId,
        poster_image_url: posterImageUrl,
        credential_stamp: { auth_user_id: poster.auth_user_id, dealer_id: poster.dealer_id, status: poster.credential_status },
      },
      overall_confidence: validated.isBundle ? 0 : 1,
    };
  });
  const { error: publicationError } = await authorization.client.schema('staging').from('listings').insert(stagingRows);
  if (publicationError) {
    await authorization.client.from('dealer_listing_submissions').update({ publication_status: 'PUBLICATION_FAILED', review_status: 'IN_REVIEW' }).in('id', data.map(item => item.id));
    console.error('[dealer-submissions-publication]', publicationError.message);
    return res.status(500).json({ error: 'Listings were saved, but publication needs attention.' });
  }
  return res.status(201).json({ success: true, submissions: data, submission: data[0], bulk_submission_id: bulkSubmissionId, publication: 'PUBLISHED', count: data.length });
}

module.exports = handler;
module.exports.validateSubmission = validateSubmission;
module.exports.validateBatch = validateBatch;
module.exports.MAX_BULK_ITEMS = MAX_BULK_ITEMS;
module.exports.credentialError = credentialError;
module.exports.credentialedLocation = credentialedLocation;
module.exports.loadCredentialedPoster = loadCredentialedPoster;
module.exports.ownedMediaUrl = ownedMediaUrl;
