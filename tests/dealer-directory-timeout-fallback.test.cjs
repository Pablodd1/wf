const test = require('node:test');
const assert = require('node:assert/strict');

const {
  canonicalDirectoryFallbackAllowed,
  optionalDealerStatsUnavailable,
} = require('../api/dealers.js');

test('canonical directory falls back only for deploy gaps and read timeouts', () => {
  assert.equal(canonicalDirectoryFallbackAllowed({ code: '57014', message: 'canceling statement' }), true);
  assert.equal(canonicalDirectoryFallbackAllowed({ message: 'canceling statement due to statement timeout' }), true);
  assert.equal(canonicalDirectoryFallbackAllowed({ message: 'function qnsa_dealer_directory_page does not exist' }), true);
  assert.equal(canonicalDirectoryFallbackAllowed({ message: 'schema cache is stale' }), true);

  assert.equal(canonicalDirectoryFallbackAllowed({ code: '42501', message: 'permission denied' }), false);
  assert.equal(canonicalDirectoryFallbackAllowed({ code: 'PGRST301', message: 'JWT expired' }), false);
  assert.equal(canonicalDirectoryFallbackAllowed({ code: 'XX000', message: 'unexpected database error' }), false);
});

test('canonical fallback treats only the optional legacy stats view as absent', () => {
  assert.equal(optionalDealerStatsUnavailable({
    code: '42P01', message: 'relation "public.dealer_profile_stats" does not exist',
  }), true);
  assert.equal(optionalDealerStatsUnavailable({
    code: 'PGRST205', message: "Could not find the table 'public.dealer_profile_stats' in the schema cache",
  }), true);
  assert.equal(optionalDealerStatsUnavailable({
    code: '42501', message: 'permission denied for table dealer_profile_stats',
  }), false);
  assert.equal(optionalDealerStatsUnavailable({
    code: '42P01', message: 'relation "public.dealers" does not exist',
  }), false);
});
