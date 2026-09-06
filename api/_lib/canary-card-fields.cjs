'use strict';

// Called only after strict contract validation and public text redaction.
// Existing cards use these field names. Aliases must describe the canonical
// record, never legacy fallbacks or the unvalidated input payload.
function withExistingCardFields(canonical) {
  return {
    ...canonical,
    raw_message: canonical.raw_message_text,
    raw_message_scope: canonical.raw_message_text === null ? 'unavailable' : 'stored_source_message',
    raw_message_evidence_type: canonical.raw_message_text === null ? null : 'SOURCE_RAW_MESSAGE',
    raw_message_truncated: false,
    source_price_text: canonical.original_price_text,
    source_price_amount: canonical.original_price_amount,
    source_currency: canonical.original_price_currency,
    price_raw: canonical.original_price_amount,
    currency: canonical.original_price_currency,
    listing_date: canonical.source_created_at,
    created_at: canonical.source_created_at,
    location: canonical.location_country,
    seller_country: canonical.location_country,
    dealer_profile_path: canonical.seller_profile_url,
    region: canonical.location_region,
    imageUrl: canonical.image_url,
    has_images: Boolean(canonical.image_url && canonical.image_status === 'SOURCE_IMAGE_PRESENT'
      && ['SOURCE_LINKED_IMAGE', 'ASSIGNED_CHILD_IMAGE'].includes(canonical.image_evidence_type)),
    multi_listing: canonical.is_bundle,
    is_unbundled_child: canonical.parent_listing_id !== null,
  };
}

module.exports = { withExistingCardFields };
