'use strict';

const crawl = require('../../data/dealer-directory/full-crawl-2026-08-09.json');
const legacyAudit = require('../../data/dealer-directory/legacy-profile-audit-2026-08-11.json');
const ratedDealers = require('../../data/dealer-directory/rated-dealers-2026-08-12.json');
const mariadbDirectory = require('../../data/dealer-directory/mariadb-public-dealers-2026-08-19.json');

const SOURCE_SYSTEM = 'WATCHFACTS_PUBLIC_TOP_RATED_SNAPSHOT';
const LEGACY_SOURCE_SYSTEM = 'WATCHFACTS_LEGACY_PROFILE_AUDIT_20260811';
const RATED_SOURCE_SYSTEM = 'WATCHFACTS_PUBLIC_RATED_DEALERS_20260812';
const MARIADB_SOURCE_SYSTEM = 'MARIADB_DEALER_CANDIDATE_RECONCILIATION_20260819';

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

function phoneDigits(value) {
  return String(value || '').replace(/[^0-9]/g, '');
}

function withoutPrivateProvenance(profile) {
  if (!profile) return profile;
  const {
    source_url: _sourceUrl,
    ...publicProfile
  } = profile;
  return publicProfile;
}

function mariadbProfiles() {
  return (mariadbDirectory.profiles || []).map(profile => ({ ...profile }));
}

const mariadbProfileById = new Map(mariadbProfiles().map(profile => [String(profile.id), profile]));

function mariadbProfilePayload(identity) {
  const profile = mariadbProfileById.get(String(identity || '')) || null;
  if (!profile) return null;
  return {
    success: true,
    dealer: withoutPrivateProvenance(profile),
    stats: {
      wts_count: profile.stats?.wts_posts ?? null,
      wtb_count: profile.stats?.wtb_posts ?? null,
      group_count: profile.whatsapp_group_count ?? null,
      first_post: null,
      latest_post: null,
      verified_contact_info: null,
      inventory_records: profile.stats?.inventory_records ?? 0,
      active_inventory_records: profile.stats?.active_inventory_records ?? 0,
      review_count: profile.review_count ?? 0,
      positive_feedback_count: profile.positive_feedback_count ?? 0,
      negative_feedback_count: null,
    },
    listings: [],
    reviews: [],
    listing_linkage_status: profile.listing_linkage_status,
    source_provenance: {
      source_system: MARIADB_SOURCE_SYSTEM,
      source_candidate_count: profile.source_candidate_count || 1,
      exact_private_identity_reconciled: true,
      public_contact_available: false,
      listing_linkage_status: profile.listing_linkage_status,
    },
    raw_message_access: false,
  };
}

function ratedProfileSummary(profile, rank) {
  const profilePhone = phoneDigits(profile.phone);
  const profileName = String(profile.name || '').trim().toLowerCase();
  const existing = (crawl.profiles || []).find(row =>
    String(row.id) === String(profile.profile_id)
    || (profilePhone && phoneDigits(row.whatsapp_url || row.chat_url).includes(profilePhone))
    || (profileName && String(row.name || '').trim().toLowerCase() === profileName)
  );
  const summary = profileSummary(existing || {
    id: profile.profile_id,
    name: profile.name,
    country: profile.location,
    profile_rating_count: profile.review_count,
    feedback_received: profile.positive_feedback_count,
    common_groups: null,
    trust_status: profile.trust_status,
    whatsapp_url: `https://wa.me/${profile.phone}`,
    profile_url: profile.profile_url,
    wts: profile.wts ?? 0,
    wtb: profile.wtb ?? 0,
    listing_total: profile.listing_total ?? 0,
  }, rank);
  return {
    ...summary,
    display_name: profile.name || summary.display_name,
    rating: null,
    review_count: nonNegativeInteger(profile.review_count) || 0,
    trust_status: profile.trust_status || summary.trust_status,
    // A phone published by a legacy/source directory is private reconciliation
    // evidence. It is not Curated Luxury contact-consent evidence.
    verified_phone: null,
    source_rank: rank,
    source_system: RATED_SOURCE_SYSTEM,
    source_url: profile.profile_url || summary.source_url,
    source_crawled_at: ratedDealers.crawled_at,
    rating_evidence_status: 'SOURCE_FEEDBACK_COUNT',
    positive_feedback_count: nonNegativeInteger(profile.positive_feedback_count) || 0,
    negative_feedback_count: nonNegativeInteger(profile.negative_feedback_count) || 0,
    stats: summary.stats,
    whatsapp_group_count: existing ? summary.whatsapp_group_count : (nonNegativeInteger(profile.common_groups) ?? null),
  };
}

