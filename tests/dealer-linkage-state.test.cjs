'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  directoryDealersWithLinkageState,
  loadCompletedDealerIds,
  profileWithLinkageState,
} = require('../api/_lib/dealer-linkage-state.cjs');
const {
  sourceProfilePayload,
  topRatedProfiles,
} = require('../api/_lib/dealer-directory-source.cjs');

test('canonical directory never presents missing linkage as factual zero activity', () => {
  const [dealer] = directoryDealersWithLinkageState([{
    id: 'dealer-1', review_count: 22, whatsapp_group_count: 25,
    stats: { wts_posts: 0, wtb_posts: 0, first_post_at: null, last_post_at: null },
  }], new Set());
  assert.equal(dealer.listing_linkage_status, 'PENDING_EXACT_LISTING_LINKAGE');
  assert.equal(dealer.stats.wts_posts, null);
  assert.equal(dealer.stats.wtb_posts, null);
  assert.equal(dealer.review_count, 22);
  assert.equal(dealer.whatsapp_group_count, 25);
});

test('profile linkage decoration preserves review and group detail while withholding unknown activity', () => {
  const profile = profileWithLinkageState({
    dealer: { display_name: 'Dealer A' },
    stats: { wts_count: 0, wtb_count: 0, group_count: 3, first_post: null, latest_post: null },
    reviews: [{ reviewer: 'Reviewer A' }],
    groups: [{ name: 'Published group' }],
    listings: [],
  }, false);
  assert.equal(profile.stats.wts_count, null);
  assert.equal(profile.stats.wtb_count, null);
  assert.equal(profile.stats.group_count, 3);
  assert.equal(profile.reviews.length, 1);
  assert.equal(profile.groups.length, 1);
});

test('completed linkage preserves genuine zero released activity', () => {
  const [dealer] = directoryDealersWithLinkageState([{
    id: 'dealer-1',
    stats: { wts_posts: 0, wtb_posts: 0 },
  }], new Set(['dealer-1']));
  assert.equal(dealer.listing_linkage_status, 'LINKED_OR_NO_RELEASED_ACTIVITY');
  assert.equal(dealer.stats.wts_posts, 0);
  assert.equal(dealer.stats.wtb_posts, 0);
});

test('linkage readiness requires one durable completion checkpoint query', async () => {
  const calls = [];
  const client = {
    from(table) {
      calls.push(['from', table]);
      return {
        select(columns) {
          calls.push(['select', columns]);
          return {
            in(column, values) {
              calls.push(['in', column, values]);
              return {
                eq(statusColumn, statusValue) {
                  calls.push(['eq', statusColumn, statusValue]);
                  return {
                    async eq(conflictColumn, conflictValue) {
                      calls.push(['eq', conflictColumn, conflictValue]);
                      return { data: [{ dealer_id: 'complete' }], error: null };
                    },
                  };
                },
              };
            },
          };
        },
      };
    },
  };
  const linked = await loadCompletedDealerIds(client, ['complete', 'partial']);
  assert.deepEqual([...linked], ['complete']);
  assert.equal(calls.filter(call => call[0] === 'from').length, 1);
  assert.deepEqual(calls[0], ['from', 'dealer_listing_linkage_checkpoints']);
  assert.equal(JSON.stringify(calls).includes('dealer_listing_links'), false);
});

test('missing checkpoint contract fails safely to pending linkage', async () => {
  const client = {
    from() {
      return { select: () => ({ in: () => ({ eq: () => ({
        eq: async () => ({ data: null, error: { message: 'relation does not exist' } }),
      }) }) }) };
    },
  };
  assert.equal((await loadCompletedDealerIds(client, ['partial'])).size, 0);
});

test('mixed directory results preserve zero only for the individually linked dealer', () => {
  const dealers = directoryDealersWithLinkageState([
    { id: 'linked', stats: { wts_posts: 0, wtb_posts: 0 } },
    { id: 'unlinked', stats: { wts_posts: 0, wtb_posts: 0 } },
  ], new Set(['linked']));
  assert.equal(dealers[0].listing_linkage_status, 'LINKED_OR_NO_RELEASED_ACTIVITY');
  assert.equal(dealers[0].stats.wts_posts, 0);
  assert.equal(dealers[1].listing_linkage_status, 'PENDING_EXACT_LISTING_LINKAGE');
  assert.equal(dealers[1].stats.wts_posts, null);
});

test('source-backed profile details reconcile without exposing external source links', () => {
  const profiles = topRatedProfiles();
  assert.equal(profiles.length, 25);
  let capturedListings = 0;
  let capturedReviews = 0;
  for (const summary of profiles) {
    const payload = sourceProfilePayload(summary.id);
    assert.ok(payload);
    assert.equal(payload.stats.wts_count, summary.stats.wts_posts);
    assert.equal(payload.stats.wtb_count, summary.stats.wtb_posts);
    assert.equal(payload.stats.group_count, summary.whatsapp_group_count);
    assert.equal(payload.reviews.length, payload.source_provenance.captured_review_count);
    assert.equal(JSON.stringify(payload).includes('watchfacts.com'), false);
    assert.equal(Object.hasOwn(payload.dealer, 'source_url'), false);
    capturedListings += payload.listings.length;
    capturedReviews += payload.reviews.length;
  }
  assert.equal(capturedListings, 376);
  assert.equal(capturedReviews, 268);
});
