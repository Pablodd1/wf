'use strict';

const HELD_BRANDS = new Set(['rolex', 'patek philippe']);
const BACKGROUND_HOLD_SOURCE = 'curated_luxury_rolex_patek_background_hold_v1';

function isRolexPatekBrand(brand) {
  return HELD_BRANDS.has(String(brand || '').trim().toLowerCase());
}

function isRolexPatekPublicationHeld(env = process.env) {
  const mode = String(env.ROLEX_PATEK_PUBLICATION_MODE || '').trim().toLowerCase();
  if (mode === 'live') return false;
  if (mode === 'background') return true;
  return String(env.VERCEL_ENV || '').trim().toLowerCase() === 'production';
}

function backgroundHoldResponse(extra = {}) {
  return {
    status: 'ok', count: 0, total: 0, records: [], hasMore: false,
    release_status: 'BACKGROUND_VERIFICATION',
    source: BACKGROUND_HOLD_SOURCE,
    ...extra,
  };
}

module.exports = {
  BACKGROUND_HOLD_SOURCE,
  backgroundHoldResponse,
  isRolexPatekBrand,
  isRolexPatekPublicationHeld,
};
