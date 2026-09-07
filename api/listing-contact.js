const { getClient } = require('./_lib/supabase');
const { trustedClientAddress: contactRequestKey } = require('./_lib/trusted-client-address.cjs');
const { createHmac } = require('node:crypto');
const { redactPublicSource } = require('./_lib/source-redaction.cjs');
const { isPublicationBrandAllowed } = require('./_lib/publication-brands.cjs');
const {
  MIN_RELEASE_CONFIDENCE,
  REVIEWED_ZENITH_RECORD_PREFIX,
  REVIEWED_ZENITH_SOURCE,
  isReleaseListingEligible,
} = require('./_lib/publication-references.cjs');

function normalizePhone(value) {
  const digits = String(value || '').replace(/\D/g, '');
  return digits.length >= 8 && digits.length <= 15 ? digits : null;
}

function hasOwnerApprovedPublicContact(flags) {
  return Array.isArray(flags) && flags.includes('OWNER_APPROVED_CONTACT_PUBLIC');
}

function normalizeTelegramUsername(value) {
  const candidate = String(value || '').trim()
    .replace(/^https?:\/\/(?:www\.)?t\.me\//i, '')
    .replace(/^@/, '')
    .split(/[/?#]/, 1)[0];
  return /^[A-Za-z0-9_]{5,32}$/.test(candidate) ? candidate : null;
}

/**
 * Phase 8 — dealer/contact security controls.
 *
 * The contact endpoint resolves phone/WhatsApp server-side ONLY after the
 * listing-to-dealer linkage and the contact-consent gate succeed. These
 * controls add: (a) bounded per-client rate limiting, (b) structured audit
 * events that never contain phones or raw payloads, and (c) a strict
 * response-field allowlist so a phone can never leak through a stray field.
 */
const CONTACT_RATE_WINDOW_MS = 10 * 60 * 1000;
const CONTACT_RATE_LIMIT = 30;
const CONTACT_MAX_CLIENTS = 10000;
const contactAttempts = new Map();

function contactRateLimited(req, now = Date.now()) {
  const key = contactRequestKey(req);
  let current = contactAttempts.get(key);
  if (current && current.resetAt <= now) {
    contactAttempts.delete(key);
    current = null;
  }
  if (!current) {
    if (contactAttempts.size >= CONTACT_MAX_CLIENTS) {
      for (const [client, attempt] of contactAttempts) {
        if (attempt.resetAt <= now) contactAttempts.delete(client);
      }
      // Never evict an active client's counter to admit a new identity.
      if (contactAttempts.size >= CONTACT_MAX_CLIENTS) return true;
    }
    current = { count: 0, resetAt: now + CONTACT_RATE_WINDOW_MS };
  }
  current.count = Math.min(current.count + 1, CONTACT_RATE_LIMIT + 1);
  contactAttempts.set(key, current);
  return current.count > CONTACT_RATE_LIMIT;
}

function resetContactRateLimitForTests() {
  contactAttempts.clear();
}

async function sharedContactBudget(client, req) {
  const secret = process.env.CONTACT_RATE_LIMIT_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY;
  if (!secret) {
    const error = new Error('Service temporarily unavailable');
    error.statusCode = 503;
    throw error;
  }
  const bucket = createHmac('sha256', secret).update('listing-contact-v1:').update(contactRequestKey(req)).digest('hex');
  const { data, error } = await client.rpc('consume_listing_contact_budget', { p_bucket_hash: bucket });
  if (error || typeof data !== 'boolean') {
    const unavailable = new Error('Service temporarily unavailable');
    unavailable.statusCode = 503;
    throw unavailable;
  }
  return data;
}

/**
 * Response-field allowlist. Anything not listed is stripped before the JSON
 * body is sent, so seller_phone / raw payloads / internal ids cannot leak
 * through future refactors.
 */
const CONTACT_RESPONSE_FIELDS = new Set([
  'success',
  'contact_available',
  'reason',
  'dealer_id',
  'dealer_name',
  'dealer_company',
  'dealer_country',
  'dealer_city',
  'dealer_avatar_url',
  'dealer_profile_summary',
  'dealer_profile_url',
  'dealer_rating',
  'dealer_review_count',
  'dealer_group_count',
  'dealer_stats',
  'contact_source',
  'contact_channels',
]);

function allowlistContactPayload(payload) {
  const safe = {};
  for (const [key, value] of Object.entries(payload || {})) {
    if (CONTACT_RESPONSE_FIELDS.has(key)) safe[key] = value;
  }
  return safe;
}

let contactAuditSink = null;
function setContactAuditSink(sink) {
  contactAuditSink = typeof sink === 'function' ? sink : null;
}

/**
 * Structured audit event. Deliberately excludes phones, raw messages, and
 * request bodies — only the listing id, surface, channel, and outcome.
 */
function emitContactAudit(event, detail = {}) {
  const safe = {
    event: String(event),
    listing_id: detail.listing_id ? String(detail.listing_id) : null,
    surface: detail.surface ? String(detail.surface) : null,
    channel: detail.channel ? String(detail.channel) : null,
    result: detail.result ? String(detail.result) : null,
  };
  if (contactAuditSink) {
    try { contactAuditSink(safe); } catch { /* audit sink must never break the request */ }
  }
  console.info('[listing-contact][audit]', JSON.stringify(safe));
}

function hasApprovedPublicContact(listing) {
  return listing?.contact_publication_approved === true
    || hasOwnerApprovedPublicContact(listing?.flags);
}

function optionalLegacyPublicListingUnavailable(error) {
  if (!error) return false;
  return String(error.code || '') === '57014'
    || /statement timeout|relation .*trading_floor_verified_listings.* does not exist|schema cache/i
      .test(`${error.message || error}`);
}

async function findQnsaReleasedListing(client, { id, brand, reference, maximumPages = 20 }) {
  const zenith = String(brand || '').trim().toLowerCase() === 'zenith';
  let offset = 0;
  for (let page = 0; page < maximumPages; page += 1) {
    const { data, error } = await client.rpc(
      zenith ? 'qnsa_zenith_reference_rows' : 'qnsa_trading_floor_reference_rows',
      zenith ? {
        p_reference: reference,
        p_limit: 101,
        p_offset: offset,
        p_listing_type: null,
      } : {
        p_brand: brand,
        p_reference: reference,
        p_family: false,
        p_limit: 101,
        p_offset: offset,
      },
    );
    if (error) throw error;
    const rows = (data || []).map(row => row?.row_data || row).filter(Boolean);
    const match = rows.find(row => String(row.id) === String(id));
    if (match) return match;
    if (rows.length < 101) return null;
    offset += rows.length;
  }
  return null;
}

function whatsappUrl(phone, listing) {
  // Prefilled text is restricted to public listing facts only
  // (brand / model / reference / dial / displayed price / listing id).
  // It never carries seller identity, phone numbers, or private notes.
  const item = [listing.brand, listing.model, listing.reference].filter(Boolean).join(' ');
  const dial = listing.dial_color ? `, ${listing.dial_color} dial` : '';
  const price = listing.display_price ? ` listed at ${listing.display_price}` : '';
  const listingRef = listing.id ? ` (listing ${listing.id})` : '';
  const isBuyerRequest = ['WTB', 'NTQ'].includes(String(listing.listing_type || '').toUpperCase());
  const message = encodeURIComponent(isBuyerRequest
    ? `Hello, I may be able to help with your request for ${item || 'this luxury item'}${dial}${price} shown on Curated Luxury${listingRef}. Are you still looking?`
    : `Hello, I am interested in the ${item || 'luxury listing'}${dial}${price} shown on Curated Luxury${listingRef}. Is it still available?`);
  return `https://wa.me/${phone}?text=${message}`;
}

function telegramUrl(username, listing) {
  const item = [listing.brand, listing.reference].filter(Boolean).join(' ');
  const message = encodeURIComponent(`Hello, I am contacting you about ${item || 'this luxury listing'} on Curated Luxury.`);
  return `https://t.me/${username}?text=${message}`;
}

function sendContactResult(res, {
  payload, externalChannels, id, surface, requestedChannel, brand, reference,
}) {
  if (requestedChannel) {
    const destination = externalChannels[requestedChannel];
    if (!destination) {
      emitContactAudit('CONTACT_CHANNEL_UNAVAILABLE', { listing_id: id, surface, channel: requestedChannel, result: 'NOT_FOUND' });
      return res.status(404).json({ error: 'Requested contact channel unavailable' });
    }
    // Phone resolution happens only here, server-side, after every gate above.
    emitContactAudit('CONTACT_RESOLVED', { listing_id: id, surface, channel: requestedChannel, result: 'REDIRECT' });
    res.setHeader('Location', destination);
    return res.status(302).end();
  }
  const context = `${brand ? `&brand=${encodeURIComponent(brand)}` : ''}${reference ? `&reference=${encodeURIComponent(reference)}` : ''}`;
  const contactChannels = Object.fromEntries(Object.keys(externalChannels).map(channel => [
    channel,
    `/api/listing-contact?id=${encodeURIComponent(id)}&surface=${encodeURIComponent(surface)}${context}&channel=${channel}`,
  ]));
  emitContactAudit('CONTACT_RESOLVED', {
    listing_id: id,
    surface,
    channel: Object.keys(externalChannels).join(',') || null,
    result: payload?.contact_available ? 'AVAILABLE' : 'UNAVAILABLE',
  });
  return res.status(200).json({ ...allowlistContactPayload(payload), contact_channels: contactChannels });
}

async function ownerApprovedContactStats(client, sellerPhone) {
  if (!sellerPhone) return null;
  try {
    const { data: rpcData } = await client.rpc('reviewed_workbook_seller_activity', { p_phone: sellerPhone });
    const activity = Array.isArray(rpcData) ? rpcData[0] : rpcData;
    if (activity && Number(activity.total_posts || 0) > 0) {
      return {
        total_posts: Number(activity.total_posts || 0),
        active_listings: Number(activity.total_posts || 0),
        wts_posts: Number(activity.wts_posts || 0),
        wtb_posts: Number(activity.wtb_posts || 0),
        first_post_at: activity.first_post_at || null,
        last_post_at: activity.last_post_at || null,
        posting_years: 0,
      };
    }
  } catch (e) {
    // proceed to watch_records
  }

  const base = () => client
    .from('watch_records')
    .select('id', { count: 'exact', head: true })
    .eq('seller_phone', sellerPhone)
    .eq('verdict', 'APPROVED')
    .gte('confidence', MIN_RELEASE_CONFIDENCE);
  const [total, wts, wtb, active] = await Promise.all([
    base(),
    base().eq('listing_type', 'WTS'),
    base().in('listing_type', ['WTB', 'NTQ']),
    base()
      .eq('listing_type', 'WTS')
      .or('listing_status.is.null,listing_status.not.in.(SOLD,WITHDRAWN,EXPIRED)'),
  ]);
  const error = [total, wts, wtb, active].find(result => result.error)?.error;
  if (error) {
    console.warn('[listing-contact] approved workbook activity unavailable:', error.message);
    return null;
  }
  return {
    total_posts: Number(total.count || 0),
    active_listings: Number(active.count || 0),
    wts_posts: Number(wts.count || 0),
    wtb_posts: Number(wtb.count || 0),
    first_post_at: null,
    last_post_at: null,
    posting_years: 0,
  };
}

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'private, no-store');
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  if (contactRateLimited(req)) {
    emitContactAudit('CONTACT_RATE_LIMITED', { result: 'RATE_LIMITED' });
    res.setHeader('Retry-After', String(Math.ceil(CONTACT_RATE_WINDOW_MS / 1000)));
    return res.status(429).json({ error: 'Too many contact requests. Try again later.' });
  }
  const id = String(req.query?.id || '').trim();
  if (!id || id.length > 250) return res.status(400).json({ error: 'Valid listing id required' });
  const surface = String(req.query?.surface || 'trading-floor').trim().toLowerCase();
  if (!['trading-floor', 'price-research'].includes(surface)) {
    return res.status(400).json({ error: 'Valid listing surface required' });
  }
  const requestedChannel = String(req.query?.channel || '').trim().toLowerCase();
  if (requestedChannel && !['whatsapp', 'telegram'].includes(requestedChannel)) {
    return res.status(400).json({ error: 'Valid contact channel required' });
  }
  const requestedBrand = String(req.query?.brand || '').trim().slice(0, 80);
  const requestedReference = String(req.query?.reference || '').trim().slice(0, 120);

  try {
    const client = getClient();
    if (!await sharedContactBudget(client, req)) {
      emitContactAudit('CONTACT_RATE_LIMITED', { result: 'RATE_LIMITED' });
      res.setHeader('Retry-After', '600');
      return res.status(429).json({ error: 'Too many contact requests. Try again later.' });
    }
    if (process.env.VITE_USE_CANARY_V2 === 'true') {
      const { data, error } = await client.rpc('get_v2_listing_contact', { p_listing_id: id, p_surface: surface });
      if (error) throw error;
      if (!data) return res.status(404).json({ error: 'Listing not found' });
      const phone = data.contact_available === true ? normalizePhone(data.contact_phone) : null;
      const safe = allowlistContactPayload(data);
      if (typeof safe.dealer_name === 'string') safe.dealer_name = redactPublicSource(safe.dealer_name);
      return sendContactResult(res, {
        payload: { ...safe, success: true, contact_available: Boolean(phone) },
        externalChannels: phone ? { whatsapp: whatsappUrl(phone, { brand: data.brand, reference: data.reference, listing_type: data.intent }) } : {},
        id, surface, requestedChannel, brand: data.brand, reference: data.reference,
      });
    }
    const publicTable = surface === 'price-research'
      ? 'price_research_verified_source'
      : 'trading_floor_verified_listings';
    const { data: strictPublicListing, error: publicError } = await client
      .from(publicTable).select('id,brand,reference').eq('id', id).maybeSingle();
    if (publicError && !optionalLegacyPublicListingUnavailable(publicError)) throw publicError;
    let publicListing = strictPublicListing;
    let qnsaReleaseListing = null;
    let qnsaDealerLink = null;
    let canonicalReadyListing = null;
    if (!publicListing && id.toLowerCase().startsWith('cn_')) {
      const canonicalResult = await client
        .from('trading_floor_ready_view')
        .select('*')
        .eq('id', id)
        .maybeSingle();
      if (canonicalResult.error && !optionalLegacyPublicListingUnavailable(canonicalResult.error)) {
        throw canonicalResult.error;
      }
      canonicalReadyListing = canonicalResult.data || null;
      if (canonicalReadyListing) {
        publicListing = {
          id: canonicalReadyListing.id,
          brand: canonicalReadyListing.brand || canonicalReadyListing.canonical_brand || null,
          reference: canonicalReadyListing.reference || canonicalReadyListing.normalized_reference || null,
        };
      }
    }
    if (!publicListing && requestedBrand && requestedReference) {
      qnsaReleaseListing = await findQnsaReleasedListing(client, {
        id, brand: requestedBrand, reference: requestedReference,
      });
      if (qnsaReleaseListing) {
        publicListing = {
          id: qnsaReleaseListing.id,
          brand: qnsaReleaseListing.canonical_brand || qnsaReleaseListing.brand_scope,
          reference: qnsaReleaseListing.normalized_reference || qnsaReleaseListing.catalog_reference,
        };
        const linkResult = await client
          .from('dealer_listing_links')
          .select('dealer_id,link_status')
          .eq('listing_id', id)
          .eq('link_status', 'APPLIED')
          .limit(1)
          .maybeSingle();
        if (linkResult.error) throw linkResult.error;
        qnsaDealerLink = linkResult.data || null;
      }
    }
    if (!publicListing
      && surface === 'trading-floor'
      && id.startsWith(REVIEWED_ZENITH_RECORD_PREFIX)) {
      const fallback = await client
        .from('watch_records')
        .select('id,brand,reference')
        .eq('id', id)
        .eq('source', REVIEWED_ZENITH_SOURCE)
        .eq('verdict', 'APPROVED')
        .gte('confidence', MIN_RELEASE_CONFIDENCE)
        .eq('listing_status', 'ACTIVE')
        .maybeSingle();
      if (fallback.error) throw fallback.error;
      publicListing = fallback.data;
    }
    if (!publicListing) {
      const { data: wbListing } = await client
        .from('reviewed_workbook_inventory')
        .select('id,brand,reference,posted_by,phone_number,contact_publication_approved,listing_type')
        .eq('id', id)
        .maybeSingle();
      if (wbListing) publicListing = wbListing;
    }
    if (!publicListing) return res.status(404).json({ error: 'Listing not found' });

    let { data: listing, error: listingError } = await client
      .from('watch_records')
      .select('id,brand,reference,listing_type,dealer_id,verdict,confidence,source,seller_name,seller_phone,flags')
      .eq('id', id)
      .eq('verdict', 'APPROVED')
      .gte('confidence', MIN_RELEASE_CONFIDENCE)
      .maybeSingle();
    if (!listing) {
      const { data: wbListing } = await client
        .from('reviewed_workbook_inventory')
        .select('id,brand,reference,posted_by,phone_number,contact_publication_approved,listing_type')
        .eq('id', id)
        .maybeSingle();
      if (wbListing) {
        listing = {
          id: wbListing.id,
          brand: wbListing.brand,
          reference: wbListing.reference,
          listing_type: wbListing.listing_type || 'WTS',
          seller_name: wbListing.posted_by || null,
          seller_phone: wbListing.phone_number || null,
          contact_publication_approved: wbListing.contact_publication_approved === true,
        };
      }
    }
    if (!listing && qnsaReleaseListing) {
      listing = {
        id: qnsaReleaseListing.id,
        brand: qnsaReleaseListing.canonical_brand || qnsaReleaseListing.brand_scope,
        reference: qnsaReleaseListing.normalized_reference || qnsaReleaseListing.catalog_reference,
        listing_type: qnsaReleaseListing.listing_type,
        seller_name: qnsaReleaseListing.seller_name || null,
        seller_phone: null,
        dealer_id: qnsaDealerLink?.dealer_id || null,
      };
    }
    if (!listing && canonicalReadyListing) {
      listing = {
        id: canonicalReadyListing.id,
        brand: canonicalReadyListing.brand || canonicalReadyListing.canonical_brand || null,
        reference: canonicalReadyListing.reference || canonicalReadyListing.normalized_reference || null,
        listing_type: canonicalReadyListing.listing_type || canonicalReadyListing.intent || null,
        seller_name: canonicalReadyListing.seller_name || canonicalReadyListing.posted_by
          || canonicalReadyListing.source_identity_name || null,
        seller_phone: canonicalReadyListing.seller_phone || canonicalReadyListing.phone_number
          || canonicalReadyListing.from_number || null,
        contact_publication_approved: canonicalReadyListing.contact_publication_approved === true,
        dealer_id: canonicalReadyListing.dealer_id || null,
      };
    }
    if (!listing) return res.status(404).json({ error: 'Listing not found' });
    const resolvedListing = {
      ...listing,
      brand: publicListing.brand || listing.brand,
      reference: publicListing.reference || listing.reference,
    };
    if (!isPublicationBrandAllowed(resolvedListing.brand)
      || (!qnsaReleaseListing && !canonicalReadyListing && !isReleaseListingEligible(resolvedListing))) {
      return res.status(404).json({ error: 'Listing not included in this release' });
    }
    if (listing.seller_phone || listing.contact_publication_approved === true) {
      const contactApproved = hasApprovedPublicContact(listing);
      const approvedPhone = contactApproved ? listing.seller_phone : null;
      const phone = normalizePhone(approvedPhone);
      const dealerStats = approvedPhone ? await ownerApprovedContactStats(client, approvedPhone) : null;
      const profile = {
        dealer_name: listing.seller_name || 'Curated Luxury member',
        dealer_company: null,
        dealer_country: null,
        dealer_city: null,
        dealer_rating: null,
        dealer_review_count: 0,
        dealer_group_count: 0,
        dealer_stats: dealerStats,
        contact_source: 'WORKBOOK_SELLER_CONTACT',
      };
      return sendContactResult(res, {
        payload: { success: true, contact_available: Boolean(phone), ...profile },
        externalChannels: phone ? { whatsapp: whatsappUrl(phone, resolvedListing) } : {},
        id,
        surface,
        requestedChannel,
        brand: resolvedListing.brand,
        reference: resolvedListing.reference,
      });
    }
    if (!listing.dealer_id) return res.status(200).json({ success: true, contact_available: false, reason: 'DEALER_UNRESOLVED' });
    let lineage = qnsaDealerLink;
    if (!qnsaReleaseListing) {
      const lineageResult = await client
        .from('seller_listing_lineage_staging')
        .select('id')
        .eq('source_record_id', listing.id)
        .eq('matched_dealer_id', listing.dealer_id)
        .eq('match_status', 'APPLIED')
        .limit(1)
        .maybeSingle();
      if (lineageResult.error) throw lineageResult.error;
      lineage = lineageResult.data;
    }
    if (!lineage) {
      emitContactAudit('CONTACT_DENIED', { listing_id: id, surface, result: 'SELLER_LINEAGE_UNVERIFIED' });
      return res.status(200).json({ success: true, contact_available: false, reason: 'SELLER_LINEAGE_UNVERIFIED' });
    }

    const { data: dealer, error: dealerError } = await client
      .from('dealers').select('id,slug,display_name,company_name,country_code,city,status,contact_consent,rating,review_count,whatsapp_group_count,avatar_url,profile_summary').eq('id', listing.dealer_id).maybeSingle();
    if (dealerError) throw dealerError;
    if (!dealer || dealer.status !== 'VERIFIED') {
      return res.status(200).json({ success: true, contact_available: false, reason: 'CONTACT_NOT_VERIFIED' });
    }

    const profile = {
      dealer_id: dealer.id,
      dealer_name: dealer.display_name || 'Verified dealer',
      dealer_company: dealer.company_name || null,
      dealer_country: dealer.country_code || null,
      dealer_city: dealer.city || null,
      dealer_avatar_url: dealer.avatar_url || null,
      dealer_profile_summary: dealer.profile_summary || null,
      dealer_profile_url: `/reference-check/${dealer.slug || dealer.id}`,
      dealer_rating: dealer.rating,
      dealer_review_count: dealer.review_count,
      dealer_group_count: dealer.whatsapp_group_count,
      // Legacy dealer_id activity is not a sufficient seller-lineage proof.
      // A future aggregate must count only APPLIED listing lineage.
      dealer_stats: null,
    };
    if (dealer.contact_consent !== true) {
      emitContactAudit('CONTACT_DENIED', { listing_id: id, surface, result: 'CONTACT_CONSENT_NOT_GRANTED' });
      return res.status(200).json({ success: true, contact_available: false, reason: 'CONTACT_CONSENT_NOT_GRANTED', ...allowlistContactPayload(profile) });
    }

    const { data: identities, error: identityError } = await client
      .from('dealer_source_identities')
      .select('source_identity,identity_type,verification_status')
      .eq('dealer_id', dealer.id).eq('verification_status', 'VERIFIED')
      .in('identity_type', ['PHONE', 'WHATSAPP', 'TELEGRAM', 'phone', 'whatsapp', 'telegram']).limit(20);
    if (identityError) throw identityError;
    const phone = (identities || []).map(item => normalizePhone(item.source_identity)).find(Boolean);
    const telegram = (identities || [])
      .filter(item => String(item.identity_type || '').toUpperCase() === 'TELEGRAM')
      .map(item => normalizeTelegramUsername(item.source_identity))
      .find(Boolean);
    if (!phone && !telegram) return res.status(200).json({ success: true, contact_available: false, reason: 'VERIFIED_CONTACT_UNAVAILABLE', ...allowlistContactPayload(profile) });

    return sendContactResult(res, {
      payload: { success: true, contact_available: true, ...profile },
      externalChannels: {
        ...(phone ? { whatsapp: whatsappUrl(phone, resolvedListing) } : {}),
        ...(telegram ? { telegram: telegramUrl(telegram, resolvedListing) } : {}),
      },
      id,
      surface,
      requestedChannel,
      brand: resolvedListing.brand,
      reference: resolvedListing.reference,
    });
  } catch (error) {
    console.error('[listing-contact] request failed');
    return res.status(error.statusCode === 503 ? 503 : 500).json({ error: 'Unable to verify dealer contact' });
  }
};

module.exports.hasApprovedPublicContact = hasApprovedPublicContact;
module.exports.optionalLegacyPublicListingUnavailable = optionalLegacyPublicListingUnavailable;
module.exports.findQnsaReleasedListing = findQnsaReleasedListing;
module.exports.normalizeTelegramUsername = normalizeTelegramUsername;
module.exports.sendContactResult = sendContactResult;
module.exports.whatsappUrl = whatsappUrl;
module.exports.CONTACT_RESPONSE_FIELDS = CONTACT_RESPONSE_FIELDS;
module.exports.allowlistContactPayload = allowlistContactPayload;
module.exports.contactRateLimited = contactRateLimited;
module.exports.contactRequestKey = contactRequestKey;
module.exports.sharedContactBudget = sharedContactBudget;
module.exports.resetContactRateLimitForTests = resetContactRateLimitForTests;
module.exports.setContactAuditSink = setContactAuditSink;
module.exports.emitContactAudit = emitContactAudit;
