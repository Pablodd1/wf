'use strict';

const { getClient } = require('./_lib/supabase');
const {
  legacyProfiles,
  mariadbProfiles,
  ratedProfiles,
  withoutPrivateProvenance,
} = require('./_lib/dealer-directory-source.cjs');
const { directoryDealersWithLinkageState, loadCompletedDealerIds } = require('./_lib/dealer-linkage-state.cjs');

function boundedInteger(value, fallback, minimum, maximum) {
  const parsed = Number.parseInt(String(value || ''), 10);
  return Number.isFinite(parsed) ? Math.min(maximum, Math.max(minimum, parsed)) : fallback;
}

function digits(value) {
  return String(value || '').replace(/[^0-9]/g, '');
}

function canonicalDirectoryFallbackAllowed(error) {
  const code = String(error?.code || '').trim();
  const message = String(error?.message || '');
  return code === '57014'
    || /canceling statement due to statement timeout|statement timeout/i.test(message)
    || /function .*qnsa_dealer_directory_page.*does not exist|schema cache/i.test(message);
}

function optionalDealerStatsUnavailable(error) {
  if (!error) return false;
  return /relation .*dealer_profile_stats.* does not exist|dealer_profile_stats.*schema cache/i
    .test(`${error.code || ''} ${error.message || error}`);
}

function normalizedDirectoryText(value) {
  return String(value || '').trim().toLocaleLowerCase();
}

function dealerName(dealer) {
  return dealer.display_name || dealer.company_name || '';
}

function dealerActivity(dealer) {
  return Number(dealer.stats?.wts_posts || 0) + Number(dealer.stats?.wtb_posts || 0);
}

function sortUnifiedDealers(dealers, ranked = false) {
  return dealers.slice().sort((left, right) => {
    if (ranked) {
      const reviewDifference = Number(right.review_count || 0) - Number(left.review_count || 0);
      if (reviewDifference) return reviewDifference;
      const groupDifference = Number(right.whatsapp_group_count || 0) - Number(left.whatsapp_group_count || 0);
      if (groupDifference) return groupDifference;
      const activityDifference = dealerActivity(right) - dealerActivity(left);
      if (activityDifference) return activityDifference;
    }
    return dealerName(left).localeCompare(dealerName(right), undefined, { sensitivity: 'base' });
  });
}

function directorySearchMatches(dealer, search) {
  const needle = normalizedDirectoryText(search);
  if (!needle) return true;
  return [dealer.display_name, dealer.company_name, dealer.city, dealer.country_code]
    .some(value => normalizedDirectoryText(value).includes(needle));
}

function unifiedDealerPage({ canonicalDealers, sourceCandidates, mode, search, page, pageSize }) {
  const digitsOnlySearch = digits(search);
  let profiles = digitsOnlySearch.length >= 4
    ? canonicalDealers
    : [...canonicalDealers, ...sourceCandidates].filter(profile => directorySearchMatches(profile, search));
  if (mode === 'rated' || mode === 'top-rated') {
    profiles = profiles.filter(profile => Number(profile.review_count || 0) > 0);
  }
  profiles = sortUnifiedDealers(profiles, mode === 'rated' || mode === 'top-rated');
  if (mode === 'top-rated') profiles = profiles.slice(0, 25);
  const total = profiles.length;
  const from = (page - 1) * pageSize;
  const pageProfiles = profiles.slice(from, from + pageSize).map((profile, index) => ({
    ...withoutPrivateProvenance(profile),
    source_rank: mode === 'rated' || mode === 'top-rated' ? from + index + 1 : profile.source_rank,
  }));
  return { total, dealers: pageProfiles };
}

