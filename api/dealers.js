'use strict';

const { getClient } = require('./_lib/supabase');
const { topRatedProfiles } = require('./_lib/dealer-directory-source.cjs');

function boundedInteger(value, fallback, minimum, maximum) {
  const parsed = Number.parseInt(String(value || ''), 10);
  return Number.isFinite(parsed) ? Math.min(maximum, Math.max(minimum, parsed)) : fallback;
}

function digits(value) {
  return String(value || '').replace(/[^0-9]/g, '');
}

async function loadVerifiedPhones(client, dealerIds) {
  if (!dealerIds.length) return new Map();
  const { data, error } = await client
    .from('dealer_source_identities')
    .select('dealer_id,source_identity,identity_type,verification_status')
    .in('dealer_id', dealerIds)
    .eq('verification_status', 'VERIFIED')
    .in('identity_type', ['PHONE', 'WHATSAPP', 'phone', 'whatsapp']);
  if (error) throw error;
  const result = new Map();
  for (const identity of data || []) {
    if (!result.has(identity.dealer_id)) result.set(identity.dealer_id, identity.source_identity);
  }
  return result;
}

async function phoneMatchedDealerIds(client, search) {
  const needle = digits(search);
  if (needle.length < 4) return null;
  const { data, error } = await client
    .from('dealer_source_identities')
    .select('dealer_id,source_identity')
    .eq('verification_status', 'VERIFIED')
    .in('identity_type', ['PHONE', 'WHATSAPP', 'phone', 'whatsapp'])
    .limit(5000);
  if (error) throw error;
  return [...new Set((data || [])
    .filter(row => digits(row.source_identity).includes(needle))
    .map(row => row.dealer_id))];
}

function publicDealer(dealer, stats, verifiedPhone, sourceRank) {
  const contactApproved = dealer.contact_consent === true;
  const {
    contact_consent: _contactConsent,
    ...publicProfile
  } = dealer;
  return {
    ...publicProfile,
    source_rank: sourceRank,
    source_system: 'WATCHFACTS_VERIFIED_DEALERS',
    verified_phone: contactApproved ? verifiedPhone : null,
    stats: stats || null,
  };
}

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'public, max-age=30, s-maxage=120, stale-while-revalidate=300');
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const page = boundedInteger(req.query?.page, 1, 1, 100000);
  const requestedPageSize = boundedInteger(req.query?.pageSize, 24, 1, 100);
  const search = String(req.query?.q || '').trim().slice(0, 100);
  const mode = String(req.query?.mode || '').trim().toLowerCase();
  const pageSize = mode === 'top-rated' ? Math.min(25, requestedPageSize) : requestedPageSize;
  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;

  try {
    if (mode === 'top-rated') {
      const normalizedSearch = search.toLocaleLowerCase();
      const phoneNeedle = digits(search);
      const sourceProfiles = topRatedProfiles()
        .filter(profile => !normalizedSearch
          || [profile.display_name, profile.company_name].some(value => String(value || '').toLocaleLowerCase().includes(normalizedSearch))
          || (phoneNeedle.length >= 4 && digits(profile.verified_phone).includes(phoneNeedle)))
        .slice(0, pageSize);
      return res.status(200).json({
        success: true,
        page: 1,
        pageSize,
        total: sourceProfiles.length,
        dealers: sourceProfiles,
        source: 'public-source-snapshot',
      });
    }
    const client = getClient();
    const phoneIds = mode === 'top-rated' ? null : await phoneMatchedDealerIds(client, search);
    if (phoneIds !== null && !phoneIds.length) {
      return res.status(200).json({
        success: true, page, pageSize, total: 0, dealers: [], source: 'database',
      });
    }

    let query = client
      .from('dealers')
      .select('id,slug,display_name,company_name,country_code,city,rating,review_count,whatsapp_group_count,avatar_url,profile_summary,verified_at,contact_consent', { count: 'exact' })
      .eq('status', 'VERIFIED')
      .order('rating', { ascending: false, nullsFirst: false })
      .order('review_count', { ascending: false })
      .order('display_name', { ascending: true })
      .range(from, to);

    if (phoneIds !== null) {
      query = query.in('id', phoneIds).eq('contact_consent', true);
    } else if (search) {
      const escaped = search.replace(/[%_,()]/g, ' ').trim();
      if (escaped) {
        query = query.or(`display_name.ilike.%${escaped}%,company_name.ilike.%${escaped}%,city.ilike.%${escaped}%`);
      }
    }

    const { data: dealers, count, error } = await query;
    if (error) throw error;
    const ids = (dealers || []).map(item => item.id);
    const [{ data: stats, error: statsError }, phonesByDealer] = await Promise.all([
      ids.length
        ? client.from('dealer_profile_stats').select('*').in('dealer_id', ids)
        : Promise.resolve({ data: [], error: null }),
      loadVerifiedPhones(client, ids),
    ]);
    if (statsError) throw statsError;
    const statsById = new Map((stats || []).map(item => [item.dealer_id, item]));
    const publicDealers = (dealers || []).map((dealer, index) => publicDealer(
      dealer,
      statsById.get(dealer.id),
      phonesByDealer.get(dealer.id) || null,
      from + index + 1,
    ));

    return res.status(200).json({
      success: true,
      page,
      pageSize,
      total: count || 0,
      dealers: publicDealers,
      source: 'database',
    });
  } catch (error) {
    console.error('[dealers]', error.message);
    const missingSchema = /relation .* does not exist|column .* does not exist|schema cache/i.test(error.message);
    return res.status(missingSchema ? 503 : 500).json({
      error: missingSchema
        ? 'Verified dealer profiles are awaiting the production migration.'
        : 'Unable to load dealer profiles.',
    });
  }
};

module.exports.publicDealer = publicDealer;
