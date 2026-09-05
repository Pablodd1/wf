export type {
  ListingDisplayContract,
  ImageEvidenceType,
} from '../../shared/listing-display-contract.d.cts';

export {
  LISTING_DISPLAY_CONTRACT_VERSION,
  CANONICAL_CONTRACT_KEYS,
  DO_SPACES_BASE,
  constructCandidateImageUrl,
  assignImageEvidenceType,
  verifyImageReachability,
  enforceListingDisplayContract,
} from '../../shared/listing-display-contract.cjs';

export function validateListingDisplayContract(item: Record<string, unknown>): boolean {
  const requiredKeys: string[] = [
    'contract_version', 'listing_id', 'parent_listing_id', 'child_index', 'source_id',
    'source_hash', 'raw_message_id', 'raw_message_text', 'source_context_text', 'source_created_at',
    'observed_at', 'category', 'brand', 'model', 'reference', 'dial_color', 'year', 'condition',
    'intent', 'intent_status', 'title', 'description', 'original_price_text', 'original_price_amount',
    'original_price_currency', 'price_usd', 'fx_rate', 'fx_source', 'fx_date', 'price_status',
    'price_research_eligible', 'included_in_statistics', 'statistics_exclusion_reason', 'image_url',
    'thumbnail_url', 'image_key', 'image_evidence_type', 'image_status', 'seller_id',
    'seller_display_name', 'seller_profile_url', 'seller_review_count', 'seller_listing_count',
    'seller_wts_count', 'seller_wtb_count', 'contact_available', 'location_country',
    'location_region', 'is_bundle', 'bundle_child_count', 'review_status', 'review_reasons'
  ];

  for (const k of requiredKeys) {
    if (item[k] === undefined) {
      throw new Error(`ListingDisplayContract validation error: key "${k}" is missing`);
    }
  }
  return true;
}

