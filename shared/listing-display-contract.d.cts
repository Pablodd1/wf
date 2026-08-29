export const LISTING_DISPLAY_CONTRACT_VERSION: 'watchfacts-listing-display-v1';

export interface ListingDisplayContract {
  listing_display_contract_version: typeof LISTING_DISPLAY_CONTRACT_VERSION;
  id: string;
  source_listing_id: string | null;
  parent_listing_id: string | null;
  child_listing_id: string | null;
  duplicate_group_id: string | null;
  brand: string | null;
  model: string | null;
  reference: string | null;
  dial_color: string | null;
  configuration: string | null;
  condition: string | null;
  listing_type: string | null;
  listing_date: string | null;
  created_at: string | null;
  raw_message: string | null;
  source_price_text: string | null;
  source_price_amount: number | null;
  source_currency: string | null;
  price_usd: number | null;
  price_evidence_status: string | null;
  price_research_eligible: boolean | null;
  included_in_statistics: boolean | null;
  outlier_reason: string | null;
  seller_id: string | null;
  seller_name: string | null;
  seller_phone: string | null;
  contact_publication_approved: boolean;
  has_images: boolean;
  thumbnail_url: string | null;
  image_urls: string[];
  image_evidence_type: 'NO_IMAGE' | 'REFERENCE_IMAGE' | 'SELLER_LISTING_IMAGE' | 'SOURCE_LISTING_IMAGE' | 'SOURCE_LINKED_IMAGE';
  source: string | null;
  source_type: string | null;
  source_record_id: string | null;
  parser_version: string | null;
  decision_evidence: string | null;
  review_status: string | null;
}

export function enforceListingDisplayContract(input: Record<string, unknown>): ListingDisplayContract & Record<string, unknown>;
