'use strict';

const crawl = require('../../data/dealer-directory/full-crawl-2026-08-09.json');

const SOURCE_SYSTEM = 'WATCHFACTS_PUBLIC_TOP_RATED_SNAPSHOT';

function nonNegativeInteger(value) {
  const parsed = Number.parseInt(String(value ?? '').replace(/,/g, ''), 10);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : null;
}

function sourceSlug(sourceId) {
  return `watchfacts-source-${String(sourceId || '').trim()}`;
}

function sourceIdFromIdentity(identity) {
  const match = String(identity || '').match(/^watchfacts-source-(.+)$/i);
  return match ? match[1] : null;
}

function sourcePhone(profile) {
  const match = String(profile?.whatsapp_url || profile?.chat_url || '').match(/wa\.me\/(\d{7,15})/i);
  return match ? `+${match[1]}` : null;
}

function profileSummary(profile, rank) {
  return {
    id: sourceSlug(profile.id),
    slug: sourceSlug(profile.id),
    display_name: profile.name || null,
    company_name: null,
    country_code: profile.country || profile.region || null,
    city: null,
    rating: null,
    review_count: nonNegativeInteger(profile.profile_rating_count ?? profile.feedback_received) || 0,
    whatsapp_group_count: nonNegativeInteger(profile.common_groups) || 0,
    avatar_url: null,
    profile_summary: null,
    verified_at: null,
    member_since: profile.member_since || null,
    trust_status: profile.trust_status || null,
    source_rank: rank,
    source_system: SOURCE_SYSTEM,
    source_url: profile.profile_url || null,
    source_crawled_at: crawl.crawled_at || null,
    verified_phone: sourcePhone(profile),
    stats: {
      wts_posts: nonNegativeInteger(profile.wts) || 0,
      wtb_posts: nonNegativeInteger(profile.wtb) || 0,
      first_post_at: null,
      last_post_at: null,
    },
  };
}

function topRatedProfiles() {
  return (crawl.profiles || []).map((profile, index) => profileSummary(profile, index + 1));
}

function sourceListings(sourceId) {
  return (crawl.listings || []).filter(row => String(row.dealer_id) === String(sourceId));
}

function parsedSourceDate(value) {
  const token = String(value || '').split('·')[0].trim();
  if (!token) return null;
  const parsed = new Date(`${token} UTC`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function sourceProfilePayload(identity) {
  const sourceId = sourceIdFromIdentity(identity);
  if (!sourceId) return null;
  const sourceIndex = (crawl.profiles || []).findIndex(profile => String(profile.id) === String(sourceId));
  if (sourceIndex < 0) return null;
  const profile = crawl.profiles[sourceIndex];
  const sourceRows = sourceListings(sourceId);
  const dates = sourceRows
    .map(row => parsedSourceDate(row.posted_on))
    .filter(Boolean)
    .sort((left, right) => left - right);
  const publicListings = sourceRows.map(row => ({
    id: `watchfacts-source-listing-${row.id}`,
    brand: null,
    reference: null,
    dial_color: null,
    condition: null,
    price_usd: null,
    currency: null,
    display_price: row.display_price || null,
    listing_type: String(row.intent || '').toUpperCase() === 'WTB' ? 'WTB' : 'WTS',
    listing_date: row.posted_on || null,
    created_at: null,
    raw_message: row.title || null,
    image_url: row.image_url || row.source_images?.[0] || null,
    source_url: row.detail_url || null,
    availability_url: row.availability_url || null,
    source_status: row.source_status || null,
    box: row.box || null,
    papers: row.papers || null,
  }));
  const summary = profileSummary(profile, sourceIndex + 1);
  return {
    success: true,
    dealer: summary,
    stats: {
      wts_count: nonNegativeInteger(profile.wts) || publicListings.filter(row => row.listing_type === 'WTS').length,
      wtb_count: nonNegativeInteger(profile.wtb) || publicListings.filter(row => row.listing_type === 'WTB').length,
      group_count: nonNegativeInteger(profile.common_groups) || 0,
      first_post: dates[0]?.toISOString() || null,
      latest_post: dates.at(-1)?.toISOString() || null,
      verified_contact_info: null,
      source_contact_url: profile.whatsapp_url || profile.chat_url || null,
    },
    listings: publicListings,
    reviews: (profile.reviews || []).map(review => ({
      date: review.date || null,
      reviewer: review.reviewer || null,
      sentiment: review.sentiment || null,
    })),
    source_links: {
      profile: profile.profile_url || null,
      for_sale: profile.wts_url || null,
      want_to_buy: profile.wtb_url || null,
      all_listings: profile.all_listings_url || null,
    },
    source_provenance: {
      source_system: SOURCE_SYSTEM,
      source_url: crawl.source || null,
      crawled_at: crawl.crawled_at || null,
    },
    raw_message_access: true,
  };
}

module.exports = {
  SOURCE_SYSTEM,
  parsedSourceDate,
  sourceProfilePayload,
  sourcePhone,
  topRatedProfiles,
};