function ratedProfiles() {
  return (ratedDealers.profiles || []).map((profile, index) => ratedProfileSummary(profile, index + 1));
}

const ratedEvidenceByProfileId = new Map();
const ratedEvidenceByPhone = new Map();
for (const profile of ratedDealers.profiles || []) {
  const evidence = {
    source_profile_id: String(profile.profile_id),
    display_name: profile.name || null,
    rating: null,
    review_count: nonNegativeInteger(profile.review_count) || 0,
    positive_feedback_count: nonNegativeInteger(profile.positive_feedback_count) || 0,
    negative_feedback_count: nonNegativeInteger(profile.negative_feedback_count) || 0,
    trust_status: profile.trust_status || null,
    source_url: profile.profile_url || null,
    evidence_status: 'SOURCE_FEEDBACK_COUNT',
  };
  ratedEvidenceByProfileId.set(String(profile.profile_id), evidence);
  const phone = phoneDigits(profile.phone);
  if (phone) ratedEvidenceByPhone.set(phone, evidence);
}

function ratedDealerEvidence({ dealerId, phone } = {}) {
  const byId = ratedEvidenceByProfileId.get(String(dealerId || '')) || null;
  const byPhone = ratedEvidenceByPhone.get(phoneDigits(phone)) || null;
  if (byId && byPhone && byId.source_profile_id !== byPhone.source_profile_id) return null;
  return byId || byPhone;
}

function profileSummary(profile, rank) {
  const wts = nonNegativeInteger(profile.wts) || 0;
  const wtb = nonNegativeInteger(profile.wtb) || 0;
  const total = nonNegativeInteger(profile.listing_total) || (wts + wtb);
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
    // Keep source phones available to the private identity reconciliation
    // helpers, but never copy them into a public snapshot profile.
    verified_phone: null,
    stats: {
      total_posts: total,
      wts_posts: wts,
      wtb_posts: wtb,
      first_post_at: null,
      last_post_at: null,
    },
  };
}

function topRatedProfiles() {
  return (crawl.profiles || []).map((profile, index) => profileSummary(profile, index + 1));
}

function legacySnapshotRange(profileId) {
  const rows = (legacyAudit.stat_snapshots || []).filter(row => String(row.legacy_profile_id) === String(profileId));
  const values = key => rows.map(row => nonNegativeInteger(row[key])).filter(value => value !== null);
  const wts = values('wts_count');
  const wtb = values('wtb_count');
  const latest = rows.at(-1) || null;
  return {
    snapshot_count: rows.length,
    wts_min: wts.length ? Math.min(...wts) : null,
    wts_max: wts.length ? Math.max(...wts) : null,
    wtb_min: wtb.length ? Math.min(...wtb) : null,
    wtb_max: wtb.length ? Math.max(...wtb) : null,
    latest_captured_wts: nonNegativeInteger(latest?.wts_count),
    latest_captured_wtb: nonNegativeInteger(latest?.wtb_count),
    latest_context: latest?.snapshot_context || null,
    current_counts_are_dynamic: false,
  };
}

