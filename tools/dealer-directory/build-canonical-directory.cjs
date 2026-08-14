'use strict';

const crypto = require('node:crypto');
const crawl = require('../../data/dealer-directory/full-crawl-2026-08-09.json');
const rated = require('../../data/dealer-directory/rated-dealers-2026-08-12.json');

function digits(value) {
  const result = String(value || '').replace(/[^0-9]/g, '');
  return result.length >= 8 && result.length <= 15 ? result : null;
}

function integer(value) {
  const parsed = Number.parseInt(String(value ?? '').replace(/,/g, ''), 10);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : null;
}

function reviewKey(profileId, review, index) {
  return crypto.createHash('sha256').update([
    profileId, review?.date || '', review?.reviewer || '',
    review?.sentiment || '', index,
  ].join('|')).digest('hex');
}

function topRatedRecords() {
  return (crawl.profiles || []).map((profile, index) => ({
    source_system: 'WATCHFACTS_PUBLIC_TOP_RATED_SNAPSHOT',
    source_profile_id: String(profile.id),
    captured_at: `${crawl.crawled_at || '2026-08-09'}T00:00:00Z`,
    source_rank: index + 1,
    display_name: profile.name || null,
    company_name: null,
    phone: digits(profile.whatsapp_url || profile.chat_url),
    country_code: profile.country || profile.region || null,
    city: null,
    rating: null,
    review_count: integer(profile.profile_rating_count ?? profile.feedback_received) || 0,
    positive_feedback_count: integer(profile.feedback_received) || 0,
    negative_feedback_count: 0,
    group_count: integer(profile.common_groups) || 0,
    wts_count: integer(profile.wts) || 0,
    wtb_count: integer(profile.wtb) || 0,
    member_since: profile.member_since || null,
    trust_status: profile.trust_status || null,
    contact_consent: false,
    evidence: {
      captured_listing_count: (crawl.listings || []).filter(row => String(row.dealer_id) === String(profile.id)).length,
      rating_evidence_status: 'SOURCE_FEEDBACK_COUNT',
    },
    reviews: (profile.reviews || []).map((review, reviewIndex) => ({
      key: reviewKey(profile.id, review, reviewIndex),
      date: review.date || null,
      reviewer: review.reviewer || null,
      sentiment: review.sentiment || null,
      rating: null,
      evidence: { source_published: true },
    })),
  }));
}

function ratedRecords() {
  return (rated.profiles || []).map((profile, index) => ({
    source_system: 'WATCHFACTS_PUBLIC_RATED_DEALERS_20260812',
    source_profile_id: String(profile.profile_id),
    captured_at: `${rated.crawled_at || '2026-08-12'}T00:00:00Z`,
    source_rank: index + 1,
    display_name: profile.name || null,
    company_name: null,
    phone: digits(profile.phone),
    country_code: profile.location || null,
    city: null,
    rating: null,
    review_count: integer(profile.review_count) || 0,
    positive_feedback_count: integer(profile.positive_feedback_count) || 0,
    negative_feedback_count: integer(profile.negative_feedback_count) || 0,
    group_count: null,
    wts_count: null,
    wtb_count: null,
    member_since: null,
    trust_status: profile.trust_status || null,
    contact_consent: false,
    evidence: { rating_evidence_status: 'SOURCE_FEEDBACK_COUNT' },
    reviews: [],
  }));
}

function buildCanonicalDirectory() {
  const records = [...topRatedRecords(), ...ratedRecords()];
  const phones = new Set(records.map(record => record.phone).filter(Boolean));
  return {
    records,
    report: {
      records: records.length,
      unique_verified_phones: phones.size,
      top_rated_profiles: topRatedRecords().length,
      rated_profiles: ratedRecords().length,
      reviews: records.reduce((total, record) => total + record.reviews.length, 0),
      contains_external_profile_urls: false,
    },
  };
}

if (require.main === module) {
  const built = buildCanonicalDirectory();
  process.stdout.write(JSON.stringify(built));
}

module.exports = { buildCanonicalDirectory, digits, integer, reviewKey };