async function loadCanonicalDealerRows(client, search) {
  const rows = [];
  let offset = 0;
  let expectedTotal = null;
  for (let page = 0; page < 20; page += 1) {
    const { data, error } = await client.rpc('qnsa_dealer_directory_page', {
      p_search: search || null,
      p_limit: 100,
      p_offset: offset,
    });
    if (error) return { data: null, error };
    const pageRows = Array.isArray(data?.dealers) ? data.dealers : [];
    expectedTotal = Number(data?.total || 0);
    rows.push(...pageRows);
    offset += pageRows.length;
    if (!pageRows.length || rows.length >= expectedTotal) break;
  }
  if (expectedTotal !== null && rows.length < expectedTotal) {
    return { data: null, error: new Error('Canonical dealer directory pagination did not reconcile') };
  }
  return { data: { dealers: rows, total: expectedTotal || rows.length }, error: null };
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
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'public, max-age=30, s-maxage=120, stale-while-revalidate=300');
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const page = boundedInteger(req.query?.page, 1, 1, 100000);
  const requestedPageSize = boundedInteger(req.query?.pageSize, 24, 1, 100);
  const search = String(req.query?.q || '').trim().slice(0, 100);
  const mode = String(req.query?.mode || '').trim().toLowerCase();
  const pageSize = mode === 'top-rated' ? Math.min(25, requestedPageSize)
    : mode === 'rated' ? Math.min(100, requestedPageSize)
    : requestedPageSize;
  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;

  try {
    if (mode === 'legacy') {
      const normalizedSearch = search.toLocaleLowerCase();
      const profiles = legacyProfiles().filter(profile => !normalizedSearch
        || [profile.display_name, profile.legacy_profile_id, profile.country_code]
          .some(value => String(value || '').toLocaleLowerCase().includes(normalizedSearch)));
      const legacyFrom = (page - 1) * pageSize;
      return res.status(200).json({
        success: true, page, pageSize, total: profiles.length,
        dealers: profiles.slice(legacyFrom, legacyFrom + pageSize).map(withoutPrivateProvenance),
        source: 'legacy-profile-audit',
      });
    }
    const client = getClient();
    const phoneSearch = digits(search).length >= 4 ? search : null;
    const { data: canonicalPage, error: canonicalError } = await loadCanonicalDealerRows(client, phoneSearch);
    if (!canonicalError && canonicalPage) {
      const canonicalDealers = canonicalPage.dealers || [];
      const completedDealerIds = await loadCompletedDealerIds(client, canonicalDealers.map(dealer => dealer.id));
      const unified = unifiedDealerPage({
        canonicalDealers: directoryDealersWithLinkageState(canonicalDealers, completedDealerIds),
        sourceCandidates: mariadbProfiles(),
        mode,
        search,
        page,
        pageSize,
      });
      return res.status(200).json({
        success: true,
        page,
        pageSize,
        total: unified.total,
        dealers: unified.dealers,
        source: 'unified-canonical-database-and-mariadb-candidates',
        reconciliation: {
          canonical_database_profiles: canonicalDealers.length,
          mariadb_source_profiles: mariadbProfiles().length,
          all_dealers_total: mode === 'all' || !mode ? unified.total : undefined,
          rated_is_filtered_from_all: true,
          top_rated_is_filtered_from_rated: true,
        },
      });
    }
    if (canonicalError && !canonicalDirectoryFallbackAllowed(canonicalError)) {
      throw canonicalError;
    }
    if (canonicalError) {
      const fallback = unifiedDealerPage({
        canonicalDealers: digits(search).length >= 4 ? [] : ratedProfiles(),
        sourceCandidates: mariadbProfiles(),
        mode,
        search,
        page,
        pageSize,
      });
      return res.status(200).json({
        success: true,
        page,
        pageSize,
        total: fallback.total,
        dealers: fallback.dealers,
        source: 'unified-static-reconciliation-fallback',
        reconciliation: {
          canonical_database_profiles: null,
          rated_snapshot_profiles: ratedProfiles().length,
          mariadb_source_profiles: mariadbProfiles().length,
          rated_is_filtered_from_all: true,
          top_rated_is_filtered_from_rated: true,
        },
      });
    }
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
      loadVerifiedPhones(client, (dealers || [])
        .filter(dealer => dealer.contact_consent === true)
        .map(dealer => dealer.id)),
    ]);
    if (statsError && !optionalDealerStatsUnavailable(statsError)) throw statsError;
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
    if (mode !== 'legacy' && (/Missing SUPABASE_URL|Missing SUPABASE.*key/i.test(error.message)
      || canonicalDirectoryFallbackAllowed(error))) {
      const fallback = unifiedDealerPage({
        canonicalDealers: digits(search).length >= 4 ? [] : ratedProfiles(),
        sourceCandidates: mariadbProfiles(),
        mode,
        search,
        page,
        pageSize,
      });
      return res.status(200).json({
        success: true,
        page,
        pageSize,
        total: fallback.total,
        dealers: fallback.dealers,
        source: 'unified-static-reconciliation-fallback',
        reconciliation: {
          canonical_database_profiles: null,
          rated_snapshot_profiles: ratedProfiles().length,
          mariadb_source_profiles: mariadbProfiles().length,
          rated_is_filtered_from_all: true,
          top_rated_is_filtered_from_rated: true,
        },
      });
    }
    const missingSchema = /relation .* does not exist|column .* does not exist|schema cache/i.test(error.message);
    return res.status(missingSchema ? 503 : 500).json({
      error: missingSchema
        ? 'Verified dealer profiles are awaiting the production migration.'
        : 'Unable to load dealer profiles.',
    });
  }
};

module.exports.publicDealer = publicDealer;
module.exports.canonicalDirectoryFallbackAllowed = canonicalDirectoryFallbackAllowed;
module.exports.optionalDealerStatsUnavailable = optionalDealerStatsUnavailable;
module.exports.unifiedDealerPage = unifiedDealerPage;
module.exports.loadCanonicalDealerRows = loadCanonicalDealerRows;
