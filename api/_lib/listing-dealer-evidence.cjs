'use strict';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const LOOKUP_BATCH_SIZE = 100;
const MAX_EVIDENCE_ROWS = 300;

function chunks(values, size = LOOKUP_BATCH_SIZE) {
  const result = [];
  for (let index = 0; index < values.length; index += size) {
    result.push(values.slice(index, index + size));
  }
  return result;
}

function sourceBackedDealerEvidence(dealer, linkMethod = null) {
  const reviewCount = Math.max(0, Number(dealer?.review_count || 0));
  const rating = Number(dealer?.rating);
  const hasNumericRating = Number.isFinite(rating) && rating > 0 && reviewCount > 0;
  return {
    dealer_id: dealer.id,
    dealer_profile_path: `/reference-check/${dealer.id}`,
    seller_rating: hasNumericRating ? rating : null,
    seller_review_count: reviewCount,
    seller_rating_evidence_status: hasNumericRating
      ? 'SOURCE_SUPPLIED'
      : reviewCount > 0 ? 'SOURCE_FEEDBACK_COUNT' : 'UNAVAILABLE',
    seller_group_count: Math.max(0, Number(dealer?.whatsapp_group_count || 0)),
    dealer_directory_link_method: ['EXACT_VERIFIED_PHONE', 'AUTHENTICATED_SUBMISSION'].includes(linkMethod)
      ? linkMethod
      : null,
  };
}

async function enrichRowsWithExactDealerEvidence(client, rows = []) {
  if (!Array.isArray(rows) || rows.length === 0) return [];
  const allIds = [...new Set(rows
    .map(row => String(row?.id || '').trim())
    .filter(Boolean))]
    .slice(0, MAX_EVIDENCE_ROWS);
  const ids = allIds.filter(id => UUID_PATTERN.test(id));
  const reviewedIds = allIds.filter(id => id.startsWith('admission_') || id.startsWith('rpdelta_'));
  if (ids.length === 0 && reviewedIds.length === 0) return rows;

  try {
    const links = [];
    for (const batch of chunks(ids)) {
      const { data, error } = await client
        .from('dealer_listing_links')
        .select('listing_id,dealer_id,link_method')
        .eq('link_status', 'APPLIED')
        .in('listing_id', batch);
      if (error) throw error;
      links.push(...(data || []));
    }
    for (const batch of chunks(reviewedIds)) {
      const { data, error } = await client
        .from('reviewed_workbook_dealer_links')
        .select('reviewed_listing_id,dealer_id,link_method')
        .eq('link_status', 'APPLIED')
        .in('reviewed_listing_id', batch);
      if (error) throw error;
      links.push(...(data || []).map(link => ({
        listing_id: link.reviewed_listing_id,
        dealer_id: link.dealer_id,
        link_method: link.link_method,
      })));
    }
    if (links.length === 0) return rows;

    const dealerIds = [...new Set(links.map(link => String(link?.dealer_id || '').trim()).filter(Boolean))];
    const dealers = [];
    for (const batch of chunks(dealerIds)) {
      const { data, error } = await client
        .from('dealers')
        .select('id,rating,review_count,whatsapp_group_count,status')
        .eq('status', 'VERIFIED')
        .in('id', batch);
      if (error) throw error;
      dealers.push(...(data || []));
    }
    const dealerById = new Map(dealers.map(dealer => [String(dealer.id), dealer]));
    const dealerIdByListing = new Map(links.map(link => [String(link.listing_id), String(link.dealer_id)]));
    const linkMethodByListing = new Map(links.map(link => [String(link.listing_id), String(link.link_method || '')]));
    return rows.map(row => {
      const dealer = dealerById.get(dealerIdByListing.get(String(row?.id)));
      return dealer
        ? { ...row, ...sourceBackedDealerEvidence(dealer, linkMethodByListing.get(String(row?.id))) }
        : row;
    });
  } catch (error) {
    console.warn('[listing-dealer-evidence] exact ledger enrichment unavailable');
    return rows;
  }
}

module.exports = {
  LOOKUP_BATCH_SIZE,
  MAX_EVIDENCE_ROWS,
  enrichRowsWithExactDealerEvidence,
  sourceBackedDealerEvidence,
};
