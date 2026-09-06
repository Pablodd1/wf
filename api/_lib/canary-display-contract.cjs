'use strict';
const { enforceListingDisplayContract: enforce } = require('../../shared/listing-display-contract.cjs');

// A genuine external preview needs a reachable synthetic image origin. This
// transport override cannot apply to production or to real listing evidence.
function enforceListingDisplayContract(input) {
  const result = enforce(input);
  const base = process.env.DISPOSABLE_IMAGE_BASE_URL;
  if (!base) return result;
  if (process.env.VERCEL_ENV !== 'preview' || process.env.WF_DISPOSABLE_PREVIEW !== 'true'
    || !/^https:\/\/[a-z0-9-]+\.trycloudflare\.com\/images$/.test(base)
    || !String(input.listing_id).startsWith('RC50-')
    || !String(input.raw_message_text).startsWith('[SYNTHETIC FIXTURE]')) {
    throw new Error('Disposable image origin refused');
  }
  if (result.image_url) {
    if (!/^rc50\/RC50-[A-Z0-9-]+\.png$/.test(result.image_key)) {
      throw new Error('Disposable image key refused');
    }
    result.image_url = `${base}/${result.image_key}`;
    result.thumbnail_url = result.image_url;
  }
  return result;
}
module.exports = { enforceListingDisplayContract };
