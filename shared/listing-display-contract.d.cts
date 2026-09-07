export const LISTING_DISPLAY_CONTRACT_VERSION: 'v2.0';
export const CANONICAL_CONTRACT_KEYS: readonly string[];
export const DO_SPACES_BASE: string;

export type ImageEvidenceType =
  | 'SOURCE_LINKED_IMAGE'
  | 'PARENT_ATTACHMENT_UNASSIGNED_TO_CHILD'
  | 'ASSIGNED_CHILD_IMAGE'
  | 'CHILD_UNASSIGNED_IMAGE'
  | 'NO_IMAGE';

export interface ListingDisplayContract {
  contract_version: string;
  listing_id: string;
  parent_listing_id: string | null;
  child_index: number | null;
  source_id: string;
  source_hash: string;
  raw_message_id: string;
  raw_message_text: string | null;
  source_context_text: string | null;
  source_created_at: string | null;
  observed_at: string | null;
  category: string | null;
  brand: string | null;
  model: string | null;
  reference: string | null;
  dial_color: string | null;
  year: number | null;
  condition: string | null;
  intent: 'WTS' | 'WTB' | null;
  intent_status: string | null;
  title: string | null;
  description: string | null;
  original_price_text: string | null;
  original_price_amount: number | null;
  original_price_currency: string | null;
  price_usd: number | null;
  fx_rate: number | null;
  fx_source: string | null;
  fx_date: string | null;
  price_status: string | null;
  price_research_eligible: boolean;
  included_in_statistics: boolean;
  statistics_exclusion_reason: string | null;
  image_url: string | null;
  thumbnail_url: string | null;
  image_key: string | null;
  image_evidence_type: ImageEvidenceType | string;
  image_status: 'SOURCE_IMAGE_PRESENT' | 'NO_IMAGE';
  seller_id: string | null;
  seller_display_name: string | null;
  seller_profile_url: string | null;
  seller_review_count: number | null;
  seller_listing_count: number | null;
  seller_wts_count: number | null;
  seller_wtb_count: number | null;
  contact_available: boolean;
  location_country: string | null;
  location_region: string | null;
  is_bundle: boolean;
  bundle_child_count: number | null;
  review_status: string | null;
  review_reasons: string[] | null;

  // Compatibility properties for React UI callers
  id: string;
  price: number | null;
  sellerName: string | null;
  seller_name: string | null;
  imageUrl: string | null;
  listing_type: string | null;
  bundle_status: string;
  raw_message_available: boolean;
  price_display_verified: boolean;
  price_evidence_status: string | null;
  image_reachable?: boolean | null;
  duplicate_group_id?: string | null;
  listing_display_contract_version: string;
}

export function constructCandidateImageUrl(imageKey: string | null | undefined): string | null;

export function assignImageEvidenceType(params: {
  imageKey: string | null | undefined;
  candidateUrl: string | null | undefined;
  hasSourceLineage: boolean;
  isReachable?: boolean | null;
  isBundle?: boolean;
  isChild?: boolean;
  childAssigned?: boolean;
  parentHasAttachment?: boolean;
}): ImageEvidenceType;

export function verifyImageReachability(url: string | null | undefined, options?: { method?: 'HEAD' | 'GET'; timeoutMs?: number }): Promise<{
  reachable: boolean;
  status: number;
  contentType: string | null;
  isImage?: boolean;
  error?: string;
}>;

export function enforceListingDisplayContract(input: Record<string, unknown>): ListingDisplayContract;

export function adaptLegacyListingDisplayV1(input: Record<string, unknown>): ListingDisplayContract;

export const LEGACY_LISTING_DISPLAY_CONTRACT_VERSION: 'watchfacts-listing-display-v1';

export const PROVENANCE_ERROR_CODES: {
  readonly PROVENANCE_MISSING: 'PROVENANCE_MISSING';
  readonly PROVENANCE_HASH_MALFORMED: 'PROVENANCE_HASH_MALFORMED';
  readonly PROVENANCE_IDENTITY_CONFLICT: 'PROVENANCE_IDENTITY_CONFLICT';
  readonly LINEAGE_PARENT_WITHOUT_CHILD: 'LINEAGE_PARENT_WITHOUT_CHILD';
  readonly LINEAGE_CHILD_WITHOUT_PARENT: 'LINEAGE_CHILD_WITHOUT_PARENT';
  readonly LINEAGE_CHILD_INDEX_MALFORMED: 'LINEAGE_CHILD_INDEX_MALFORMED';
};