function legacyProfileSummary(user, rank) {
  const snapshot = legacySnapshotRange(user.legacy_profile_id);
  return {
    id: `watchfacts-legacy-${user.legacy_profile_id}`,
    slug: `watchfacts-legacy-${user.legacy_profile_id}`,
    legacy_profile_id: user.legacy_profile_id,
    display_name: user.display_name || null,
    company_name: null,
    country_code: user.dealer_country || user.location_raw || null,
    city: null,
    rating: null,
    review_count: null,
    whatsapp_group_count: null,
    avatar_url: null,
    profile_summary: user.profile_user_type || null,
    verified_at: null,
    member_since: user.member_since_raw || null,
    trust_status: null,
    source_rank: rank,
    source_system: LEGACY_SOURCE_SYSTEM,
    source_url: user.profile_sale_url || null,
    source_crawled_at: '2026-08-11',
    verified_phone: null,
    evidence_status: user.profile_click_status || null,
    stats: {
      wts_posts: snapshot.latest_captured_wts,
      wtb_posts: snapshot.latest_captured_wtb,
      first_post_at: null,
      last_post_at: null,
      ...snapshot,
    },
  };
}

function legacyProfiles() {
  return (legacyAudit.users || [])
    .filter(user => user.legacy_profile_id)
    .map((user, index) => legacyProfileSummary(user, index + 1));
}

const legacyById = new Map(legacyProfiles().map(profile => [String(profile.legacy_profile_id), profile]));

function legacyProfileForDealerId(dealerId) {
  return legacyById.get(String(dealerId || '')) || null;
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
    source_status: row.source_status || null,
    box: row.box || null,
    papers: row.papers || null,
  }));
  const summary = profileSummary(profile, sourceIndex + 1);
  return {
    success: true,
    dealer: withoutPrivateProvenance(summary),
    stats: {
      wts_count: nonNegativeInteger(profile.wts) ?? publicListings.filter(row => row.listing_type === 'WTS').length,
      wtb_count: nonNegativeInteger(profile.wtb) ?? publicListings.filter(row => row.listing_type === 'WTB').length,
      group_count: nonNegativeInteger(profile.common_groups) ?? 0,
      first_post: dates[0]?.toISOString() || null,
      latest_post: dates.at(-1)?.toISOString() || null,
      verified_contact_info: null,
    },
    listings: publicListings,
    reviews: (profile.reviews || []).map(review => ({
      date: review.date || null,
      reviewer: review.reviewer || null,
      sentiment: review.sentiment || null,
    })),
    source_provenance: {
      source_system: SOURCE_SYSTEM,
      crawled_at: crawl.crawled_at || null,
      captured_listing_count: publicListings.length,
      captured_review_count: (profile.reviews || []).length,
    },
    raw_message_access: true,
  };
}

function ratedProfilePayload(identity) {
  const sourceId = sourceIdFromIdentity(identity);
  if (!sourceId) return null;
  const ratedIndex = (ratedDealers.profiles || []).findIndex(profile => String(profile.profile_id) === String(sourceId));
  if (ratedIndex < 0) return null;
  const summary = ratedProfileSummary(ratedDealers.profiles[ratedIndex], ratedIndex + 1);
  return {
    success: true,
    dealer: withoutPrivateProvenance(summary),
    stats: {
      wts_count: summary.stats?.wts_posts ?? null,
      wtb_count: summary.stats?.wtb_posts ?? null,
      group_count: summary.whatsapp_group_count ?? null,
      first_post: summary.stats?.first_post_at ?? null,
      latest_post: summary.stats?.last_post_at ?? null,
      verified_contact_info: summary.verified_phone
        ? { phone: summary.verified_phone, verification_status: 'SOURCE_PUBLISHED' }
        : null,
      review_count: summary.review_count,
      positive_feedback_count: summary.positive_feedback_count,
      negative_feedback_count: summary.negative_feedback_count,
    },
    listings: [],
    reviews: [],
    source_provenance: {
      source_system: RATED_SOURCE_SYSTEM,
      crawled_at: ratedDealers.crawled_at,
      captured_review_count: summary.review_count,
    },
    raw_message_access: false,
  };
}

