type FeaturedListing = {
  brand?: string | null;
  reference?: string | null;
  dial_color?: string | null;
  price_usd?: number | null;
  verdict?: string | null;
  listing_type?: string | null;
  confidence?: number | null;
  has_images?: boolean | null;
  thumbnail_url?: string | null;
};

const MISSING_VALUES = new Set(['', 'n/a', 'na', 'none', 'null', 'unknown', 'undefined']);

function hasUsableValue(value: string | null | undefined) {
  return !MISSING_VALUES.has(String(value || '').trim().toLowerCase());
}

export function isCustomerSafeFeaturedListing(listing: FeaturedListing) {
  const price = Number(listing.price_usd);
  const confidence = Number(listing.confidence);

  return Boolean(
    listing.has_images &&
    listing.thumbnail_url &&
    listing.verdict === 'APPROVED' &&
    listing.listing_type === 'WTS' &&
    hasUsableValue(listing.brand) &&
    hasUsableValue(listing.reference) &&
    hasUsableValue(listing.dial_color) &&
    Number.isFinite(price) &&
    price >= 1_000 &&
    price <= 2_500_000 &&
    !(Number.isInteger(price) && price >= 1900 && price <= new Date().getUTCFullYear() + 2) &&
    Number.isFinite(confidence) &&
    confidence >= 85 &&
    confidence <= 100
  );
}
