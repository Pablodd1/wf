'use strict';

const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const workflow = fs.readFileSync(
  path.join(__dirname, '../.github/workflows/qnsa-non-watch-feed-release.yml'),
  'utf8',
);

test('non-watch release is pinned, allowlisted, audited, and bounded', () => {
  assert.match(workflow, /PROJECT_REF: qnsafosakvonzgfcsphh/);
  assert.match(workflow, /20260815103000_qnsa_non_watch_bounded_feed\.sql/);
  assert.match(workflow, /BEGIN;`n\$migration`nROLLBACK;/);
  assert.match(workflow, /JOIN public\.raw_message_versions rv/);
  assert.match(workflow, /bundle_status' = 'SINGLE_CANDIDATE'/);
  assert.match(workflow, /APPLY_QNSA_NON_WATCH/);
  assert.match(workflow, /qnsa_non_watch_market_page_rows\('HANDBAG', 2/);
  assert.doesNotMatch(workflow, /supabase db push|--include-all|migration repair/i);
});