function legacyProfilePayload(identity) {
  const match = String(identity || '').match(/^watchfacts-legacy-(\d+)$/i);
  if (!match) return null;
  const profile = legacyProfileForDealerId(match[1]);
  if (!profile) return null;
  const posts = (legacyAudit.posts || []).filter(row => String(row.legacy_profile_id) === match[1]);
  const snapshots = (legacyAudit.stat_snapshots || []).filter(row => String(row.legacy_profile_id) === match[1]);
  const postById = new Map(posts.map(row => [String(row.post_id), row]));
  const inventory = (legacyAudit.inventory_lines || [])
    .filter(row => String(row.legacy_profile_id) === match[1]);
  const inventoryListings = inventory.map(row => {
    const post = postById.get(String(row.post_id)) || null;
    return {
      id: `watchfacts-legacy-item-${row.item_row_id}`,
      post_id: row.post_id || null,
      source_line_no: row.source_line_no ?? null,
      category: row.category || null,
      brand: row.brand_context || null,
      reference: row.reference_candidate || null,
      dial_color: null,
      condition: row.condition_raw || null,
      year: row.year_raw || null,
      price_usd: null,
      currency: null,
      display_price: row.price_raw || null,
      currency_evidence_status: row.currency_status || null,
      listing_type: row.intent || post?.post_intent || null,
      listing_date: post?.posted_on || null,
      created_at: null,
      raw_message: row.raw_source_line || post?.raw_post_summary || null,
      image_url: null,
      repost_count: post?.repost_count ?? null,
      box: row.box_evidence || post?.page_box || null,
      papers: row.papers_evidence || post?.page_papers || null,
      availability_status: row.availability_status || null,
      quality_flags: row.quality_flags || null,
      evidence_only: true,
    };
  });
  const postListings = posts.map(row => ({
    id: `watchfacts-legacy-post-${row.post_id}`,
    brand: null, reference: null, dial_color: null, condition: null,
    price_usd: null, currency: null, listing_type: row.post_intent || null,
    listing_date: row.posted_on || null, created_at: null,
    raw_message: row.raw_post_summary || null, image_url: null,
    repost_count: row.repost_count,
    box: row.page_box || null, papers: row.page_papers || null,
    evidence_only: true,
  }));
  return {
    success: true,
    dealer: withoutPrivateProvenance(profile),
    stats: {
      wts_count: profile.stats.latest_captured_wts,
      wtb_count: profile.stats.latest_captured_wtb,
      group_count: null,
      first_post: null,
      latest_post: null,
      verified_contact_info: null,
      snapshot_range: profile.stats,
      captured_inventory_count: inventoryListings.length,
      captured_inventory_wts_count: inventoryListings.filter(row => row.listing_type === 'WTS').length,
      captured_inventory_wtb_count: inventoryListings.filter(row => row.listing_type === 'WTB').length,
    },
    listings: inventoryListings.length ? inventoryListings : postListings,
    stat_snapshots: snapshots.map(({ source_url: _sourceUrl, ...snapshot }) => snapshot),
    source_provenance: {
      source_system: LEGACY_SOURCE_SYSTEM,
      crawled_at: '2026-08-11',
      source_file: legacyAudit.source_file,
      source_sha256: legacyAudit.source_sha256,
      captured_at: '2026-08-11',
      counts_are_historical_snapshots: true,
    },
    raw_message_access: true,
  };
}

module.exports = {
  SOURCE_SYSTEM,
  LEGACY_SOURCE_SYSTEM,
  RATED_SOURCE_SYSTEM,
  MARIADB_SOURCE_SYSTEM,
  legacyProfileForDealerId,
  legacyProfilePayload,
  legacyProfiles,
  parsedSourceDate,
  ratedProfilePayload,
  sourceProfilePayload,
  sourcePhone,
  topRatedProfiles,
  ratedDealerEvidence,
  ratedProfiles,
  mariadbProfilePayload,
  mariadbProfiles,
  withoutPrivateProvenance,
};
